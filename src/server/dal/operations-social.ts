import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitMonitors,
  operationInvitations,
  operationMembers,
  operations,
  operationStepFlags,
  operationVersions,
  projectMembers,
  userFollows,
  users,
  type OperationDomain,
  type OperationInvitationRecord,
  type OperationMemberRecord,
  type OperationMemberRole,
  type OperationRecord,
  type OperationStepFlagRecord,
  type OperationStepFlagStatus,
  type OperationVersionRecord,
} from "@/server/db/schema";
import {
  toPublicOperationCardDto,
  toPublicOperationDetailDto,
  type PublicCreatorProfileDto,
  type PublicOperationCardDto,
  type PublicOperationDetailDto,
  type PublicOperationForkSourceDto,
} from "@/server/domain/operations";

export type ExploreSortOption = "recent" | "most_forked" | "recently_verified";

export interface OperationMemberWithUser {
  operationId: string;
  userId: string;
  role: OperationMemberRole;
  grantedById: string | null;
  createdAt: number;
  name: string;
  email: string;
  handle: string | null;
}

export interface OperationInvitationWithMeta {
  invitation: OperationInvitationRecord;
  operationTitle: string;
  operationDomain: OperationDomain;
  inviterName: string;
  inviterHandle: string | null;
}

export interface SharedOperationListItem {
  operation: OperationRecord;
  role: OperationMemberRole;
  accessSource: "direct_member" | "project_inherited";
  ownerName: string;
  ownerHandle: string | null;
  stepCount: number;
}

export interface QuickPickShareContact {
  userId: string;
  name: string;
  handle: string | null;
  sourceLabel: "Following" | "Follower" | "Circle" | "Project";
}

export interface OperationStepFlagWithReporter {
  flag: OperationStepFlagRecord;
  reporterName: string;
  reporterHandle: string | null;
  resolverName: string | null;
}

export interface StaleOperationCandidate {
  id: string;
  ownerId: string;
  title: string;
  slug: string;
  reviewCycleDays: number;
  lastVerifiedAt: number | null;
  updatedAt: number;
  ownerTimezone: string;
}

function countStepsJson(stepsSnapshotJson: string): number {
  try {
    const parsed: unknown = JSON.parse(stepsSnapshotJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export interface OperationsSocialRepository {
  // Follow graph
  followUser(
    followerId: string,
    followingId: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<boolean>;
  unfollowUser(
    followerId: string,
    followingId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  isFollowing(
    followerId: string,
    followingId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  getFollowCounts(
    userId: string,
    executor?: DbExecutor
  ): Promise<{ followerCount: number; followingCount: number }>;

  // Memberships & Quick-Pick
  listMembersForOperation(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationMemberWithUser[]>;
  upsertMember(
    params: {
      operationId: string;
      userId: string;
      role: OperationMemberRole;
      grantedById: string;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<OperationMemberRecord>;
  removeMember(
    operationId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  listQuickPickContacts(
    ownerId: string,
    executor?: DbExecutor
  ): Promise<QuickPickShareContact[]>;
  listSharedWithUser(
    userId: string,
    executor?: DbExecutor
  ): Promise<SharedOperationListItem[]>;

  // Invitations
  findVerifiedUserByEmail(
    email: string,
    executor?: DbExecutor
  ): Promise<{ id: string; name: string; email: string; handle: string | null } | null>;
  createInvitation(
    input: {
      operationId: string;
      invitedById: string;
      targetUserId: string | null;
      targetEmail: string;
      tokenHash: string | null;
      role: OperationMemberRole;
      expiresAt: number;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord>;
  findPendingInvitationForTarget(
    operationId: string,
    targetEmail: string,
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord | null>;
  listPendingInvitationsForOperation(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord[]>;
  listPendingInvitationsForUser(
    userId: string,
    email: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<OperationInvitationWithMeta[]>;
  getInvitationById(
    invitationId: string,
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord | null>;
  getInvitationByTokenHash(
    tokenHash: string,
    executor?: DbExecutor
  ): Promise<OperationInvitationWithMeta | null>;
  claimInvitationAcceptAtomically(
    invitationId: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord | null>;
  updateInvitationStatusAtomically(
    invitationId: string,
    fromStatus: "pending",
    nextStatus: "declined" | "revoked" | "expired",
    nowMs: number,
    executor?: DbExecutor
  ): Promise<OperationInvitationRecord | null>;

  // Step flags
  createStepFlag(
    input: {
      operationId: string;
      versionNumber: number;
      stepKey: string;
      reporterId: string;
      message: string;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<OperationStepFlagRecord>;
  listFlagsForOperation(
    operationId: string,
    statusFilter?: OperationStepFlagStatus,
    executor?: DbExecutor
  ): Promise<OperationStepFlagWithReporter[]>;
  resolveFlagAtomically(
    operationId: string,
    flagId: string,
    resolvedById: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<OperationStepFlagRecord | null>;

  // Public stripped DTO queries
  listPublicExploreOperations(
    params: {
      domain?: OperationDomain;
      query?: string;
      sort?: ExploreSortOption;
      limit?: number;
    },
    executor?: DbExecutor
  ): Promise<PublicOperationCardDto[]>;
  getPublicOperationBySlug(
    slug: string,
    executor?: DbExecutor
  ): Promise<PublicOperationDetailDto | null>;
  getUnlistedOperationDtoById(
    operationId: string,
    executor?: DbExecutor
  ): Promise<PublicOperationDetailDto | null>;
  getPublicCreatorProfileByHandle(
    handle: string,
    executor?: DbExecutor
  ): Promise<PublicCreatorProfileDto | null>;
  listPublicOperationSlugs(
    limit?: number,
    executor?: DbExecutor
  ): Promise<Array<{ slug: string; updatedAt: number }>>;

  // Staleness audit pagination
  listStaleOperationCandidatesPage(
    limit: number,
    offset: number,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<StaleOperationCandidate[]>;
}

export class DrizzleOperationsSocialRepository
  implements OperationsSocialRepository
{
  constructor(private readonly database: AppDatabase = db) {}

  async followUser(
    followerId: string,
    followingId: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const inserted = await executor
      .insert(userFollows)
      .values({ followerId, followingId, createdAt: nowMs })
      .onConflictDoNothing()
      .returning({ followerId: userFollows.followerId });
    return inserted.length > 0;
  }

  async unfollowUser(
    followerId: string,
    followingId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId)
        )
      )
      .returning({ followerId: userFollows.followerId });
    return deleted.length > 0;
  }

  async isFollowing(
    followerId: string,
    followingId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const [row] = await executor
      .select({ followerId: userFollows.followerId })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId)
        )
      )
      .limit(1);
    return Boolean(row);
  }

  async getFollowCounts(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<{ followerCount: number; followingCount: number }> {
    const [followersRes, followingRes] = await Promise.all([
      executor
        .select({ value: count() })
        .from(userFollows)
        .where(eq(userFollows.followingId, userId)),
      executor
        .select({ value: count() })
        .from(userFollows)
        .where(eq(userFollows.followerId, userId)),
    ]);
    return {
      followerCount: followersRes[0]?.value ?? 0,
      followingCount: followingRes[0]?.value ?? 0,
    };
  }

  async listMembersForOperation(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationMemberWithUser[]> {
    return executor
      .select({
        operationId: operationMembers.operationId,
        userId: operationMembers.userId,
        role: operationMembers.role,
        grantedById: operationMembers.grantedById,
        createdAt: operationMembers.createdAt,
        name: users.name,
        email: users.email,
        handle: users.handle,
      })
      .from(operationMembers)
      .innerJoin(users, eq(operationMembers.userId, users.id))
      .where(eq(operationMembers.operationId, operationId))
      .orderBy(asc(users.name));
  }

  async upsertMember(
    params: {
      operationId: string;
      userId: string;
      role: OperationMemberRole;
      grantedById: string;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<OperationMemberRecord> {
    const [row] = await executor
      .insert(operationMembers)
      .values({
        operationId: params.operationId,
        userId: params.userId,
        role: params.role,
        grantedById: params.grantedById,
        createdAt: params.nowMs,
      })
      .onConflictDoUpdate({
        target: [operationMembers.operationId, operationMembers.userId],
        set: {
          role: params.role,
          grantedById: params.grantedById,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert operation member.");
    }
    return row;
  }

  async removeMember(
    operationId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(operationMembers)
      .where(
        and(
          eq(operationMembers.operationId, operationId),
          eq(operationMembers.userId, userId)
        )
      )
      .returning({ userId: operationMembers.userId });
    return deleted.length > 0;
  }

  async listQuickPickContacts(
    ownerId: string,
    executor: DbExecutor = this.database
  ): Promise<QuickPickShareContact[]> {
    const [followingRows, followerRows, circleAsOwner, circleAsMonitor, myProjects] =
      await Promise.all([
        executor
          .select({
            userId: users.id,
            name: users.name,
            handle: users.handle,
          })
          .from(userFollows)
          .innerJoin(users, eq(userFollows.followingId, users.id))
          .where(
            and(eq(userFollows.followerId, ownerId), eq(users.isSuspended, false))
          )
          .limit(50),
        executor
          .select({
            userId: users.id,
            name: users.name,
            handle: users.handle,
          })
          .from(userFollows)
          .innerJoin(users, eq(userFollows.followerId, users.id))
          .where(
            and(eq(userFollows.followingId, ownerId), eq(users.isSuspended, false))
          )
          .limit(50),
        executor
          .select({
            userId: users.id,
            name: users.name,
            handle: users.handle,
          })
          .from(habitMonitors)
          .innerJoin(users, eq(habitMonitors.monitorUserId, users.id))
          .where(
            and(
              eq(habitMonitors.ownerId, ownerId),
              eq(habitMonitors.status, "active"),
              eq(users.isSuspended, false)
            )
          )
          .limit(50),
        executor
          .select({
            userId: users.id,
            name: users.name,
            handle: users.handle,
          })
          .from(habitMonitors)
          .innerJoin(users, eq(habitMonitors.ownerId, users.id))
          .where(
            and(
              eq(habitMonitors.monitorUserId, ownerId),
              eq(habitMonitors.status, "active"),
              eq(users.isSuspended, false)
            )
          )
          .limit(50),
        executor
          .select({ projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(eq(projectMembers.userId, ownerId)),
      ]);

    const projectIds = myProjects.map((p) => p.projectId);
    const projectPeers =
      projectIds.length > 0
        ? await executor
            .select({
              userId: users.id,
              name: users.name,
              handle: users.handle,
            })
            .from(projectMembers)
            .innerJoin(users, eq(projectMembers.userId, users.id))
            .where(
              and(
                inArray(projectMembers.projectId, projectIds),
                ne(projectMembers.userId, ownerId),
                eq(users.isSuspended, false)
              )
            )
            .limit(50)
        : [];

    const dedup = new Map<string, QuickPickShareContact>();
    const add = (
      rows: Array<{ userId: string; name: string; handle: string | null }>,
      sourceLabel: QuickPickShareContact["sourceLabel"]
    ) => {
      for (const row of rows) {
        if (row.userId === ownerId || dedup.has(row.userId)) continue;
        dedup.set(row.userId, { ...row, sourceLabel });
      }
    };

    add(followingRows, "Following");
    add(followerRows, "Follower");
    add([...circleAsOwner, ...circleAsMonitor], "Circle");
    add(projectPeers, "Project");

    return Array.from(dedup.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async listSharedWithUser(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<SharedOperationListItem[]> {
    const [directRows, projectRows] = await Promise.all([
      executor
        .select({
          operation: operations,
          role: operationMembers.role,
          ownerName: users.name,
          ownerHandle: users.handle,
        })
        .from(operationMembers)
        .innerJoin(operations, eq(operationMembers.operationId, operations.id))
        .innerJoin(users, eq(operations.ownerId, users.id))
        .where(
          and(
            eq(operationMembers.userId, userId),
            eq(operations.isArchived, false),
            ne(operations.ownerId, userId)
          )
        )
        .orderBy(desc(operations.updatedAt)),
      executor
        .select({
          operation: operations,
          projectRole: projectMembers.role,
          ownerName: users.name,
          ownerHandle: users.handle,
        })
        .from(projectMembers)
        .innerJoin(
          operations,
          and(
            eq(operations.projectId, projectMembers.projectId),
            eq(operations.shareWithProject, true)
          )
        )
        .innerJoin(users, eq(operations.ownerId, users.id))
        .where(
          and(
            eq(projectMembers.userId, userId),
            eq(operations.isArchived, false),
            ne(operations.ownerId, userId)
          )
        )
        .orderBy(desc(operations.updatedAt)),
    ]);

    const merged = new Map<
      string,
      {
        operation: OperationRecord;
        role: OperationMemberRole;
        accessSource: "direct_member" | "project_inherited";
        ownerName: string;
        ownerHandle: string | null;
      }
    >();

    for (const row of directRows) {
      merged.set(row.operation.id, {
        operation: row.operation,
        role: row.role,
        accessSource: "direct_member",
        ownerName: row.ownerName,
        ownerHandle: row.ownerHandle,
      });
    }
    for (const row of projectRows) {
      if (merged.has(row.operation.id)) continue;
      merged.set(row.operation.id, {
        operation: row.operation,
        role:
          row.projectRole === "owner" || row.projectRole === "editor"
            ? "collaborator"
            : "viewer",
        accessSource: "project_inherited",
        ownerName: row.ownerName,
        ownerHandle: row.ownerHandle,
      });
    }

    const opIds = Array.from(merged.keys());
    if (opIds.length === 0) return [];

    const versionRows = await executor
      .select({
        operationId: operationVersions.operationId,
        versionNumber: operationVersions.versionNumber,
        stepsSnapshotJson: operationVersions.stepsSnapshotJson,
      })
      .from(operationVersions)
      .where(inArray(operationVersions.operationId, opIds));

    const stepCountByOp = new Map<string, number>();
    for (const ver of versionRows) {
      const target = merged.get(ver.operationId);
      if (target && ver.versionNumber === target.operation.currentVersion) {
        stepCountByOp.set(ver.operationId, countStepsJson(ver.stepsSnapshotJson));
      }
    }

    return Array.from(merged.values()).map((entry) => ({
      ...entry,
      stepCount: stepCountByOp.get(entry.operation.id) ?? 0,
    }));
  }

  async findVerifiedUserByEmail(
    email: string,
    executor: DbExecutor = this.database
  ): Promise<{
    id: string;
    name: string;
    email: string;
    handle: string | null;
  } | null> {
    const normalized = email.trim().toLowerCase();
    const [row] = await executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        handle: users.handle,
      })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${normalized}`,
          eq(users.emailVerified, true),
          eq(users.isSuspended, false)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async createInvitation(
    input: {
      operationId: string;
      invitedById: string;
      targetUserId: string | null;
      targetEmail: string;
      tokenHash: string | null;
      role: OperationMemberRole;
      expiresAt: number;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord> {
    const [created] = await executor
      .insert(operationInvitations)
      .values({
        operationId: input.operationId,
        invitedById: input.invitedById,
        targetUserId: input.targetUserId,
        targetEmail: input.targetEmail.trim().toLowerCase(),
        tokenHash: input.tokenHash,
        role: input.role,
        status: "pending",
        expiresAt: input.expiresAt,
        createdAt: input.nowMs,
        respondedAt: null,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert operation invitation.");
    }
    return created;
  }

  async findPendingInvitationForTarget(
    operationId: string,
    targetEmail: string,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord | null> {
    const normalized = targetEmail.trim().toLowerCase();
    const [row] = await executor
      .select()
      .from(operationInvitations)
      .where(
        and(
          eq(operationInvitations.operationId, operationId),
          eq(operationInvitations.targetEmail, normalized),
          eq(operationInvitations.status, "pending")
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listPendingInvitationsForOperation(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord[]> {
    return executor
      .select()
      .from(operationInvitations)
      .where(
        and(
          eq(operationInvitations.operationId, operationId),
          eq(operationInvitations.status, "pending")
        )
      )
      .orderBy(desc(operationInvitations.createdAt));
  }

  async listPendingInvitationsForUser(
    userId: string,
    email: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationWithMeta[]> {
    const normalized = email.trim().toLowerCase();
    return executor
      .select({
        invitation: operationInvitations,
        operationTitle: operations.title,
        operationDomain: operations.domain,
        inviterName: users.name,
        inviterHandle: users.handle,
      })
      .from(operationInvitations)
      .innerJoin(
        operations,
        eq(operationInvitations.operationId, operations.id)
      )
      .innerJoin(users, eq(operationInvitations.invitedById, users.id))
      .where(
        and(
          eq(operationInvitations.status, "pending"),
          gt(operationInvitations.expiresAt, nowMs),
          or(
            eq(operationInvitations.targetUserId, userId),
            eq(operationInvitations.targetEmail, normalized)
          )
        )
      )
      .orderBy(desc(operationInvitations.createdAt));
  }

  async getInvitationById(
    invitationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord | null> {
    const [row] = await executor
      .select()
      .from(operationInvitations)
      .where(eq(operationInvitations.id, invitationId))
      .limit(1);
    return row ?? null;
  }

  async getInvitationByTokenHash(
    tokenHash: string,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationWithMeta | null> {
    const [row] = await executor
      .select({
        invitation: operationInvitations,
        operationTitle: operations.title,
        operationDomain: operations.domain,
        inviterName: users.name,
        inviterHandle: users.handle,
      })
      .from(operationInvitations)
      .innerJoin(
        operations,
        eq(operationInvitations.operationId, operations.id)
      )
      .innerJoin(users, eq(operationInvitations.invitedById, users.id))
      .where(eq(operationInvitations.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async claimInvitationAcceptAtomically(
    invitationId: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord | null> {
    const [claimed] = await executor
      .update(operationInvitations)
      .set({
        status: "accepted",
        respondedAt: nowMs,
      })
      .where(
        and(
          eq(operationInvitations.id, invitationId),
          eq(operationInvitations.status, "pending"),
          gt(operationInvitations.expiresAt, nowMs)
        )
      )
      .returning();
    return claimed ?? null;
  }

  async updateInvitationStatusAtomically(
    invitationId: string,
    fromStatus: "pending",
    nextStatus: "declined" | "revoked" | "expired",
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<OperationInvitationRecord | null> {
    const [updated] = await executor
      .update(operationInvitations)
      .set({
        status: nextStatus,
        respondedAt: nowMs,
      })
      .where(
        and(
          eq(operationInvitations.id, invitationId),
          eq(operationInvitations.status, fromStatus)
        )
      )
      .returning();
    return updated ?? null;
  }

  async createStepFlag(
    input: {
      operationId: string;
      versionNumber: number;
      stepKey: string;
      reporterId: string;
      message: string;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<OperationStepFlagRecord> {
    const [created] = await executor
      .insert(operationStepFlags)
      .values({
        operationId: input.operationId,
        versionNumber: input.versionNumber,
        stepKey: input.stepKey,
        reporterId: input.reporterId,
        message: input.message,
        status: "open",
        resolvedById: null,
        resolvedAt: null,
        createdAt: input.nowMs,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert operation step flag.");
    }
    return created;
  }

  async listFlagsForOperation(
    operationId: string,
    statusFilter?: OperationStepFlagStatus,
    executor: DbExecutor = this.database
  ): Promise<OperationStepFlagWithReporter[]> {
    const conditions = [eq(operationStepFlags.operationId, operationId)];
    if (statusFilter) {
      conditions.push(eq(operationStepFlags.status, statusFilter));
    }

    const rows = await executor
      .select({
        flag: operationStepFlags,
        reporterName: users.name,
        reporterHandle: users.handle,
      })
      .from(operationStepFlags)
      .innerJoin(users, eq(operationStepFlags.reporterId, users.id))
      .where(and(...conditions))
      .orderBy(desc(operationStepFlags.createdAt))
      .limit(100);

    const resolverIds = Array.from(
      new Set(
        rows
          .map((r) => r.flag.resolvedById)
          .filter((id): id is string => typeof id === "string")
      )
    );
    const resolvers =
      resolverIds.length > 0
        ? await executor
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, resolverIds))
        : [];
    const resolverMap = new Map(resolvers.map((r) => [r.id, r.name]));

    return rows.map((row) => ({
      flag: row.flag,
      reporterName: row.reporterName,
      reporterHandle: row.reporterHandle,
      resolverName: row.flag.resolvedById
        ? (resolverMap.get(row.flag.resolvedById) ?? null)
        : null,
    }));
  }

  async resolveFlagAtomically(
    operationId: string,
    flagId: string,
    resolvedById: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<OperationStepFlagRecord | null> {
    const [updated] = await executor
      .update(operationStepFlags)
      .set({
        status: "resolved",
        resolvedById,
        resolvedAt: nowMs,
      })
      .where(
        and(
          eq(operationStepFlags.id, flagId),
          eq(operationStepFlags.operationId, operationId),
          eq(operationStepFlags.status, "open")
        )
      )
      .returning();
    return updated ?? null;
  }

  private async hydratePublicCards(
    rows: Array<{
      operation: OperationRecord;
      creatorId: string;
      creatorName: string;
      creatorHandle: string | null;
      creatorBio: string | null;
    }>,
    executor: DbExecutor
  ): Promise<PublicOperationCardDto[]> {
    if (rows.length === 0) return [];
    const opIds = rows.map((r) => r.operation.id);
    const versionRows = await executor
      .select({
        operationId: operationVersions.operationId,
        versionNumber: operationVersions.versionNumber,
        stepsSnapshotJson: operationVersions.stepsSnapshotJson,
      })
      .from(operationVersions)
      .where(inArray(operationVersions.operationId, opIds));

    const currentVerByOp = new Map(
      rows.map((r) => [r.operation.id, r.operation.currentVersion])
    );
    const stepCountByOp = new Map<string, number>();
    for (const ver of versionRows) {
      if (ver.versionNumber === currentVerByOp.get(ver.operationId)) {
        stepCountByOp.set(ver.operationId, countStepsJson(ver.stepsSnapshotJson));
      }
    }

    return rows.map((row) =>
      toPublicOperationCardDto({
        operation: row.operation,
        stepCount: stepCountByOp.get(row.operation.id) ?? 0,
        creator: {
          id: row.creatorId,
          name: row.creatorName,
          handle: row.creatorHandle,
          bio: row.creatorBio,
        },
      })
    );
  }

  async listPublicExploreOperations(
    params: {
      domain?: OperationDomain;
      query?: string;
      sort?: ExploreSortOption;
      limit?: number;
    } = {},
    executor: DbExecutor = this.database
  ): Promise<PublicOperationCardDto[]> {
    const conditions = [
      eq(operations.visibility, "public"),
      eq(operations.isArchived, false),
      eq(users.isSuspended, false),
    ];
    if (params.domain) {
      conditions.push(eq(operations.domain, params.domain));
    }

    const orderClauses =
      params.sort === "most_forked"
        ? [desc(operations.forkCount), desc(operations.updatedAt)]
        : params.sort === "recently_verified"
          ? [
              sql`COALESCE(${operations.lastVerifiedAt}, 0) DESC`,
              desc(operations.updatedAt),
            ]
          : [desc(operations.updatedAt), desc(operations.id)];

    const rows = await executor
      .select({
        operation: operations,
        creatorId: users.id,
        creatorName: users.name,
        creatorHandle: users.handle,
        creatorBio: users.bio,
      })
      .from(operations)
      .innerJoin(users, eq(operations.ownerId, users.id))
      .where(and(...conditions))
      .orderBy(...orderClauses)
      .limit(params.limit ?? 60);

    const cards = await this.hydratePublicCards(rows, executor);
    const q = params.query?.trim().toLowerCase() ?? "";
    if (!q) return cards;

    return cards.filter(
      (card) =>
        card.title.toLowerCase().includes(q) ||
        card.summary.toLowerCase().includes(q) ||
        card.tags.some((t) => t.includes(q)) ||
        (card.creator.handle?.toLowerCase().includes(q) ?? false) ||
        card.creator.name.toLowerCase().includes(q)
    );
  }

  private async assemblePublicOperationDetail(
    row: {
      operation: OperationRecord;
      creatorId: string;
      creatorName: string;
      creatorHandle: string | null;
      creatorBio: string | null;
    },
    executor: DbExecutor
  ): Promise<PublicOperationDetailDto | null> {
    const [latestVersion] = await executor
      .select()
      .from(operationVersions)
      .where(
        and(
          eq(operationVersions.operationId, row.operation.id),
          eq(operationVersions.versionNumber, row.operation.currentVersion)
        )
      )
      .limit(1);

    let resolvedVersion: OperationVersionRecord | undefined = latestVersion;
    if (!resolvedVersion) {
      const [fallback] = await executor
        .select()
        .from(operationVersions)
        .where(eq(operationVersions.operationId, row.operation.id))
        .orderBy(desc(operationVersions.versionNumber))
        .limit(1);
      resolvedVersion = fallback;
    }
    if (!resolvedVersion) return null;

    let forkedFrom: PublicOperationForkSourceDto | null = null;
    if (row.operation.forkedFromId) {
      const [sourceRow] = await executor
        .select({
          slug: operations.slug,
          title: operations.title,
          visibility: operations.visibility,
          creatorHandle: users.handle,
          creatorName: users.name,
        })
        .from(operations)
        .innerJoin(users, eq(operations.ownerId, users.id))
        .where(eq(operations.id, row.operation.forkedFromId))
        .limit(1);
      // Only attribute publicly visible source blueprints so private titles/slugs never leak!
      if (sourceRow && sourceRow.visibility === "public") {
        forkedFrom = {
          slug: sourceRow.slug,
          title: sourceRow.title,
          creatorHandle: sourceRow.creatorHandle,
          creatorName: sourceRow.creatorName,
        };
      }
    }

    return toPublicOperationDetailDto({
      operation: row.operation,
      version: resolvedVersion,
      creator: {
        id: row.creatorId,
        name: row.creatorName,
        handle: row.creatorHandle,
        bio: row.creatorBio,
      },
      forkedFrom,
    });
  }

  async getPublicOperationBySlug(
    slug: string,
    executor: DbExecutor = this.database
  ): Promise<PublicOperationDetailDto | null> {
    const [row] = await executor
      .select({
        operation: operations,
        creatorId: users.id,
        creatorName: users.name,
        creatorHandle: users.handle,
        creatorBio: users.bio,
      })
      .from(operations)
      .innerJoin(users, eq(operations.ownerId, users.id))
      .where(
        and(
          eq(operations.slug, slug),
          eq(operations.visibility, "public"),
          eq(operations.isArchived, false),
          eq(users.isSuspended, false)
        )
      )
      .limit(1);

    if (!row) return null;
    return this.assemblePublicOperationDetail(row, executor);
  }

  async getUnlistedOperationDtoById(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<PublicOperationDetailDto | null> {
    const [row] = await executor
      .select({
        operation: operations,
        creatorId: users.id,
        creatorName: users.name,
        creatorHandle: users.handle,
        creatorBio: users.bio,
      })
      .from(operations)
      .innerJoin(users, eq(operations.ownerId, users.id))
      .where(and(eq(operations.id, operationId), eq(users.isSuspended, false)))
      .limit(1);

    if (!row) return null;
    return this.assemblePublicOperationDetail(row, executor);
  }

  async getPublicCreatorProfileByHandle(
    handle: string,
    executor: DbExecutor = this.database
  ): Promise<PublicCreatorProfileDto | null> {
    const normalized = handle.trim().toLowerCase().replace(/^@+/, "");
    const [creator] = await executor
      .select({
        id: users.id,
        name: users.name,
        handle: users.handle,
        bio: users.bio,
      })
      .from(users)
      .where(and(eq(users.handle, normalized), eq(users.isSuspended, false)))
      .limit(1);

    if (!creator || !creator.handle) return null;

    const [followCounts, opRows] = await Promise.all([
      this.getFollowCounts(creator.id, executor),
      executor
        .select({
          operation: operations,
          creatorId: users.id,
          creatorName: users.name,
          creatorHandle: users.handle,
          creatorBio: users.bio,
        })
        .from(operations)
        .innerJoin(users, eq(operations.ownerId, users.id))
        .where(
          and(
            eq(operations.ownerId, creator.id),
            eq(operations.visibility, "public"),
            eq(operations.isArchived, false)
          )
        )
        .orderBy(desc(operations.updatedAt))
        .limit(100),
    ]);

    const cards = await this.hydratePublicCards(opRows, executor);

    return {
      creator: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        bio: creator.bio,
      },
      followerCount: followCounts.followerCount,
      followingCount: followCounts.followingCount,
      publicOperationsCount: cards.length,
      operations: cards,
    };
  }

  async listPublicOperationSlugs(
    limit = 200,
    executor: DbExecutor = this.database
  ): Promise<Array<{ slug: string; updatedAt: number }>> {
    return executor
      .select({
        slug: operations.slug,
        updatedAt: operations.updatedAt,
      })
      .from(operations)
      .innerJoin(users, eq(operations.ownerId, users.id))
      .where(
        and(
          eq(operations.visibility, "public"),
          eq(operations.isArchived, false),
          eq(users.isSuspended, false)
        )
      )
      .orderBy(desc(operations.updatedAt))
      .limit(limit);
  }

  async listStaleOperationCandidatesPage(
    limit: number,
    offset: number,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<StaleOperationCandidate[]> {
    const rows = await executor
      .select({
        id: operations.id,
        ownerId: operations.ownerId,
        title: operations.title,
        slug: operations.slug,
        reviewCycleDays: operations.reviewCycleDays,
        lastVerifiedAt: operations.lastVerifiedAt,
        updatedAt: operations.updatedAt,
        ownerTimezone: users.timezone,
      })
      .from(operations)
      .innerJoin(users, eq(operations.ownerId, users.id))
      .where(
        and(
          eq(operations.isArchived, false),
          eq(users.isSuspended, false),
          isNotNull(operations.reviewCycleDays),
          sql`(COALESCE(${operations.lastVerifiedAt}, ${operations.updatedAt}) + (${operations.reviewCycleDays} * 86400000)) <= ${nowMs}`
        )
      )
      .orderBy(asc(operations.id))
      .limit(limit)
      .offset(offset);

    return rows.filter(
      (r): r is StaleOperationCandidate =>
        typeof r.reviewCycleDays === "number" && r.reviewCycleDays >= 1
    );
  }
}

export const operationsSocialRepository: OperationsSocialRepository =
  new DrizzleOperationsSocialRepository(db);
