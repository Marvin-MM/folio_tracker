import { addDays, addHours, addMinutes, nextMonday, set } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type SnoozePreset = "15m" | "1h" | "tomorrow_9am";
export type QuickReminderPreset = "later_today" | "tomorrow_9am" | "next_week";

function safeTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/**
 * Computes a snooze target strictly in the user's IANA timezone, respecting DST transitions.
 */
export function computeSnoozeTargetUtcMs(
  preset: SnoozePreset,
  timezone: string,
  nowMs: number = Date.now()
): number {
  const tz = safeTimezone(timezone);
  const now = new Date(nowMs);

  if (preset === "15m") {
    return addMinutes(now, 15).getTime();
  }

  if (preset === "1h") {
    return addHours(now, 1).getTime();
  }

  // Tomorrow 9:00 AM in the user's IANA timezone
  const zonedNow = toZonedTime(now, tz);
  const tomorrowNine = set(addDays(zonedNow, 1), {
    hours: 9,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  });
  return fromZonedTime(tomorrowNine, tz).getTime();
}

/**
 * Computes quick reminder presets ("Later today", "Tomorrow 9 AM", "Next week")
 * strictly in the user's IANA timezone.
 */
export function computeQuickReminderPresetUtcMs(
  preset: QuickReminderPreset,
  timezone: string,
  nowMs: number = Date.now()
): number {
  const tz = safeTimezone(timezone);
  const now = new Date(nowMs);
  const zonedNow = toZonedTime(now, tz);

  if (preset === "later_today") {
    const hour = zonedNow.getHours();
    if (hour < 15) {
      const target = set(zonedNow, {
        hours: Math.max(hour + 3, 18),
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      return fromZonedTime(target, tz).getTime();
    }
    if (hour < 20) {
      const target = set(zonedNow, {
        hours: hour + 2,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      return fromZonedTime(target, tz).getTime();
    }
    // Late evening fallback: tomorrow 9:00 AM
    const tomorrowNine = set(addDays(zonedNow, 1), {
      hours: 9,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    return fromZonedTime(tomorrowNine, tz).getTime();
  }

  if (preset === "tomorrow_9am") {
    const tomorrowNine = set(addDays(zonedNow, 1), {
      hours: 9,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    return fromZonedTime(tomorrowNine, tz).getTime();
  }

  // Next week: next Monday 9:00 AM local time
  const nextMonNine = set(nextMonday(zonedNow), {
    hours: 9,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  });
  return fromZonedTime(nextMonNine, tz).getTime();
}

/**
 * Converts a local `YYYY-MM-DD` + `HH:mm` input in `timezone` into exact UTC ms.
 */
export function zonedWallClockToUtcMs(
  dateStr: string,
  timeStr: string,
  timezone: string
): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const tz = safeTimezone(timezone);
  const localWallClock = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const utcDate = fromZonedTime(localWallClock, tz);
  const ms = utcDate.getTime();
  return Number.isNaN(ms) ? null : ms;
}
