import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitGroupMembers,
  habitGroupReviews,
  habitGroups,
  habitGroupSharedHabits,
  habits,
  users,
  type HabitGroupMemberRecord,
  type HabitGroupRecord,
  type HabitGroupReviewRecord,
  type HabitGroupRole,
  type HabitRecord,
} from "@/server/db/schema";

export interface GroupSummary extends HabitGroupRecord {
  memberCount: number;
  sharedHabitCount: number;
  myRole: HabitGroupRole;
}

export interface GroupMemberProfile extends HabitGroupMemberRecord {
  name: string;
  email: string;
  timezone: string;
}

export interface GroupInvitationSummary extends HabitGroupRecord {
  inviterName: string;
  invitedAt: number;
}

export interface GroupSharedHabit {
  groupId: string;
  habitId: string;
  title: string;
  ownerId: string;
  ownerName: string;
  cadenceType: HabitRecord["cadenceType"];
  scheduledDaysJson: string;
  weeklyTargetCount: number | null;
  startDate: string;
  sharedBy: string;
  createdAt: number;
}

export interface GroupReviewWithAuthor extends HabitGroupReviewRecord {
  authorName: string;
}

export interface CreateGroupRowInput {
  ownerId: string;
  name: string;
  description: string | null;
  invitedUserIds: string[];
  nowMs: number;
}

export interface UpsertGroupReviewRowInput {
  groupId: string;
  authorId: string;
  cycleKey: string;
  periodStartDate: string;
  periodEndDate: string;
  wentWell: string;
  challenges: string;
  nextFocus: string;
  metricsJson: string;
  nowMs: number;
}

export interface HabitGroupRepository {
  listGroupsForUser(userId: string): Promise<GroupSummary[]>;
  listPendingInvitationsForUser(
    userId: string
  ): Promise<GroupInvitationSummary[]>;
  getGroupForMember(
    groupId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<HabitGroupRecord | null>;
  getMember(
    groupId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<HabitGroupMemberRecord | null>;
  listMembers(
    groupId: string,
    actorId: string,
    executor?: DbExecutor
  ): Promise<GroupMemberProfile[]>;
  listSharedHabits(
    groupId: string,
    actorId: string,
    executor?: DbExecutor
  ): Promise<GroupSharedHabit[]>;
  getReview(
    groupId: string,
    cycleKey: string,
    authorId: string,
    executor?: DbExecutor
  ): Promise<HabitGroupReviewRecord | null>;
  listReviews(
    groupId: string,
    cycleKey: string,
    actorId: string,
    executor?: DbExecutor
  ): Promise<GroupReviewWithAuthor[]>;
  createGroupWithMembers(
    input: CreateGroupRowInput,
    executor?: DbExecutor
  ): Promise<HabitGroupRecord>;
  addMember(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      role?: HabitGroupRole;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<HabitGroupMemberRecord>;
  inviteMember(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<HabitGroupMemberRecord | null>;
  acceptInvitation(
    input: { groupId: string; userId: string; nowMs: number },
    executor?: DbExecutor
  ): Promise<boolean>;
  declineInvitation(
    input: { groupId: string; userId: string },
    executor?: DbExecutor
  ): Promise<boolean>;
  setMemberRole(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      role: HabitGroupRole;
    },
    executor?: DbExecutor
  ): Promise<HabitGroupMemberRecord>;
  removeMember(
    input: { groupId: string; actorId: string; userId: string },
    executor?: DbExecutor
  ): Promise<boolean>;
  leaveGroup(
    input: { groupId: string; userId: string },
    executor?: DbExecutor
  ): Promise<boolean>;
  shareHabit(
    input: { groupId: string; actorId: string; habitId: string; nowMs: number },
    executor?: DbExecutor
  ): Promise<void>;
  unshareHabit(
    input: { groupId: string; actorId: string; habitId: string },
    executor?: DbExecutor
  ): Promise<boolean>;
  upsertReview(
    input: UpsertGroupReviewRowInput,
    executor?: DbExecutor
  ): Promise<HabitGroupReviewRecord>;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function assertManager(role: HabitGroupRole) {
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError("Only group owners and admins can manage members.");
  }
}

export class DrizzleHabitGroupRepository implements HabitGroupRepository {
  constructor(private readonly database: AppDatabase = db) {}

  private async findMember(
    groupId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupMemberRecord | null> {
    const [row] = await executor
      .select()
      .from(habitGroupMembers)
      .where(
        and(
          eq(habitGroupMembers.groupId, groupId),
          eq(habitGroupMembers.userId, userId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listGroupsForUser(userId: string): Promise<GroupSummary[]> {
    const rows = await this.database
      .select({ group: habitGroups, role: habitGroupMembers.role })
      .from(habitGroupMembers)
      .innerJoin(habitGroups, eq(habitGroupMembers.groupId, habitGroups.id))
      .where(
        and(
          eq(habitGroupMembers.userId, userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .orderBy(desc(habitGroups.updatedAt));

    if (rows.length === 0) return [];
    const groupIds = rows.map((r) => r.group.id);

    const [memberCounts, habitCounts] = await Promise.all([
      this.database
        .select({
          groupId: habitGroupMembers.groupId,
          value: habitGroupMembers.userId,
        })
        .from(habitGroupMembers)
        .where(
          and(
            inArray(habitGroupMembers.groupId, groupIds),
            eq(habitGroupMembers.status, "active")
          )
        ),
      this.database
        .select({ groupId: habitGroupSharedHabits.groupId })
        .from(habitGroupSharedHabits)
        .where(inArray(habitGroupSharedHabits.groupId, groupIds)),
    ]);

    const membersByGroup = new Map<string, number>();
    for (const row of memberCounts) {
      membersByGroup.set(row.groupId, (membersByGroup.get(row.groupId) ?? 0) + 1);
    }
    const habitsByGroup = new Map<string, number>();
    for (const row of habitCounts) {
      habitsByGroup.set(row.groupId, (habitsByGroup.get(row.groupId) ?? 0) + 1);
    }

    return rows.map((r) => ({
      ...r.group,
      memberCount: membersByGroup.get(r.group.id) ?? 0,
      sharedHabitCount: habitsByGroup.get(r.group.id) ?? 0,
      myRole: r.role,
    }));
  }

  async listPendingInvitationsForUser(
    userId: string
  ): Promise<GroupInvitationSummary[]> {
    const rows = await this.database
      .select({
        group: habitGroups,
        inviterName: users.name,
        invitedAt: habitGroupMembers.joinedAt,
      })
      .from(habitGroupMembers)
      .innerJoin(habitGroups, eq(habitGroupMembers.groupId, habitGroups.id))
      .innerJoin(users, eq(habitGroups.ownerId, users.id))
      .where(
        and(
          eq(habitGroupMembers.userId, userId),
          eq(habitGroupMembers.status, "invited")
        )
      )
      .orderBy(desc(habitGroupMembers.joinedAt));

    return rows.map((row) => ({
      ...row.group,
      inviterName: row.inviterName,
      invitedAt: row.invitedAt,
    }));
  }

  async getGroupForMember(
    groupId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupRecord | null> {
    const [row] = await executor
      .select({ group: habitGroups })
      .from(habitGroups)
      .innerJoin(
        habitGroupMembers,
        eq(habitGroupMembers.groupId, habitGroups.id)
      )
      .where(
        and(
          eq(habitGroups.id, groupId),
          eq(habitGroupMembers.userId, userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .limit(1);
    return row?.group ?? null;
  }

  async getMember(
    groupId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupMemberRecord | null> {
    const [row] = await executor
      .select()
      .from(habitGroupMembers)
      .where(
        and(
          eq(habitGroupMembers.groupId, groupId),
          eq(habitGroupMembers.userId, userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listMembers(
    groupId: string,
    actorId: string,
    executor: DbExecutor = this.database
  ): Promise<GroupMemberProfile[]> {
    const actor = await this.getMember(groupId, actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    const rows = await executor
      .select({
        groupId: habitGroupMembers.groupId,
        userId: habitGroupMembers.userId,
        role: habitGroupMembers.role,
        status: habitGroupMembers.status,
        joinedAt: habitGroupMembers.joinedAt,
        name: users.name,
        email: users.email,
        timezone: users.timezone,
      })
      .from(habitGroupMembers)
      .innerJoin(users, eq(habitGroupMembers.userId, users.id))
      .where(
        and(
          eq(habitGroupMembers.groupId, groupId),
          inArray(habitGroupMembers.status, ["active", "invited"])
        )
      )
      .orderBy(asc(users.name));

    return rows.map((row) => ({ ...row, email: maskEmail(row.email) }));
  }

  async listSharedHabits(
    groupId: string,
    actorId: string,
    executor: DbExecutor = this.database
  ): Promise<GroupSharedHabit[]> {
    const actor = await this.getMember(groupId, actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    const rows = await executor
      .select({
        groupId: habitGroupSharedHabits.groupId,
        habitId: habitGroupSharedHabits.habitId,
        sharedBy: habitGroupSharedHabits.sharedBy,
        createdAt: habitGroupSharedHabits.createdAt,
        title: habits.title,
        ownerId: habits.userId,
        cadenceType: habits.cadenceType,
        scheduledDaysJson: habits.scheduledDaysJson,
        weeklyTargetCount: habits.weeklyTargetCount,
        startDate: habits.startDate,
        ownerName: users.name,
      })
      .from(habitGroupSharedHabits)
      .innerJoin(habits, eq(habitGroupSharedHabits.habitId, habits.id))
      .innerJoin(users, eq(habits.userId, users.id))
      .where(eq(habitGroupSharedHabits.groupId, groupId))
      .orderBy(asc(habits.title));

    // Defense in depth: never surface a habit whose owner left the group.
    const activeUserIds = new Set(
      (
        await executor
          .select({ userId: habitGroupMembers.userId })
          .from(habitGroupMembers)
          .where(
            and(
              eq(habitGroupMembers.groupId, groupId),
              eq(habitGroupMembers.status, "active")
            )
          )
      ).map((row) => row.userId)
    );

    return rows.filter((row) => activeUserIds.has(row.ownerId));
  }

  async getReview(
    groupId: string,
    cycleKey: string,
    authorId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupReviewRecord | null> {
    const [row] = await executor
      .select()
      .from(habitGroupReviews)
      .where(
        and(
          eq(habitGroupReviews.groupId, groupId),
          eq(habitGroupReviews.cycleKey, cycleKey),
          eq(habitGroupReviews.authorId, authorId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listReviews(
    groupId: string,
    cycleKey: string,
    actorId: string,
    executor: DbExecutor = this.database
  ): Promise<GroupReviewWithAuthor[]> {
    const actor = await this.getMember(groupId, actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    const rows = await executor
      .select({ review: habitGroupReviews, authorName: users.name })
      .from(habitGroupReviews)
      .innerJoin(users, eq(habitGroupReviews.authorId, users.id))
      .where(
        and(
          eq(habitGroupReviews.groupId, groupId),
          eq(habitGroupReviews.cycleKey, cycleKey)
        )
      )
      .orderBy(desc(habitGroupReviews.updatedAt));

    // Removed members' reviews are not exposed on the group board.
    const activeUserIds = new Set(
      (
        await executor
          .select({ userId: habitGroupMembers.userId })
          .from(habitGroupMembers)
          .where(
            and(
              eq(habitGroupMembers.groupId, groupId),
              eq(habitGroupMembers.status, "active")
            )
          )
      ).map((row) => row.userId)
    );

    return rows
      .filter((row) => activeUserIds.has(row.review.authorId))
      .map((row) => ({ ...row.review, authorName: row.authorName }));
  }

  async createGroupWithMembers(
    input: CreateGroupRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupRecord> {
    const invitedUserIds = Array.from(
      new Set(input.invitedUserIds.filter((userId) => userId !== input.ownerId))
    );

    const [group] = await executor
      .insert(habitGroups)
      .values({
        ownerId: input.ownerId,
        name: input.name,
        description: input.description,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      })
      .returning();
    if (!group) throw new Error("Failed to create group.");

    await executor.insert(habitGroupMembers).values([
      {
        groupId: group.id,
        userId: input.ownerId,
        role: "owner",
        status: "active",
        joinedAt: input.nowMs,
      },
      ...invitedUserIds.map((userId) => ({
        groupId: group.id,
        userId,
        role: "member" as const,
        status: "invited" as const,
        joinedAt: input.nowMs,
      })),
    ]);

    return group;
  }

  async addMember(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      role?: HabitGroupRole;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<HabitGroupMemberRecord> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");
    assertManager(actor.role);
    if (input.role === "owner") {
      throw new ForbiddenError("Group ownership cannot be assigned here.");
    }
    if (input.userId === input.actorId) {
      throw new ForbiddenError("You are already a member of this group.");
    }

    const target = await this.findMember(input.groupId, input.userId, executor);
    if (target?.status === "active") {
      throw new ConflictError("That person is already in the group.");
    }

    const [saved] = await executor
      .insert(habitGroupMembers)
      .values({
        groupId: input.groupId,
        userId: input.userId,
        role: input.role ?? "member",
        status: "active",
        joinedAt: input.nowMs,
      })
      .onConflictDoUpdate({
        target: [habitGroupMembers.groupId, habitGroupMembers.userId],
        set: { status: "active", role: input.role ?? "member" },
      })
      .returning();
    if (!saved) throw new Error("Failed to add group member.");
    return saved;
  }

  async inviteMember(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<HabitGroupMemberRecord | null> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");
    assertManager(actor.role);
    if (input.userId === input.actorId) return null;

    const target = await this.findMember(input.groupId, input.userId, executor);
    if (target?.status === "active" || target?.status === "invited") {
      return null;
    }

    const [saved] = await executor
      .insert(habitGroupMembers)
      .values({
        groupId: input.groupId,
        userId: input.userId,
        role: "member",
        status: "invited",
        joinedAt: input.nowMs,
      })
      .onConflictDoUpdate({
        target: [habitGroupMembers.groupId, habitGroupMembers.userId],
        set: { status: "invited", role: "member", joinedAt: input.nowMs },
      })
      .returning();
    return saved ?? null;
  }

  async acceptInvitation(
    input: { groupId: string; userId: string; nowMs: number },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const updated = await executor
      .update(habitGroupMembers)
      .set({ status: "active", joinedAt: input.nowMs })
      .where(
        and(
          eq(habitGroupMembers.groupId, input.groupId),
          eq(habitGroupMembers.userId, input.userId),
          eq(habitGroupMembers.status, "invited")
        )
      )
      .returning({ userId: habitGroupMembers.userId });
    return updated.length > 0;
  }

  async declineInvitation(
    input: { groupId: string; userId: string },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const updated = await executor
      .update(habitGroupMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(habitGroupMembers.groupId, input.groupId),
          eq(habitGroupMembers.userId, input.userId),
          eq(habitGroupMembers.status, "invited")
        )
      )
      .returning({ userId: habitGroupMembers.userId });
    return updated.length > 0;
  }

  async setMemberRole(
    input: {
      groupId: string;
      actorId: string;
      userId: string;
      role: HabitGroupRole;
    },
    executor: DbExecutor = this.database
  ): Promise<HabitGroupMemberRecord> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");
    if (actor.role !== "owner") {
      throw new ForbiddenError("Only the group owner can change roles.");
    }
    if (input.userId === input.actorId || input.role === "owner") {
      throw new ForbiddenError("Group ownership cannot be reassigned.");
    }

    const [updated] = await executor
      .update(habitGroupMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(habitGroupMembers.groupId, input.groupId),
          eq(habitGroupMembers.userId, input.userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .returning();
    if (!updated) throw new NotFoundError("Group member not found.");
    return updated;
  }

  async removeMember(
    input: { groupId: string; actorId: string; userId: string },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");
    if (input.userId === input.actorId) {
      throw new ForbiddenError("Use leave-group instead of removing yourself.");
    }
    assertManager(actor.role);

    const target = await this.findMember(input.groupId, input.userId, executor);
    if (target?.role === "owner") {
      throw new ForbiddenError("The group owner cannot be removed.");
    }
    if (actor.role === "admin" && target?.role === "admin") {
      throw new ForbiddenError("Only the owner can remove another admin.");
    }

    const [updated] = await executor
      .update(habitGroupMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(habitGroupMembers.groupId, input.groupId),
          eq(habitGroupMembers.userId, input.userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .returning();
    return Boolean(updated);
  }

  async leaveGroup(
    input: { groupId: string; userId: string },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const member = await this.getMember(input.groupId, input.userId, executor);
    if (!member) throw new ForbiddenError("You are not an active group member.");
    if (member.role === "owner") {
      throw new ValidationError(
        "The owner cannot leave. Transfer ownership or delete the group."
      );
    }

    const updated = await executor
      .update(habitGroupMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(habitGroupMembers.groupId, input.groupId),
          eq(habitGroupMembers.userId, input.userId),
          eq(habitGroupMembers.status, "active")
        )
      )
      .returning({ userId: habitGroupMembers.userId });
    return updated.length > 0;
  }

  async shareHabit(
    input: { groupId: string; actorId: string; habitId: string; nowMs: number },
    executor: DbExecutor = this.database
  ): Promise<void> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    const [habit] = await executor
      .select()
      .from(habits)
      .where(eq(habits.id, input.habitId))
      .limit(1);
    if (!habit || habit.userId !== input.actorId) {
      throw new ForbiddenError("You can only share your own habits.");
    }

    await executor
      .insert(habitGroupSharedHabits)
      .values({
        groupId: input.groupId,
        habitId: input.habitId,
        sharedBy: input.actorId,
        createdAt: input.nowMs,
      })
      .onConflictDoNothing();
  }

  async unshareHabit(
    input: { groupId: string; actorId: string; habitId: string },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const actor = await this.getMember(input.groupId, input.actorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    const [shared] = await executor
      .select()
      .from(habitGroupSharedHabits)
      .where(
        and(
          eq(habitGroupSharedHabits.groupId, input.groupId),
          eq(habitGroupSharedHabits.habitId, input.habitId)
        )
      )
      .limit(1);
    if (!shared) return false;
    if (shared.sharedBy !== input.actorId && actor.role !== "owner") {
      throw new ForbiddenError("Only the habit owner can unshare it.");
    }

    const deleted = await executor
      .delete(habitGroupSharedHabits)
      .where(
        and(
          eq(habitGroupSharedHabits.groupId, input.groupId),
          eq(habitGroupSharedHabits.habitId, input.habitId)
        )
      )
      .returning({ habitId: habitGroupSharedHabits.habitId });
    return deleted.length > 0;
  }

  async upsertReview(
    input: UpsertGroupReviewRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitGroupReviewRecord> {
    const actor = await this.getMember(input.groupId, input.authorId, executor);
    if (!actor) throw new ForbiddenError("You are not an active group member.");

    // The unique (group, cycle, author) index makes this a single atomic
    // statement. The metrics snapshot and period are written only on the
    // first post; editing the narrative must never rewrite either one.
    const [review] = await executor
      .insert(habitGroupReviews)
      .values({
        groupId: input.groupId,
        cycleKey: input.cycleKey,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        authorId: input.authorId,
        wentWell: input.wentWell,
        challenges: input.challenges,
        nextFocus: input.nextFocus,
        metricsJson: input.metricsJson,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      })
      .onConflictDoUpdate({
        target: [
          habitGroupReviews.groupId,
          habitGroupReviews.cycleKey,
          habitGroupReviews.authorId,
        ],
        set: {
          wentWell: input.wentWell,
          challenges: input.challenges,
          nextFocus: input.nextFocus,
          updatedAt: input.nowMs,
        },
      })
      .returning();
    if (!review) throw new Error("Failed to save group review.");
    return review;
  }
}

export const habitGroupRepository: HabitGroupRepository =
  new DrizzleHabitGroupRepository(db);
