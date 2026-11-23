import { fromZonedTime } from "date-fns-tz";
import {
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
  type LinkedHabitTaskSummary,
  type UpdateHabitSettingsRowInput,
} from "@/server/dal/habits";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  taskRepository,
  type TaskRepository,
  type TaskScope,
} from "@/server/dal/task-repository";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  HabitCadenceType,
  HabitCommentMode,
  HabitLogRecord,
  HabitLogStatus,
  HabitRecord,
  HabitTrackerSettingsRecord,
  TaskRecord,
} from "@/server/db/schema";
import {
  addDaysToDateKey,
  buildMonthCalendar,
  computeHabitMonthAnalytics,
  computeHabitStreaks,
  computeIsBackfilledLate,
  getLocalDateKey,
  isFutureDateKey,
  isHabitScheduledOnDate,
  isValidDateKey,
  isValidTimeHHmm,
  isValidYearMonth,
  parseBulkHabitImport,
  parseScheduledDaysJson,
  type AnalyticsHabitInput,
  type HabitMonthAnalytics,
  type ScoringMode,
} from "@/server/domain/habit-analytics";

const MAX_HABIT_NOTE_LENGTH = 280;

export interface CreateHabitInput {
  title: string;
  description?: string | null;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDays?: number[];
  weeklyTargetCount?: number | null;
  startDate?: string;
  preferredTime?: string | null;
  linkedProjectId?: string | null;
  autoSyncDailyTask?: boolean;
}

export interface UpdateHabitInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDays?: number[];
  weeklyTargetCount?: number | null;
  startDate?: string;
  preferredTime?: string | null;
  linkedProjectId?: string | null;
  autoSyncDailyTask?: boolean;
  isArchived?: boolean;
}

export interface UpdateHabitSettingsInput {
  weekStartsOn?: 0 | 1;
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

export interface LogHabitDayInput {
  habitId: string;
  dateKey: string;
  status: HabitLogStatus | null;
  note?: string | null;
}

export interface PromoteTaskToHabitInput {
  title?: string;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDays?: number[];
  weeklyTargetCount?: number | null;
  preferredTime?: string | null;
  autoSyncDailyTask?: boolean;
}

export interface HabitMonthWorkspace {
  settings: HabitTrackerSettingsRecord;
  habits: HabitRecord[];
  archivedHabits: HabitRecord[];
  logsByKey: Record<string, HabitLogRecord>;
  linkedTaskByKey: Record<string, LinkedHabitTaskSummary>;
  analytics: HabitMonthAnalytics;
  todayDateKey: string;
  yearMonth: string;
  scoringMode: ScoringMode;
}

export interface TodayHabitStripItem {
  habit: HabitRecord;
  log: HabitLogRecord | null;
  scheduledToday: boolean;
  currentStreak: number;
  streakUnit: "days" | "weeks";
}

export interface TodayHabitsStripData {
  todayDateKey: string;
  items: TodayHabitStripItem[];
}

export interface HabitServiceDeps {
  database?: AppDatabase;
  habits?: HabitRepository;
  tasks?: TaskRepository;
  projects?: ProjectRepository;
  membershipLookup?: ProjectMembershipLookup;
  now?: () => number;
}

function toAnalyticsHabit(habit: HabitRecord): AnalyticsHabitInput {
  return {
    id: habit.id,
    title: habit.title,
    cadenceType: habit.cadenceType,
    scheduledDays: parseScheduledDaysJson(habit.scheduledDaysJson),
    weeklyTargetCount: habit.weeklyTargetCount,
    startDate: habit.startDate,
  };
}

function normalizeCadence(params: {
  cadenceType: HabitCadenceType;
  scheduledDays?: number[];
  weeklyTargetCount?: number | null;
}): {
  cadenceType: HabitCadenceType;
  scheduledDaysJson: string;
  weeklyTargetCount: number | null;
} {
  if (params.cadenceType === "daily") {
    return {
      cadenceType: "daily",
      scheduledDaysJson: "[]",
      weeklyTargetCount: null,
    };
  }

  if (params.cadenceType === "specific_days") {
    const cleaned = Array.from(
      new Set(
        (params.scheduledDays ?? []).filter(
          (d) => Number.isInteger(d) && d >= 0 && d <= 6
        )
      )
    ).sort((a, b) => a - b);

    if (cleaned.length === 0) {
      throw new ValidationError(
        "Select at least one weekday for specific-days habits."
      );
    }

    return {
      cadenceType: "specific_days",
      scheduledDaysJson: JSON.stringify(cleaned),
      weeklyTargetCount: null,
    };
  }

  const target = params.weeklyTargetCount;
  if (
    typeof target !== "number" ||
    !Number.isInteger(target) ||
    target < 1 ||
    target > 7
  ) {
    throw new ValidationError(
      "Weekly target must be a whole number between 1 and 7."
    );
  }

  return {
    cadenceType: "weekly_target",
    scheduledDaysJson: "[]",
    weeklyTargetCount: target,
  };
}

function normalizeTimeOrNull(
  raw: string | null | undefined,
  fieldLabel: string
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isValidTimeHHmm(trimmed)) {
    throw new ValidationError(`${fieldLabel} must be in HH:mm (24h) format.`);
  }
  return trimmed;
}

function getLocalEndOfDayUtcMs(dateKey: string, timezone: string): number {
  try {
    return fromZonedTime(`${dateKey}T23:59:59.000`, timezone).getTime();
  } catch {
    return fromZonedTime(`${dateKey}T23:59:59.000`, "UTC").getTime();
  }
}

export class HabitService {
  private readonly database: AppDatabase;
  private readonly habits: HabitRepository;
  private readonly tasks: TaskRepository;
  private readonly projects: ProjectRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly now: () => number;

  constructor(deps: HabitServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.habits = deps.habits ?? habitRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.projects = deps.projects ?? projectRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.now = deps.now ?? (() => Date.now());
  }

  private async validateLinkedProject(
    userId: string,
    projectId: string | null | undefined,
    executor?: DbExecutor
  ): Promise<string | null> {
    if (!projectId) return null;
    await assertProjectRole(
      projectId,
      userId,
      ["owner", "editor"],
      this.membershipLookup,
      executor
    );
    return projectId;
  }

  private async allocateNextHabitPosition(
    userId: string,
    tx: DbExecutor
  ): Promise<string> {
    const lastPos = await this.habits.getLastHabitPosition(userId, tx);
    let position = generatePositionBetween(lastPos, null);
    if (position.length > MAX_POSITION_KEY_LENGTH) {
      await this.habits.rebalanceHabitPositions(userId, tx);
      const refreshed = await this.habits.getLastHabitPosition(userId, tx);
      position = generatePositionBetween(refreshed, null);
    }
    return position;
  }

  async getMonthWorkspace(
    userId: string,
    timezone: string,
    options: { yearMonth?: string; scoringMode?: ScoringMode } = {}
  ): Promise<HabitMonthWorkspace> {
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const yearMonth =
      options.yearMonth && isValidYearMonth(options.yearMonth)
        ? options.yearMonth
        : todayDateKey.slice(0, 7);
    const scoringMode: ScoringMode =
      options.scoringMode === "full_month" ? "full_month" : "elapsed";

    const [settings, allUserHabits] = await Promise.all([
      this.habits.getOrCreateSettings(userId),
      this.habits.listHabitsForUser(userId, { includeArchived: true }),
    ]);

    const activeHabits = allUserHabits.filter((h) => !h.isArchived);
    const archivedHabits = allUserHabits.filter((h) => h.isArchived);
    const weekStartsOn: 0 | 1 = settings.weekStartsOn === 0 ? 0 : 1;
    const calendar = buildMonthCalendar(yearMonth, weekStartsOn);

    // Fetch enough historical logs to compute accurate streaks crossing month boundaries
    const defaultLookback = addDaysToDateKey(calendar.monthStartKey, -120);
    const maxLookback = addDaysToDateKey(calendar.monthStartKey, -365);
    let earliestStart = defaultLookback;
    for (const h of activeHabits) {
      if (h.startDate < earliestStart) {
        earliestStart = h.startDate < maxLookback ? maxLookback : h.startDate;
      }
    }
    const fetchEnd =
      todayDateKey > calendar.monthEndKey ? todayDateKey : calendar.monthEndKey;

    const [allLogs, linkedTasks] = await Promise.all([
      this.habits.listLogsForRange(userId, earliestStart, fetchEnd),
      this.habits.listLinkedTasksForRange(
        userId,
        calendar.monthStartKey,
        calendar.monthEndKey
      ),
    ]);

    const analytics = computeHabitMonthAnalytics({
      yearMonth,
      todayDateKey,
      weekStartsOn,
      scoringMode,
      habits: activeHabits.map(toAnalyticsHabit),
      logs: allLogs,
    });

    const logsByKey: Record<string, HabitLogRecord> = {};
    for (const log of allLogs) {
      if (
        log.dateKey >= calendar.monthStartKey &&
        log.dateKey <= calendar.monthEndKey
      ) {
        logsByKey[`${log.habitId}::${log.dateKey}`] = log;
      }
    }

    const linkedTaskByKey: Record<string, LinkedHabitTaskSummary> = {};
    for (const lt of linkedTasks) {
      linkedTaskByKey[`${lt.habitId}::${lt.habitDateKey}`] = lt;
    }

    return {
      settings,
      habits: activeHabits,
      archivedHabits,
      logsByKey,
      linkedTaskByKey,
      analytics,
      todayDateKey,
      yearMonth,
      scoringMode,
    };
  }

  async getTodayHabitsStrip(
    userId: string,
    timezone: string
  ): Promise<TodayHabitsStripData> {
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const lookbackStart = addDaysToDateKey(todayDateKey, -120);

    const [settings, activeHabits, recentLogs] = await Promise.all([
      this.habits.getOrCreateSettings(userId),
      this.habits.listHabitsForUser(userId, { includeArchived: false }),
      this.habits.listLogsForRange(userId, lookbackStart, todayDateKey),
    ]);

    const weekStartsOn: 0 | 1 = settings.weekStartsOn === 0 ? 0 : 1;
    const logsByHabit = new Map<string, Map<string, HabitLogStatus>>();
    const todayLogByHabit = new Map<string, HabitLogRecord>();

    for (const log of recentLogs) {
      let map = logsByHabit.get(log.habitId);
      if (!map) {
        map = new Map<string, HabitLogStatus>();
        logsByHabit.set(log.habitId, map);
      }
      map.set(log.dateKey, log.status);
      if (log.dateKey === todayDateKey) {
        todayLogByHabit.set(log.habitId, log);
      }
    }

    const items: TodayHabitStripItem[] = activeHabits.map((habit) => {
      const analyticsHabit = toAnalyticsHabit(habit);
      const map = logsByHabit.get(habit.id) ?? new Map<string, HabitLogStatus>();
      const streak = computeHabitStreaks(
        analyticsHabit,
        map,
        todayDateKey,
        weekStartsOn
      );
      return {
        habit,
        log: todayLogByHabit.get(habit.id) ?? null,
        scheduledToday: isHabitScheduledOnDate(analyticsHabit, todayDateKey),
        currentStreak: streak.currentStreak,
        streakUnit: streak.streakUnit,
      };
    });

    return { todayDateKey, items };
  }

  async createHabit(
    userId: string,
    timezone: string,
    input: CreateHabitInput
  ): Promise<HabitRecord> {
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError("Habit title cannot be empty.");
    }
    if (title.length > 120) {
      throw new ValidationError("Habit title must be 120 characters or fewer.");
    }

    const todayDateKey = getLocalDateKey(this.now(), timezone);
    const startDate = input.startDate?.trim() || todayDateKey;
    if (!isValidDateKey(startDate)) {
      throw new ValidationError("Start date must be a valid YYYY-MM-DD date.");
    }

    const cadence = normalizeCadence({
      cadenceType: input.cadenceType ?? "daily",
      scheduledDays: input.scheduledDays,
      weeklyTargetCount: input.weeklyTargetCount,
    });
    const preferredTime = normalizeTimeOrNull(
      input.preferredTime,
      "Preferred time"
    );

    const linkedProjectId = await this.validateLinkedProject(
      userId,
      input.linkedProjectId
    );

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const position = await this.allocateNextHabitPosition(userId, tx);

        const created = await this.habits.createHabit(
          {
            userId,
            title,
            description: input.description?.trim() || null,
            category: input.category?.trim().slice(0, 48) || null,
            cadenceType: cadence.cadenceType,
            scheduledDaysJson: cadence.scheduledDaysJson,
            weeklyTargetCount: cadence.weeklyTargetCount,
            startDate,
            preferredTime,
            linkedProjectId,
            autoSyncDailyTask: input.autoSyncDailyTask ?? false,
            position,
          },
          tx
        );

        // Optionally seed today's linked task in the same ACID transaction when auto-sync is enabled
        if (
          created.autoSyncDailyTask &&
          isHabitScheduledOnDate(toAnalyticsHabit(created), todayDateKey)
        ) {
          const scope: TaskScope = created.linkedProjectId
            ? { kind: "project", projectId: created.linkedProjectId }
            : { kind: "personal", userId };
          const lastTaskPos = await this.tasks.getLastPositionForScope(
            scope,
            tx
          );
          let taskPos = generatePositionBetween(lastTaskPos, null);
          if (taskPos.length > MAX_POSITION_KEY_LENGTH) {
            await this.tasks.rebalancePositions(scope, tx);
            const refreshedTaskPos = await this.tasks.getLastPositionForScope(
              scope,
              tx
            );
            taskPos = generatePositionBetween(refreshedTaskPos, null);
          }

          await this.tasks.create(
            {
              userId,
              projectId: created.linkedProjectId,
              habitId: created.id,
              habitDateKey: todayDateKey,
              title: created.title,
              description: created.description,
              dueAt: getLocalEndOfDayUtcMs(todayDateKey, timezone),
              position: taskPos,
            },
            tx
          );
        }

        return created;
      })
    );
  }

  async updateHabit(
    userId: string,
    habitId: string,
    input: UpdateHabitInput
  ): Promise<HabitRecord> {
    if (input.title !== undefined && !input.title.trim()) {
      throw new ValidationError("Habit title cannot be empty.");
    }
    if (input.startDate !== undefined && !isValidDateKey(input.startDate)) {
      throw new ValidationError("Start date must be a valid YYYY-MM-DD date.");
    }

    if (input.linkedProjectId !== undefined) {
      await this.validateLinkedProject(userId, input.linkedProjectId);
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.habits.getHabitForUser(userId, habitId, tx);
        if (!existing) {
          throw new NotFoundError("Habit not found.");
        }

        const nextCadenceType = input.cadenceType ?? existing.cadenceType;
        const cadence = normalizeCadence({
          cadenceType: nextCadenceType,
          scheduledDays:
            input.scheduledDays ??
            parseScheduledDaysJson(existing.scheduledDaysJson),
          weeklyTargetCount:
            input.weeklyTargetCount !== undefined
              ? input.weeklyTargetCount
              : existing.weeklyTargetCount,
        });

        const preferredTime =
          input.preferredTime !== undefined
            ? normalizeTimeOrNull(input.preferredTime, "Preferred time")
            : undefined;

        const updated = await this.habits.updateHabitForUser(
          userId,
          habitId,
          {
            ...(input.title !== undefined ? { title: input.title.trim() } : {}),
            ...(input.description !== undefined
              ? { description: input.description?.trim() || null }
              : {}),
            ...(input.category !== undefined
              ? { category: input.category?.trim().slice(0, 48) || null }
              : {}),
            cadenceType: cadence.cadenceType,
            scheduledDaysJson: cadence.scheduledDaysJson,
            weeklyTargetCount: cadence.weeklyTargetCount,
            ...(input.startDate !== undefined
              ? { startDate: input.startDate }
              : {}),
            ...(preferredTime !== undefined ? { preferredTime } : {}),
            ...(input.linkedProjectId !== undefined
              ? { linkedProjectId: input.linkedProjectId }
              : {}),
            ...(input.autoSyncDailyTask !== undefined
              ? { autoSyncDailyTask: input.autoSyncDailyTask }
              : {}),
            ...(input.isArchived !== undefined
              ? { isArchived: input.isArchived }
              : {}),
          },
          tx
        );

        if (!updated) {
          throw new NotFoundError("Habit not found.");
        }
        return updated;
      })
    );
  }

  async archiveHabit(
    userId: string,
    habitId: string,
    isArchived = true
  ): Promise<HabitRecord> {
    return this.updateHabit(userId, habitId, { isArchived });
  }

  async deleteHabit(userId: string, habitId: string): Promise<void> {
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const deleted = await this.habits.deleteHabitForUser(
          userId,
          habitId,
          tx
        );
        if (!deleted) {
          throw new NotFoundError("Habit not found.");
        }
      })
    );
  }

  async getSettings(userId: string): Promise<HabitTrackerSettingsRecord> {
    return this.habits.getOrCreateSettings(userId);
  }

  async updateSettings(
    userId: string,
    input: UpdateHabitSettingsInput
  ): Promise<HabitTrackerSettingsRecord> {
    const patch: UpdateHabitSettingsRowInput = {};

    if (input.weekStartsOn !== undefined) {
      if (input.weekStartsOn !== 0 && input.weekStartsOn !== 1) {
        throw new ValidationError("Week start day must be 0 (Sun) or 1 (Mon).");
      }
      patch.weekStartsOn = input.weekStartsOn;
    }

    if (input.defaultCommentMode !== undefined) {
      patch.defaultCommentMode = input.defaultCommentMode;
    }

    if (input.defaultWindowStartDay !== undefined) {
      if (
        !Number.isInteger(input.defaultWindowStartDay) ||
        input.defaultWindowStartDay < 0 ||
        input.defaultWindowStartDay > 6
      ) {
        throw new ValidationError("Window start day must be between 0 and 6.");
      }
      patch.defaultWindowStartDay = input.defaultWindowStartDay;
    }

    if (input.defaultWindowEndDay !== undefined) {
      if (
        !Number.isInteger(input.defaultWindowEndDay) ||
        input.defaultWindowEndDay < 0 ||
        input.defaultWindowEndDay > 6
      ) {
        throw new ValidationError("Window end day must be between 0 and 6.");
      }
      patch.defaultWindowEndDay = input.defaultWindowEndDay;
    }

    if (input.defaultWindowStartTime !== undefined) {
      const t = normalizeTimeOrNull(
        input.defaultWindowStartTime,
        "Window start time"
      );
      if (!t) throw new ValidationError("Window start time is required.");
      patch.defaultWindowStartTime = t;
    }

    if (input.defaultWindowEndTime !== undefined) {
      const t = normalizeTimeOrNull(
        input.defaultWindowEndTime,
        "Window end time"
      );
      if (!t) throw new ValidationError("Window end time is required.");
      patch.defaultWindowEndTime = t;
    }

    if (input.defaultIntervalDays !== undefined) {
      if (
        input.defaultIntervalDays !== null &&
        (!Number.isInteger(input.defaultIntervalDays) ||
          input.defaultIntervalDays < 1 ||
          input.defaultIntervalDays > 30)
      ) {
        throw new ValidationError("Interval days must be between 1 and 30.");
      }
      patch.defaultIntervalDays = input.defaultIntervalDays;
    }

    if (input.defaultIntervalAnchorDate !== undefined) {
      if (
        input.defaultIntervalAnchorDate !== null &&
        input.defaultIntervalAnchorDate !== "" &&
        !isValidDateKey(input.defaultIntervalAnchorDate)
      ) {
        throw new ValidationError(
          "Interval anchor date must be a valid YYYY-MM-DD date."
        );
      }
      patch.defaultIntervalAnchorDate =
        input.defaultIntervalAnchorDate?.trim() || null;
    }

    if (input.defaultIntervalOpenHours !== undefined) {
      if (
        !Number.isInteger(input.defaultIntervalOpenHours) ||
        input.defaultIntervalOpenHours < 1 ||
        input.defaultIntervalOpenHours > 168
      ) {
        throw new ValidationError("Open duration must be 1–168 hours.");
      }
      patch.defaultIntervalOpenHours = input.defaultIntervalOpenHours;
    }

    if (input.allowReactionsWhenLocked !== undefined) {
      patch.allowReactionsWhenLocked = input.allowReactionsWhenLocked;
    }

    if (input.eveningCheckinTime !== undefined) {
      patch.eveningCheckinTime = normalizeTimeOrNull(
        input.eveningCheckinTime,
        "Evening check-in time"
      );
    }

    return withDbRetry(() => this.habits.updateSettings(userId, patch));
  }

  /**
   * Atomically upserts or clears a habit log for `(habitId, dateKey)` AND
   * synchronizes any linked task row in the same SQLite ACID transaction.
   */
  async logHabitDay(
    userId: string,
    timezone: string,
    input: LogHabitDayInput
  ): Promise<{ log: HabitLogRecord | null; syncedTaskCount: number }> {
    if (!isValidDateKey(input.dateKey)) {
      throw new ValidationError("Date must be a valid YYYY-MM-DD date.");
    }

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    if (isFutureDateKey(input.dateKey, todayDateKey)) {
      throw new ValidationError("Cannot log future dates.");
    }

    let cleanedNote: string | null | undefined;
    if (input.note !== undefined) {
      const trimmed = input.note?.trim() ?? "";
      if (trimmed.length > MAX_HABIT_NOTE_LENGTH) {
        throw new ValidationError(
          `Micro-note must be ${MAX_HABIT_NOTE_LENGTH} characters or fewer.`
        );
      }
      cleanedNote = trimmed.length > 0 ? trimmed : null;
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const habit = await this.habits.getHabitForUser(
          userId,
          input.habitId,
          tx
        );
        if (!habit) {
          throw new NotFoundError("Habit not found.");
        }

        if (input.status === null) {
          await this.habits.deleteLogForUser(
            userId,
            habit.id,
            input.dateKey,
            tx
          );
          const syncedTaskCount = await this.tasks.syncLinkedTasksForHabitDay(
            {
              userId,
              habitId: habit.id,
              dateKey: input.dateKey,
              completed: false,
              nowMs,
            },
            tx
          );
          return { log: null, syncedTaskCount };
        }

        let resolvedNote: string | null = cleanedNote ?? null;
        if (cleanedNote === undefined) {
          const existingLog = await this.habits.getLogForHabitDay(
            userId,
            habit.id,
            input.dateKey,
            tx
          );
          resolvedNote = existingLog?.note ?? null;
        }

        const isBackfilledLate = computeIsBackfilledLate(
          input.dateKey,
          nowMs,
          timezone
        );

        const savedLog = await this.habits.upsertLog(
          {
            habitId: habit.id,
            userId,
            dateKey: input.dateKey,
            status: input.status,
            note: resolvedNote,
            loggedAt: nowMs,
            isBackfilledLate,
          },
          tx
        );

        const syncedTaskCount = await this.tasks.syncLinkedTasksForHabitDay(
          {
            userId,
            habitId: habit.id,
            dateKey: input.dateKey,
            completed: input.status === "done",
            nowMs,
          },
          tx
        );

        return { log: savedLog, syncedTaskCount };
      })
    );
  }

  /**
   * Promotes an existing task into a personal recurring habit inside a single
   * ACID transaction, linking `tasks.habitId` + `tasks.habitDateKey` and
   * seeding a `'done'` log if the task is already completed.
   */
  async promoteTaskToHabit(
    userId: string,
    timezone: string,
    taskId: string,
    options: PromoteTaskToHabitInput = {}
  ): Promise<{
    habit: HabitRecord;
    task: TaskRecord;
    initialLog: HabitLogRecord | null;
  }> {
    const cadence = normalizeCadence({
      cadenceType: options.cadenceType ?? "daily",
      scheduledDays: options.scheduledDays,
      weeklyTargetCount: options.weeklyTargetCount,
    });
    const preferredTime = normalizeTimeOrNull(
      options.preferredTime,
      "Preferred time"
    );

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const taskMeta = await this.tasks.getAuthMetadata(taskId, tx);
        if (!taskMeta) {
          throw new NotFoundError("Task not found.");
        }

        if (taskMeta.projectId) {
          await assertProjectRole(
            taskMeta.projectId,
            userId,
            ["owner", "editor"],
            this.membershipLookup,
            tx
          );
        }

        if (taskMeta.userId !== userId) {
          throw new ForbiddenError(
            "Only the task creator can promote this task into a personal habit."
          );
        }

        if (taskMeta.habitId) {
          throw new ConflictError("This task is already linked to a habit.");
        }

        let habitDateKey = todayDateKey;
        if (taskMeta.dueAt !== null) {
          const dueDateKey = getLocalDateKey(taskMeta.dueAt, timezone);
          if (!isFutureDateKey(dueDateKey, todayDateKey)) {
            habitDateKey = dueDateKey;
          }
        }

        const position = await this.allocateNextHabitPosition(userId, tx);
        const habitTitle = (options.title?.trim() || taskMeta.title).slice(
          0,
          120
        );

        const habit = await this.habits.createHabit(
          {
            userId,
            title: habitTitle,
            category: options.category?.trim().slice(0, 48) || null,
            cadenceType: cadence.cadenceType,
            scheduledDaysJson: cadence.scheduledDaysJson,
            weeklyTargetCount: cadence.weeklyTargetCount,
            startDate: habitDateKey,
            preferredTime,
            linkedProjectId: taskMeta.projectId,
            autoSyncDailyTask: options.autoSyncDailyTask ?? true,
            position,
          },
          tx
        );

        const updatedTask = taskMeta.projectId
          ? await this.tasks.updateProjectTask(
              taskId,
              taskMeta.projectId,
              { habitId: habit.id, habitDateKey },
              tx
            )
          : await this.tasks.updatePersonalTask(
              taskId,
              userId,
              { habitId: habit.id, habitDateKey },
              tx
            );

        if (!updatedTask) {
          throw new NotFoundError("Task not found.");
        }

        let initialLog: HabitLogRecord | null = null;
        if (taskMeta.status === "done") {
          const loggedAt = taskMeta.completedAt ?? nowMs;
          initialLog = await this.habits.upsertLog(
            {
              habitId: habit.id,
              userId,
              dateKey: habitDateKey,
              status: "done",
              note: null,
              loggedAt,
              isBackfilledLate: computeIsBackfilledLate(
                habitDateKey,
                loggedAt,
                timezone
              ),
            },
            tx
          );
        }

        if (taskMeta.projectId) {
          await this.projects.recordActivity(
            {
              projectId: taskMeta.projectId,
              actorId: userId,
              action: "task.linked_habit",
              entityType: "task",
              entityId: updatedTask.id,
              metadata: {
                title: updatedTask.title,
                habitId: habit.id,
              },
            },
            tx
          );
        }

        return { habit, task: updatedTask, initialLog };
      })
    );
  }

  /**
   * Bulk imports up to 50 habits from newline-separated titles or CSV inside
   * a single atomic transaction.
   */
  async bulkImportHabits(
    userId: string,
    timezone: string,
    rawText: string
  ): Promise<HabitRecord[]> {
    const parsed = parseBulkHabitImport(rawText);
    if (parsed.error || parsed.rows.length === 0) {
      throw new ValidationError(
        parsed.error ?? "Provide at least one habit to import."
      );
    }

    const todayDateKey = getLocalDateKey(this.now(), timezone);

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        let cursorPos = await this.habits.getLastHabitPosition(userId, tx);
        const positions: string[] = [];

        for (let i = 0; i < parsed.rows.length; i++) {
          const next = generatePositionBetween(cursorPos, null);
          if (next.length > MAX_POSITION_KEY_LENGTH) {
            await this.habits.rebalanceHabitPositions(userId, tx);
            cursorPos = await this.habits.getLastHabitPosition(userId, tx);
            const reset = generatePositionBetween(cursorPos, null);
            positions.push(reset);
            cursorPos = reset;
          } else {
            positions.push(next);
            cursorPos = next;
          }
        }

        return this.habits.createHabitsBatch(
          parsed.rows.map((row, idx) => ({
            userId,
            title: row.title,
            category: row.category,
            cadenceType: row.cadenceType,
            scheduledDaysJson: JSON.stringify(row.scheduledDays),
            weeklyTargetCount: row.weeklyTargetCount,
            startDate: todayDateKey,
            preferredTime: row.preferredTime,
            linkedProjectId: null,
            autoSyncDailyTask: false,
            position: positions[idx]!,
          })),
          tx
        );
      })
    );
  }
}

export const habitService = new HabitService();
