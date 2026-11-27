import { NotFoundError, RateLimitError, ValidationError } from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitGroupRepository,
  type GroupInvitationSummary,
  type GroupMemberProfile,
  type GroupSharedHabit,
  type GroupSummary,
  type HabitGroupRepository,
} from "@/server/dal/habit-groups";
import {
  habitSocialRepository,
  type HabitSocialRepository,
} from "@/server/dal/habits-social";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type { HabitGroupRecord, HabitGroupRole } from "@/server/db/schema";
import {
  addDaysToDateKey,
  computeHabitStreaks,
  getLocalDateKey,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

const MAX_MEMBERS_PER_GROUP = 50;
const MAX_GROUPS_PER_USER = 30;

type GroupRateLimitBucket = "habit_group_create" | "habit_group_invite";

export interface CreateGroupInput {
  name: string;
  description?: string | null;
  memberEmails: string[];
}

export interface GroupMemberMetrics {
  habitId: string;
  title: string;
  ownerId: string;
  ownerName: string;
  completionPct: number | null;
  doneCount: number;
  scheduledCount: number;
  currentStreak: number;
  bestStreak: number;
  streakUnit: "days" | "weeks";
}

export interface GroupWorkspace {
  group: HabitGroupRecord;
  members: GroupMemberProfile[];
  sharedHabits: GroupSharedHabit[];
  metrics: GroupMemberMetrics[];
  periodStartDate: string;
  periodEndDate: string;
  canManageMembers: boolean;
}

export interface HabitGroupServiceDeps {
  database?: AppDatabase;
  groups?: HabitGroupRepository;
  social?: HabitSocialRepository;
  habits?: HabitRepository;
  notifications?: NotificationRepository;
  rateLimiter?: RateLimiter;
  now?: () => number;
}

export class HabitGroupService {
  private readonly database: AppDatabase;
  private readonly groups: HabitGroupRepository;
  private readonly social: HabitSocialRepository;
  private readonly habits: HabitRepository;
  private readonly notifications: NotificationRepository;
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(deps: HabitGroupServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.groups = deps.groups ?? habitGroupRepository;
    this.social = deps.social ?? habitSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.notifications = deps.notifications ?? notificationRepository;
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.now = deps.now ?? (() => Date.now());
  }

  private async enforceRateLimit(
    bucket: GroupRateLimitBucket,
    actorId: string
  ): Promise<void> {
    const limitResult = await this.rateLimiter.limit(bucket, actorId);
    if (!limitResult.allowed) {
      throw new RateLimitError({
        message: `Group request limit reached. Retry in ${limitResult.retryAfterSeconds}s.`,
        retryAfterSeconds: limitResult.retryAfterSeconds,
        limit: limitResult.limit,
        remaining: limitResult.remaining,
        resetAtMs: limitResult.resetAtMs,
      });
    }
  }

  listGroups(userId: string): Promise<GroupSummary[]> {
    return this.groups.listGroupsForUser(userId);
  }

  listPendingInvitations(userId: string): Promise<GroupInvitationSummary[]> {
    return this.groups.listPendingInvitationsForUser(userId);
  }

  async createGroup(
    actorId: string,
    input: CreateGroupInput
  ): Promise<HabitGroupRecord> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new ValidationError("Group name must be 2–80 characters.");
    }

    await this.enforceRateLimit("habit_group_create", actorId);

    const existing = await this.groups.listGroupsForUser(actorId);
    if (existing.length >= MAX_GROUPS_PER_USER) {
      throw new ValidationError(
        `You can belong to at most ${MAX_GROUPS_PER_USER} groups.`
      );
    }

    const invitedUserIds = new Set<string>();
    for (const rawEmail of input.memberEmails) {
      const email = rawEmail.trim().toLowerCase();
      if (!email) continue;
      // Unknown and unverified emails are ignored with the same neutral result
      // as known accounts so invites cannot be used to enumerate FOLIO users.
      const user = await this.social.findUserByNormalizedEmail(email);
      if (!user || !user.emailVerified || user.id === actorId) continue;
      invitedUserIds.add(user.id);
      if (invitedUserIds.size >= MAX_MEMBERS_PER_GROUP - 1) break;
    }

    const nowMs = this.now();
    const group = await withDbRetry(() =>
      this.database.transaction((tx) =>
        this.groups.createGroupWithMembers(
          {
            ownerId: actorId,
            name,
            description: input.description?.trim() || null,
            invitedUserIds: Array.from(invitedUserIds),
            nowMs,
          },
          tx
        )
      )
    );

    const members = await this.groups.listMembers(group.id, actorId);
    const inviterName =
      members.find((member) => member.userId === actorId)?.name ??
      "A FOLIO member";
    await Promise.all(
      Array.from(invitedUserIds).map((userId) =>
        this.notifications.create({
          userId,
          type: "habit.group_invited",
          title: `You're invited to ${name}`,
          body: `${inviterName} invited you to join an accountability group. Accept the invitation to see shared progress.`,
          entityType: "habit_group",
          entityId: group.id,
        })
      )
    );

    return group;
  }

  /**
   * Invites a verified FOLIO user by email. Unknown, unverified, duplicate, and
   * self-invites all complete silently to avoid account enumeration.
   */
  async inviteMemberByEmail(
    actorId: string,
    groupId: string,
    email: string
  ): Promise<void> {
    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");

    await this.enforceRateLimit("habit_group_invite", actorId);

    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.social.findUserByNormalizedEmail(normalizedEmail);
    if (!user || !user.emailVerified || user.id === actorId) return;

    const invited = await this.groups.inviteMember({
      groupId,
      actorId,
      userId: user.id,
      nowMs: this.now(),
    });
    if (!invited) return;

    const members = await this.groups.listMembers(groupId, actorId);
    const inviterName =
      members.find((member) => member.userId === actorId)?.name ??
      "A FOLIO member";
    await this.notifications.create({
      userId: user.id,
      type: "habit.group_invited",
      title: `You're invited to ${group.name}`,
      body: `${inviterName} invited you to join an accountability group. Accept the invitation to see shared progress.`,
      entityType: "habit_group",
      entityId: group.id,
    });
  }

  /** @deprecated Use `inviteMemberByEmail`; invitations always require consent. */
  addMemberByEmail(
    actorId: string,
    groupId: string,
    email: string
  ): Promise<void> {
    return this.inviteMemberByEmail(actorId, groupId, email);
  }

  async acceptGroupInvitation(
    actorId: string,
    groupId: string
  ): Promise<HabitGroupRecord> {
    const accepted = await this.groups.acceptInvitation({
      groupId,
      userId: actorId,
      nowMs: this.now(),
    });
    if (!accepted) throw new NotFoundError("Invitation not found.");

    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");

    await this.notifications.create({
      userId: actorId,
      type: "habit.group_joined",
      title: `You joined ${group.name}`,
      body: "Share a habit and post your first weekly review to get started.",
      entityType: "habit_group",
      entityId: group.id,
    });
    return group;
  }

  async declineGroupInvitation(actorId: string, groupId: string): Promise<void> {
    const declined = await this.groups.declineInvitation({
      groupId,
      userId: actorId,
    });
    if (!declined) throw new NotFoundError("Invitation not found.");
  }

  async setMemberRole(
    actorId: string,
    groupId: string,
    userId: string,
    role: HabitGroupRole
  ): Promise<void> {
    await this.groups.setMemberRole({ groupId, actorId, userId, role });
  }

  async removeMember(
    actorId: string,
    groupId: string,
    userId: string
  ): Promise<void> {
    await this.groups.removeMember({ groupId, actorId, userId });
  }

  async leaveGroup(actorId: string, groupId: string): Promise<void> {
    await this.groups.leaveGroup({ groupId, userId: actorId });
  }

  async shareHabit(
    actorId: string,
    groupId: string,
    habitId: string
  ): Promise<void> {
    await this.groups.shareHabit({
      groupId,
      actorId,
      habitId,
      nowMs: this.now(),
    });
  }

  async unshareHabit(
    actorId: string,
    groupId: string,
    habitId: string
  ): Promise<void> {
    await this.groups.unshareHabit({ groupId, actorId, habitId });
  }

  async getWorkspace(actorId: string, groupId: string): Promise<GroupWorkspace> {
    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");

    const [members, sharedHabits] = await Promise.all([
      this.groups.listMembers(groupId, actorId),
      this.groups.listSharedHabits(groupId, actorId),
    ]);

    const myMembership = members.find((member) => member.userId === actorId);
    const periodEndDate = getLocalDateKey(this.now(), myMembership?.timezone || "UTC");
    const periodStartDate = addDaysToDateKey(periodEndDate, -6);
    const metrics = await this.getMemberMetrics(
      sharedHabits,
      periodStartDate,
      periodEndDate
    );

    return {
      group,
      members,
      sharedHabits,
      metrics,
      periodStartDate,
      periodEndDate,
      canManageMembers:
        myMembership?.role === "owner" || myMembership?.role === "admin",
    };
  }

  private async getMemberMetrics(
    sharedHabits: GroupSharedHabit[],
    periodStartDate: string,
    periodEndDate: string
  ): Promise<GroupMemberMetrics[]> {
    // One log query per habit owner, never one per shared habit. The query is
    // intentionally coarse (all habits in the window); filtering below by
    // habitId is the security boundary that keeps private habits private.
    const earliestStartDateByOwner = new Map<string, string>();
    for (const shared of sharedHabits) {
      const current = earliestStartDateByOwner.get(shared.ownerId);
      if (!current || shared.startDate < current) {
        earliestStartDateByOwner.set(shared.ownerId, shared.startDate);
      }
    }

    const logsByOwner = new Map<
      string,
      Awaited<ReturnType<HabitRepository["listLogsForRange"]>>
    >();
    await Promise.all(
      Array.from(earliestStartDateByOwner.entries()).map(
        async ([ownerId, startDate]) => {
          logsByOwner.set(
            ownerId,
            await this.habits.listLogsForRange(ownerId, startDate, periodEndDate)
          );
        }
      )
    );

    return Promise.all(
      sharedHabits.map(async (shared): Promise<GroupMemberMetrics> => {
        const logs = logsByOwner.get(shared.ownerId) ?? [];
        const logMap = new Map(
          logs
            .filter((log) => log.habitId === shared.habitId)
            .map((log) => [log.dateKey, log.status])
        );
        const scheduledDays = parseScheduledDaysJson(shared.scheduledDaysJson);
        const streaks = computeHabitStreaks(
          {
            id: shared.habitId,
            title: shared.title,
            cadenceType: shared.cadenceType,
            scheduledDays,
            weeklyTargetCount: shared.weeklyTargetCount,
            startDate: shared.startDate,
          },
          logMap as Parameters<typeof computeHabitStreaks>[1],
          periodEndDate
        );

        let doneCount = 0;
        let scheduledCount = 0;
        let cursor = periodStartDate;
        let guard = 0;
        while (cursor <= periodEndDate && guard < 14) {
          guard += 1;
          if (
            isHabitScheduledOnDate(
              {
                cadenceType: shared.cadenceType,
                scheduledDays,
                startDate: shared.startDate,
              },
              cursor
            )
          ) {
            const status = logMap.get(cursor);
            if (status !== "skipped") {
              scheduledCount += 1;
              if (status === "done") doneCount += 1;
            }
          }
          cursor = addDaysToDateKey(cursor, 1);
        }

        return {
          habitId: shared.habitId,
          title: shared.title,
          ownerId: shared.ownerId,
          ownerName: shared.ownerName,
          completionPct:
            scheduledCount > 0
              ? Math.round((doneCount / scheduledCount) * 100)
              : null,
          doneCount,
          scheduledCount,
          currentStreak: streaks.currentStreak,
          bestStreak: streaks.bestStreak,
          streakUnit: streaks.streakUnit,
        };
      })
    );
  }
}

export const habitGroupService = new HabitGroupService();
