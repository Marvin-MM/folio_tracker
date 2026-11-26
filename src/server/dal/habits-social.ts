import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import {
  DrizzleHabitRepository,
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitComments,
  habitMonitorItems,
  habitMonitorRequests,
  habitMonitors,
  habitReactions,
  habits,
  habitTrackerSettings,
  habitWeeklySnapshots,
  projectMembers,
  users,
  type HabitCommentMode,
  type HabitCommentRecord,
  type HabitLogRecord,
  type HabitMonitorRecord,
  type HabitMonitorRequestRecord,
  type HabitMonitorRequestStatus,
  type HabitMonitorScope,
  type HabitReactionRecord,
  type HabitReactionType,
  type HabitRecord,
  type HabitTrackerSettingsRecord,
  type HabitWeeklySnapshotRecord,
} from "@/server/db/schema";
import {
  evaluateCommentWindow,
  resolveEffectivePolicy,
  type CommentWindowState,
  type EffectiveCommentPolicy,
} from "@/server/domain/comment-window-policy";
import {
  evaluateMonthLockState,
  type MonthLockIntegritySummary,
} from "@/server/domain/habit-month-lock";
import {
  addDaysToDateKey,
  buildMonthCalendar,
  computeHabitMonthAnalytics,
  getLocalDateKey,
  isValidYearMonth,
  parseScheduledDaysJson,
  type HabitMonthAnalytics,
  type ScoringMode,
} from "@/server/domain/habit-analytics";

export interface KnownCollaborator {
  userId: string;
  name: string;
  email: string;
}

export interface BasicUserProfile {
  id: string;
  name: string;
  email: string;
  timezone: string;
  emailVerified: boolean;
}

export interface MonitorWithUser extends HabitMonitorRecord {
  monitorName: string;
  monitorEmail: string;
  monitorTimezone: string;
  selectedHabitIds: string[];
}

export interface MonitoredOwnerSummary {
  monitor: HabitMonitorRecord;
  owner: {
    id: string;
    name: string;
    email: string;
    timezone: string;
  };
  globalSettings: HabitTrackerSettingsRecord;
  selectedHabitIds: string[];
}

export interface IncomingMonitorRequestItem extends HabitMonitorRequestRecord {
  ownerName: string;
  ownerEmail: string;
}

export interface TokenMonitorRequestMatch {
  request: HabitMonitorRequestRecord;
  ownerName: string;
  ownerEmail: string;
}

export interface ActiveMonitorDigestCandidate {
  monitor: HabitMonitorRecord;
  ownerName: string;
  ownerTimezone: string;
  monitorName: string;
  monitorTimezone: string;
  globalSettings: HabitTrackerSettingsRecord;
  allowedHabitIds: string[] | null;
}

export interface HabitCommentWithAuthor extends HabitCommentRecord {
  authorName: string;
  targetHabitTitle: string | null;
}

export interface HabitReactionWithAuthor extends HabitReactionRecord {
  authorName: string;
}

export interface UpsertActiveMonitorInput {
  ownerId: string;
  monitorUserId: string;
  scope: HabitMonitorScope;
  useCustomPolicy?: boolean;
  customCommentMode?: HabitCommentMode | null;
  customWindowStartDay?: number | null;
  customWindowStartTime?: string | null;
  customWindowEndDay?: number | null;
  customWindowEndTime?: string | null;
  customIntervalDays?: number | null;
  customIntervalAnchorDate?: string | null;
  customIntervalOpenHours?: number | null;
  customAllowReactionsWhenLocked?: boolean | null;
  nowMs: number;
}

export interface UpdateMonitorConfigRowPatch {
  scope?: HabitMonitorScope;
  useCustomPolicy?: boolean;
  customCommentMode?: HabitCommentMode | null;
  customWindowStartDay?: number | null;
  customWindowStartTime?: string | null;
  customWindowEndDay?: number | null;
  customWindowEndTime?: string | null;
  customIntervalDays?: number | null;
  customIntervalAnchorDate?: string | null;
  customIntervalOpenHours?: number | null;
  customAllowReactionsWhenLocked?: boolean | null;
}

export interface CreateMonitorRequestRowInput {
  ownerId: string;
  targetUserId: string | null;
  targetEmail: string;
  tokenHash: string | null;
  scope: HabitMonitorScope;
  selectedHabitIdsJson: string;
  proposedPolicyJson: string | null;
  expiresAt: number;
  nowMs: number;
}

export interface CreateHabitCommentRowInput {
  ownerId: string;
  authorId: string;
  cycleKey: string;
  targetDateKey: string | null;
  targetHabitId: string | null;
  parentCommentId: string | null;
  body: string;
  nowMs: number;
}

export interface ScopedFriendWorkspace {
  owner: {
    id: string;
    name: string;
    timezone: string;
  };
  monitor: HabitMonitorRecord;
  effectivePolicy: EffectiveCommentPolicy;
  windowState: CommentWindowState;
  activeCycleKey: string;
  availableCycleKeys: string[];
  habits: HabitRecord[];
  logsByKey: Record<string, HabitLogRecord>;
  analytics: HabitMonthAnalytics;
  comments: HabitCommentWithAuthor[];
  reactions: HabitReactionWithAuthor[];
  todayDateKey: string;
  yearMonth: string;
  scoringMode: ScoringMode;
  monthLockIntegrity: MonthLockIntegritySummary;
}

export interface HabitSocialRepository {
  listKnownCollaborators(
    userId: string,
    nowMs: number
  ): Promise<KnownCollaborator[]>;
  findUserByNormalizedEmail(
    normalizedEmail: string,
    executor?: DbExecutor
  ): Promise<BasicUserProfile | null>;
  findUserById(
    userId: string,
    executor?: DbExecutor
  ): Promise<BasicUserProfile | null>;
  filterOwnedHabitIds(
    ownerId: string,
    habitIds: string[],
    executor?: DbExecutor
  ): Promise<string[]>;
  getActiveMonitor(
    ownerId: string,
    monitorUserId: string,
    executor?: DbExecutor
  ): Promise<HabitMonitorRecord | null>;
  getMonitorByIdForOwner(
    ownerId: string,
    monitorId: string,
    executor?: DbExecutor
  ): Promise<HabitMonitorRecord | null>;
  listActiveMonitorsForOwner(ownerId: string): Promise<MonitorWithUser[]>;
  listMonitoringOwnersForUser(
    monitorUserId: string
  ): Promise<MonitoredOwnerSummary[]>;
  upsertActiveMonitor(
    input: UpsertActiveMonitorInput,
    executor?: DbExecutor
  ): Promise<HabitMonitorRecord>;
  replaceMonitorItems(
    monitorId: string,
    habitIds: string[],
    executor?: DbExecutor
  ): Promise<void>;
  listAllowedHabitIdsForMonitor(
    monitorId: string,
    executor?: DbExecutor
  ): Promise<string[]>;
  updateMonitorConfigForOwner(
    ownerId: string,
    monitorId: string,
    patch: UpdateMonitorConfigRowPatch,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<HabitMonitorRecord | null>;
  revokeMonitorForOwner(
    ownerId: string,
    monitorId: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<HabitMonitorRecord | null>;
  listActiveMonitorPairsPage(
    limit: number,
    offset: number
  ): Promise<ActiveMonitorDigestCandidate[]>;
  createMonitorRequest(
    input: CreateMonitorRequestRowInput,
    executor?: DbExecutor
  ): Promise<HabitMonitorRequestRecord>;
  findRequestById(
    requestId: string,
    executor?: DbExecutor
  ): Promise<HabitMonitorRequestRecord | null>;
  findRequestByTokenHash(
    tokenHash: string,
    executor?: DbExecutor
  ): Promise<TokenMonitorRequestMatch | null>;
  findPendingRequestByOwnerAndEmail(
    ownerId: string,
    normalizedEmail: string,
    executor?: DbExecutor
  ): Promise<HabitMonitorRequestRecord | null>;
  listIncomingPendingRequestsForUser(
    userId: string,
    nowMs: number
  ): Promise<IncomingMonitorRequestItem[]>;
  listOutgoingPendingRequestsForOwner(
    ownerId: string,
    nowMs: number
  ): Promise<HabitMonitorRequestRecord[]>;
  claimPendingRequestAtomically(
    requestId: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<HabitMonitorRequestRecord | null>;
  updateRequestStatus(
    requestId: string,
    status: HabitMonitorRequestStatus,
    respondedAt: number | null,
    executor?: DbExecutor
  ): Promise<HabitMonitorRequestRecord | null>;
  getWeeklySnapshot(
    ownerId: string,
    cycleKey: string,
    executor?: DbExecutor
  ): Promise<HabitWeeklySnapshotRecord | null>;
  getOrCreateWeeklySnapshot(
    input: {
      ownerId: string;
      cycleKey: string;
      periodStartDate: string;
      periodEndDate: string;
      metricsJson: string;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<HabitWeeklySnapshotRecord>;
  listCommentsForOwnerCycle(
    ownerId: string,
    cycleKey: string,
    allowedHabitIds: string[] | null,
    executor?: DbExecutor
  ): Promise<HabitCommentWithAuthor[]>;
  listRecentCycleKeysForOwner(
    ownerId: string,
    allowedHabitIds: string[] | null
  ): Promise<string[]>;
  getCommentById(
    commentId: string,
    executor?: DbExecutor
  ): Promise<HabitCommentRecord | null>;
  createComment(
    input: CreateHabitCommentRowInput,
    executor?: DbExecutor
  ): Promise<HabitCommentRecord>;
  deleteComment(commentId: string, executor?: DbExecutor): Promise<boolean>;
  listReactionsForOwnerCycle(
    ownerId: string,
    cycleKey: string,
    executor?: DbExecutor
  ): Promise<HabitReactionWithAuthor[]>;
  toggleReaction(
    input: {
      ownerId: string;
      authorId: string;
      cycleKey: string;
      targetDateKey: string | null;
      reactionType: HabitReactionType;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<{ active: boolean; reaction: HabitReactionRecord | null }>;
}

export class DrizzleHabitSocialRepository implements HabitSocialRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async listKnownCollaborators(
    userId: string,
    nowMs: number
  ): Promise<KnownCollaborator[]> {
    const myProjects = await this.database
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));

    const projectIds = myProjects.map((p) => p.projectId);
    if (projectIds.length === 0) return [];

    const [teammates, activeMonitors, pendingRequests] = await Promise.all([
      this.database
        .selectDistinct({
          userId: users.id,
          name: users.name,
          email: users.email,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(
          and(
            inArray(projectMembers.projectId, projectIds),
            ne(projectMembers.userId, userId)
          )
        )
        .orderBy(asc(users.name)),
      this.database
        .select({ monitorUserId: habitMonitors.monitorUserId })
        .from(habitMonitors)
        .where(
          and(
            eq(habitMonitors.ownerId, userId),
            eq(habitMonitors.status, "active")
          )
        ),
      this.database
        .select({
          targetUserId: habitMonitorRequests.targetUserId,
          targetEmail: habitMonitorRequests.targetEmail,
        })
        .from(habitMonitorRequests)
        .where(
          and(
            eq(habitMonitorRequests.ownerId, userId),
            eq(habitMonitorRequests.status, "pending"),
            gt(habitMonitorRequests.expiresAt, nowMs)
          )
        ),
    ]);

    const excludedIds = new Set<string>(
      activeMonitors.map((m) => m.monitorUserId)
    );
    const excludedEmails = new Set<string>();
    for (const req of pendingRequests) {
      if (req.targetUserId) excludedIds.add(req.targetUserId);
      excludedEmails.add(req.targetEmail.trim().toLowerCase());
    }

    return teammates.filter(
      (t) =>
        !excludedIds.has(t.userId) &&
        !excludedEmails.has(t.email.trim().toLowerCase())
    );
  }

  async findUserByNormalizedEmail(
    normalizedEmail: string,
    executor: DbExecutor = this.database
  ): Promise<BasicUserProfile | null> {
    const clean = normalizedEmail.trim().toLowerCase();
    const [row] = await executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        timezone: users.timezone,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${clean}`)
      .limit(1);

    return row ?? null;
  }

  async findUserById(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<BasicUserProfile | null> {
    const [row] = await executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        timezone: users.timezone,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row ?? null;
  }

  async filterOwnedHabitIds(
    ownerId: string,
    habitIds: string[],
    executor: DbExecutor = this.database
  ): Promise<string[]> {
    const unique = Array.from(new Set(habitIds.filter(Boolean)));
    if (unique.length === 0) return [];

    const rows = await executor
      .select({ id: habits.id })
      .from(habits)
      .where(and(eq(habits.userId, ownerId), inArray(habits.id, unique)));

    return rows.map((r) => r.id);
  }

  async getActiveMonitor(
    ownerId: string,
    monitorUserId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRecord | null> {
    const [row] = await executor
      .select()
      .from(habitMonitors)
      .where(
        and(
          eq(habitMonitors.ownerId, ownerId),
          eq(habitMonitors.monitorUserId, monitorUserId),
          eq(habitMonitors.status, "active")
        )
      )
      .limit(1);

    return row ?? null;
  }

  async getMonitorByIdForOwner(
    ownerId: string,
    monitorId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRecord | null> {
    const [row] = await executor
      .select()
      .from(habitMonitors)
      .where(
        and(
          eq(habitMonitors.id, monitorId),
          eq(habitMonitors.ownerId, ownerId)
        )
      )
      .limit(1);

    return row ?? null;
  }

  async listActiveMonitorsForOwner(
    ownerId: string
  ): Promise<MonitorWithUser[]> {
    const rows = await this.database
      .select({
        monitor: habitMonitors,
        monitorName: users.name,
        monitorEmail: users.email,
        monitorTimezone: users.timezone,
      })
      .from(habitMonitors)
      .innerJoin(users, eq(habitMonitors.monitorUserId, users.id))
      .where(
        and(
          eq(habitMonitors.ownerId, ownerId),
          eq(habitMonitors.status, "active")
        )
      )
      .orderBy(asc(users.name));

    if (rows.length === 0) return [];

    const monitorIds = rows.map((r) => r.monitor.id);
    const items = await this.database
      .select()
      .from(habitMonitorItems)
      .where(inArray(habitMonitorItems.monitorId, monitorIds));

    const itemsByMonitor = new Map<string, string[]>();
    for (const item of items) {
      const list = itemsByMonitor.get(item.monitorId) ?? [];
      list.push(item.habitId);
      itemsByMonitor.set(item.monitorId, list);
    }

    return rows.map((r) => ({
      ...r.monitor,
      monitorName: r.monitorName,
      monitorEmail: r.monitorEmail,
      monitorTimezone: r.monitorTimezone || "UTC",
      selectedHabitIds: itemsByMonitor.get(r.monitor.id) ?? [],
    }));
  }

  async listMonitoringOwnersForUser(
    monitorUserId: string
  ): Promise<MonitoredOwnerSummary[]> {
    const rows = await this.database
      .select({
        monitor: habitMonitors,
        ownerId: users.id,
        ownerName: users.name,
        ownerEmail: users.email,
        ownerTimezone: users.timezone,
      })
      .from(habitMonitors)
      .innerJoin(users, eq(habitMonitors.ownerId, users.id))
      .where(
        and(
          eq(habitMonitors.monitorUserId, monitorUserId),
          eq(habitMonitors.status, "active")
        )
      )
      .orderBy(asc(users.name));

    if (rows.length === 0) return [];

    const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
    const monitorIds = rows.map((r) => r.monitor.id);

    const [settingsRows, itemRows] = await Promise.all([
      this.database
        .select()
        .from(habitTrackerSettings)
        .where(inArray(habitTrackerSettings.userId, ownerIds)),
      this.database
        .select()
        .from(habitMonitorItems)
        .where(inArray(habitMonitorItems.monitorId, monitorIds)),
    ]);

    const settingsMap = new Map(settingsRows.map((s) => [s.userId, s]));
    const itemsMap = new Map<string, string[]>();
    for (const item of itemRows) {
      const list = itemsMap.get(item.monitorId) ?? [];
      list.push(item.habitId);
      itemsMap.set(item.monitorId, list);
    }

    const nowMs = Date.now();
    return rows.map((r) => {
      const globalSettings: HabitTrackerSettingsRecord =
        settingsMap.get(r.ownerId) ?? {
          userId: r.ownerId,
          weekStartsOn: 1,
          defaultCommentMode: "weekly_window",
          defaultWindowStartDay: 6,
          defaultWindowStartTime: "00:00",
          defaultWindowEndDay: 0,
          defaultWindowEndTime: "23:59",
          defaultIntervalDays: null,
          defaultIntervalAnchorDate: null,
          defaultIntervalOpenHours: 24,
          allowReactionsWhenLocked: true,
          eveningCheckinTime: null,
          monthLockEnabled: true,
          monthLockGraceDays: 3,
          monthLockPinHash: null,
          monthLockPinSalt: null,
          monthLockPinFailedAttempts: 0,
          monthLockPinLockedUntil: null,
          updatedAt: nowMs,
        };

      return {
        monitor: r.monitor,
        owner: {
          id: r.ownerId,
          name: r.ownerName,
          email: r.ownerEmail,
          timezone: r.ownerTimezone || "UTC",
        },
        globalSettings,
        selectedHabitIds: itemsMap.get(r.monitor.id) ?? [],
      };
    });
  }

  async upsertActiveMonitor(
    input: UpsertActiveMonitorInput,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRecord> {
    const [row] = await executor
      .insert(habitMonitors)
      .values({
        ownerId: input.ownerId,
        monitorUserId: input.monitorUserId,
        scope: input.scope,
        status: "active",
        useCustomPolicy: input.useCustomPolicy ?? false,
        customCommentMode: input.customCommentMode ?? null,
        customWindowStartDay: input.customWindowStartDay ?? null,
        customWindowStartTime: input.customWindowStartTime ?? null,
        customWindowEndDay: input.customWindowEndDay ?? null,
        customWindowEndTime: input.customWindowEndTime ?? null,
        customIntervalDays: input.customIntervalDays ?? null,
        customIntervalAnchorDate: input.customIntervalAnchorDate ?? null,
        customIntervalOpenHours: input.customIntervalOpenHours ?? null,
        customAllowReactionsWhenLocked:
          input.customAllowReactionsWhenLocked ?? null,
        createdAt: input.nowMs,
        revokedAt: null,
        updatedAt: input.nowMs,
      })
      .onConflictDoUpdate({
        target: [habitMonitors.ownerId, habitMonitors.monitorUserId],
        set: {
          scope: input.scope,
          status: "active",
          revokedAt: null,
          useCustomPolicy: input.useCustomPolicy ?? false,
          customCommentMode: input.customCommentMode ?? null,
          customWindowStartDay: input.customWindowStartDay ?? null,
          customWindowStartTime: input.customWindowStartTime ?? null,
          customWindowEndDay: input.customWindowEndDay ?? null,
          customWindowEndTime: input.customWindowEndTime ?? null,
          customIntervalDays: input.customIntervalDays ?? null,
          customIntervalAnchorDate: input.customIntervalAnchorDate ?? null,
          customIntervalOpenHours: input.customIntervalOpenHours ?? null,
          customAllowReactionsWhenLocked:
            input.customAllowReactionsWhenLocked ?? null,
          updatedAt: input.nowMs,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert habit monitor.");
    }
    return row;
  }

  async replaceMonitorItems(
    monitorId: string,
    habitIds: string[],
    executor: DbExecutor = this.database
  ): Promise<void> {
    await executor
      .delete(habitMonitorItems)
      .where(eq(habitMonitorItems.monitorId, monitorId));

    const unique = Array.from(new Set(habitIds.filter(Boolean)));
    if (unique.length === 0) return;

    await executor.insert(habitMonitorItems).values(
      unique.map((habitId) => ({
        monitorId,
        habitId,
      }))
    );
  }

  async listAllowedHabitIdsForMonitor(
    monitorId: string,
    executor: DbExecutor = this.database
  ): Promise<string[]> {
    const rows = await executor
      .select({ habitId: habitMonitorItems.habitId })
      .from(habitMonitorItems)
      .where(eq(habitMonitorItems.monitorId, monitorId));

    return rows.map((r) => r.habitId);
  }

  async updateMonitorConfigForOwner(
    ownerId: string,
    monitorId: string,
    patch: UpdateMonitorConfigRowPatch,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRecord | null> {
    const [updated] = await executor
      .update(habitMonitors)
      .set({
        ...patch,
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(habitMonitors.id, monitorId),
          eq(habitMonitors.ownerId, ownerId),
          eq(habitMonitors.status, "active")
        )
      )
      .returning();

    return updated ?? null;
  }

  async revokeMonitorForOwner(
    ownerId: string,
    monitorId: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRecord | null> {
    const [revoked] = await executor
      .update(habitMonitors)
      .set({
        status: "revoked",
        revokedAt: nowMs,
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(habitMonitors.id, monitorId),
          eq(habitMonitors.ownerId, ownerId),
          eq(habitMonitors.status, "active")
        )
      )
      .returning();

    return revoked ?? null;
  }

  async listActiveMonitorPairsPage(
    limit = 200,
    offset = 0
  ): Promise<ActiveMonitorDigestCandidate[]> {
    const monitorRows = await this.database
      .select()
      .from(habitMonitors)
      .where(eq(habitMonitors.status, "active"))
      .orderBy(asc(habitMonitors.id))
      .limit(limit)
      .offset(offset);

    if (monitorRows.length === 0) return [];

    const userIds = Array.from(
      new Set(monitorRows.flatMap((m) => [m.ownerId, m.monitorUserId]))
    );
    const ownerIds = Array.from(new Set(monitorRows.map((m) => m.ownerId)));
    const selectedMonitorIds = monitorRows
      .filter((m) => m.scope === "selected")
      .map((m) => m.id);

    const [userRows, settingsRows, itemRows] = await Promise.all([
      this.database
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
        })
        .from(users)
        .where(inArray(users.id, userIds)),
      this.database
        .select()
        .from(habitTrackerSettings)
        .where(inArray(habitTrackerSettings.userId, ownerIds)),
      selectedMonitorIds.length > 0
        ? this.database
            .select()
            .from(habitMonitorItems)
            .where(inArray(habitMonitorItems.monitorId, selectedMonitorIds))
        : Promise.resolve([]),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const settingsMap = new Map(settingsRows.map((s) => [s.userId, s]));
    const itemsMap = new Map<string, string[]>();
    for (const item of itemRows) {
      const list = itemsMap.get(item.monitorId) ?? [];
      list.push(item.habitId);
      itemsMap.set(item.monitorId, list);
    }

    const nowMs = Date.now();
    return monitorRows
      .map((monitor): ActiveMonitorDigestCandidate | null => {
        const owner = userMap.get(monitor.ownerId);
        const watcher = userMap.get(monitor.monitorUserId);
        if (!owner || !watcher) return null;

        const globalSettings: HabitTrackerSettingsRecord =
          settingsMap.get(monitor.ownerId) ?? {
            userId: monitor.ownerId,
            weekStartsOn: 1,
            defaultCommentMode: "weekly_window",
            defaultWindowStartDay: 6,
            defaultWindowStartTime: "00:00",
            defaultWindowEndDay: 0,
            defaultWindowEndTime: "23:59",
            defaultIntervalDays: null,
            defaultIntervalAnchorDate: null,
            defaultIntervalOpenHours: 24,
            allowReactionsWhenLocked: true,
            eveningCheckinTime: null,
            monthLockEnabled: true,
            monthLockGraceDays: 3,
            monthLockPinHash: null,
            monthLockPinSalt: null,
            monthLockPinFailedAttempts: 0,
            monthLockPinLockedUntil: null,
            updatedAt: nowMs,
          };

        return {
          monitor,
          ownerName: owner.name,
          ownerTimezone: owner.timezone || "UTC",
          monitorName: watcher.name,
          monitorTimezone: watcher.timezone || "UTC",
          globalSettings,
          allowedHabitIds:
            monitor.scope === "selected"
              ? itemsMap.get(monitor.id) ?? []
              : null,
        };
      })
      .filter((row): row is ActiveMonitorDigestCandidate => row !== null);
  }

  async createMonitorRequest(
    input: CreateMonitorRequestRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRequestRecord> {
    const [created] = await executor
      .insert(habitMonitorRequests)
      .values({
        ownerId: input.ownerId,
        targetUserId: input.targetUserId,
        targetEmail: input.targetEmail,
        tokenHash: input.tokenHash,
        scope: input.scope,
        selectedHabitIdsJson: input.selectedHabitIdsJson,
        proposedPolicyJson: input.proposedPolicyJson,
        status: "pending",
        expiresAt: input.expiresAt,
        createdAt: input.nowMs,
        respondedAt: null,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create habit monitor request.");
    }
    return created;
  }

  async findRequestById(
    requestId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRequestRecord | null> {
    const [row] = await executor
      .select()
      .from(habitMonitorRequests)
      .where(eq(habitMonitorRequests.id, requestId))
      .limit(1);

    return row ?? null;
  }

  async findRequestByTokenHash(
    tokenHash: string,
    executor: DbExecutor = this.database
  ): Promise<TokenMonitorRequestMatch | null> {
    const [row] = await executor
      .select({
        request: habitMonitorRequests,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(habitMonitorRequests)
      .innerJoin(users, eq(habitMonitorRequests.ownerId, users.id))
      .where(eq(habitMonitorRequests.tokenHash, tokenHash))
      .limit(1);

    return row ?? null;
  }

  async findPendingRequestByOwnerAndEmail(
    ownerId: string,
    normalizedEmail: string,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRequestRecord | null> {
    const [row] = await executor
      .select()
      .from(habitMonitorRequests)
      .where(
        and(
          eq(habitMonitorRequests.ownerId, ownerId),
          eq(habitMonitorRequests.targetEmail, normalizedEmail),
          eq(habitMonitorRequests.status, "pending")
        )
      )
      .limit(1);

    return row ?? null;
  }

  async listIncomingPendingRequestsForUser(
    userId: string,
    nowMs: number
  ): Promise<IncomingMonitorRequestItem[]> {
    const rows = await this.database
      .select({
        request: habitMonitorRequests,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(habitMonitorRequests)
      .innerJoin(users, eq(habitMonitorRequests.ownerId, users.id))
      .where(
        and(
          eq(habitMonitorRequests.targetUserId, userId),
          eq(habitMonitorRequests.status, "pending"),
          gt(habitMonitorRequests.expiresAt, nowMs)
        )
      )
      .orderBy(desc(habitMonitorRequests.createdAt));

    return rows.map((r) => ({
      ...r.request,
      ownerName: r.ownerName,
      ownerEmail: r.ownerEmail,
    }));
  }

  async listOutgoingPendingRequestsForOwner(
    ownerId: string,
    nowMs: number
  ): Promise<HabitMonitorRequestRecord[]> {
    return this.database
      .select()
      .from(habitMonitorRequests)
      .where(
        and(
          eq(habitMonitorRequests.ownerId, ownerId),
          eq(habitMonitorRequests.status, "pending"),
          gt(habitMonitorRequests.expiresAt, nowMs)
        )
      )
      .orderBy(desc(habitMonitorRequests.createdAt));
  }

  /**
   * Single atomic conditional UPDATE preventing concurrent double-accept TOCTOU.
   */
  async claimPendingRequestAtomically(
    requestId: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRequestRecord | null> {
    const [claimed] = await executor
      .update(habitMonitorRequests)
      .set({
        status: "accepted",
        respondedAt: nowMs,
      })
      .where(
        and(
          eq(habitMonitorRequests.id, requestId),
          eq(habitMonitorRequests.status, "pending"),
          gt(habitMonitorRequests.expiresAt, nowMs)
        )
      )
      .returning();

    return claimed ?? null;
  }

  async updateRequestStatus(
    requestId: string,
    status: HabitMonitorRequestStatus,
    respondedAt: number | null,
    executor: DbExecutor = this.database
  ): Promise<HabitMonitorRequestRecord | null> {
    const [updated] = await executor
      .update(habitMonitorRequests)
      .set({ status, respondedAt })
      .where(eq(habitMonitorRequests.id, requestId))
      .returning();

    return updated ?? null;
  }

  async getWeeklySnapshot(
    ownerId: string,
    cycleKey: string,
    executor: DbExecutor = this.database
  ): Promise<HabitWeeklySnapshotRecord | null> {
    const [row] = await executor
      .select()
      .from(habitWeeklySnapshots)
      .where(
        and(
          eq(habitWeeklySnapshots.ownerId, ownerId),
          eq(habitWeeklySnapshots.cycleKey, cycleKey)
        )
      )
      .limit(1);

    return row ?? null;
  }

  async getOrCreateWeeklySnapshot(
    input: {
      ownerId: string;
      cycleKey: string;
      periodStartDate: string;
      periodEndDate: string;
      metricsJson: string;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<HabitWeeklySnapshotRecord> {
    await executor
      .insert(habitWeeklySnapshots)
      .values({
        ownerId: input.ownerId,
        cycleKey: input.cycleKey,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        metricsJson: input.metricsJson,
        createdAt: input.nowMs,
      })
      .onConflictDoNothing({
        target: [habitWeeklySnapshots.ownerId, habitWeeklySnapshots.cycleKey],
      });

    const row = await this.getWeeklySnapshot(
      input.ownerId,
      input.cycleKey,
      executor
    );
    if (!row) {
      throw new Error("Failed to load or create habit weekly snapshot.");
    }
    return row;
  }

  async listCommentsForOwnerCycle(
    ownerId: string,
    cycleKey: string,
    allowedHabitIds: string[] | null,
    executor: DbExecutor = this.database
  ): Promise<HabitCommentWithAuthor[]> {
    const rows = await executor
      .select({
        comment: habitComments,
        authorName: users.name,
        targetHabitTitle: habits.title,
      })
      .from(habitComments)
      .innerJoin(users, eq(habitComments.authorId, users.id))
      .leftJoin(habits, eq(habitComments.targetHabitId, habits.id))
      .where(
        and(
          eq(habitComments.ownerId, ownerId),
          eq(habitComments.cycleKey, cycleKey)
        )
      )
      .orderBy(asc(habitComments.createdAt), asc(habitComments.id));

    if (allowedHabitIds === null) {
      return rows.map((r) => ({
        ...r.comment,
        authorName: r.authorName,
        targetHabitTitle: r.targetHabitTitle ?? null,
      }));
    }

    const allowedSet = new Set(allowedHabitIds);
    // First pass: drop comments anchored to unshared habits
    const visibleFirstPass = rows.filter(
      (r) =>
        r.comment.targetHabitId === null ||
        allowedSet.has(r.comment.targetHabitId)
    );
    const visibleIds = new Set(visibleFirstPass.map((r) => r.comment.id));

    // Second pass: drop replies whose parent was anchored to an unshared habit
    return visibleFirstPass
      .filter(
        (r) =>
          r.comment.parentCommentId === null ||
          visibleIds.has(r.comment.parentCommentId)
      )
      .map((r) => ({
        ...r.comment,
        authorName: r.authorName,
        targetHabitTitle: r.targetHabitTitle ?? null,
      }));
  }

  async listRecentCycleKeysForOwner(
    ownerId: string,
    allowedHabitIds: string[] | null
  ): Promise<string[]> {
    const rows = await this.database
      .select({
        cycleKey: habitComments.cycleKey,
        targetHabitId: habitComments.targetHabitId,
        createdAt: habitComments.createdAt,
      })
      .from(habitComments)
      .where(eq(habitComments.ownerId, ownerId))
      .orderBy(desc(habitComments.createdAt))
      .limit(100);

    const allowedSet =
      allowedHabitIds === null ? null : new Set(allowedHabitIds);
    const seen = new Set<string>();
    const ordered: string[] = [];

    for (const row of rows) {
      if (
        allowedSet !== null &&
        row.targetHabitId !== null &&
        !allowedSet.has(row.targetHabitId)
      ) {
        continue;
      }
      if (!seen.has(row.cycleKey)) {
        seen.add(row.cycleKey);
        ordered.push(row.cycleKey);
      }
    }

    return ordered;
  }

  async getCommentById(
    commentId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitCommentRecord | null> {
    const [row] = await executor
      .select()
      .from(habitComments)
      .where(eq(habitComments.id, commentId))
      .limit(1);

    return row ?? null;
  }

  async createComment(
    input: CreateHabitCommentRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitCommentRecord> {
    const [created] = await executor
      .insert(habitComments)
      .values({
        ownerId: input.ownerId,
        authorId: input.authorId,
        cycleKey: input.cycleKey,
        targetDateKey: input.targetDateKey,
        targetHabitId: input.targetHabitId,
        parentCommentId: input.parentCommentId,
        body: input.body,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert habit comment.");
    }
    return created;
  }

  async deleteComment(
    commentId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(habitComments)
      .where(eq(habitComments.id, commentId))
      .returning({ id: habitComments.id });
    return deleted.length > 0;
  }

  async listReactionsForOwnerCycle(
    ownerId: string,
    cycleKey: string,
    executor: DbExecutor = this.database
  ): Promise<HabitReactionWithAuthor[]> {
    const rows = await executor
      .select({
        reaction: habitReactions,
        authorName: users.name,
      })
      .from(habitReactions)
      .innerJoin(users, eq(habitReactions.authorId, users.id))
      .where(
        and(
          eq(habitReactions.ownerId, ownerId),
          eq(habitReactions.cycleKey, cycleKey)
        )
      )
      .orderBy(asc(habitReactions.createdAt));

    return rows.map((r) => ({
      ...r.reaction,
      authorName: r.authorName,
    }));
  }

  async toggleReaction(
    input: {
      ownerId: string;
      authorId: string;
      cycleKey: string;
      targetDateKey: string | null;
      reactionType: HabitReactionType;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<{ active: boolean; reaction: HabitReactionRecord | null }> {
    const datePredicate =
      input.targetDateKey === null
        ? isNull(habitReactions.targetDateKey)
        : eq(habitReactions.targetDateKey, input.targetDateKey);

    const existing = await executor
      .select({ id: habitReactions.id })
      .from(habitReactions)
      .where(
        and(
          eq(habitReactions.ownerId, input.ownerId),
          eq(habitReactions.authorId, input.authorId),
          eq(habitReactions.cycleKey, input.cycleKey),
          datePredicate,
          eq(habitReactions.reactionType, input.reactionType)
        )
      )
      .limit(1);

    if (existing[0]) {
      await executor
        .delete(habitReactions)
        .where(eq(habitReactions.id, existing[0].id));
      return { active: false, reaction: null };
    }

    const [created] = await executor
      .insert(habitReactions)
      .values({
        ownerId: input.ownerId,
        authorId: input.authorId,
        cycleKey: input.cycleKey,
        targetDateKey: input.targetDateKey,
        reactionType: input.reactionType,
        createdAt: input.nowMs,
      })
      .returning();

    return { active: true, reaction: created ?? null };
  }
}

export interface HabitMonitorReadDal {
  getScopedFriendWorkspace(params: {
    viewerUserId: string;
    ownerId: string;
    yearMonth?: string;
    scoringMode?: ScoringMode;
    selectedCycleKey?: string;
    nowMs?: number;
  }): Promise<ScopedFriendWorkspace>;
}

/**
 * Direct-Turso Zero-Leak Scoped Projection DAL for read-only friend monitoring.
 * Verifies active `habit_monitors` row directly against Turso (zero Redis auth cache)
 * and filters habits, logs, analytics, KPIs, and comments strictly to the allowed scope.
 */
export class DrizzleHabitMonitorReadDal implements HabitMonitorReadDal {
  constructor(
    private readonly social: HabitSocialRepository = habitSocialRepository,
    private readonly habitRepo: HabitRepository = habitRepository
  ) {}

  async getScopedFriendWorkspace(params: {
    viewerUserId: string;
    ownerId: string;
    yearMonth?: string;
    scoringMode?: ScoringMode;
    selectedCycleKey?: string;
    nowMs?: number;
  }): Promise<ScopedFriendWorkspace> {
    const nowMs = params.nowMs ?? Date.now();

    const monitor = await this.social.getActiveMonitor(
      params.ownerId,
      params.viewerUserId
    );
    if (!monitor) {
      throw new ForbiddenError(
        "You do not have active monitor access to this habit tracker."
      );
    }

    const [owner, globalSettings, allowedIdsRaw, allActiveHabits] =
      await Promise.all([
        this.social.findUserById(params.ownerId),
        this.habitRepo.getOrCreateSettings(params.ownerId),
        monitor.scope === "selected"
          ? this.social.listAllowedHabitIdsForMonitor(monitor.id)
          : Promise.resolve(null),
        this.habitRepo.listHabitsForUser(params.ownerId, {
          includeArchived: false,
        }),
      ]);

    if (!owner) {
      throw new NotFoundError("Habit owner not found.");
    }

    const ownerTimezone = owner.timezone || "UTC";
    const allowedSet = allowedIdsRaw ? new Set(allowedIdsRaw) : null;
    const scopedHabits =
      allowedSet === null
        ? allActiveHabits
        : allActiveHabits.filter((h) => allowedSet.has(h.id));

    const scopedHabitIdSet = new Set(scopedHabits.map((h) => h.id));
    const todayDateKey = getLocalDateKey(nowMs, ownerTimezone);
    const currentMonth = todayDateKey.slice(0, 7);
    const requestedMonth =
      params.yearMonth && isValidYearMonth(params.yearMonth)
        ? params.yearMonth
        : currentMonth;
    // Never allow viewing or tracking future months before they begin
    const yearMonth =
      requestedMonth > currentMonth ? currentMonth : requestedMonth;
    const scoringMode: ScoringMode =
      params.scoringMode === "full_month" ? "full_month" : "elapsed";
    const weekStartsOn: 0 | 1 = globalSettings.weekStartsOn === 0 ? 0 : 1;
    const calendar = buildMonthCalendar(yearMonth, weekStartsOn);

    const defaultLookback = addDaysToDateKey(calendar.monthStartKey, -120);
    const maxLookback = addDaysToDateKey(calendar.monthStartKey, -365);
    let earliestStart = defaultLookback;
    for (const h of scopedHabits) {
      if (h.startDate < earliestStart) {
        earliestStart = h.startDate < maxLookback ? maxLookback : h.startDate;
      }
    }
    const fetchEnd =
      todayDateKey > calendar.monthEndKey ? todayDateKey : calendar.monthEndKey;

    const [rawLogs, monthLockRow] = await Promise.all([
      scopedHabits.length > 0
        ? this.habitRepo.listLogsForRange(
            params.ownerId,
            earliestStart,
            fetchEnd
          )
        : Promise.resolve([]),
      this.habitRepo.getMonthLock(params.ownerId, yearMonth),
    ]);
    const monthLockState = evaluateMonthLockState({
      yearMonth,
      todayDateKey,
      nowMs,
      settings: globalSettings,
      lockRow: monthLockRow,
    });
    const monthLockIntegrity: MonthLockIntegritySummary = {
      phase: monthLockState.phase,
      isLocked: monthLockState.isLocked,
      unlockCount: monthLockState.unlockCount,
      hasBeenUnlocked: monthLockState.hasBeenUnlocked,
    };
    // ZERO-LEAK: drop every log row whose habitId is not in the monitor's allowed set
    const scopedLogs = rawLogs.filter((log) =>
      scopedHabitIdSet.has(log.habitId)
    );

    const analytics = computeHabitMonthAnalytics({
      yearMonth,
      todayDateKey,
      weekStartsOn,
      scoringMode,
      habits: scopedHabits.map((h) => ({
        id: h.id,
        title: h.title,
        cadenceType: h.cadenceType,
        scheduledDays: parseScheduledDaysJson(h.scheduledDaysJson),
        weeklyTargetCount: h.weeklyTargetCount,
        startDate: h.startDate,
      })),
      logs: scopedLogs,
    });

    const logsByKey: Record<string, HabitLogRecord> = {};
    for (const log of scopedLogs) {
      if (
        log.dateKey >= calendar.monthStartKey &&
        log.dateKey <= calendar.monthEndKey
      ) {
        logsByKey[`${log.habitId}::${log.dateKey}`] = log;
      }
    }

    const effectivePolicy = resolveEffectivePolicy(globalSettings, monitor);
    const windowState = evaluateCommentWindow(
      effectivePolicy,
      ownerTimezone,
      nowMs
    );

    const recentCycles = await this.social.listRecentCycleKeysForOwner(
      params.ownerId,
      allowedIdsRaw
    );
    const availableCycleKeys = Array.from(
      new Set([
        windowState.cycleKey,
        ...(windowState.lastClosedCycleKey
          ? [windowState.lastClosedCycleKey]
          : []),
        ...recentCycles,
      ])
    );

    const activeCycleKey =
      params.selectedCycleKey &&
      availableCycleKeys.includes(params.selectedCycleKey)
        ? params.selectedCycleKey
        : windowState.cycleKey;

    const [comments, reactions] = await Promise.all([
      this.social.listCommentsForOwnerCycle(
        params.ownerId,
        activeCycleKey,
        allowedIdsRaw
      ),
      this.social.listReactionsForOwnerCycle(params.ownerId, activeCycleKey),
    ]);

    return {
      owner: {
        id: owner.id,
        name: owner.name,
        timezone: ownerTimezone,
      },
      monitor,
      effectivePolicy,
      windowState,
      activeCycleKey,
      availableCycleKeys,
      habits: scopedHabits,
      logsByKey,
      analytics,
      comments,
      reactions,
      todayDateKey,
      yearMonth,
      scoringMode,
      monthLockIntegrity,
    };
  }
}

export const habitSocialRepository: HabitSocialRepository =
  new DrizzleHabitSocialRepository(db);

export const habitMonitorReadDal: HabitMonitorReadDal =
  new DrizzleHabitMonitorReadDal(
    habitSocialRepository,
    new DrizzleHabitRepository(db)
  );
