import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type {
  HabitCadenceType,
  HabitLogStatus,
} from "@/server/db/schema/habits";

export type ScoringMode = "elapsed" | "full_month";

export interface AnalyticsHabitInput {
  id: string;
  title: string;
  cadenceType: HabitCadenceType;
  scheduledDays: number[]; // 0 (Sun) .. 6 (Sat)
  weeklyTargetCount: number | null;
  startDate: string; // YYYY-MM-DD
}

export interface AnalyticsHabitLogInput {
  habitId: string;
  dateKey: string; // YYYY-MM-DD
  status: HabitLogStatus;
  note?: string | null;
  isBackfilledLate?: boolean;
}

export interface CalendarDay {
  dateKey: string;
  dayOfMonth: number;
  dayOfWeek: number; // 0=Sun .. 6=Sat
  weekdayShort: string;
  weekdayLetter: string;
}

export interface CalendarWeek {
  weekIndex: number; // 1-based (1..6)
  label: string; // "W1" .. "W6"
  dateRangeLabel: string; // e.g. "Nov 2–8"
  startDateKey: string;
  endDateKey: string;
  days: CalendarDay[];
}

export interface MonthCalendar {
  yearMonth: string; // YYYY-MM
  year: number;
  month: number; // 1..12
  monthLabel: string; // e.g. "November 2026"
  shortMonthLabel: string; // e.g. "Nov"
  daysInMonth: number;
  monthStartKey: string;
  monthEndKey: string;
  days: CalendarDay[];
  weeks: CalendarWeek[];
}

export interface HabitRankHighlight {
  primaryTitle: string;
  tieCount: number; // number of OTHER habits tied at exact same rate
  tiedTitles: string[];
  rate: number; // 0..1
}

export interface HabitRowSummary {
  habitId: string;
  doneCount: number;
  missedCount: number;
  skippedCount: number;
  scheduledCount: number;
  elapsedScheduledDays: number;
  completionRate: number | null; // 0..1 or null if 0 effective denominator
  eligibleForRanking: boolean;
  currentStreak: number;
  bestStreak: number;
  streakUnit: "days" | "weeks";
}

export interface DailyCompletionPoint {
  dateKey: string;
  dayOfMonth: number;
  label: string; // "1" .. "31"
  doneCount: number;
  scheduledCount: number;
  completionRate: number | null; // 0..100 integer-rounded or null
  rolling7DayAvg: number | null; // 0..100 or null
  isFuture: boolean;
}

export interface WeeklyComparisonPoint {
  weekIndex: number;
  weekLabel: string; // "W1" .. "W6"
  dateRangeLabel: string;
  doneCount: number;
  targetCount: number;
  completionRate: number | null; // 0..100 or null
  deltaFromPrevPct: number | null; // percentage points vs previous week
}

export interface HabitMonthAnalytics {
  calendar: MonthCalendar;
  scoringMode: ScoringMode;
  todayDateKey: string;
  monthlyProgress: {
    rate: number | null; // 0..1
    completedUnits: number;
    targetUnits: number;
  };
  bestHabit: HabitRankHighlight | null;
  needsAttention: HabitRankHighlight | null;
  byHabitId: Record<string, HabitRowSummary>;
  dailySeries: DailyCompletionPoint[];
  weeklySeries: WeeklyComparisonPoint[];
}

export interface ParsedBulkHabitRow {
  title: string;
  category: string | null;
  cadenceType: HabitCadenceType;
  scheduledDays: number[];
  weeklyTargetCount: number | null;
  preferredTime: string | null;
}

export const MAX_BULK_IMPORT_HABITS = 50;
export const LATE_BACKFILL_THRESHOLD_MS = 48 * 60 * 60 * 1000;
export const MIN_RANKING_ELAPSED_DAYS = 3;

const WEEKDAY_SHORTS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTH_SHORTS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_REGEX.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidYearMonth(value: string): boolean {
  return YEAR_MONTH_REGEX.test(value);
}

export function isValidTimeHHmm(value: string): boolean {
  return TIME_HHMM_REGEX.test(value);
}

export function parseScheduledDaysJson(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const unique = new Set<number>();
    for (const item of parsed) {
      if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 6) {
        unique.add(item);
      }
    }
    return Array.from(unique).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function getLocalDateKey(
  utcMs: number,
  timezone: string = "UTC"
): string {
  try {
    return formatInTimeZone(utcMs, timezone, "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(utcMs, "UTC", "yyyy-MM-dd");
  }
}

export function getLocalYearMonth(
  utcMs: number,
  timezone: string = "UTC"
): string {
  return getLocalDateKey(utcMs, timezone).slice(0, 7);
}

export function getLocalTimeHHmm(
  utcMs: number,
  timezone: string = "UTC"
): string {
  try {
    return formatInTimeZone(utcMs, timezone, "HH:mm");
  } catch {
    return formatInTimeZone(utcMs, "UTC", "HH:mm");
  }
}

export function isFutureDateKey(dateKey: string, todayDateKey: string): boolean {
  return dateKey > todayDateKey;
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDayOfWeekFromDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + deltaMonths, 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns `true` when `loggedAtUtcMs` is strictly more than 48 hours past the
 * local end-of-day (`23:59:59.999`) of `dateKey` in the owner's IANA timezone.
 */
export function computeIsBackfilledLate(
  dateKey: string,
  loggedAtUtcMs: number,
  timezone: string = "UTC"
): boolean {
  if (!isValidDateKey(dateKey)) return false;
  let endOfDayUtcMs: number;
  try {
    endOfDayUtcMs = fromZonedTime(`${dateKey}T23:59:59.999`, timezone).getTime();
  } catch {
    endOfDayUtcMs = fromZonedTime(`${dateKey}T23:59:59.999`, "UTC").getTime();
  }
  if (!Number.isFinite(endOfDayUtcMs)) return false;
  return loggedAtUtcMs - endOfDayUtcMs > LATE_BACKFILL_THRESHOLD_MS;
}

/**
 * Builds an exact calendar grid for `yearMonth` (`YYYY-MM`) including ALL real
 * days (`1..28/29/30/31`) grouped into real calendar weeks aligned to
 * `weekStartsOn` (`0` = Sunday, `1` = Monday).
 */
export function buildMonthCalendar(
  yearMonth: string,
  weekStartsOn: 0 | 1 = 1
): MonthCalendar {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`Invalid yearMonth "${yearMonth}". Expected YYYY-MM.`);
  }

  const [yearNum, monthNum] = yearMonth.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const mm = String(monthNum).padStart(2, "0");
  const shortMonth = MONTH_SHORTS[monthNum - 1]!;
  const fullMonth = MONTH_NAMES[monthNum - 1]!;

  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, "0");
    const dateKey = `${yearNum}-${mm}-${dd}`;
    const dayOfWeek = new Date(Date.UTC(yearNum, monthNum - 1, d)).getUTCDay();
    days.push({
      dateKey,
      dayOfMonth: d,
      dayOfWeek,
      weekdayShort: WEEKDAY_SHORTS[dayOfWeek]!,
      weekdayLetter: WEEKDAY_LETTERS[dayOfWeek]!,
    });
  }

  const weeks: CalendarWeek[] = [];
  let currentDays: CalendarDay[] = [];

  for (const day of days) {
    if (currentDays.length > 0 && day.dayOfWeek === weekStartsOn) {
      const first = currentDays[0]!;
      const last = currentDays[currentDays.length - 1]!;
      const weekIndex = weeks.length + 1;
      weeks.push({
        weekIndex,
        label: `W${weekIndex}`,
        dateRangeLabel:
          first.dayOfMonth === last.dayOfMonth
            ? `${shortMonth} ${first.dayOfMonth}`
            : `${shortMonth} ${first.dayOfMonth}–${last.dayOfMonth}`,
        startDateKey: first.dateKey,
        endDateKey: last.dateKey,
        days: currentDays,
      });
      currentDays = [day];
    } else {
      currentDays.push(day);
    }
  }

  if (currentDays.length > 0) {
    const first = currentDays[0]!;
    const last = currentDays[currentDays.length - 1]!;
    const weekIndex = weeks.length + 1;
    weeks.push({
      weekIndex,
      label: `W${weekIndex}`,
      dateRangeLabel:
        first.dayOfMonth === last.dayOfMonth
          ? `${shortMonth} ${first.dayOfMonth}`
          : `${shortMonth} ${first.dayOfMonth}–${last.dayOfMonth}`,
      startDateKey: first.dateKey,
      endDateKey: last.dateKey,
      days: currentDays,
    });
  }

  return {
    yearMonth,
    year: yearNum,
    month: monthNum,
    monthLabel: `${fullMonth} ${yearNum}`,
    shortMonthLabel: shortMonth,
    daysInMonth,
    monthStartKey: days[0]!.dateKey,
    monthEndKey: days[days.length - 1]!.dateKey,
    days,
    weeks,
  };
}

export function isHabitScheduledOnDate(
  habit: Pick<AnalyticsHabitInput, "cadenceType" | "scheduledDays" | "startDate">,
  dateKey: string
): boolean {
  if (dateKey < habit.startDate) return false;
  if (habit.cadenceType === "daily") return true;
  if (habit.cadenceType === "weekly_target") return true;
  const dow = getDayOfWeekFromDateKey(dateKey);
  return habit.scheduledDays.includes(dow);
}

function getWeekStartDateKey(dateKey: string, weekStartsOn: 0 | 1): string {
  const dow = getDayOfWeekFromDateKey(dateKey);
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDaysToDateKey(dateKey, -diff);
}

/**
 * Computes `currentStreak` and `bestStreak` up to `todayDateKey`:
 * - For `daily` and `specific_days`: consecutive scheduled days in days,
 *   honoring `'skipped'` rest passes without breaking the streak, and never
 *   penalizing an unlogged `todayDateKey`.
 * - For `weekly_target`: consecutive calendar weeks meeting the effective
 *   weekly target (`min(weeklyTargetCount, nonSkippedActiveDaysInWeek)`).
 */
export function computeHabitStreaks(
  habit: AnalyticsHabitInput,
  logsByDate: Map<string, HabitLogStatus>,
  todayDateKey: string,
  weekStartsOn: 0 | 1 = 1
): { currentStreak: number; bestStreak: number; streakUnit: "days" | "weeks" } {
  if (habit.startDate > todayDateKey) {
    return {
      currentStreak: 0,
      bestStreak: 0,
      streakUnit: habit.cadenceType === "weekly_target" ? "weeks" : "days",
    };
  }

  if (habit.cadenceType === "weekly_target") {
    const targetCount = Math.max(1, Math.min(7, habit.weeklyTargetCount ?? 3));
    const firstWeekStart = getWeekStartDateKey(habit.startDate, weekStartsOn);
    const currentWeekStart = getWeekStartDateKey(todayDateKey, weekStartsOn);

    let running = 0;
    let best = 0;
    let cursorWeek = firstWeekStart;
    let guard = 0;

    while (cursorWeek <= currentWeekStart && guard < 600) {
      guard += 1;
      const weekEnd = addDaysToDateKey(cursorWeek, 6);
      const isCurrentWeek = cursorWeek === currentWeekStart;

      let activeDays = 0;
      let skippedDays = 0;
      let doneDays = 0;

      for (let offset = 0; offset < 7; offset++) {
        const dKey = addDaysToDateKey(cursorWeek, offset);
        if (dKey < habit.startDate || dKey > todayDateKey) continue;
        activeDays += 1;
        const st = logsByDate.get(dKey);
        if (st === "done") doneDays += 1;
        else if (st === "skipped") skippedDays += 1;
      }

      const nonSkippedActive = Math.max(0, activeDays - skippedDays);
      // Full past weeks use full weeklyTargetCount (capped by active non-skipped days for partial start week)
      const effectiveTarget = Math.min(targetCount, nonSkippedActive);

      if (effectiveTarget > 0) {
        if (doneDays >= effectiveTarget) {
          running += 1;
          if (running > best) best = running;
        } else if (!isCurrentWeek && weekEnd < todayDateKey) {
          running = 0;
        }
      }

      cursorWeek = addDaysToDateKey(cursorWeek, 7);
    }

    return { currentStreak: running, bestStreak: best, streakUnit: "weeks" };
  }

  let running = 0;
  let best = 0;
  let cursor = habit.startDate;
  let guard = 0;

  while (cursor <= todayDateKey && guard < 2_000) {
    guard += 1;
    if (isHabitScheduledOnDate(habit, cursor)) {
      const status = logsByDate.get(cursor);
      if (status === "done") {
        running += 1;
        if (running > best) best = running;
      } else if (status === "skipped") {
        // Rest/pass day preserves active streak without incrementing
      } else if (status === "missed") {
        running = 0;
      } else if (cursor < todayDateKey) {
        // Unlogged past scheduled day resets streak; unlogged today does not break yesterday's streak yet
        running = 0;
      }
    }
    cursor = addDaysToDateKey(cursor, 1);
  }

  return { currentStreak: running, bestStreak: best, streakUnit: "days" };
}

export function computeHabitMonthAnalytics(params: {
  yearMonth: string;
  todayDateKey: string;
  weekStartsOn: 0 | 1;
  scoringMode: ScoringMode;
  habits: AnalyticsHabitInput[];
  logs: AnalyticsHabitLogInput[];
}): HabitMonthAnalytics {
  const { yearMonth, todayDateKey, weekStartsOn, scoringMode, habits, logs } =
    params;
  const calendar = buildMonthCalendar(yearMonth, weekStartsOn);

  // Index logs by habitId -> dateKey -> status
  const logsByHabit = new Map<string, Map<string, HabitLogStatus>>();
  for (const log of logs) {
    let map = logsByHabit.get(log.habitId);
    if (!map) {
      map = new Map<string, HabitLogStatus>();
      logsByHabit.set(log.habitId, map);
    }
    map.set(log.dateKey, log.status);
  }

  const effectiveMonthEnd =
    scoringMode === "elapsed"
      ? todayDateKey < calendar.monthEndKey
        ? todayDateKey
        : calendar.monthEndKey
      : calendar.monthEndKey;

  const elapsedEnd =
    todayDateKey < calendar.monthEndKey ? todayDateKey : calendar.monthEndKey;

  const byHabitId: Record<string, HabitRowSummary> = {};
  let overallCompletedUnits = 0;
  let overallTargetUnits = 0;

  // Track per-week aggregate numerators/denominators across all habits
  const weekTotals = calendar.weeks.map(() => ({ achieved: 0, target: 0 }));

  for (const habit of habits) {
    const habitLogsMap = logsByHabit.get(habit.id) ?? new Map<string, HabitLogStatus>();
    const streaks = computeHabitStreaks(
      habit,
      habitLogsMap,
      todayDateKey,
      weekStartsOn
    );

    const rangeStart =
      habit.startDate > calendar.monthStartKey
        ? habit.startDate
        : calendar.monthStartKey;

    let doneCount = 0;
    let missedCount = 0;
    let skippedCount = 0;
    let scheduledCount = 0;
    let elapsedScheduledDays = 0;

    // Count elapsed scheduled non-skipped days strictly up to min(monthEnd, todayDateKey)
    if (rangeStart <= elapsedEnd) {
      for (const day of calendar.days) {
        if (day.dateKey < rangeStart || day.dateKey > elapsedEnd) continue;
        if (!isHabitScheduledOnDate(habit, day.dateKey)) continue;
        const st = habitLogsMap.get(day.dateKey);
        if (st !== "skipped") {
          elapsedScheduledDays += 1;
        }
      }
    }

    let completionRate: number | null = null;

    if (rangeStart <= effectiveMonthEnd) {
      if (habit.cadenceType === "weekly_target") {
        const weeklyTarget = Math.max(
          1,
          Math.min(7, habit.weeklyTargetCount ?? 3)
        );
        let habitAchievedUnits = 0;
        let habitTargetUnits = 0;

        calendar.weeks.forEach((week, wIdx) => {
          let activeInWeek = 0;
          let skippedInWeek = 0;
          let doneInWeek = 0;
          let missedInWeek = 0;

          for (const day of week.days) {
            if (day.dateKey < rangeStart || day.dateKey > effectiveMonthEnd) {
              continue;
            }
            activeInWeek += 1;
            const st = habitLogsMap.get(day.dateKey);
            if (st === "done") doneInWeek += 1;
            else if (st === "skipped") skippedInWeek += 1;
            else if (st === "missed") missedInWeek += 1;
          }

          doneCount += doneInWeek;
          skippedCount += skippedInWeek;
          missedCount += missedInWeek;

          const availableInWeek = Math.max(0, activeInWeek - skippedInWeek);
          const effectiveWeekTarget = Math.min(weeklyTarget, availableInWeek);
          if (effectiveWeekTarget > 0) {
            const achievedInWeek = Math.min(doneInWeek, effectiveWeekTarget);
            habitAchievedUnits += achievedInWeek;
            habitTargetUnits += effectiveWeekTarget;
            weekTotals[wIdx]!.achieved += achievedInWeek;
            weekTotals[wIdx]!.target += effectiveWeekTarget;
          }
        });

        scheduledCount = habitTargetUnits;
        if (habitTargetUnits > 0) {
          completionRate = Math.min(habitAchievedUnits / habitTargetUnits, 1);
          overallCompletedUnits += habitAchievedUnits;
          overallTargetUnits += habitTargetUnits;
        }
      } else {
        calendar.weeks.forEach((week, wIdx) => {
          let weekDone = 0;
          let weekEffectiveScheduled = 0;

          for (const day of week.days) {
            if (day.dateKey < rangeStart || day.dateKey > effectiveMonthEnd) {
              continue;
            }
            if (!isHabitScheduledOnDate(habit, day.dateKey)) continue;

            const st = habitLogsMap.get(day.dateKey);
            if (st === "skipped") {
              skippedCount += 1;
              continue;
            }
            weekEffectiveScheduled += 1;
            if (st === "done") {
              doneCount += 1;
              weekDone += 1;
            } else if (st === "missed") {
              missedCount += 1;
            }
          }

          scheduledCount += weekEffectiveScheduled;
          weekTotals[wIdx]!.achieved += weekDone;
          weekTotals[wIdx]!.target += weekEffectiveScheduled;
        });

        if (scheduledCount > 0) {
          completionRate = Math.min(doneCount / scheduledCount, 1);
          overallCompletedUnits += doneCount;
          overallTargetUnits += scheduledCount;
        }
      }
    }

    byHabitId[habit.id] = {
      habitId: habit.id,
      doneCount,
      missedCount,
      skippedCount,
      scheduledCount,
      elapsedScheduledDays,
      completionRate,
      eligibleForRanking:
        elapsedScheduledDays >= MIN_RANKING_ELAPSED_DAYS &&
        completionRate !== null,
      currentStreak: streaks.currentStreak,
      bestStreak: streaks.bestStreak,
      streakUnit: streaks.streakUnit,
    };
  }

  // Headline KPI: Best Habit & Needs Attention (zero tie bugs)
  const eligible = habits
    .map((h) => ({
      habit: h,
      summary: byHabitId[h.id]!,
    }))
    .filter(
      (entry) =>
        entry.summary.eligibleForRanking &&
        entry.summary.completionRate !== null
    );

  let bestHabit: HabitRankHighlight | null = null;
  let needsAttention: HabitRankHighlight | null = null;

  if (eligible.length > 0) {
    const rates = eligible.map((e) => e.summary.completionRate!);
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);

    const bestTied = eligible.filter(
      (e) => Math.abs(e.summary.completionRate! - maxRate) < 1e-9
    );
    bestHabit = {
      primaryTitle: bestTied[0]!.habit.title,
      tieCount: bestTied.length - 1,
      tiedTitles: bestTied.map((e) => e.habit.title),
      rate: maxRate,
    };

    // Never show the same habit in both Best and Needs Attention when all are tied or <2 eligible
    if (eligible.length >= 2 && Math.abs(maxRate - minRate) >= 1e-9) {
      const worstTied = eligible.filter(
        (e) => Math.abs(e.summary.completionRate! - minRate) < 1e-9
      );
      needsAttention = {
        primaryTitle: worstTied[0]!.habit.title,
        tieCount: worstTied.length - 1,
        tiedTitles: worstTied.map((e) => e.habit.title),
        rate: minRate,
      };
    }
  }

  // Daily series across ALL 28..31 days of the real calendar month + 7-day rolling average
  const dailySeries: DailyCompletionPoint[] = [];
  for (let i = 0; i < calendar.days.length; i++) {
    const day = calendar.days[i]!;
    const isFuture = day.dateKey > todayDateKey;

    if (isFuture && scoringMode === "elapsed") {
      dailySeries.push({
        dateKey: day.dateKey,
        dayOfMonth: day.dayOfMonth,
        label: String(day.dayOfMonth),
        doneCount: 0,
        scheduledCount: 0,
        completionRate: null,
        rolling7DayAvg: null,
        isFuture: true,
      });
      continue;
    }

    let dayDone = 0;
    let dayScheduled = 0;

    for (const habit of habits) {
      if (!isHabitScheduledOnDate(habit, day.dateKey)) continue;
      const st = logsByHabit.get(habit.id)?.get(day.dateKey);
      if (st === "skipped") continue;
      dayScheduled += 1;
      if (st === "done") dayDone += 1;
    }

    const ratePct =
      dayScheduled > 0 ? Math.round((dayDone / dayScheduled) * 100) : null;

    // 7-day rolling average over trailing non-null daily rates [i-6..i]
    const windowRates: number[] = [];
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      const val = j === i ? ratePct : dailySeries[j]?.completionRate ?? null;
      if (val !== null) windowRates.push(val);
    }
    const rolling7DayAvg =
      windowRates.length > 0 && ratePct !== null
        ? Math.round(
            windowRates.reduce((acc, v) => acc + v, 0) / windowRates.length
          )
        : null;

    dailySeries.push({
      dateKey: day.dateKey,
      dayOfMonth: day.dayOfMonth,
      label: String(day.dayOfMonth),
      doneCount: dayDone,
      scheduledCount: dayScheduled,
      completionRate: ratePct,
      rolling7DayAvg,
      isFuture,
    });
  }

  // Weekly comparison series (W1..W5/W6) with week-over-week percentage-point deltas
  const weeklySeries: WeeklyComparisonPoint[] = calendar.weeks.map(
    (week, idx) => {
      const totals = weekTotals[idx]!;
      const ratePct =
        totals.target > 0
          ? Math.round(Math.min(totals.achieved / totals.target, 1) * 100)
          : null;
      return {
        weekIndex: week.weekIndex,
        weekLabel: week.label,
        dateRangeLabel: week.dateRangeLabel,
        doneCount: totals.achieved,
        targetCount: totals.target,
        completionRate: ratePct,
        deltaFromPrevPct: null,
      };
    }
  );

  for (let i = 1; i < weeklySeries.length; i++) {
    const prev = weeklySeries[i - 1]!.completionRate;
    const curr = weeklySeries[i]!.completionRate;
    if (prev !== null && curr !== null) {
      weeklySeries[i]!.deltaFromPrevPct = curr - prev;
    }
  }

  return {
    calendar,
    scoringMode,
    todayDateKey,
    monthlyProgress: {
      rate:
        overallTargetUnits > 0
          ? Math.min(overallCompletedUnits / overallTargetUnits, 1)
          : null,
      completedUnits: overallCompletedUnits,
      targetUnits: overallTargetUnits,
    },
    bestHabit,
    needsAttention,
    byHabitId,
    dailySeries,
    weeklySeries,
  };
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses newline-separated habit titles or CSV lines (`title,category,cadence,preferredTime`)
 * into validated habit definitions (max 50 rows).
 */
export function parseBulkHabitImport(rawText: string): {
  rows: ParsedBulkHabitRow[];
  error?: string;
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], error: "Paste at least one habit title to import." };
  }

  // Drop optional CSV header row
  const firstLower = lines[0]!.toLowerCase();
  const dataLines =
    firstLower.startsWith("title,") ||
    firstLower === "title" ||
    firstLower.startsWith("habit,") ||
    firstLower === "habit"
      ? lines.slice(1)
      : lines;

  if (dataLines.length === 0) {
    return { rows: [], error: "No habit rows found after header." };
  }

  if (dataLines.length > MAX_BULK_IMPORT_HABITS) {
    return {
      rows: [],
      error: `Bulk import supports up to ${MAX_BULK_IMPORT_HABITS} habits at once (found ${dataLines.length}).`,
    };
  }

  const seenTitles = new Set<string>();
  const rows: ParsedBulkHabitRow[] = [];

  for (const line of dataLines) {
    const parts = splitCsvLine(line);
    const title = (parts[0] ?? "").trim().slice(0, 120);
    if (!title) continue;

    const dedupeKey = title.toLowerCase();
    if (seenTitles.has(dedupeKey)) continue;
    seenTitles.add(dedupeKey);

    const category = (parts[1] ?? "").trim().slice(0, 48) || null;
    const rawCadence = (parts[2] ?? "").trim().toLowerCase();
    const rawTime = (parts[3] ?? "").trim();

    let cadenceType: HabitCadenceType = "daily";
    let scheduledDays: number[] = [];
    let weeklyTargetCount: number | null = null;

    const weeklyMatch = rawCadence.match(/^([1-7])\s*(?:x|\/w|\/week|per week)?$/);
    if (rawCadence === "weekdays" || rawCadence === "mon-fri") {
      cadenceType = "specific_days";
      scheduledDays = [1, 2, 3, 4, 5];
    } else if (rawCadence === "weekends") {
      cadenceType = "specific_days";
      scheduledDays = [0, 6];
    } else if (weeklyMatch) {
      cadenceType = "weekly_target";
      weeklyTargetCount = Number(weeklyMatch[1]);
    } else if (rawCadence.startsWith("weekly:")) {
      const n = Number(rawCadence.replace("weekly:", ""));
      if (Number.isInteger(n) && n >= 1 && n <= 7) {
        cadenceType = "weekly_target";
        weeklyTargetCount = n;
      }
    }

    const preferredTime = isValidTimeHHmm(rawTime) ? rawTime : null;

    rows.push({
      title,
      category,
      cadenceType,
      scheduledDays,
      weeklyTargetCount,
      preferredTime,
    });
  }

  if (rows.length === 0) {
    return { rows: [], error: "No valid habit titles found." };
  }

  return { rows };
}
