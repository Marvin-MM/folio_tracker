import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import { generateEvenPositions } from "@/lib/fractional-index";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitLogs,
  habits,
  habitTrackerSettings,
  tasks,
  users,
  type HabitCadenceType,
  type HabitCommentMode,
  type HabitLogRecord,
  type HabitLogStatus,
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
    return executor
      .insert(habits)
      .values(
        inputs.map((input) => ({
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
