import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  isValidDateKey,
  isValidTimeHHmm,
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

export function isWithinQuietHours(
  localHHmm: string,
  quietStart: string,
  quietEnd: string
): boolean {
  if (
    !isValidTimeHHmm(localHHmm) ||
    !isValidTimeHHmm(quietStart) ||
    !isValidTimeHHmm(quietEnd)
  ) {
    return false;
  }
  if (quietStart === quietEnd) return false;

  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  const current = minutes(localHHmm);
  const start = minutes(quietStart);
  const end = minutes(quietEnd);

  // Overnight range, e.g. 21:00 -> 08:00.
  if (start > end) return current >= start || current < end;
  return current >= start && current < end;
}

export interface StreakRiskInput {
  currentStreak: number;
  minStreak: number;
  scheduledToday: boolean;
  todayStatus: "done" | "missed" | "skipped" | null;
  localHour: number;
  startHour: number;
}

export type StreakRiskReason = "unlogged" | "missed" | null;

/**
 * Duolingo-style signal: only protect an established streak, and only once the
 * owner's local day is late enough that an unlogged scheduled habit is
 * genuinely at risk. A logged `missed` mark is an immediate rallying signal.
 * `skipped` is a planned rest day and never triggers a nudge.
 */
export function evaluateStreakRisk(input: StreakRiskInput): {
  atRisk: boolean;
  reason: StreakRiskReason;
} {
  if (input.currentStreak < Math.max(1, input.minStreak)) {
    return { atRisk: false, reason: null };
  }
  if (!input.scheduledToday) return { atRisk: false, reason: null };
  if (input.todayStatus === "done" || input.todayStatus === "skipped") {
    return { atRisk: false, reason: null };
  }
  if (input.todayStatus === "missed") {
    return { atRisk: true, reason: "missed" };
  }
  if (input.localHour < input.startHour) {
    return { atRisk: false, reason: null };
  }
  return { atRisk: true, reason: "unlogged" };
}

export function formatStreakPhrase(
  streak: number,
  unit: "days" | "weeks"
): string {
  const value = Math.max(0, streak);
  // Adjectival form: "4-day streak", not "4-days streak".
  return `${value}-${unit === "weeks" ? "week" : "day"}`;
}
