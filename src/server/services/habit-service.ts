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
  shiftYearMonth,
  type AnalyticsHabitInput,
  type HabitMonthAnalytics,
  type ScoringMode,
} from "@/server/domain/habit-analytics";
import {
  deriveMonthRostersFromLogs,
  MAX_HISTORY_LOG_ROWS,
  type ParsedHistoryLog,
} from "@/server/domain/habit-import";
import {
  normalizeImportTitle,
  planHabitEvolution,
  resolveCanonicalTitle,
  type AliasOverride,
  type HabitEvolutionPlan,
  type MonthRoster,
} from "@/server/domain/habit-evolution";

const MAX_HABIT_NOTE_LENGTH = 280;

const MERGE_STATUS_PRIORITY: Record<HabitLogStatus, number> = {
  done: 3,
  skipped: 2,
  missed: 1,
};

export interface CreateHabitInput {
  title: string;
  description?: string | null;
  category?: string | null;
  cadenceType?: HabitCadenceType;
  scheduledDays?: number[];
  weeklyTargetCount?: number | null;
  startDate?: string;
  /** Optional YYYY-MM month being viewed when creating the habit so it enrolls into that month's roster. */
  targetYearMonth?: string;
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

export interface BulkHistoryImportInput {
  rows: ParsedHistoryLog[];
  createMissing: boolean;
  /** One entry per spreadsheet month; drives add/remove/rename detection. */
  monthRosters: MonthRoster[];
  /** User-confirmed alias mappings that override automatic grouping. */
  aliasOverrides: AliasOverride[];
  /** Archive habits that stop appearing in the final month. */
  archiveRemoved: boolean;
}

export interface BulkHistoryImportResult {
  importedCount: number;
  createdHabits: HabitRecord[];
  archivedHabits: HabitRecord[];
  matchedTitleCount: number;
  skippedTitleCount: number;
  aliasCount: number;
  syncedTaskCount: number;
  evolution: HabitEvolutionPlan;
  warnings: string[];
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

export interface PreviousMonthRosterSource {
  yearMonth: string;
  monthLabel: string;
  habitIds: string[];
}

export interface HabitMonthWorkspace {
  settings: HabitTrackerSettingsRecord;
  habits: HabitRecord[];
  archivedHabits: HabitRecord[];
  /** Complete library of user habits (active + archived) for per-month roster editing. */
  allHabits: HabitRecord[];
  /** True when `yearMonth` has explicit rows in `habit_month_rosters`. */
  hasExplicitMonthRoster: boolean;
  /** Latest earlier month whose habits can be carried over into `yearMonth` in 1 click. */
  previousRosterSource: PreviousMonthRosterSource | null;
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
    const [position] = await this.allocateHabitPositions(userId, tx, 1);
    return position!;
  }

  private async allocateHabitPositions(
    userId: string,
    tx: DbExecutor,
    count: number
  ): Promise<string[]> {
    if (count <= 0) return [];
    let cursor = await this.habits.getLastHabitPosition(userId, tx);
    const positions: string[] = [];

    for (let i = 0; i < count; i++) {
      let next = generatePositionBetween(cursor, null);
      if (next.length > MAX_POSITION_KEY_LENGTH) {
        await this.habits.rebalanceHabitPositions(userId, tx);
        cursor = await this.habits.getLastHabitPosition(userId, tx);
        next = generatePositionBetween(cursor, null);
      }
      positions.push(next);
      cursor = next;
    }

    return positions;
  }

  async getMonthWorkspace(
    userId: string,
    timezone: string,
    options: { yearMonth?: string; scoringMode?: ScoringMode } = {}
  ): Promise<HabitMonthWorkspace> {
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    const requestedMonth =
      options.yearMonth && isValidYearMonth(options.yearMonth)
        ? options.yearMonth
        : currentMonth;
    // Future months cannot be tracked until they begin — clamp strictly to <= currentMonth
    const yearMonth =
      requestedMonth > currentMonth ? currentMonth : requestedMonth;
    const scoringMode: ScoringMode =
      options.scoringMode === "full_month" ? "full_month" : "elapsed";

    const [
      settings,
      allUserHabits,
      explicitMonthHabitIds,
      hasAnyMonthRoster,
      previousRoster,
    ] = await Promise.all([
      this.habits.getOrCreateSettings(userId),
      this.habits.listHabitsForUser(userId, { includeArchived: true }),
      this.habits.listMonthRosterHabitIds(userId, yearMonth),
      this.habits.hasAnyMonthRosterForUser(userId),
      this.habits.findLatestMonthRosterBefore(userId, yearMonth),
    ]);

    const archivedHabits = allUserHabits.filter((h) => h.isArchived);
    const weekStartsOn: 0 | 1 = settings.weekStartsOn === 0 ? 0 : 1;
    const calendar = buildMonthCalendar(yearMonth, weekStartsOn);

    // Fetch enough historical logs to compute accurate streaks crossing month boundaries
    const defaultLookback = addDaysToDateKey(calendar.monthStartKey, -120);
    const maxLookback = addDaysToDateKey(calendar.monthStartKey, -365);
    let earliestStart = defaultLookback;
    for (const h of allUserHabits) {
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

    const logsByKey: Record<string, HabitLogRecord> = {};
    const habitIdsWithLogsInMonth = new Set<string>();
    for (const log of allLogs) {
      if (
        log.dateKey >= calendar.monthStartKey &&
        log.dateKey <= calendar.monthEndKey
      ) {
        logsByKey[`${log.habitId}::${log.dateKey}`] = log;
        habitIdsWithLogsInMonth.add(log.habitId);
      }
    }

    // Per-month habit visibility:
    // 1. If this month has an explicit roster, honor it strictly so removing a habit
    //    from this month hides it from this month's grid & KPIs (even if earlier marks
    //    exist in this month) without altering other months or deleting historical logs.
    // 2. If the user uses monthly rosters in other months but hasn't set up this month yet
    //    (e.g., new month just began), show only habits logged this month so the carry-over
    //    prompt lets them import or edit from the previous month cleanly.
    // 3. Otherwise (legacy/fresh user with no monthly rosters yet), render active habits
    //    plus archived habits that have logs in this month.
    const explicitSet = new Set(explicitMonthHabitIds);
    const hasExplicitMonthRoster = explicitSet.size > 0;
    const visibleHabits = hasExplicitMonthRoster
      ? allUserHabits.filter((h) => explicitSet.has(h.id))
      : hasAnyMonthRoster
        ? allUserHabits.filter((h) => habitIdsWithLogsInMonth.has(h.id))
        : allUserHabits.filter(
            (h) => !h.isArchived || habitIdsWithLogsInMonth.has(h.id)
          );

    const previousRosterSource: PreviousMonthRosterSource | null = previousRoster
      ? {
          yearMonth: previousRoster.yearMonth,
          monthLabel: buildMonthCalendar(
            previousRoster.yearMonth,
            weekStartsOn
          ).monthLabel,
          habitIds: previousRoster.habitIds,
        }
      : null;

    const analytics = computeHabitMonthAnalytics({
      yearMonth,
      todayDateKey,
      weekStartsOn,
      scoringMode,
      habits: visibleHabits.map(toAnalyticsHabit),
      logs: allLogs,
    });

    const linkedTaskByKey: Record<string, LinkedHabitTaskSummary> = {};
    for (const lt of linkedTasks) {
      linkedTaskByKey[`${lt.habitId}::${lt.habitDateKey}`] = lt;
    }

    return {
      settings,
      habits: visibleHabits,
      archivedHabits,
      allHabits: allUserHabits,
      hasExplicitMonthRoster,
      previousRosterSource,
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
    const currentMonth = todayDateKey.slice(0, 7);
    const lookbackStart = addDaysToDateKey(todayDateKey, -120);

    const [settings, activeHabits, currentMonthRosterIds, recentLogs] =
      await Promise.all([
        this.habits.getOrCreateSettings(userId),
        this.habits.listHabitsForUser(userId, { includeArchived: false }),
        this.habits.listMonthRosterHabitIds(userId, currentMonth),
        this.habits.listLogsForRange(userId, lookbackStart, todayDateKey),
      ]);

    const currentMonthRosterSet = new Set(currentMonthRosterIds);
    const scopedActiveHabits =
      currentMonthRosterSet.size > 0
        ? activeHabits.filter((h) => currentMonthRosterSet.has(h.id))
        : activeHabits;

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

    const items: TodayHabitStripItem[] = scopedActiveHabits.map((habit) => {
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
    const currentMonth = todayDateKey.slice(0, 7);
    const startDate = input.startDate?.trim() || todayDateKey;
    if (!isValidDateKey(startDate)) {
      throw new ValidationError("Start date must be a valid YYYY-MM-DD date.");
    }
    if (startDate.slice(0, 7) > currentMonth) {
      throw new ValidationError(
        "Future months cannot be tracked until they begin."
      );
    }

    const targetYearMonth = input.targetYearMonth?.trim() || null;
    if (targetYearMonth) {
      if (!isValidYearMonth(targetYearMonth)) {
        throw new ValidationError("Month must be in YYYY-MM format.");
      }
      if (targetYearMonth > currentMonth) {
        throw new ValidationError(
          "Future months cannot be tracked until they begin."
        );
      }
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

        // If the user uses monthly rosters (or explicitly targeted a month),
        // enroll this new habit into the target month's roster cleanly. When
        // bootstrapping a legacy user's very first month roster, preserve all
        // existing active habits in that month so none disappear unexpectedly.
        const enrollMonth =
          targetYearMonth ??
          (startDate.slice(0, 7) <= currentMonth
            ? startDate.slice(0, 7)
            : currentMonth);
        const hadAnyRoster = await this.habits.hasAnyMonthRosterForUser(
          userId,
          tx
        );
        if (hadAnyRoster || targetYearMonth) {
          const habitIdsToEnroll = hadAnyRoster
            ? [created.id]
            : (
                await this.habits.listHabitsForUser(
                  userId,
                  { includeArchived: false },
                  tx
                )
              ).map((h) => h.id);
          await this.habits.upsertMonthRosterEntries(
            habitIdsToEnroll.map((habitId) => ({
              userId,
              habitId,
              yearMonth: enrollMonth,
            })),
            tx
          );
        }

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
    if (input.startDate !== undefined) {
      const currentMonth = getLocalDateKey(this.now(), "UTC").slice(0, 7);
      // Allow current month (up to next month edge for UTC+14) while strictly rejecting far future months
      const nextMonthEdge = shiftYearMonth(currentMonth, 1);
      if (input.startDate.slice(0, 7) > nextMonthEdge) {
        throw new ValidationError(
          "Future months cannot be tracked until they begin."
        );
      }
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

  /**
   * Saves the exact curated list of habits to track for `yearMonth` (`YYYY-MM`).
   * Rejects future months not yet reached and leaves all other months intact.
   */
  async saveMonthRoster(
    userId: string,
    timezone: string,
    input: { yearMonth: string; habitIds: string[] }
  ): Promise<{ yearMonth: string; habitIds: string[] }> {
    if (!isValidYearMonth(input.yearMonth)) {
      throw new ValidationError("Month must be in YYYY-MM format.");
    }
    const todayDateKey = getLocalDateKey(this.now(), timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    if (input.yearMonth > currentMonth) {
      throw new ValidationError(
        "Future months cannot be tracked until they begin."
      );
    }

    const calendar = buildMonthCalendar(input.yearMonth, 1);

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const ownedHabits = await this.habits.listHabitsForUser(
          userId,
          { includeArchived: true },
          tx
        );
        const ownedById = new Map(ownedHabits.map((h) => [h.id, h]));

        const validHabitIds = Array.from(
          new Set(input.habitIds.filter((id) => ownedById.has(id)))
        );

        await this.habits.replaceMonthRoster(
          userId,
          input.yearMonth,
          validHabitIds,
          tx
        );

        for (const habitId of validHabitIds) {
          const habit = ownedById.get(habitId)!;
          const patch: { isArchived?: boolean; startDate?: string } = {};
          if (input.yearMonth === currentMonth && habit.isArchived) {
            patch.isArchived = false;
          }
          if (habit.startDate > calendar.monthEndKey) {
            patch.startDate = calendar.monthStartKey;
          }
          if (
            patch.isArchived !== undefined ||
            patch.startDate !== undefined
          ) {
            await this.habits.updateHabitForUser(userId, habit.id, patch, tx);
          }
        }

        return { yearMonth: input.yearMonth, habitIds: validHabitIds };
      })
    );
  }

  /**
   * Carries over the habit list from the previous month (or a specified earlier
   * source month) into `targetYearMonth` so the user starts the new month with
   * their previous list and can edit/add/remove items freely.
   */
  async carryOverPreviousMonthRoster(
    userId: string,
    timezone: string,
    input: { targetYearMonth: string; sourceYearMonth?: string }
  ): Promise<{
    targetYearMonth: string;
    sourceYearMonth: string;
    habitIds: string[];
  }> {
    if (!isValidYearMonth(input.targetYearMonth)) {
      throw new ValidationError("Target month must be in YYYY-MM format.");
    }
    const todayDateKey = getLocalDateKey(this.now(), timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    if (input.targetYearMonth > currentMonth) {
      throw new ValidationError(
        "Future months cannot be tracked until they begin."
      );
    }
    if (
      input.sourceYearMonth &&
      (!isValidYearMonth(input.sourceYearMonth) ||
        input.sourceYearMonth >= input.targetYearMonth)
    ) {
      throw new ValidationError(
        "Source month must be an earlier YYYY-MM month."
      );
    }

    const calendar = buildMonthCalendar(input.targetYearMonth, 1);

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const ownedHabits = await this.habits.listHabitsForUser(
          userId,
          { includeArchived: true },
          tx
        );
        const ownedById = new Map(ownedHabits.map((h) => [h.id, h]));

        let sourceYearMonth: string;
        let habitIds: string[];

        if (input.sourceYearMonth) {
          sourceYearMonth = input.sourceYearMonth;
          habitIds = await this.habits.listMonthRosterHabitIds(
            userId,
            input.sourceYearMonth,
            tx
          );
        } else {
          const latest = await this.habits.findLatestMonthRosterBefore(
            userId,
            input.targetYearMonth,
            tx
          );
          if (latest) {
            sourceYearMonth = latest.yearMonth;
            habitIds = latest.habitIds;
          } else {
            // Fallback for legacy users carrying active habits into their first explicit month
            const activeIds = ownedHabits
              .filter((h) => !h.isArchived)
              .map((h) => h.id);
            if (activeIds.length === 0) {
              throw new ValidationError(
                "No habits found in previous months to carry over."
              );
            }
            sourceYearMonth = input.targetYearMonth;
            habitIds = activeIds;
          }
        }

        const validIds = Array.from(
          new Set(habitIds.filter((id) => ownedById.has(id)))
        );
        if (validIds.length === 0) {
          throw new ValidationError(
            "No habits found in the selected previous month to carry over."
          );
        }

        await this.habits.replaceMonthRoster(
          userId,
          input.targetYearMonth,
          validIds,
          tx
        );

        for (const habitId of validIds) {
          const habit = ownedById.get(habitId)!;
          const patch: { isArchived?: boolean; startDate?: string } = {};
          if (input.targetYearMonth === currentMonth && habit.isArchived) {
            patch.isArchived = false;
          }
          if (habit.startDate > calendar.monthEndKey) {
            patch.startDate = calendar.monthStartKey;
          }
          if (
            patch.isArchived !== undefined ||
            patch.startDate !== undefined
          ) {
            await this.habits.updateHabitForUser(userId, habit.id, patch, tx);
          }
        }

        return {
          targetYearMonth: input.targetYearMonth,
          sourceYearMonth,
          habitIds: validIds,
        };
      })
    );
  }

  /**
   * Removes a habit from `yearMonth` ONLY without deleting or modifying its
   * participation or historical logs in any other month.
   */
  async removeHabitFromMonth(
    userId: string,
    timezone: string,
    input: { habitId: string; yearMonth: string }
  ): Promise<{ yearMonth: string; removedHabitId: string }> {
    if (!isValidYearMonth(input.yearMonth)) {
      throw new ValidationError("Month must be in YYYY-MM format.");
    }
    const todayDateKey = getLocalDateKey(this.now(), timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    if (input.yearMonth > currentMonth) {
      throw new ValidationError(
        "Future months cannot be tracked until they begin."
      );
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const target = await this.habits.getHabitForUser(
          userId,
          input.habitId,
          tx
        );
        if (!target) {
          throw new NotFoundError("Habit not found.");
        }

        const existingRoster = await this.habits.listMonthRosterHabitIds(
          userId,
          input.yearMonth,
          tx
        );
        if (existingRoster.length === 0) {
          // Materialize current active habits into an explicit roster for this month first
          const allActive = await this.habits.listHabitsForUser(
            userId,
            { includeArchived: false },
            tx
          );
          const remaining = allActive
            .map((h) => h.id)
            .filter((id) => id !== input.habitId);
          await this.habits.replaceMonthRoster(
            userId,
            input.yearMonth,
            remaining,
            tx
          );
        } else {
          await this.habits.removeHabitFromMonthRoster(
            userId,
            input.habitId,
            input.yearMonth,
            tx
          );
        }

        return { yearMonth: input.yearMonth, removedHabitId: input.habitId };
      })
    );
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

        const usesRosters = await this.habits.hasAnyMonthRosterForUser(
          userId,
          tx
        );
        if (usesRosters) {
          await this.habits.upsertMonthRosterEntries(
            [
              {
                userId,
                habitId: habit.id,
                yearMonth: todayDateKey.slice(0, 7),
              },
            ],
            tx
          );
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
    rawText: string,
    targetYearMonth?: string
  ): Promise<HabitRecord[]> {
    const parsed = parseBulkHabitImport(rawText);
    if (parsed.error || parsed.rows.length === 0) {
      throw new ValidationError(
        parsed.error ?? "Provide at least one habit to import."
      );
    }

    const todayDateKey = getLocalDateKey(this.now(), timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    if (targetYearMonth) {
      if (!isValidYearMonth(targetYearMonth)) {
        throw new ValidationError("Month must be in YYYY-MM format.");
      }
      if (targetYearMonth > currentMonth) {
        throw new ValidationError(
          "Future months cannot be tracked until they begin."
        );
      }
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const positions = await this.allocateHabitPositions(
          userId,
          tx,
          parsed.rows.length
        );

        const created = await this.habits.createHabitsBatch(
          parsed.rows.map((row, idx) => ({
            userId,
            title: row.title,
            category: row.category,
            cadenceType: row.cadenceType,
            scheduledDaysJson: JSON.stringify(row.scheduledDays),
            weeklyTargetCount: row.weeklyTargetCount,
            startDate:
              row.startDate && row.startDate.slice(0, 7) <= currentMonth
                ? row.startDate
                : todayDateKey,
            preferredTime: row.preferredTime,
            linkedProjectId: null,
            autoSyncDailyTask: false,
            position: positions[idx]!,
          })),
          tx
        );

        const hadAnyRoster = await this.habits.hasAnyMonthRosterForUser(
          userId,
          tx
        );
        if ((hadAnyRoster || targetYearMonth) && created.length > 0) {
          const enrollMonth = targetYearMonth ?? currentMonth;
          const habitIdsToEnroll = hadAnyRoster
            ? created.map((habit) => habit.id)
            : (
                await this.habits.listHabitsForUser(
                  userId,
                  { includeArchived: false },
                  tx
                )
              ).map((h) => h.id);
          await this.habits.upsertMonthRosterEntries(
            habitIdsToEnroll.map((habitId) => ({
              userId,
              habitId,
              yearMonth: enrollMonth,
            })),
            tx
          );
        }

        return created;
      })
    );
  }

  /**
   * Imports a completion-history grid in one transaction. Source titles are
   * resolved through detected renames and merges so one habit keeps its
   * history, start dates come from the first month a habit appears, and habits
   * that disappear in later months are archived.
   */
  async bulkImportHistory(
    userId: string,
    timezone: string,
    input: BulkHistoryImportInput
  ): Promise<BulkHistoryImportResult> {
    if (input.rows.length === 0) {
      throw new ValidationError("Provide at least one completion mark.");
    }
    if (input.rows.length > MAX_HISTORY_LOG_ROWS) {
      throw new ValidationError(
        `History import supports up to ${MAX_HISTORY_LOG_ROWS.toLocaleString()} marks at once.`
      );
    }

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const warnings: string[] = [];
    const rows: ParsedHistoryLog[] = [];

    for (const row of input.rows) {
      if (!isValidDateKey(row.dateKey)) {
        warnings.push(`Ignored invalid date "${row.dateKey}".`);
        continue;
      }
      if (isFutureDateKey(row.dateKey, todayDateKey)) {
        warnings.push(`Ignored future date "${row.dateKey}".`);
        continue;
      }
      rows.push(row);
    }

    if (rows.length === 0) {
      throw new ValidationError(
        "No importable marks remain after checking dates."
      );
    }

    // Derive month rosters from parsed dates when not explicitly supplied by .xlsx sheets
    // so CSV/TXT/pasted multi-month grids receive identical rename/merge/archival detection.
    const effectiveRosters =
      input.monthRosters.length > 0
        ? input.monthRosters
        : deriveMonthRostersFromLogs(rows);

    const evolution = planHabitEvolution(
      effectiveRosters,
      input.aliasOverrides
    );
    warnings.push(...evolution.warnings);

    const resolvedRows = rows.map((row) => ({
      ...row,
      canonicalTitle: resolveCanonicalTitle(
        row.title,
        evolution,
        input.aliasOverrides
      ),
    }));

    interface CanonicalGroup {
      title: string;
      firstDate: string;
      lastDate: string;
      startDate: string;
      lastMonth: string | null;
      sourceTitleKeys: Set<string>;
    }
    const groupByKey = new Map<string, CanonicalGroup>();
    for (const row of resolvedRows) {
      const key = normalizeImportTitle(row.canonicalTitle);
      const sourceKey = normalizeImportTitle(row.title);
      const existing = groupByKey.get(key);
      if (!existing) {
        groupByKey.set(key, {
          title: row.canonicalTitle,
          firstDate: row.dateKey,
          lastDate: row.dateKey,
          // Keep the actual first day this habit has a logged mark — never pull back to
          // YYYY-MM-01, which would penalize mid-month starters with phantom missed days.
          startDate: row.dateKey,
          lastMonth: row.dateKey.slice(0, 7),
          sourceTitleKeys: new Set([key, sourceKey]),
        });
        continue;
      }
      existing.sourceTitleKeys.add(sourceKey);
      if (row.dateKey < existing.firstDate) {
        existing.firstDate = row.dateKey;
        existing.startDate = row.dateKey;
      }
      if (row.dateKey > existing.lastDate) {
        existing.lastDate = row.dateKey;
        existing.lastMonth = row.dateKey.slice(0, 7);
      }
    }

    for (const group of evolution.groups) {
      const entry = groupByKey.get(normalizeImportTitle(group.canonicalTitle));
      if (!entry) continue;
      if (group.lastMonth) {
        entry.lastMonth = group.lastMonth;
      }
      for (const sourceTitle of group.sourceTitles) {
        entry.sourceTitleKeys.add(normalizeImportTitle(sourceTitle));
      }
    }

    const canonicalKeys = Array.from(groupByKey.keys());

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const [allHabits, existingAliases] = await Promise.all([
          this.habits.listHabitsForUser(userId, { includeArchived: true }, tx),
          this.habits.listAliasesForUser(userId, tx),
        ]);

        const habitById = new Map<string, HabitRecord>(
          allHabits.map((h) => [h.id, h])
        );
        const habitByKey = new Map<string, HabitRecord>();
        for (const habit of allHabits) {
          habitByKey.set(normalizeImportTitle(habit.title), habit);
        }
        for (const alias of existingAliases) {
          if (habitByKey.has(alias.normalizedTitle)) continue;
          const habit = habitById.get(alias.habitId);
          if (habit) habitByKey.set(alias.normalizedTitle, habit);
        }

        // Also match an evolution group against any of its historical source titles
        // so incremental month-by-month imports after a rename link to the existing habit.
        for (const key of canonicalKeys) {
          if (habitByKey.has(key)) continue;
          const group = groupByKey.get(key)!;
          for (const sourceKey of group.sourceTitleKeys) {
            const matchedHabit = habitByKey.get(sourceKey);
            if (matchedHabit) {
              habitByKey.set(key, matchedHabit);
              break;
            }
          }
        }

        const missingKeys = canonicalKeys.filter((key) => !habitByKey.has(key));
        const matchedTitleCount = canonicalKeys.length - missingKeys.length;

        let createdHabits: HabitRecord[] = [];
        const effectiveKeys = input.createMissing
          ? canonicalKeys
          : matchedKeys(canonicalKeys, habitByKey);

        if (input.createMissing && missingKeys.length > 0) {
          const positions = await this.allocateHabitPositions(
            userId,
            tx,
            missingKeys.length
          );
          createdHabits = await this.habits.createHabitsBatch(
            missingKeys.map((key, index) => ({
              userId,
              title: groupByKey.get(key)!.title.slice(0, 120),
              category: null,
              cadenceType: "daily",
              scheduledDaysJson: "[]",
              weeklyTargetCount: null,
              startDate: groupByKey.get(key)!.startDate,
              preferredTime: null,
              linkedProjectId: null,
              autoSyncDailyTask: false,
              position: positions[index]!,
            })),
            tx
          );
          for (const habit of createdHabits) {
            habitByKey.set(normalizeImportTitle(habit.title), habit);
          }
        }

        // Backfill startDate on existing matched habits when imported history predates
        // their current startDate so historical analytics include every imported mark.
        for (const key of effectiveKeys) {
          const habit = habitByKey.get(key);
          const group = groupByKey.get(key);
          if (!habit || !group) continue;
          if (group.startDate < habit.startDate) {
            const updated = await this.habits.updateHabitForUser(
              userId,
              habit.id,
              { startDate: group.startDate },
              tx
            );
            if (updated) {
              habitByKey.set(key, updated);
            }
          }
        }

        // Archive habits that disappear after their last source month (only when
        // importing across multiple months so a single-month import never archives).
        const archivedHabits: HabitRecord[] = [];
        const hasMultipleMonths =
          evolution.firstMonth !== null &&
          evolution.lastMonth !== null &&
          evolution.firstMonth < evolution.lastMonth;
        if (input.archiveRemoved && hasMultipleMonths && evolution.lastMonth) {
          for (const key of effectiveKeys) {
            const habit = habitByKey.get(key);
            const group = groupByKey.get(key);
            if (!habit || !group?.lastMonth) continue;

            if (group.lastMonth < evolution.lastMonth && !habit.isArchived) {
              const updated = await this.habits.updateHabitForUser(
                userId,
                habit.id,
                { isArchived: true },
                tx
              );
              if (updated) {
                habitByKey.set(key, updated);
                archivedHabits.push(updated);
              }
            } else if (
              group.lastMonth === evolution.lastMonth &&
              habit.isArchived
            ) {
              // A removed habit came back — restore it instead of double-creating.
              const restored = await this.habits.updateHabitForUser(
                userId,
                habit.id,
                { isArchived: false },
                tx
              );
              if (restored) {
                habitByKey.set(key, restored);
              }
            }
          }
        }

        const effectiveKeySet = new Set(effectiveKeys);
        const importRows = resolvedRows.filter((row) =>
          effectiveKeySet.has(normalizeImportTitle(row.canonicalTitle))
        );

        if (importRows.length === 0) {
          return {
            importedCount: 0,
            createdHabits,
            archivedHabits,
            matchedTitleCount,
            skippedTitleCount: canonicalKeys.length - effectiveKeys.length,
            aliasCount: 0,
            syncedTaskCount: 0,
            evolution,
            warnings,
          };
        }

        let minDate = importRows[0]!.dateKey;
        let maxDate = importRows[0]!.dateKey;
        for (const row of importRows) {
          if (row.dateKey < minDate) minDate = row.dateKey;
          if (row.dateKey > maxDate) maxDate = row.dateKey;
        }

        const existingLogs = await this.habits.listLogsForRange(
          userId,
          minDate,
          maxDate,
          tx
        );
        const noteByKey = new Map(
          existingLogs.map((log) => [`${log.habitId}|${log.dateKey}`, log.note])
        );

        // Deduplicate by (habitId, dateKey) after alias/merge resolution using
        // deterministic precedence (done > skipped > missed) so merged habits never
        // emit duplicate keys or overwrite a completion with a miss.
        const dedupedLogInputs = new Map<
          string,
          {
            habitId: string;
            userId: string;
            dateKey: string;
            status: HabitLogStatus;
            note: string | null;
            loggedAt: number;
            isBackfilledLate: boolean;
          }
        >();

        for (const row of importRows) {
          const habit = habitByKey.get(normalizeImportTitle(row.canonicalTitle));
          if (!habit) continue;
          const compositeKey = `${habit.id}|${row.dateKey}`;
          const prev = dedupedLogInputs.get(compositeKey);
          if (
            prev &&
            MERGE_STATUS_PRIORITY[prev.status] >= MERGE_STATUS_PRIORITY[row.status]
          ) {
            continue;
          }
          dedupedLogInputs.set(compositeKey, {
            habitId: habit.id,
            userId,
            dateKey: row.dateKey,
            status: row.status,
            note: noteByKey.get(compositeKey) ?? null,
            loggedAt: nowMs,
            isBackfilledLate: computeIsBackfilledLate(
              row.dateKey,
              nowMs,
              timezone
            ),
          });
        }

        const logInputs = Array.from(dedupedLogInputs.values());
        const saved = await this.habits.upsertLogsBatch(logInputs, tx);

        // Enroll every imported habit into the exact months where it had marks
        // so switching months shows ONLY that month's curated habit roster.
        const rosterEntries = logInputs.map((log) => ({
          userId,
          habitId: log.habitId,
          yearMonth: log.dateKey.slice(0, 7),
        }));
        await this.habits.upsertMonthRosterEntries(rosterEntries, tx);

        const syncedTaskCount = await this.tasks.syncLinkedTasksForHabitLogs(
          {
            userId,
            nowMs,
            entries: logInputs.map((log) => ({
              habitId: log.habitId,
              dateKey: log.dateKey,
              completed: log.status === "done",
            })),
          },
          tx
        );

        // Persist source-title -> habit aliases so later imports keep identity.
        const aliasMeta = new Map<
          string,
          { label: string; first: string; last: string }
        >();
        for (const row of importRows) {
          const key = normalizeImportTitle(row.title);
          const meta = aliasMeta.get(key);
          if (!meta) {
            aliasMeta.set(key, {
              label: row.title,
              first: row.dateKey,
              last: row.dateKey,
            });
          } else {
            if (row.dateKey < meta.first) meta.first = row.dateKey;
            if (row.dateKey > meta.last) meta.last = row.dateKey;
          }
        }
        const habitTitleKeys = new Set([
          ...allHabits.map((habit) => normalizeImportTitle(habit.title)),
          ...createdHabits.map((habit) => normalizeImportTitle(habit.title)),
        ]);
        const aliasInputs: Array<{
          userId: string;
          habitId: string;
          sourceTitle: string;
          normalizedTitle: string;
          firstSeenDateKey: string;
          lastSeenDateKey: string;
        }> = [];
        for (const [key, meta] of aliasMeta.entries()) {
          const canonicalTitle = resolveCanonicalTitle(
            meta.label,
            evolution,
            input.aliasOverrides
          );
          const canonicalKey = normalizeImportTitle(canonicalTitle);
          const targetHabit = habitByKey.get(canonicalKey);
          if (!targetHabit) continue;
          const targetTitleKey = normalizeImportTitle(targetHabit.title);
          if (key === targetTitleKey || habitTitleKeys.has(key)) continue;
          aliasInputs.push({
            userId,
            habitId: targetHabit.id,
            sourceTitle: meta.label,
            normalizedTitle: key,
            firstSeenDateKey: meta.first,
            lastSeenDateKey: meta.last,
          });
        }
        const savedAliases = await this.habits.upsertAliasesBatch(
          aliasInputs,
          tx
        );

        return {
          importedCount: saved.length,
          createdHabits,
          archivedHabits,
          matchedTitleCount,
          skippedTitleCount: canonicalKeys.length - effectiveKeys.length,
          aliasCount: savedAliases.length,
          syncedTaskCount,
          evolution,
          warnings,
        };
      })
    );
  }
}

function matchedKeys(
  keys: string[],
  habitByKey: Map<string, HabitRecord>
): string[] {
  return keys.filter((key) => habitByKey.has(key));
}

export const habitService = new HabitService();
