import type { HabitLogStatus } from "@/server/db/schema/habits";

export type EffectiveHabitStatus = HabitLogStatus | null;

export interface EffectiveStatusHabitLog {
  habitId: string;
  dateKey: string;
  status: HabitLogStatus;
}

export interface EffectiveStatusExcuseRange {
  startDate: string;
  endDate: string;
  habitIds: string[]; // empty/undefined means all habits
  deletedAt?: number | null;
}

/**
 * Single source of truth for habit status on a date.
 * Rules:
 * 1) Explicit log wins.
 * 2) Else active excuse range covering habit => "skipped" (neutral/excused).
 * 3) Else unset (null).
 *
 * "skipped" is FOLIO's neutral/excused status (spec's △) and must not count
 * against performance.
 */
export function getEffectiveHabitStatus(input: {
  habitId: string;
  dateKey: string;
  log?: EffectiveStatusHabitLog | null;
  excuseRanges?: EffectiveStatusExcuseRange[];
}): EffectiveHabitStatus {
  const { habitId, dateKey, log, excuseRanges = [] } = input;
  if (log && log.habitId === habitId && log.dateKey === dateKey) {
    return log.status;
  }

  const coveredByExcuse = excuseRanges.some((range) => {
    if (range.deletedAt) return false;
    if (dateKey < range.startDate || dateKey > range.endDate) return false;
    if (!range.habitIds || range.habitIds.length === 0) return true;
    return range.habitIds.includes(habitId);
  });

  return coveredByExcuse ? "skipped" : null;
}

export function getEffectiveStatusMap(input: {
  habitIds: string[];
  dateKeys: string[];
  logs: EffectiveStatusHabitLog[];
  excuseRanges?: EffectiveStatusExcuseRange[];
}): Map<string, EffectiveHabitStatus> {
  const logsByKey = new Map<string, EffectiveStatusHabitLog>();
  for (const log of input.logs) {
    logsByKey.set(`${log.habitId}|${log.dateKey}`, log);
  }
  const out = new Map<string, EffectiveHabitStatus>();
  for (const habitId of input.habitIds) {
    for (const dateKey of input.dateKeys) {
      const key = `${habitId}|${dateKey}`;
      out.set(
        key,
        getEffectiveHabitStatus({
          habitId,
          dateKey,
          log: logsByKey.get(key) ?? null,
          excuseRanges: input.excuseRanges,
        })
      );
    }
  }
  return out;
}
