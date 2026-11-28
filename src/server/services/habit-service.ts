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
  MonthLockedError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitMetadataPatch,
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
  MAX_HISTORY_IMPORT_CHUNK_SIZE,
  MAX_HISTORY_LOG_ROWS,
  type ParsedHistoryLog,
} from "@/server/domain/habit-import";
import {
  clampGraceDays,
  evaluateMonthLockState,
  isValidMonthLockPin,
  PIN_LOCKOUT_DURATION_MS,
  PIN_LOCKOUT_THRESHOLD,
  sanitizeHabitTrackerSettings,
  TEMP_UNLOCK_DURATION_MS,
  type ClientHabitTrackerSettings,
  type MonthLockState,
} from "@/server/domain/habit-month-lock";
import {
  normalizeImportTitle,
  planHabitEvolution,
  resolveCanonicalTitle,
  type AliasOverride,
  type HabitEvolutionPlan,
  type MonthRoster,
} from "@/server/domain/habit-evolution";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";
import {
  hashMonthLockPin,
  verifyMonthLockPin,
} from "@/server/security/pin-crypto";

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
  monthLockEnabled?: boolean;
  monthLockGraceDays?: number;
  currentPin?: string;
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
  /**
   * When true (default per Option 2A), past months that are only auto-locked
   * by calendar age may receive initial historical backfills. Manually locked
   * months ALWAYS block imports until unlocked.
   */
  allowAutoLockedBackfill?: boolean;
}

export interface PrepareBulkHistoryHabitSummary {
  canonicalTitle: string;
  firstDate: string;
  lastDate: string;
  lastMonth: string;
  sourceTitles: string[];
}

export interface PrepareBulkHistoryAliasEntry {
  sourceTitle: string;
  canonicalTitle: string;
  firstDate: string;
  lastDate: string;
}

export interface PrepareBulkHistoryImportInput {
  habits: PrepareBulkHistoryHabitSummary[];
  months: string[];
  firstMonth: string | null;
  lastMonth: string | null;
  createMissing: boolean;
  archiveRemoved: boolean;
  allowAutoLockedBackfill?: boolean;
  aliasEntries: PrepareBulkHistoryAliasEntry[];
}

export interface PrepareBulkHistoryImportResult {
  habitIdByCanonicalKey: Record<string, string>;
  createdHabits: HabitRecord[];
  archivedHabits: HabitRecord[];
  matchedTitleCount: number;
  skippedTitleCount: number;
  aliasCount: number;
}

export interface ImportBulkHistoryChunkEntry {
  habitId: string;
  dateKey: string;
  status: HabitLogStatus;
}

export interface ImportBulkHistoryChunkInput {
  entries: ImportBulkHistoryChunkEntry[];
  allowAutoLockedBackfill?: boolean;
}

export interface ImportBulkHistoryChunkResult {
  importedCount: number;
  syncedTaskCount: number;
  warnings: string[];
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
  settings: ClientHabitTrackerSettings;
  monthLock: MonthLockState;
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
  rateLimiter?: RateLimiter;
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
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(deps: HabitServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.habits = deps.habits ?? habitRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.projects = deps.projects ?? projectRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.now = deps.now ?? (() => Date.now());
  }

  private async assertMonthEditable(
    userId: string,
    timezone: string,
    yearMonth: string,
    executor?: DbExecutor
  ): Promise<void> {
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const settings = await this.habits.getOrCreateSettings(userId, executor);
    const lockRow = await this.habits.getMonthLock(userId, yearMonth, executor);
    const state = evaluateMonthLockState({
      yearMonth,
      todayDateKey,
      nowMs,
      settings,
      lockRow,
    });
    if (state.isLocked) {
      const monthLabel = buildMonthCalendar(yearMonth, 1).monthLabel;
      const reason =
        state.phase === "locked_manual" ? "locked_manual" : "locked_auto";
      throw new MonthLockedError({
        yearMonth,
        reason,
        message:
          reason === "locked_manual"
            ? `${monthLabel} is locked and read-only. Unlock it first to make edits.`
            : `${monthLabel} auto-locked after your ${state.graceDays}-day grace window. Unlock it first to make edits.`,
      });
    }
  }

  private async assertImportMonthsAllowed(
    userId: string,
    timezone: string,
    yearMonths: string[],
    allowAutoLockedBackfill: boolean,
    executor?: DbExecutor
  ): Promise<void> {
    const uniqueMonths = Array.from(new Set(yearMonths.filter(Boolean))).sort();
    if (uniqueMonths.length === 0) return;

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const settings = await this.habits.getOrCreateSettings(userId, executor);
    const lockRows = await this.habits.listMonthLocksForMonths(
      userId,
      uniqueMonths,
      executor
    );
    const lockByMonth = new Map(lockRows.map((row) => [row.yearMonth, row]));

    for (const ym of uniqueMonths) {
      const state = evaluateMonthLockState({
        yearMonth: ym,
        todayDateKey,
        nowMs,
        settings,
        lockRow: lockByMonth.get(ym) ?? null,
      });

      if (state.phase === "locked_manual") {
        const monthLabel = buildMonthCalendar(ym, 1).monthLabel;
        throw new MonthLockedError({
          yearMonth: ym,
          reason: "locked_manual",
          message: `${monthLabel} is manually locked. Unlock it first before importing history into it.`,
        });
      }

      if (state.phase === "locked_auto" && !allowAutoLockedBackfill) {
        const monthLabel = buildMonthCalendar(ym, 1).monthLabel;
        throw new MonthLockedError({
          yearMonth: ym,
          reason: "locked_auto",
          message: `${monthLabel} is auto-locked. Check "Include past months during historical import" or unlock it first.`,
        });
      }
    }
  }

  private async verifyPinWithBruteForceProtection(
    userId: string,
    settings: HabitTrackerSettingsRecord,
    candidatePin: string | undefined,
    executor?: DbExecutor
  ): Promise<void> {
    const nowMs = this.now();
    if (
      settings.monthLockPinLockedUntil !== null &&
      settings.monthLockPinLockedUntil > nowMs
    ) {
      const waitMinutes = Math.max(
        1,
        Math.ceil((settings.monthLockPinLockedUntil - nowMs) / 60_000)
      );
      throw new RateLimitError({
        message: `PIN temporarily locked after repeated failures. Try again in ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((settings.monthLockPinLockedUntil - nowMs) / 1000)
        ),
        limit: PIN_LOCKOUT_THRESHOLD,
        remaining: 0,
        resetAtMs: settings.monthLockPinLockedUntil,
      });
    }

    const rate = await this.rateLimiter.limit("habit_month_pin", userId);
    if (!rate.allowed) {
      throw new RateLimitError({
        message: `Too many PIN attempts. Please retry in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        limit: rate.limit,
        remaining: rate.remaining,
        resetAtMs: rate.resetAtMs,
      });
    }

    const trimmed = candidatePin?.trim() ?? "";
    if (!trimmed) {
      throw new ValidationError(
        "Enter your 4–6 digit Accountability PIN to continue."
      );
    }

    const valid =
      Boolean(settings.monthLockPinHash && settings.monthLockPinSalt) &&
      verifyMonthLockPin(
        trimmed,
        settings.monthLockPinHash!,
        settings.monthLockPinSalt!
      );

    if (!valid) {
      const failure = await withDbRetry(() =>
        this.habits.recordPinFailureAtomically(
          userId,
          {
            threshold: PIN_LOCKOUT_THRESHOLD,
            lockDurationMs: PIN_LOCKOUT_DURATION_MS,
            nowMs,
          },
          executor
        )
      );
      if (failure.lockedOut) {
        throw new RateLimitError({
          message:
            "Too many incorrect PIN attempts. PIN entry is locked for 15 minutes.",
          retryAfterSeconds: Math.ceil(PIN_LOCKOUT_DURATION_MS / 1000),
          limit: PIN_LOCKOUT_THRESHOLD,
          remaining: 0,
          resetAtMs: failure.lockedUntil ?? nowMs + PIN_LOCKOUT_DURATION_MS,
        });
      }
      const attemptsLeft = Math.max(
        1,
        PIN_LOCKOUT_THRESHOLD - failure.failedAttempts
      );
      throw new ValidationError(
        `Incorrect Accountability PIN (${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining).`
      );
    }

    if (
      settings.monthLockPinFailedAttempts > 0 ||
      settings.monthLockPinLockedUntil !== null
    ) {
      await withDbRetry(() =>
        this.habits.updatePinFailureState(
          userId,
          {
            failedAttempts: 0,
            lockedUntil: null,
            nowMs,
          },
          executor
        )
      );
    }
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
      monthLockRow,
    ] = await Promise.all([
      this.habits.getOrCreateSettings(userId),
      this.habits.listHabitsForUser(userId, { includeArchived: true }),
      this.habits.listMonthRosterHabitIds(userId, yearMonth),
      this.habits.hasAnyMonthRosterForUser(userId),
      this.habits.findLatestMonthRosterBefore(userId, yearMonth),
      this.habits.getMonthLock(userId, yearMonth),
    ]);

    const monthLock = evaluateMonthLockState({
      yearMonth,
      todayDateKey,
      nowMs,
      settings,
      lockRow: monthLockRow,
    });

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
      settings: sanitizeHabitTrackerSettings(settings),
      monthLock,
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
        if (targetYearMonth) {
          await this.assertMonthEditable(userId, timezone, targetYearMonth, tx);
        }
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
        await this.assertMonthEditable(userId, timezone, input.yearMonth, tx);
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
        await this.assertMonthEditable(
          userId,
          timezone,
          input.targetYearMonth,
          tx
        );
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
        await this.assertMonthEditable(userId, timezone, input.yearMonth, tx);
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

  async getSettings(userId: string): Promise<ClientHabitTrackerSettings> {
    const raw = await this.habits.getOrCreateSettings(userId);
    return sanitizeHabitTrackerSettings(raw);
  }

  async updateSettings(
    userId: string,
    input: UpdateHabitSettingsInput
  ): Promise<ClientHabitTrackerSettings> {
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

    if (input.monthLockEnabled !== undefined) {
      patch.monthLockEnabled = Boolean(input.monthLockEnabled);
    }

    if (input.monthLockGraceDays !== undefined) {
      if (
        !Number.isInteger(input.monthLockGraceDays) ||
        input.monthLockGraceDays < 0 ||
        input.monthLockGraceDays > 14
      ) {
        throw new ValidationError(
          "Month-lock grace window must be a whole number between 0 and 14 days."
        );
      }
      patch.monthLockGraceDays = clampGraceDays(input.monthLockGraceDays);
    }

    // Security: when an Accountability PIN is configured, require PIN verification
    // before disabling month locks or extending the auto-lock grace window.
    if (
      patch.monthLockEnabled === false ||
      patch.monthLockGraceDays !== undefined
    ) {
      const currentSettings = await this.habits.getOrCreateSettings(userId);
      const hasPin = Boolean(
        currentSettings.monthLockPinHash && currentSettings.monthLockPinSalt
      );
      const weakeningLock =
        (patch.monthLockEnabled === false && currentSettings.monthLockEnabled) ||
        (patch.monthLockGraceDays !== undefined &&
          patch.monthLockGraceDays > currentSettings.monthLockGraceDays);
      if (hasPin && weakeningLock) {
        await this.verifyPinWithBruteForceProtection(
          userId,
          currentSettings,
          input.currentPin
        );
      }
    }

    const updated = await withDbRetry(() =>
      this.habits.updateSettings(userId, patch)
    );
    return sanitizeHabitTrackerSettings(updated);
  }

  async lockMonth(
    userId: string,
    timezone: string,
    yearMonth: string
  ): Promise<MonthLockState> {
    if (!isValidYearMonth(yearMonth)) {
      throw new ValidationError("Month must be in YYYY-MM format.");
    }
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const currentMonth = todayDateKey.slice(0, 7);
    if (yearMonth > currentMonth) {
      throw new ValidationError(
        "Future months cannot be locked before they begin."
      );
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const settings = await this.habits.getOrCreateSettings(userId, tx);
        const existingLock = await this.habits.getMonthLock(
          userId,
          yearMonth,
          tx
        );
        const currentState = evaluateMonthLockState({
          yearMonth,
          todayDateKey,
          nowMs,
          settings,
          lockRow: existingLock,
        });

        if (currentState.phase === "locked_manual") {
          return currentState;
        }
        if (!currentState.canLockNow && !currentState.isLocked) {
          throw new ValidationError(
            "You can lock a month on its final day or after the month has ended."
          );
        }

        const saved = await this.habits.upsertMonthLock(
          {
            userId,
            yearMonth,
            status: "locked",
            lockedAt: existingLock?.lockedAt ?? nowMs,
            unlockedAt: existingLock?.unlockedAt ?? null,
            unlockedUntil: null,
            unlockReason: existingLock?.unlockReason ?? null,
            unlockCount: existingLock?.unlockCount ?? 0,
            updatedAt: nowMs,
          },
          tx
        );

        return evaluateMonthLockState({
          yearMonth,
          todayDateKey,
          nowMs,
          settings,
          lockRow: saved,
        });
      })
    );
  }

  async unlockMonth(
    userId: string,
    timezone: string,
    input: { yearMonth: string; pin?: string; reason?: string }
  ): Promise<MonthLockState> {
    if (!isValidYearMonth(input.yearMonth)) {
      throw new ValidationError("Month must be in YYYY-MM format.");
    }
    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);

    const [settings, existingLock] = await Promise.all([
      this.habits.getOrCreateSettings(userId),
      this.habits.getMonthLock(userId, input.yearMonth),
    ]);
    const currentState = evaluateMonthLockState({
      yearMonth: input.yearMonth,
      todayDateKey,
      nowMs,
      settings,
      lockRow: existingLock,
    });

    if (!currentState.isLocked) {
      return currentState;
    }

    // Verify Accountability PIN outside the write transaction so failed-attempt
    // counters persist immediately even when verification throws.
    if (settings.monthLockPinHash && settings.monthLockPinSalt) {
      await this.verifyPinWithBruteForceProtection(userId, settings, input.pin);
    }

    const cleanedReason = input.reason?.trim().slice(0, 200) || null;
    const saved = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const latestLock = await this.habits.getMonthLock(
          userId,
          input.yearMonth,
          tx
        );
        const preservedManualLockedAt =
          latestLock?.lockedAt ??
          (currentState.phase === "locked_manual" ? nowMs : null);
        return this.habits.unlockMonthAtomically(
          {
            userId,
            yearMonth: input.yearMonth,
            lockedAt: preservedManualLockedAt,
            unlockedAt: nowMs,
            unlockedUntil: nowMs + TEMP_UNLOCK_DURATION_MS,
            unlockReason: cleanedReason,
            updatedAt: nowMs,
          },
          tx
        );
      })
    );

    return evaluateMonthLockState({
      yearMonth: input.yearMonth,
      todayDateKey,
      nowMs,
      settings,
      lockRow: saved,
    });
  }

  async setMonthLockPin(
    userId: string,
    input: { currentPin?: string; newPin: string }
  ): Promise<ClientHabitTrackerSettings> {
    const newPin = input.newPin.trim();
    if (!isValidMonthLockPin(newPin)) {
      throw new ValidationError(
        "Accountability PIN must be 4 to 6 digits (numbers only)."
      );
    }

    const settings = await this.habits.getOrCreateSettings(userId);
    if (settings.monthLockPinHash && settings.monthLockPinSalt) {
      await this.verifyPinWithBruteForceProtection(
        userId,
        settings,
        input.currentPin
      );
    }

    const hashed = hashMonthLockPin(newPin);
    const updated = await withDbRetry(() =>
      this.habits.updateMonthLockPin(userId, {
        pinHash: hashed.hash,
        pinSalt: hashed.salt,
        nowMs: this.now(),
      })
    );
    return sanitizeHabitTrackerSettings(updated);
  }

  async removeMonthLockPin(
    userId: string,
    input: { currentPin: string }
  ): Promise<ClientHabitTrackerSettings> {
    const settings = await this.habits.getOrCreateSettings(userId);
    if (!settings.monthLockPinHash || !settings.monthLockPinSalt) {
      return sanitizeHabitTrackerSettings(settings);
    }

    await this.verifyPinWithBruteForceProtection(
      userId,
      settings,
      input.currentPin
    );

    const updated = await withDbRetry(() =>
      this.habits.updateMonthLockPin(userId, {
        pinHash: null,
        pinSalt: null,
        nowMs: this.now(),
      })
    );
    return sanitizeHabitTrackerSettings(updated);
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
        await this.assertMonthEditable(
          userId,
          timezone,
          input.dateKey.slice(0, 7),
          tx
        );
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
          await this.assertMonthEditable(
            userId,
            timezone,
            habitDateKey.slice(0, 7),
            tx
          );
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
        if (targetYearMonth) {
          await this.assertMonthEditable(userId, timezone, targetYearMonth, tx);
        }
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
   * Phase 1 of timeout-proof multi-year history imports: reconciles canonical
   * habits, creates missing rows, backfills `startDate` & archival flags in
   * 1 pipelined batch, persists `habit_import_aliases`, and validates month locks.
   */
  async prepareBulkHistoryImport(
    userId: string,
    timezone: string,
    input: PrepareBulkHistoryImportInput
  ): Promise<PrepareBulkHistoryImportResult> {
    if (input.habits.length === 0) {
      throw new ValidationError("Provide at least one habit to import.");
    }

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const currentMonth = todayDateKey.slice(0, 7);

    const validMonths = Array.from(
      new Set(input.months.filter((m) => isValidYearMonth(m)))
    ).sort();
    for (const ym of validMonths) {
      if (ym > currentMonth) {
        throw new ValidationError(
          `Future month "${ym}" cannot be imported before it begins.`
        );
      }
    }

    const allowAutoLockedBackfill = input.allowAutoLockedBackfill ?? true;
    await this.assertImportMonthsAllowed(
      userId,
      timezone,
      validMonths,
      allowAutoLockedBackfill
    );

    const groupByKey = new Map<
      string,
      {
        title: string;
        firstDate: string;
        lastDate: string;
        startDate: string;
        lastMonth: string;
        sourceTitleKeys: Set<string>;
      }
    >();

    for (const h of input.habits) {
      const cleanTitle = h.canonicalTitle.trim().slice(0, 120);
      if (!cleanTitle) continue;
      if (!isValidDateKey(h.firstDate) || !isValidDateKey(h.lastDate)) continue;
      const key = normalizeImportTitle(cleanTitle);
      const sourceKeys = new Set<string>([key]);
      for (const s of h.sourceTitles) {
        const norm = normalizeImportTitle(s);
        if (norm) sourceKeys.add(norm);
      }
      const existing = groupByKey.get(key);
      if (!existing) {
        groupByKey.set(key, {
          title: cleanTitle,
          firstDate: h.firstDate,
          lastDate: h.lastDate,
          startDate: h.firstDate,
          lastMonth: h.lastMonth,
          sourceTitleKeys: sourceKeys,
        });
      } else {
        for (const sk of sourceKeys) existing.sourceTitleKeys.add(sk);
        if (h.firstDate < existing.firstDate) {
          existing.firstDate = h.firstDate;
          existing.startDate = h.firstDate;
        }
        if (h.lastDate > existing.lastDate) {
          existing.lastDate = h.lastDate;
          existing.lastMonth = h.lastMonth;
        }
      }
    }

    const canonicalKeys = Array.from(groupByKey.keys());
    if (canonicalKeys.length === 0) {
      throw new ValidationError("No valid habit titles found to import.");
    }

    return withDbRetry(async () => {
      const [allHabits, existingAliases] = await Promise.all([
        this.habits.listHabitsForUser(userId, { includeArchived: true }),
        this.habits.listAliasesForUser(userId),
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
      const effectiveKeys = input.createMissing
        ? canonicalKeys
        : matchedKeys(canonicalKeys, habitByKey);

      let createdHabits: HabitRecord[] = [];
      if (input.createMissing && missingKeys.length > 0) {
        const positions = await this.allocateHabitPositions(
          userId,
          this.database,
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
          }))
        );
        for (const habit of createdHabits) {
          habitByKey.set(normalizeImportTitle(habit.title), habit);
        }
      }

      const hasMultipleMonths =
        input.firstMonth !== null &&
        input.lastMonth !== null &&
        input.firstMonth < input.lastMonth;

      const metadataPatches: HabitMetadataPatch[] = [];
      const archivedHabits: HabitRecord[] = [];

      for (const key of effectiveKeys) {
        const habit = habitByKey.get(key);
        const group = groupByKey.get(key);
        if (!habit || !group) continue;

        const patch: HabitMetadataPatch = { habitId: habit.id };
        if (group.startDate < habit.startDate) {
          patch.startDate = group.startDate;
        }
        if (input.archiveRemoved && hasMultipleMonths && input.lastMonth) {
          if (group.lastMonth < input.lastMonth && !habit.isArchived) {
            patch.isArchived = true;
            archivedHabits.push({
              ...habit,
              startDate: patch.startDate ?? habit.startDate,
              isArchived: true,
            });
          } else if (group.lastMonth === input.lastMonth && habit.isArchived) {
            patch.isArchived = false;
          }
        }
        if (patch.startDate !== undefined || patch.isArchived !== undefined) {
          metadataPatches.push(patch);
          habitByKey.set(key, {
            ...habit,
            ...(patch.startDate !== undefined
              ? { startDate: patch.startDate }
              : {}),
            ...(patch.isArchived !== undefined
              ? { isArchived: patch.isArchived }
              : {}),
          });
        }
      }

      if (metadataPatches.length > 0) {
        await this.habits.updateHabitsMetadataBatch(userId, metadataPatches);
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
      const seenAliasKeys = new Set<string>();

      for (const entry of input.aliasEntries) {
        const sourceKey = normalizeImportTitle(entry.sourceTitle);
        if (!sourceKey || seenAliasKeys.has(sourceKey)) continue;
        const canonicalKey = normalizeImportTitle(entry.canonicalTitle);
        const targetHabit = habitByKey.get(canonicalKey);
        if (!targetHabit) continue;
        const targetTitleKey = normalizeImportTitle(targetHabit.title);
        if (sourceKey === targetTitleKey || habitTitleKeys.has(sourceKey)) {
          continue;
        }
        seenAliasKeys.add(sourceKey);
        aliasInputs.push({
          userId,
          habitId: targetHabit.id,
          sourceTitle: entry.sourceTitle.slice(0, 120),
          normalizedTitle: sourceKey,
          firstSeenDateKey: entry.firstDate,
          lastSeenDateKey: entry.lastDate,
        });
      }

      const savedAliases =
        aliasInputs.length > 0
          ? await this.habits.upsertAliasesBatch(aliasInputs)
          : [];

      const habitIdByCanonicalKey: Record<string, string> = {};
      for (const key of effectiveKeys) {
        const habit = habitByKey.get(key);
        if (habit) {
          habitIdByCanonicalKey[key] = habit.id;
        }
      }

      return {
        habitIdByCanonicalKey,
        createdHabits,
        archivedHabits,
        matchedTitleCount,
        skippedTitleCount: canonicalKeys.length - effectiveKeys.length,
        aliasCount: savedAliases.length,
      };
    });
  }

  /**
   * Phase 2 of timeout-proof multi-year history imports: idempotently upserts
   * a bounded chunk (<= 2,000 marks) + per-month rosters in 1 pipelined
   * `db.batch()` HTTP call, preserves existing micro-notes, enforces ownership
   * & month locks, and short-circuits linked task sync.
   */
  async importBulkHistoryChunk(
    userId: string,
    timezone: string,
    input: ImportBulkHistoryChunkInput
  ): Promise<ImportBulkHistoryChunkResult> {
    if (input.entries.length === 0) {
      return { importedCount: 0, syncedTaskCount: 0, warnings: [] };
    }
    if (input.entries.length > 2_000) {
      throw new ValidationError(
        "Each history import chunk supports up to 2,000 completion marks."
      );
    }

    const nowMs = this.now();
    const todayDateKey = getLocalDateKey(nowMs, timezone);
    const warnings: string[] = [];
    const validEntries: ImportBulkHistoryChunkEntry[] = [];

    for (const entry of input.entries) {
      if (!isValidDateKey(entry.dateKey)) {
        warnings.push(`Ignored invalid date "${entry.dateKey}".`);
        continue;
      }
      if (isFutureDateKey(entry.dateKey, todayDateKey)) {
        warnings.push(`Ignored future date "${entry.dateKey}".`);
        continue;
      }
      validEntries.push(entry);
    }

    if (validEntries.length === 0) {
      return { importedCount: 0, syncedTaskCount: 0, warnings };
    }

    const chunkMonths = Array.from(
      new Set(validEntries.map((entry) => entry.dateKey.slice(0, 7)))
    );
    const allowAutoLockedBackfill = input.allowAutoLockedBackfill ?? true;

    return withDbRetry(async () => {
      // 1. Validate tenant ownership + month locks in parallel
      const [ownedHabits] = await Promise.all([
        this.habits.listHabitsForUser(userId, { includeArchived: true }),
        this.assertImportMonthsAllowed(
          userId,
          timezone,
          chunkMonths,
          allowAutoLockedBackfill
        ),
      ]);
      const ownedIds = new Set(ownedHabits.map((h) => h.id));

      for (const entry of validEntries) {
        if (!ownedIds.has(entry.habitId)) {
          throw new ForbiddenError(
            "One or more habits in this import chunk do not belong to your account."
          );
        }
      }

      let minDate = validEntries[0]!.dateKey;
      let maxDate = validEntries[0]!.dateKey;
      for (const entry of validEntries) {
        if (entry.dateKey < minDate) minDate = entry.dateKey;
        if (entry.dateKey > maxDate) maxDate = entry.dateKey;
      }

      // 2. Fetch ONLY existing non-null micro-notes (typically 0 rows on backfill)
      const existingNotes = await this.habits.listLogNotesForRange(
        userId,
        minDate,
        maxDate
      );
      const noteByKey = new Map(
        existingNotes.map((row) => [`${row.habitId}|${row.dateKey}`, row.note])
      );

      // Deduplicate by (habitId, dateKey) with deterministic precedence (done > skipped > missed)
      const deduped = new Map<
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

      for (const entry of validEntries) {
        const compositeKey = `${entry.habitId}|${entry.dateKey}`;
        const prev = deduped.get(compositeKey);
        if (
          prev &&
          MERGE_STATUS_PRIORITY[prev.status] >=
            MERGE_STATUS_PRIORITY[entry.status]
        ) {
          continue;
        }
        deduped.set(compositeKey, {
          habitId: entry.habitId,
          userId,
          dateKey: entry.dateKey,
          status: entry.status,
          note: noteByKey.get(compositeKey) ?? null,
          loggedAt: nowMs,
          isBackfilledLate: computeIsBackfilledLate(
            entry.dateKey,
            nowMs,
            timezone
          ),
        });
      }

      const logInputs = Array.from(deduped.values());
      const rosterEntries = logInputs.map((log) => ({
        userId,
        habitId: log.habitId,
        yearMonth: log.dateKey.slice(0, 7),
      }));

      // 3. Single pipelined atomic db.batch() write for logs + month rosters
      const importedCount = await this.habits.upsertLogsAndRostersPipelined(
        logInputs,
        rosterEntries
      );

      // 4. Short-circuited linked task sync (1 indexed SELECT -> 0 writes if no linked tasks)
      const syncedTaskCount = await this.tasks.syncLinkedTasksForHabitLogs({
        userId,
        nowMs,
        entries: logInputs.map((log) => ({
          habitId: log.habitId,
          dateKey: log.dateKey,
          completed: log.status === "done",
        })),
      });

      return {
        importedCount,
        syncedTaskCount,
        warnings,
      };
    });
  }

  /**
   * Imports a completion-history grid using the pipelined 2-phase chunk engine.
   * Source titles are resolved through detected renames and merges so one habit
   * keeps its history, start dates come from the first appearance, and habits
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

    const groupByKey = new Map<
      string,
      {
        canonicalTitle: string;
        firstDate: string;
        lastDate: string;
        lastMonth: string;
        sourceTitles: Set<string>;
      }
    >();
    const aliasMeta = new Map<
      string,
      { sourceTitle: string; canonicalTitle: string; firstDate: string; lastDate: string }
    >();
    const monthSet = new Set<string>();

    for (const row of resolvedRows) {
      const key = normalizeImportTitle(row.canonicalTitle);
      const ym = row.dateKey.slice(0, 7);
      monthSet.add(ym);

      const existing = groupByKey.get(key);
      if (!existing) {
        groupByKey.set(key, {
          canonicalTitle: row.canonicalTitle,
          firstDate: row.dateKey,
          lastDate: row.dateKey,
          lastMonth: ym,
          sourceTitles: new Set([row.canonicalTitle, row.title]),
        });
      } else {
        existing.sourceTitles.add(row.title);
        if (row.dateKey < existing.firstDate) existing.firstDate = row.dateKey;
        if (row.dateKey > existing.lastDate) {
          existing.lastDate = row.dateKey;
          existing.lastMonth = ym;
        }
      }

      const sourceKey = normalizeImportTitle(row.title);
      const existingAlias = aliasMeta.get(sourceKey);
      if (!existingAlias) {
        aliasMeta.set(sourceKey, {
          sourceTitle: row.title,
          canonicalTitle: row.canonicalTitle,
          firstDate: row.dateKey,
          lastDate: row.dateKey,
        });
      } else {
        if (row.dateKey < existingAlias.firstDate) {
          existingAlias.firstDate = row.dateKey;
        }
        if (row.dateKey > existingAlias.lastDate) {
          existingAlias.lastDate = row.dateKey;
        }
      }
    }

    for (const group of evolution.groups) {
      const entry = groupByKey.get(normalizeImportTitle(group.canonicalTitle));
      if (!entry) continue;
      if (group.lastMonth) {
        entry.lastMonth = group.lastMonth;
      }
      for (const sourceTitle of group.sourceTitles) {
        entry.sourceTitles.add(sourceTitle);
      }
    }

    const prepared = await this.prepareBulkHistoryImport(userId, timezone, {
      habits: Array.from(groupByKey.values()).map((g) => ({
        canonicalTitle: g.canonicalTitle,
        firstDate: g.firstDate,
        lastDate: g.lastDate,
        lastMonth: g.lastMonth,
        sourceTitles: Array.from(g.sourceTitles),
      })),
      months: Array.from(monthSet).sort(),
      firstMonth: evolution.firstMonth,
      lastMonth: evolution.lastMonth,
      createMissing: input.createMissing,
      archiveRemoved: input.archiveRemoved,
      allowAutoLockedBackfill: input.allowAutoLockedBackfill ?? true,
      aliasEntries: Array.from(aliasMeta.values()),
    });

    // Resolve and deduplicate across merged titles before chunking so exact
    // counts and precedence (done > skipped > missed) hold across chunk boundaries.
    const resolvedByComposite = new Map<string, ImportBulkHistoryChunkEntry>();
    for (const row of resolvedRows) {
      const habitId =
        prepared.habitIdByCanonicalKey[normalizeImportTitle(row.canonicalTitle)];
      if (!habitId) continue;
      const compositeKey = `${habitId}|${row.dateKey}`;
      const prev = resolvedByComposite.get(compositeKey);
      if (
        prev &&
        MERGE_STATUS_PRIORITY[prev.status] >= MERGE_STATUS_PRIORITY[row.status]
      ) {
        continue;
      }
      resolvedByComposite.set(compositeKey, {
        habitId,
        dateKey: row.dateKey,
        status: row.status,
      });
    }

    const dedupedEntries = Array.from(resolvedByComposite.values());
    let importedCount = 0;
    let syncedTaskCount = 0;

    for (
      let i = 0;
      i < dedupedEntries.length;
      i += MAX_HISTORY_IMPORT_CHUNK_SIZE
    ) {
      const slice = dedupedEntries.slice(i, i + MAX_HISTORY_IMPORT_CHUNK_SIZE);
      const chunkRes = await this.importBulkHistoryChunk(userId, timezone, {
        entries: slice,
        allowAutoLockedBackfill: input.allowAutoLockedBackfill ?? true,
      });
      importedCount += chunkRes.importedCount;
      syncedTaskCount += chunkRes.syncedTaskCount;
      warnings.push(...chunkRes.warnings);
    }

    return {
      importedCount,
      createdHabits: prepared.createdHabits,
      archivedHabits: prepared.archivedHabits,
      matchedTitleCount: prepared.matchedTitleCount,
      skippedTitleCount: prepared.skippedTitleCount,
      aliasCount: prepared.aliasCount,
      syncedTaskCount,
      evolution,
      warnings,
    };
  }
}

function matchedKeys(
  keys: string[],
  habitByKey: Map<string, HabitRecord>
): string[] {
  return keys.filter((key) => habitByKey.has(key));
}

export const habitService = new HabitService();
