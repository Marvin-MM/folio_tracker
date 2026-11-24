import { getLocalDateKey } from "@/server/domain/habit-analytics";

export function getServerTimestampMs(): number {
  return Date.now();
}

export function getCurrentYearMonthForTimezone(timezone: string): string {
  return getLocalDateKey(Date.now(), timezone).slice(0, 7);
}
