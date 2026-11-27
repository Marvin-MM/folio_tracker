/**
 * Phase C — pure, request-scoped rollup helpers.
 *
 * These are deliberately stateless: no module-level caches or version counters.
 * A month's logs are small enough to recompute on every request, which also
 * guarantees that deletions, older-log edits, and excuse-range changes are
 * reflected immediately.
 */

export type RollupLogStatus = "done" | "missed" | "skipped";

export interface RollupHabitLog {
  habitId: string;
  dateKey: string;
  status: RollupLogStatus;
  loggedAt?: number;
}

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

export interface RunsRollup {
  done: number;
  target: number | null;
}

function formatUtcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getWeekRangeForDate(
  dateKey: string,
  weekStartsOn: 0 | 1 = 1
): DateRange {
  const [year, month, day] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const dayOfWeek = base.getUTCDay();
  const back = (dayOfWeek - weekStartsOn + 7) % 7;
  base.setUTCDate(base.getUTCDate() - back);
  const start = formatUtcDateKey(base);
  base.setUTCDate(base.getUTCDate() + 6);
  return { start, end: formatUtcDateKey(base) };
}

export function getMonthRangeForDate(dateKey: string): DateRange {
  const month = dateKey.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const start = formatUtcDateKey(
    new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1))
  );
  const end = formatUtcDateKey(
    new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0))
  );
  return { start, end };
}

function isInRange(dateKey: string, range: DateRange): boolean {
  return dateKey >= range.start && dateKey <= range.end;
}

/** Completion = done / (done + missed); skipped is neutral; null if no denominator. */
export function computeHabitRate(
  logs: readonly RollupHabitLog[],
  range: DateRange
): number | null {
  let done = 0;
  let missed = 0;
  for (const log of logs) {
    if (!isInRange(log.dateKey, range)) continue;
    if (log.status === "done") done += 1;
    else if (log.status === "missed") missed += 1;
  }
  const denominator = done + missed;
  return denominator === 0 ? null : done / denominator;
}

/**
 * Counts completed (habit, date) pairs, so three runs on three different days
 * of one weekly-target habit count as 3 rather than 1.
 */
export function computeRunsThisWeek(input: {
  logs: readonly RollupHabitLog[];
  runHabitIds: readonly string[];
  range: DateRange;
  target: number | null;
}): RunsRollup {
  const runHabits = new Set(input.runHabitIds);
  const completedDays = new Set<string>();
  for (const log of input.logs) {
    if (log.status !== "done") continue;
    if (!isInRange(log.dateKey, input.range)) continue;
    if (!runHabits.has(log.habitId)) continue;
    completedDays.add(`${log.habitId}|${log.dateKey}`);
  }
  return { done: completedDays.size, target: input.target };
}
