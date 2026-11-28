import type { HabitCadenceType, HabitMissReason } from "@/server/db/schema/habits";
import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  getEffectiveHabitStatus,
  getEffectiveStatusMap,
  type EffectiveHabitStatus,
} from "@/server/domain/effectiveStatus";

export interface PhaseCDayHabit {
  id: string;
  title: string;
  cadenceType: HabitCadenceType;
  scheduledDaysJson: string;
  weeklyTargetCount: number | null;
  startDate: string;
  category?: string | null;
}

export interface PhaseCDayLog {
  habitId: string;
  dateKey: string;
  status: "done" | "missed" | "skipped";
  note?: string | null;
  missReason?: HabitMissReason | null;
  loggedAt?: number;
}

export interface PhaseCExcuseRange {
  startDate: string;
  endDate: string;
  habitIds: string[];
  deletedAt?: number | null;
}

export interface EffectiveDayLog {
  habitId: string;
  dateKey: string;
  status: "done" | "missed" | "skipped";
  note: string | null;
  missReason: HabitMissReason | null;
  loggedAt: number;
}

function toAnalyticsShape(habit: PhaseCDayHabit) {
  return {
    id: habit.id,
    title: habit.title,
    cadenceType: habit.cadenceType,
    scheduledDays: parseScheduledDaysJson(habit.scheduledDaysJson),
    weeklyTargetCount: habit.weeklyTargetCount,
    startDate: habit.startDate,
  };
}

/**
 * Rewrites raw logs through the single effective-status rule and adds neutral
 * `skipped` rows for excused dates without an explicit log. Existing analytics
 * can consume the result without changing its data shape.
 */
export function applyEffectiveStatusesToLogs(input: {
  habits: readonly PhaseCDayHabit[];
  dateKeys: readonly string[];
  logs: readonly PhaseCDayLog[];
  excuseRanges: readonly PhaseCExcuseRange[];
}): EffectiveDayLog[] {
  const rawByKey = new Map<string, PhaseCDayLog>();
  for (const log of input.logs) {
    rawByKey.set(`${log.habitId}|${log.dateKey}`, log);
  }

  const effectiveMap = getEffectiveStatusMap({
    habitIds: input.habits.map((habit) => habit.id),
    dateKeys: [...input.dateKeys],
    logs: input.logs.map((log) => ({
      habitId: log.habitId,
      dateKey: log.dateKey,
      status: log.status,
    })),
    excuseRanges: input.excuseRanges.map((range) => ({
      startDate: range.startDate,
      endDate: range.endDate,
      habitIds: range.habitIds,
      deletedAt: range.deletedAt,
    })),
  });

  const result: EffectiveDayLog[] = [];
  for (const habit of input.habits) {
    for (const dateKey of input.dateKeys) {
      const status = effectiveMap.get(`${habit.id}|${dateKey}`);
      if (!status) continue;
      const raw = rawByKey.get(`${habit.id}|${dateKey}`);
      result.push({
        habitId: habit.id,
        dateKey,
        status,
        note: raw?.note ?? null,
        missReason: raw?.missReason ?? null,
        loggedAt: raw?.loggedAt ?? 0,
      });
    }
  }
  return result;
}

export interface DayChecklistItem {
  habit: PhaseCDayHabit;
  scheduled: boolean;
  status: EffectiveHabitStatus;
  log: PhaseCDayLog | null;
}

/** Only scheduled habits (or habits with an effective status) appear on a day. */
export function buildDayChecklist(input: {
  habits: readonly PhaseCDayHabit[];
  dateKey: string;
  logs: readonly PhaseCDayLog[];
  excuseRanges: readonly PhaseCExcuseRange[];
}): DayChecklistItem[] {
  const logByHabit = new Map<string, PhaseCDayLog>();
  for (const log of input.logs) {
    if (log.dateKey === input.dateKey) logByHabit.set(log.habitId, log);
  }

  const items: DayChecklistItem[] = [];
  for (const habit of input.habits) {
    const log = logByHabit.get(habit.id) ?? null;
    const status = getEffectiveHabitStatus({
      habitId: habit.id,
      dateKey: input.dateKey,
      log: log
        ? { habitId: log.habitId, dateKey: log.dateKey, status: log.status }
        : null,
      excuseRanges: input.excuseRanges.map((range) => ({
        startDate: range.startDate,
        endDate: range.endDate,
        habitIds: range.habitIds,
        deletedAt: range.deletedAt,
      })),
    });
    const scheduled = isHabitScheduledOnDate(
      toAnalyticsShape(habit),
      input.dateKey
    );
    if (!scheduled && status === null) continue;
    items.push({ habit, scheduled, status, log });
  }
  return items;
}

export interface DayStreakHighlight {
  habitId: string;
  title: string;
  streak: number;
  streakUnit: "days" | "weeks";
  kind: "continued" | "rest-day";
}

export interface DayMissHighlight {
  habitId: string;
  title: string;
  reason: HabitMissReason | null;
}

export interface DayHighlights {
  score: number | null;
  monthAverage: number | null;
  deltaPoints: number | null;
  streaksKept: DayStreakHighlight[];
  misses: DayMissHighlight[];
}

export function computeDayHighlights(input: {
  checklist: readonly DayChecklistItem[];
  monthAverage: number | null;
  streakByHabitId: Record<
    string,
    { currentStreak: number; streakUnit: "days" | "weeks" } | undefined
  >;
}): DayHighlights {
  let done = 0;
  let missed = 0;
  const streaksKept: DayStreakHighlight[] = [];
  const misses: DayMissHighlight[] = [];

  for (const item of input.checklist) {
    const streak = input.streakByHabitId[item.habit.id];
    if (item.status === "done") {
      done += 1;
      if (streak && streak.currentStreak > 0) {
        streaksKept.push({
          habitId: item.habit.id,
          title: item.habit.title,
          streak: streak.currentStreak,
          streakUnit: streak.streakUnit,
          kind: "continued",
        });
      }
    } else if (item.status === "missed") {
      missed += 1;
      misses.push({
        habitId: item.habit.id,
        title: item.habit.title,
        reason: item.log?.missReason ?? null,
      });
    } else if (item.status === "skipped" && streak && streak.currentStreak > 0) {
      streaksKept.push({
        habitId: item.habit.id,
        title: item.habit.title,
        streak: streak.currentStreak,
        streakUnit: streak.streakUnit,
        kind: "rest-day",
      });
    }
  }

  const denominator = done + missed;
  const score = denominator === 0 ? null : done / denominator;
  const deltaPoints =
    score === null || input.monthAverage === null
      ? null
      : Math.round((score - input.monthAverage) * 1000) / 10;

  return { score, monthAverage: input.monthAverage, deltaPoints, streaksKept, misses };
}

/** Run habits are detected from canonical title/category; no schema change needed. */
export function resolveRunHabitIds(
  habits: readonly { id: string; title: string; category?: string | null }[]
): string[] {
  return habits
    .filter((habit) => /\brun(ning|s)?\b/i.test(`${habit.title} ${habit.category ?? ""}`))
    .map((habit) => habit.id);
}

export function getAdjacentDateKeys(
  dateKey: string,
  todayDateKey: string
): { previousDateKey: string; nextDateKey: string | null } {
  return {
    previousDateKey: addDaysToDateKey(dateKey, -1),
    nextDateKey: dateKey >= todayDateKey ? null : addDaysToDateKey(dateKey, 1),
  };
}

export function getWeekdayFromDateKey(dateKey: string): number {
  return getDayOfWeekFromDateKey(dateKey);
}
