import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { generateEvenPositions } from "@/lib/fractional-index";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitImportAliases,
  habitLogs,
  habitMonthLocks,
  habitMonthRosters,
  habits,
  habitTrackerSettings,
  tasks,
  users,
  type HabitCadenceType,
  type HabitCommentMode,
  type HabitLogRecord,
  type HabitImportAliasRecord,
  type HabitLogStatus,
  type HabitMonthLockRecord,
  type HabitMonthLockStatus,
  type HabitRecord,
  type HabitTrackerSettingsRecord,
  type TaskStatus,
} from "@/server/db/schema";

export interface CreateHabitRowInput {
  userId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDaysJson?: string;
  weeklyTargetCount?: number | null;
  startDate: string;
  preferredTime?: string | null;
  linkedProjectId?: string | null;
  autoSyncDailyTask?: boolean;
  position: string;
}

export interface UpsertAliasRowInput {
  userId: string;
  habitId: string;
  sourceTitle: string;
  normalizedTitle: string;
  firstSeenDateKey: string;
  lastSeenDateKey: string;
}

export interface UpdateHabitRowInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDaysJson?: string;
  weeklyTargetCount?: number | null;
  startDate?: string;
  preferredTime?: string | null;
  linkedProjectId?: string | null;
  autoSyncDailyTask?: boolean;
  position?: string;
  isArchived?: boolean;
}

export interface UpdateHabitSettingsRowInput {
  weekStartsOn?: number;
  defaultCommentMode?: HabitCommentMode;
  defaultWindowStartDay?: number;
  defaultWindowStartTime?: string;
  defaultWindowEndDay?: number;
  defaultWindowEndTime?: string;
  defaultIntervalDays?: number | null;
  defaultIntervalAnchorDate?: string | null;
  defaultIntervalOpenHours?: number;
  allowReactionsWhenLocked?: boolean;
  eveningCheckinTime?: string | null;
  monthLockEnabled?: boolean;
  monthLockGraceDays?: number;
}

export interface UpsertHabitMonthLockRowInput {
  userId: string;
  yearMonth: string;
  status: HabitMonthLockStatus;
  lockedAt: number | null;
  unlockedAt: number | null;
  unlockedUntil: number | null;
  unlockReason: string | null;
  unlockCount: number;
  updatedAt: number;
}

export interface HabitMetadataPatch {
  habitId: string;
  startDate?: string;
  isArchived?: boolean;
}

export interface UpsertHabitLogRowInput {
  habitId: string;
  userId: string;
  dateKey: string;
  status: HabitLogStatus;
  note?: string | null;
  loggedAt: number;
  isBackfilledLate: boolean;
}

export interface HabitNudgeUserCandidate {
  userId: string;
  timezone: string;
  eveningCheckinTime: string | null;
}

export interface LinkedHabitTaskSummary {
  taskId: string;
  habitId: string;
  habitDateKey: string;
  status: TaskStatus;
}

export interface HabitRepository {
  getOrCreateSettings(
    userId: string,
    executor?: DbExecutor
  ): Promise<HabitTrackerSettingsRecord>;
  updateSettings(
    userId: string,
    patch: UpdateHabitSettingsRowInput,
    executor?: DbExecutor
  ): Promise<HabitTrackerSettingsRecord>;
  listHabitsForUser(
    userId: string,
    options?: { includeArchived?: boolean },
    executor?: DbExecutor
  ): Promise<HabitRecord[]>;
  getHabitForUser(
    userId: string,
    habitId: string,
    executor?: DbExecutor
  ): Promise<HabitRecord | null>;
  getLastHabitPosition(
    userId: string,
    executor?: DbExecutor
  ): Promise<string | null>;
  createHabit(
    input: CreateHabitRowInput,
    executor?: DbExecutor
  ): Promise<HabitRecord>;
  createHabitsBatch(
    inputs: CreateHabitRowInput[],
    executor?: DbExecutor
  ): Promise<HabitRecord[]>;
  updateHabitForUser(
    userId: string,
    habitId: string,
    patch: UpdateHabitRowInput,
    executor?: DbExecutor
  ): Promise<HabitRecord | null>;
  updateHabitsMetadataBatch(
    userId: string,
    patches: HabitMetadataPatch[],
    executor?: DbExecutor
  ): Promise<number>;
  listAliasesForUser(
    userId: string,
    executor?: DbExecutor
  ): Promise<HabitImportAliasRecord[]>;
  upsertAliasesBatch(
    inputs: UpsertAliasRowInput[],
    executor?: DbExecutor
  ): Promise<HabitImportAliasRecord[]>;
  listMonthRosterHabitIds(
    userId: string,
    yearMonth: string,
    executor?: DbExecutor
  ): Promise<string[]>;
  hasAnyMonthRosterForUser(
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  findLatestMonthRosterBefore(
    userId: string,
    yearMonth: string,
    executor?: DbExecutor
  ): Promise<{ yearMonth: string; habitIds: string[] } | null>;
  upsertMonthRosterEntries(
    entries: Array<{ userId: string; habitId: string; yearMonth: string }>,
    executor?: DbExecutor
  ): Promise<void>;
  replaceMonthRoster(
    userId: string,
    yearMonth: string,
    habitIds: string[],
    executor?: DbExecutor
  ): Promise<string[]>;
  removeHabitFromMonthRoster(
    userId: string,
    habitId: string,
    yearMonth: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  deleteHabitForUser(
    userId: string,
    habitId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  rebalanceHabitPositions(
    userId: string,
    executor?: DbExecutor
  ): Promise<number>;
  listLogsForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor?: DbExecutor
  ): Promise<HabitLogRecord[]>;
  listLogNotesForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor?: DbExecutor
  ): Promise<Array<{ habitId: string; dateKey: string; note: string }>>;
  getLogForHabitDay(
    userId: string,
    habitId: string,
    dateKey: string,
    executor?: DbExecutor
  ): Promise<HabitLogRecord | null>;
  upsertLog(
    input: UpsertHabitLogRowInput,
    executor?: DbExecutor
  ): Promise<HabitLogRecord>;
  /** Batch variant of `upsertLog` for backfills; uses the same unique key. */
  upsertLogsBatch(
    inputs: UpsertHabitLogRowInput[],
    executor?: DbExecutor
  ): Promise<HabitLogRecord[]>;
  /**
   * High-throughput pipelined upsert of logs + optional month roster entries
   * using Drizzle `db.batch()` (1 atomic HTTP round-trip on remote Turso)
   * without `.returning()` payload bloat.
   */
  upsertLogsAndRostersPipelined(
    inputs: UpsertHabitLogRowInput[],
    rosterEntries?: Array<{ userId: string; habitId: string; yearMonth: string }>,
    executor?: DbExecutor
  ): Promise<number>;
  getMonthLock(
    userId: string,
    yearMonth: string,
    executor?: DbExecutor
  ): Promise<HabitMonthLockRecord | null>;
  listMonthLocksForMonths(
    userId: string,
    yearMonths: string[],
    executor?: DbExecutor
  ): Promise<HabitMonthLockRecord[]>;
  upsertMonthLock(
    input: UpsertHabitMonthLockRowInput,
    executor?: DbExecutor
  ): Promise<HabitMonthLockRecord>;
  updateMonthLockPin(
    userId: string,
    input: {
      pinHash: string | null;
      pinSalt: string | null;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<HabitTrackerSettingsRecord>;
  updatePinFailureState(
    userId: string,
    input: {
      failedAttempts: number;
      lockedUntil: number | null;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<void>;
  deleteLogForUser(
    userId: string,
    habitId: string,
    dateKey: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  listLinkedTasksForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor?: DbExecutor
  ): Promise<LinkedHabitTaskSummary[]>;
  listNudgeUserCandidatesPage(
    limit: number,
    offset: number
  ): Promise<HabitNudgeUserCandidate[]>;
}

export class DrizzleHabitRepository implements HabitRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async getOrCreateSettings(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitTrackerSettingsRecord> {
    // Fast read-only path: avoids acquiring a SQLite write lock when settings already exist
    const [existing] = await executor
      .select()
      .from(habitTrackerSettings)
      .where(eq(habitTrackerSettings.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    await executor
      .insert(habitTrackerSettings)
      .values({
        userId,
        updatedAt: Date.now(),
      })
      .onConflictDoNothing({ target: habitTrackerSettings.userId });

    const [row] = await executor
      .select()
      .from(habitTrackerSettings)
      .where(eq(habitTrackerSettings.userId, userId))
      .limit(1);

    if (!row) {
      throw new Error("Failed to load habit tracker settings.");
    }
    return row;
  }

  async updateSettings(
    userId: string,
    patch: UpdateHabitSettingsRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitTrackerSettingsRecord> {
    await this.getOrCreateSettings(userId, executor);

    const [updated] = await executor
      .update(habitTrackerSettings)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(eq(habitTrackerSettings.userId, userId))
      .returning();

    if (!updated) {
      throw new Error("Failed to update habit tracker settings.");
    }
    return updated;
  }

  async listHabitsForUser(
    userId: string,
    options: { includeArchived?: boolean } = {},
    executor: DbExecutor = this.database
  ): Promise<HabitRecord[]> {
    const predicate = options.includeArchived
      ? eq(habits.userId, userId)
      : and(eq(habits.userId, userId), eq(habits.isArchived, false));

    return executor
      .select()
      .from(habits)
      .where(predicate)
      .orderBy(asc(habits.position), asc(habits.id));
  }

  async getHabitForUser(
    userId: string,
    habitId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitRecord | null> {
    const [row] = await executor
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
      .limit(1);

    return row ?? null;
  }

  async getLastHabitPosition(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<string | null> {
    const [row] = await executor
      .select({ position: habits.position })
      .from(habits)
      .where(eq(habits.userId, userId))
      .orderBy(desc(habits.position), desc(habits.id))
      .limit(1);

    return row?.position ?? null;
  }

  async createHabit(
    input: CreateHabitRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(habits)
      .values({
        userId: input.userId,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        cadenceType: input.cadenceType ?? "daily",
        scheduledDaysJson: input.scheduledDaysJson ?? "[]",
        weeklyTargetCount: input.weeklyTargetCount ?? null,
        startDate: input.startDate,
        preferredTime: input.preferredTime ?? null,
        linkedProjectId: input.linkedProjectId ?? null,
        autoSyncDailyTask: input.autoSyncDailyTask ?? false,
        position: input.position,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create habit.");
    }
    return created;
  }

  async createHabitsBatch(
    inputs: CreateHabitRowInput[],
    executor: DbExecutor = this.database
  ): Promise<HabitRecord[]> {
    if (inputs.length === 0) return [];
    const now = Date.now();
    const created: HabitRecord[] = [];
    // Keep bind variables safely under SQLite's 999 parameter limit (50 * 15 = 750)
    const chunkSize = 50;

    for (let i = 0; i < inputs.length; i += chunkSize) {
      const chunk = inputs.slice(i, i + chunkSize);
      const rows = await executor
        .insert(habits)
        .values(
          chunk.map((input) => ({
            userId: input.userId,
            title: input.title,
            description: input.description ?? null,
            category: input.category ?? null,
            cadenceType: input.cadenceType ?? "daily",
            scheduledDaysJson: input.scheduledDaysJson ?? "[]",
            weeklyTargetCount: input.weeklyTargetCount ?? null,
            startDate: input.startDate,
            preferredTime: input.preferredTime ?? null,
            linkedProjectId: input.linkedProjectId ?? null,
            autoSyncDailyTask: input.autoSyncDailyTask ?? false,
            position: input.position,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .returning();
      created.push(...rows);
    }

    return created;
  }

  async updateHabitForUser(
    userId: string,
    habitId: string,
    patch: UpdateHabitRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitRecord | null> {
    const [updated] = await executor
      .update(habits)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
      .returning();

    return updated ?? null;
  }

  async updateHabitsMetadataBatch(
    userId: string,
    patches: HabitMetadataPatch[],
    executor: DbExecutor = this.database
  ): Promise<number> {
    const actionable = patches.filter(
      (p) => p.startDate !== undefined || p.isArchived !== undefined
    );
    if (actionable.length === 0) return 0;

    const now = Date.now();
    const buildQuery = (patch: HabitMetadataPatch) =>
      executor
        .update(habits)
        .set({
          ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
          ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
          updatedAt: now,
        })
        .where(and(eq(habits.id, patch.habitId), eq(habits.userId, userId)));

    if (executor === this.database) {
      const statements = actionable.map(buildQuery);
      const batchChunk = 50;
      for (let i = 0; i < statements.length; i += batchChunk) {
        const slice = statements.slice(i, i + batchChunk);
        const [first, ...rest] = slice;
        if (first) {
          await this.database.batch([first, ...rest]);
        }
      }
      return actionable.length;
    }

    for (const patch of actionable) {
      await buildQuery(patch);
    }
    return actionable.length;
  }

  async listAliasesForUser(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitImportAliasRecord[]> {
    return executor
      .select()
      .from(habitImportAliases)
      .where(eq(habitImportAliases.userId, userId))
      .orderBy(asc(habitImportAliases.normalizedTitle));
  }

  async upsertAliasesBatch(
    inputs: UpsertAliasRowInput[],
    executor: DbExecutor = this.database
  ): Promise<HabitImportAliasRecord[]> {
    if (inputs.length === 0) return [];
    const saved: HabitImportAliasRecord[] = [];
    // Keep bind variables under SQLite's 999 parameter ceiling (100 * 8 = 800)
    const chunkSize = 100;

    for (let i = 0; i < inputs.length; i += chunkSize) {
      const chunk = inputs.slice(i, i + chunkSize);
      const rows = await executor
        .insert(habitImportAliases)
        .values(
          chunk.map((input) => ({
            userId: input.userId,
            habitId: input.habitId,
            sourceTitle: input.sourceTitle,
            normalizedTitle: input.normalizedTitle,
            firstSeenDateKey: input.firstSeenDateKey,
            lastSeenDateKey: input.lastSeenDateKey,
          }))
        )
        .onConflictDoUpdate({
          target: [
            habitImportAliases.userId,
            habitImportAliases.normalizedTitle,
          ],
          set: {
            habitId: sql`excluded.habit_id`,
            sourceTitle: sql`excluded.source_title`,
            firstSeenDateKey: sql`excluded.first_seen_date_key`,
            lastSeenDateKey: sql`excluded.last_seen_date_key`,
          },
          setWhere: eq(habitImportAliases.userId, chunk[0]!.userId),
        })
        .returning();
      saved.push(...rows);
    }

    return saved;
  }

  async listMonthRosterHabitIds(
    userId: string,
    yearMonth: string,
    executor: DbExecutor = this.database
  ): Promise<string[]> {
    const rows = await executor
      .select({ habitId: habitMonthRosters.habitId })
      .from(habitMonthRosters)
      .where(
        and(
          eq(habitMonthRosters.userId, userId),
          eq(habitMonthRosters.yearMonth, yearMonth)
        )
      );
    return rows.map((row) => row.habitId);
  }

  async hasAnyMonthRosterForUser(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const [row] = await executor
      .select({ yearMonth: habitMonthRosters.yearMonth })
      .from(habitMonthRosters)
      .where(eq(habitMonthRosters.userId, userId))
      .limit(1);
    return Boolean(row);
  }

  async findLatestMonthRosterBefore(
    userId: string,
    yearMonth: string,
    executor: DbExecutor = this.database
  ): Promise<{ yearMonth: string; habitIds: string[] } | null> {
    const [latest] = await executor
      .select({ yearMonth: habitMonthRosters.yearMonth })
      .from(habitMonthRosters)
      .where(
        and(
          eq(habitMonthRosters.userId, userId),
          lt(habitMonthRosters.yearMonth, yearMonth)
        )
      )
      .orderBy(desc(habitMonthRosters.yearMonth))
      .limit(1);

    if (!latest) return null;

    const habitIds = await this.listMonthRosterHabitIds(
      userId,
      latest.yearMonth,
      executor
    );
    return habitIds.length > 0
      ? { yearMonth: latest.yearMonth, habitIds }
      : null;
  }

  async upsertMonthRosterEntries(
    entries: Array<{ userId: string; habitId: string; yearMonth: string }>,
    executor: DbExecutor = this.database
  ): Promise<void> {
    if (entries.length === 0) return;
    const now = Date.now();
    // Deduplicate in memory and chunk safely under SQLite's 999 bind-variable limit (200 * 4 = 800)
    const unique = new Map<
      string,
      { userId: string; habitId: string; yearMonth: string }
    >();
    for (const entry of entries) {
      unique.set(`${entry.userId}|${entry.habitId}|${entry.yearMonth}`, entry);
    }
    const list = Array.from(unique.values());
    const chunkSize = 200;

    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      await executor
        .insert(habitMonthRosters)
        .values(
          chunk.map((entry) => ({
            userId: entry.userId,
            habitId: entry.habitId,
            yearMonth: entry.yearMonth,
            createdAt: now,
          }))
        )
        .onConflictDoNothing({
          target: [
            habitMonthRosters.userId,
            habitMonthRosters.habitId,
            habitMonthRosters.yearMonth,
          ],
        });
    }
  }

  async replaceMonthRoster(
    userId: string,
    yearMonth: string,
    habitIds: string[],
    executor: DbExecutor = this.database
  ): Promise<string[]> {
    const deduped = Array.from(new Set(habitIds));
    await executor
      .delete(habitMonthRosters)
      .where(
        and(
          eq(habitMonthRosters.userId, userId),
          eq(habitMonthRosters.yearMonth, yearMonth)
        )
      );

    if (deduped.length > 0) {
      await this.upsertMonthRosterEntries(
        deduped.map((habitId) => ({ userId, habitId, yearMonth })),
        executor
      );
    }
    return deduped;
  }

  async removeHabitFromMonthRoster(
    userId: string,
    habitId: string,
    yearMonth: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(habitMonthRosters)
      .where(
        and(
          eq(habitMonthRosters.userId, userId),
          eq(habitMonthRosters.habitId, habitId),
          eq(habitMonthRosters.yearMonth, yearMonth)
        )
      )
      .returning({ habitId: habitMonthRosters.habitId });
    return deleted.length > 0;
  }

  async deleteHabitForUser(
    userId: string,
    habitId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(habits)
      .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
      .returning({ id: habits.id });

    return deleted.length > 0;
  }

  async rebalanceHabitPositions(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<number> {
    const ordered = await executor
      .select({ id: habits.id })
      .from(habits)
      .where(eq(habits.userId, userId))
      .orderBy(asc(habits.position), asc(habits.id));

    if (ordered.length === 0) return 0;

    const freshKeys = generateEvenPositions(ordered.length);
    const now = Date.now();

    for (let i = 0; i < ordered.length; i++) {
      await executor
        .update(habits)
        .set({ position: freshKeys[i]!, updatedAt: now })
        .where(and(eq(habits.id, ordered[i]!.id), eq(habits.userId, userId)));
    }

    return ordered.length;
  }

  async listLogsForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor: DbExecutor = this.database
  ): Promise<HabitLogRecord[]> {
    return executor
      .select()
      .from(habitLogs)
      .where(
        and(
          eq(habitLogs.userId, userId),
          gte(habitLogs.dateKey, startDateKey),
          lte(habitLogs.dateKey, endDateKey)
        )
      )
      .orderBy(asc(habitLogs.dateKey), asc(habitLogs.id));
  }

  async listLogNotesForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor: DbExecutor = this.database
  ): Promise<Array<{ habitId: string; dateKey: string; note: string }>> {
    const rows = await executor
      .select({
        habitId: habitLogs.habitId,
        dateKey: habitLogs.dateKey,
        note: habitLogs.note,
      })
      .from(habitLogs)
      .where(
        and(
          eq(habitLogs.userId, userId),
          gte(habitLogs.dateKey, startDateKey),
          lte(habitLogs.dateKey, endDateKey),
          isNotNull(habitLogs.note)
        )
      );

    return rows.filter(
      (r): r is { habitId: string; dateKey: string; note: string } =>
        typeof r.note === "string" && r.note.length > 0
    );
  }

  async getLogForHabitDay(
    userId: string,
    habitId: string,
    dateKey: string,
    executor: DbExecutor = this.database
  ): Promise<HabitLogRecord | null> {
    const [row] = await executor
      .select()
      .from(habitLogs)
      .where(
        and(
          eq(habitLogs.userId, userId),
          eq(habitLogs.habitId, habitId),
          eq(habitLogs.dateKey, dateKey)
        )
      )
      .limit(1);

    return row ?? null;
  }

  async upsertLog(
    input: UpsertHabitLogRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitLogRecord> {
    const [saved] = await executor
      .insert(habitLogs)
      .values({
        habitId: input.habitId,
        userId: input.userId,
        dateKey: input.dateKey,
        status: input.status,
        note: input.note ?? null,
        loggedAt: input.loggedAt,
        isBackfilledLate: input.isBackfilledLate,
      })
      .onConflictDoUpdate({
        target: [habitLogs.habitId, habitLogs.dateKey],
        set: {
          status: input.status,
          note: input.note ?? null,
          loggedAt: input.loggedAt,
          isBackfilledLate: input.isBackfilledLate,
        },
        setWhere: eq(habitLogs.userId, input.userId),
      })
      .returning();

    if (!saved) {
      throw new Error("Failed to upsert habit log.");
    }
    return saved;
  }

  async upsertLogsBatch(
    inputs: UpsertHabitLogRowInput[],
    executor: DbExecutor = this.database
  ): Promise<HabitLogRecord[]> {
    if (inputs.length === 0) return [];
    const saved: HabitLogRecord[] = [];
    // Keep bind variables safely under SQLite's 999 parameter ceiling (100 * 8 = 800)
    const chunkSize = 100;

    for (let i = 0; i < inputs.length; i += chunkSize) {
      const chunk = inputs.slice(i, i + chunkSize);
      const rows = await executor
        .insert(habitLogs)
        .values(
          chunk.map((input) => ({
            habitId: input.habitId,
            userId: input.userId,
            dateKey: input.dateKey,
            status: input.status,
            note: input.note ?? null,
            loggedAt: input.loggedAt,
            isBackfilledLate: input.isBackfilledLate,
          }))
        )
        .onConflictDoUpdate({
          target: [habitLogs.habitId, habitLogs.dateKey],
          set: {
            status: sql`excluded.status`,
            note: sql`excluded.note`,
            loggedAt: sql`excluded.logged_at`,
            isBackfilledLate: sql`excluded.is_backfilled_late`,
          },
          setWhere: eq(habitLogs.userId, chunk[0]!.userId),
        })
        .returning();
      saved.push(...rows);
    }

    return saved;
  }

  async upsertLogsAndRostersPipelined(
    inputs: UpsertHabitLogRowInput[],
    rosterEntries: Array<{
      userId: string;
      habitId: string;
      yearMonth: string;
    }> = [],
    executor: DbExecutor = this.database
  ): Promise<number> {
    if (inputs.length === 0 && rosterEntries.length === 0) return 0;

    // Keep bind variables safely under SQLite's 999 parameter ceiling:
    // logs: 100 * 8 = 800 bind params; rosters: 200 * 4 = 800 bind params
    const logChunkSize = 100;
    const rosterChunkSize = 200;
    const now = Date.now();

    const uniqueRoster = new Map<
      string,
      { userId: string; habitId: string; yearMonth: string }
    >();
    for (const entry of rosterEntries) {
      uniqueRoster.set(`${entry.userId}|${entry.habitId}|${entry.yearMonth}`, entry);
    }
    const dedupedRosters = Array.from(uniqueRoster.values());

    const statements = [];

    for (let i = 0; i < inputs.length; i += logChunkSize) {
      const chunk = inputs.slice(i, i + logChunkSize);
      statements.push(
        executor
          .insert(habitLogs)
          .values(
            chunk.map((input) => ({
              habitId: input.habitId,
              userId: input.userId,
              dateKey: input.dateKey,
              status: input.status,
              note: input.note ?? null,
              loggedAt: input.loggedAt,
              isBackfilledLate: input.isBackfilledLate,
            }))
          )
          .onConflictDoUpdate({
            target: [habitLogs.habitId, habitLogs.dateKey],
            set: {
              status: sql`excluded.status`,
              note: sql`excluded.note`,
              loggedAt: sql`excluded.logged_at`,
              isBackfilledLate: sql`excluded.is_backfilled_late`,
            },
            setWhere: eq(habitLogs.userId, chunk[0]!.userId),
          })
      );
    }

    for (let i = 0; i < dedupedRosters.length; i += rosterChunkSize) {
      const chunk = dedupedRosters.slice(i, i + rosterChunkSize);
      statements.push(
        executor
          .insert(habitMonthRosters)
          .values(
            chunk.map((entry) => ({
              userId: entry.userId,
              habitId: entry.habitId,
              yearMonth: entry.yearMonth,
              createdAt: now,
            }))
          )
          .onConflictDoNothing({
            target: [
              habitMonthRosters.userId,
              habitMonthRosters.habitId,
              habitMonthRosters.yearMonth,
            ],
          })
      );
    }

    if (statements.length === 0) return inputs.length;

    if (executor === this.database) {
      // Single atomic pipelined HTTP batch to Turso (max ~25 statements per batch)
      const maxStmtsPerBatch = 25;
      for (let i = 0; i < statements.length; i += maxStmtsPerBatch) {
        const slice = statements.slice(i, i + maxStmtsPerBatch);
        const [first, ...rest] = slice;
        if (first) {
          await this.database.batch([first, ...rest]);
        }
      }
      return inputs.length;
    }

    for (const stmt of statements) {
      await stmt;
    }
    return inputs.length;
  }

  async getMonthLock(
    userId: string,
    yearMonth: string,
    executor: DbExecutor = this.database
  ): Promise<HabitMonthLockRecord | null> {
    const [row] = await executor
      .select()
      .from(habitMonthLocks)
      .where(
        and(
          eq(habitMonthLocks.userId, userId),
          eq(habitMonthLocks.yearMonth, yearMonth)
        )
      )
      .limit(1);

    return row ?? null;
  }

  async listMonthLocksForMonths(
    userId: string,
    yearMonths: string[],
    executor: DbExecutor = this.database
  ): Promise<HabitMonthLockRecord[]> {
    const unique = Array.from(new Set(yearMonths.filter(Boolean)));
    if (unique.length === 0) return [];

    return executor
      .select()
      .from(habitMonthLocks)
      .where(
        and(
          eq(habitMonthLocks.userId, userId),
          inArray(habitMonthLocks.yearMonth, unique)
        )
      );
  }

  async upsertMonthLock(
    input: UpsertHabitMonthLockRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitMonthLockRecord> {
    const [saved] = await executor
      .insert(habitMonthLocks)
      .values({
        userId: input.userId,
        yearMonth: input.yearMonth,
        status: input.status,
        lockedAt: input.lockedAt,
        unlockedAt: input.unlockedAt,
        unlockedUntil: input.unlockedUntil,
        unlockReason: input.unlockReason,
        unlockCount: input.unlockCount,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: [habitMonthLocks.userId, habitMonthLocks.yearMonth],
        set: {
          status: input.status,
          lockedAt: input.lockedAt,
          unlockedAt: input.unlockedAt,
          unlockedUntil: input.unlockedUntil,
          unlockReason: input.unlockReason,
          unlockCount: input.unlockCount,
          updatedAt: input.updatedAt,
        },
      })
      .returning();

    if (!saved) {
      throw new Error("Failed to save habit month lock.");
    }
    return saved;
  }

  async updateMonthLockPin(
    userId: string,
    input: {
      pinHash: string | null;
      pinSalt: string | null;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<HabitTrackerSettingsRecord> {
    await this.getOrCreateSettings(userId, executor);
    const [updated] = await executor
      .update(habitTrackerSettings)
      .set({
        monthLockPinHash: input.pinHash,
        monthLockPinSalt: input.pinSalt,
        monthLockPinFailedAttempts: 0,
        monthLockPinLockedUntil: null,
        updatedAt: input.nowMs,
      })
      .where(eq(habitTrackerSettings.userId, userId))
      .returning();

    if (!updated) {
      throw new Error("Failed to update habit month-lock PIN.");
    }
    return updated;
  }

  async updatePinFailureState(
    userId: string,
    input: {
      failedAttempts: number;
      lockedUntil: number | null;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<void> {
    await executor
      .update(habitTrackerSettings)
      .set({
        monthLockPinFailedAttempts: input.failedAttempts,
        monthLockPinLockedUntil: input.lockedUntil,
        updatedAt: input.nowMs,
      })
      .where(eq(habitTrackerSettings.userId, userId));
  }

  async deleteLogForUser(
    userId: string,
    habitId: string,
    dateKey: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(habitLogs)
      .where(
        and(
          eq(habitLogs.userId, userId),
          eq(habitLogs.habitId, habitId),
          eq(habitLogs.dateKey, dateKey)
        )
      )
      .returning({ id: habitLogs.id });

    return deleted.length > 0;
  }

  async listLinkedTasksForRange(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    executor: DbExecutor = this.database
  ): Promise<LinkedHabitTaskSummary[]> {
    const rows = await executor
      .select({
        taskId: tasks.id,
        habitId: tasks.habitId,
        habitDateKey: tasks.habitDateKey,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNotNull(tasks.habitId),
          isNotNull(tasks.habitDateKey),
          gte(tasks.habitDateKey, startDateKey),
          lte(tasks.habitDateKey, endDateKey)
        )
      );

    return rows.filter(
      (r): r is LinkedHabitTaskSummary =>
        typeof r.habitId === "string" && typeof r.habitDateKey === "string"
    );
  }

  /**
   * Paginated lookup of users who have either an active habit with `preferredTime`
   * OR an `eveningCheckinTime` configured, bounded to `LIMIT 200` for Vercel/Inngest scale.
   */
  async listNudgeUserCandidatesPage(
    limit = 200,
    offset = 0
  ): Promise<HabitNudgeUserCandidate[]> {
    const [habitUsers, eveningUsers] = await Promise.all([
      this.database
        .selectDistinct({ userId: habits.userId })
        .from(habits)
        .where(
          and(eq(habits.isArchived, false), isNotNull(habits.preferredTime))
        ),
      this.database
        .select({ userId: habitTrackerSettings.userId })
        .from(habitTrackerSettings)
        .where(isNotNull(habitTrackerSettings.eveningCheckinTime)),
    ]);

    const candidateIds = Array.from(
      new Set([
        ...habitUsers.map((r) => r.userId),
        ...eveningUsers.map((r) => r.userId),
      ])
    ).sort();

    const pageIds = candidateIds.slice(offset, offset + limit);
    if (pageIds.length === 0) return [];

    const [userRows, settingsRows] = await Promise.all([
      this.database
        .select({ id: users.id, timezone: users.timezone })
        .from(users)
        .where(inArray(users.id, pageIds)),
      this.database
        .select({
          userId: habitTrackerSettings.userId,
          eveningCheckinTime: habitTrackerSettings.eveningCheckinTime,
        })
        .from(habitTrackerSettings)
        .where(
          and(
            inArray(habitTrackerSettings.userId, pageIds),
            or(isNotNull(habitTrackerSettings.eveningCheckinTime))
          )
        ),
    ]);

    const eveningMap = new Map(
      settingsRows.map((s) => [s.userId, s.eveningCheckinTime])
    );

    return userRows.map((u) => ({
      userId: u.id,
      timezone: u.timezone || "UTC",
      eveningCheckinTime: eveningMap.get(u.id) ?? null,
    }));
  }
}

export const habitRepository: HabitRepository = new DrizzleHabitRepository(db);
