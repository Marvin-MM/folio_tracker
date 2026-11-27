import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  isValidDateKey,
} from "@/server/domain/habit-analytics";

export interface GroupWeek {
  cycleKey: string;
  periodStartDate: string;
  periodEndDate: string;
}

/**
 * Group reviews are anchored to ISO-style Monday weeks so every member sees
 * the same board regardless of their personal `weekStartsOn` preference.
 */
export function getGroupWeek(dateKey: string): GroupWeek {
  const dow = getDayOfWeekFromDateKey(dateKey);
  const daysSinceMonday = (dow + 6) % 7;
  const periodStartDate = addDaysToDateKey(dateKey, -daysSinceMonday);
  return {
    cycleKey: `week-${periodStartDate}`,
    periodStartDate,
    periodEndDate: addDaysToDateKey(periodStartDate, 6),
  };
}

/**
 * Parses a client-supplied cycle key without trusting it. A cycle is valid only
 * when it names a real date, is exactly the Monday of its week, and is not in
 * the future relative to the actor's local today.
 */
export function parseGroupCycleKey(
  value: string,
  todayDateKey: string
): GroupWeek | null {
  const match = /^week-(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match) return null;

  const dateKey = match[1]!;
  if (!isValidDateKey(dateKey)) return null;

  const week = getGroupWeek(dateKey);
  if (week.cycleKey !== value) return null;
  if (week.periodStartDate > todayDateKey) return null;

  return week;
}
