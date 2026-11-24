import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitGroupRepository,
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
import {
  habitGroupMembers,
  type HabitGroupRecord,
  type HabitGroupRole,
} from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import {
  addDaysToDateKey,
  computeHabitStreaks,
  getLocalDateKey,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";

const MAX_MEMBERS_PER_GROUP = 50;
const MAX_GROUPS_PER_USER = 30;

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
  now?: () => number;
}

export class HabitGroupService {
  private readonly database: AppDatabase;
  private readonly groups: HabitGroupRepository;
  private readonly social: HabitSocialRepository;
  private readonly habits: HabitRepository;
  private readonly notifications: NotificationRepository;
  private readonly now: () => number;

  constructor(deps: HabitGroupServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.groups = deps.groups ?? habitGroupRepository;
    this.social = deps.social ?? habitSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.notifications = deps.notifications ?? notificationRepository;
    this.now = deps.now ?? (() => Date.now());
  }

  listGroups(userId: string): Promise<GroupSummary[]> {
    return this.groups.listGroupsForUser(userId);
  }

  async createGroup(
    actorId: string,
    input: CreateGroupInput
  ): Promise<HabitGroupRecord> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new ValidationError("Group name must be 2–80 characters.");
    }

    const existing = await this.groups.listGroupsForUser(actorId);
    if (existing.length >= MAX_GROUPS_PER_USER) {
      throw new ValidationError(
        `You can belong to at most ${MAX_GROUPS_PER_USER} groups.`
      );
    }

    const memberIds: string[] = [];
    const seen = new Set<string>([actorId]);
    for (const rawEmail of input.memberEmails) {
      const email = rawEmail.trim();
      if (!email) continue;
      const user = await this.social.findUserByNormalizedEmail(email);
      if (!user || !user.emailVerified) {
        throw new ValidationError(
          `No verified FOLIO account found for ${email}.`
        );
      }
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      memberIds.push(user.id);
    }

    if (memberIds.length < 2) {
      throw new ValidationError(
        "Add at least two other people — groups are for 3+ members."
      );
    }
    if (memberIds.length + 1 > MAX_MEMBERS_PER_GROUP) {
      throw new ValidationError(
        `A group can have at most ${MAX_MEMBERS_PER_GROUP} members.`
      );
    }

    const nowMs = this.now();
    const group = await withDbRetry(() =>
      this.database.transaction((tx) =>
        this.groups.createGroupWithMembers(
          {
            ownerId: actorId,
            name,
            description: input.description?.trim() || null,
            memberIds,
            nowMs,
          },
          tx
        )
      )
    );

    await Promise.all(
      memberIds.map((userId) =>
        this.notifications.create({
          userId,
          type: "habit.group_joined",
          title: `You joined ${name}`,
          body: "Share a habit and post your first weekly review to get started.",
          entityType: "habit_review",
          entityId: group.id,
        })
      )
    );

    return group;
  }

  async addMemberByEmail(
    actorId: string,
    groupId: string,
    email: string
  ): Promise<GroupMemberProfile> {
    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");
    const members = await this.groups.listMembers(groupId, actorId);
    if (members.length >= MAX_MEMBERS_PER_GROUP) {
      throw new ValidationError(
        `A group can have at most ${MAX_MEMBERS_PER_GROUP} members.`
      );
    }

    const user = await this.social.findUserByNormalizedEmail(email);
    if (!user || !user.emailVerified) {
      throw new ValidationError(
        "No verified FOLIO account found for that email address."
      );
    }

    await this.groups.addMember({
      groupId,
      actorId,
      userId: user.id,
      role: "member",
      nowMs: this.now(),
    });
    await this.notifications.create({
      userId: user.id,
      type: "habit.group_joined",
      title: `You joined ${group.name}`,
      body: `${members.find((m) => m.userId === actorId)?.name ?? "A partner"} added you to an accountability group.`,
      entityType: "habit_review",
      entityId: group.id,
    });
    return {
      groupId,
      userId: user.id,
      role: "member",
      status: "active",
      joinedAt: this.now(),
      name: user.name,
      email: user.email,
      timezone: user.timezone,
    };
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
    const group = await this.groups.getGroupForMember(groupId, actorId);
    if (!group) throw new NotFoundError("Group not found.");
    if (group.ownerId === actorId) {
      throw new ValidationError(
        "The owner cannot leave. Transfer ownership or delete the group."
      );
    }
    const member = await this.groups.getMember(groupId, actorId);
    if (!member) throw new NotFoundError("Group membership not found.");
    await this.database
      .update(habitGroupMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(habitGroupMembers.groupId, groupId),
          eq(habitGroupMembers.userId, actorId)
        )
      );
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

    const periodEndDate = getLocalDateKey(this.now(), "UTC");
    const periodStartDate = addDaysToDateKey(periodEndDate, -6);
    const metrics = await this.getMemberMetrics(
      actorId,
      groupId,
      periodStartDate,
      periodEndDate
    );

    const myMembership = members.find((m) => m.userId === actorId);
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
    actorId: string,
    groupId: string,
    periodStartDate: string,
    periodEndDate: string
  ): Promise<GroupMemberMetrics[]> {
    const sharedHabits = await this.groups.listSharedHabits(groupId, actorId);
    return Promise.all(
      sharedHabits.map(async (shared): Promise<GroupMemberMetrics> => {
        const logs = await this.habits.listLogsForRange(
          shared.ownerId,
          shared.startDate,
          periodEndDate
        );
        const logMap = new Map(logs.map((log) => [log.dateKey, log.status]));
        const streaks = computeHabitStreaks(
          {
            id: shared.habitId,
            title: shared.title,
            cadenceType: shared.cadenceType,
            scheduledDays: parseScheduledDaysJson(shared.scheduledDaysJson),
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
                scheduledDays: parseScheduledDaysJson(shared.scheduledDaysJson),
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
