import {
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitGroupRepository,
  type GroupInvitationSummary,
  type GroupMemberProfile,
  type GroupReviewWithAuthor,
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
import type {
  HabitGroupRecord,
  HabitGroupReviewRecord,
  HabitGroupRole,
} from "@/server/db/schema";
import {
  addDaysToDateKey,
  computeHabitStreaks,
  getLocalDateKey,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  getGroupWeek,
  parseGroupCycleKey,
} from "@/server/domain/habit-group-policy";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

const MAX_REVIEW_LENGTH = 1200;
const MAX_MEMBERS_PER_GROUP = 50;
const MAX_GROUPS_PER_USER = 30;
const REVIEW_HISTORY_WEEKS = 4;

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
  cycleKey: string;
  periodStartDate: string;
  periodEndDate: string;
  availableCycleKeys: string[];
  reviews: GroupReviewWithAuthor[];
  myReview: HabitGroupReviewRecord | null;
  canManageMembers: boolean;
}

export interface UpsertReviewInput {
  groupId: string;
  cycleKey?: string;
  wentWell: string;
  challenges: string;
  nextFocus: string;
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

  async upsertReview(
    actorId: string,
    input: UpsertReviewInput
  ): Promise<HabitGroupReviewRecord> {
    const group = await this.groups.getGroupForMember(input.groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");

    for (const [label, value] of Object.entries({
      "Went well": input.wentWell,
      Challenges: input.challenges,
      "Next focus": input.nextFocus,
    })) {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > MAX_REVIEW_LENGTH) {
        throw new ValidationError(
          `${label} must be 1–${MAX_REVIEW_LENGTH} characters.`
        );
      }
    }

    const members = await this.groups.listMembers(input.groupId, actorId);
    const actorTimezone =
      members.find((member) => member.userId === actorId)?.timezone ?? "UTC";
    const nowMs = this.now();
    const todayKey = getLocalDateKey(nowMs, actorTimezone);

    let period = getGroupWeek(todayKey);
    if (input.cycleKey !== undefined) {
      const parsed = parseGroupCycleKey(input.cycleKey, todayKey);
      if (!parsed) {
        throw new ValidationError(
          "Review cycle must be a valid Monday week and cannot be in the future."
        );
      }
      period = parsed;
    }

    // A mid-week review only reports days that have happened. The stored week
    // boundaries remain the full Monday–Sunday cycle for board display.
    const metricsEndDate =
      period.periodEndDate > todayKey ? todayKey : period.periodEndDate;
    const sharedHabits = await this.groups.listSharedHabits(
      input.groupId,
      actorId
    );
    const metrics = await this.getMemberMetrics(
      sharedHabits,
      period.periodStartDate,
      metricsEndDate
    );

    const existing = await this.groups.getReview(
      input.groupId,
      period.cycleKey,
      actorId
    );
    const review = await this.groups.upsertReview({
      groupId: input.groupId,
      authorId: actorId,
      cycleKey: period.cycleKey,
      periodStartDate: period.periodStartDate,
      periodEndDate: period.periodEndDate,
      wentWell: input.wentWell.trim(),
      challenges: input.challenges.trim(),
      nextFocus: input.nextFocus.trim(),
      metricsJson: JSON.stringify({
        version: 1,
        completionPct: completionAcross(metrics),
        habits: metrics.map((metric) => ({
          habitId: metric.habitId,
          doneCount: metric.doneCount,
          scheduledCount: metric.scheduledCount,
          currentStreak: metric.currentStreak,
        })),
      }),
      nowMs,
    });

    if (!existing) {
      const authorName =
        members.find((member) => member.userId === actorId)?.name ??
        "A partner";
      const entityId = `${input.groupId}:${period.cycleKey}`;
      await Promise.all(
        members
          .filter((member) => member.userId !== actorId)
          .map(async (member) => {
            const alreadyNotified =
              await this.notifications.hasNotificationForEntity(
                member.userId,
                "habit.group_review_posted",
                entityId
              );
            if (alreadyNotified) return;
            await this.notifications.create({
              userId: member.userId,
              type: "habit.group_review_posted",
              title: `New weekly review in ${group.name}`,
              body: `${authorName} posted a review for ${period.periodStartDate}.`,
              entityType: "habit_group_review",
              entityId,
            });
          })
      );
    }

    return review;
  }

  async getWorkspace(
    actorId: string,
    groupId: string,
    cycleKey?: string
  ): Promise<GroupWorkspace> {
    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");

    const [members, sharedHabits] = await Promise.all([
      this.groups.listMembers(groupId, actorId),
      this.groups.listSharedHabits(groupId, actorId),
    ]);
    const myMembership = members.find((member) => member.userId === actorId);
    const todayKey = getLocalDateKey(
      this.now(),
      myMembership?.timezone ?? "UTC"
    );
    const current = getGroupWeek(todayKey);
    const availableCycleKeys = Array.from({ length: REVIEW_HISTORY_WEEKS }, (_, index) =>
      getGroupWeek(addDaysToDateKey(todayKey, -7 * index)).cycleKey
    );
    const requested = cycleKey
      ? parseGroupCycleKey(cycleKey, todayKey)
      : null;
    const selected =
      requested && availableCycleKeys.includes(requested.cycleKey)
        ? requested
        : current;
    const metricsEndDate =
      selected.periodEndDate > todayKey ? todayKey : selected.periodEndDate;

    const [reviews, myReview, metrics] = await Promise.all([
      this.groups.listReviews(groupId, selected.cycleKey, actorId),
      this.groups.getReview(groupId, selected.cycleKey, actorId),
      this.getMemberMetrics(
        sharedHabits,
        selected.periodStartDate,
        metricsEndDate
      ),
    ]);

    return {
      group,
      members,
      sharedHabits,
      metrics,
      cycleKey: selected.cycleKey,
      periodStartDate: selected.periodStartDate,
      periodEndDate: selected.periodEndDate,
      availableCycleKeys: Array.from(new Set(availableCycleKeys)),
      reviews,
      myReview,
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

function completionAcross(metrics: GroupMemberMetrics[]): number | null {
  const done = metrics.reduce((sum, metric) => sum + metric.doneCount, 0);
  const scheduled = metrics.reduce(
    (sum, metric) => sum + metric.scheduledCount,
    0
  );
  return scheduled > 0 ? Math.round((done / scheduled) * 100) : null;
}

export const habitGroupService = new HabitGroupService();
