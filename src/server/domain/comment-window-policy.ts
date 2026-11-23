import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type {
  HabitCommentMode,
  HabitMonitorRecord,
  HabitTrackerSettingsRecord,
} from "@/server/db/schema";
import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  getLocalDateKey,
  isValidDateKey,
  isValidTimeHHmm,
} from "./habit-analytics";

const WEEKDAY_SHORTS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DEFAULT_INTERVAL_DAYS = 5;
const DEFAULT_INTERVAL_ANCHOR = "2026-01-01";
const DEFAULT_INTERVAL_OPEN_HOURS = 24;

export interface EffectiveCommentPolicy {
  source: "global" | "custom";
  mode: HabitCommentMode;
  windowStartDay: number; // 0 (Sun) .. 6 (Sat)
  windowStartTime: string; // HH:mm
  windowEndDay: number; // 0 (Sun) .. 6 (Sat)
  windowEndTime: string; // HH:mm
  intervalDays: number; // 2..30
  intervalAnchorDate: string; // YYYY-MM-DD
  intervalOpenHours: number; // 1..168
  allowReactionsWhenLocked: boolean;
}

export interface CommentWindowState {
  isOpen: boolean;
  mode: HabitCommentMode;
  source: "global" | "custom";
  cycleKey: string;
  lastClosedCycleKey: string | null;
  periodStartDate: string;
  periodEndDate: string;
  opensAtUtcMs: number | null;
  closesAtUtcMs: number | null;
  allowReactionsWhenLocked: boolean;
  canReact: boolean;
  summary: string;
  ownerTimezone: string;
}

export type PolicySettingsInput = Pick<
  HabitTrackerSettingsRecord,
  | "defaultCommentMode"
  | "defaultWindowStartDay"
  | "defaultWindowStartTime"
  | "defaultWindowEndDay"
  | "defaultWindowEndTime"
  | "defaultIntervalDays"
  | "defaultIntervalAnchorDate"
  | "defaultIntervalOpenHours"
  | "allowReactionsWhenLocked"
>;

export type MonitorPolicyOverrideInput = Pick<
  HabitMonitorRecord,
  | "useCustomPolicy"
  | "customCommentMode"
  | "customWindowStartDay"
  | "customWindowStartTime"
  | "customWindowEndDay"
  | "customWindowEndTime"
  | "customIntervalDays"
  | "customIntervalAnchorDate"
  | "customIntervalOpenHours"
  | "customAllowReactionsWhenLocked"
>;

function parseTimeToMinutes(hhmm: string): number {
  if (!isValidTimeHHmm(hhmm)) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function zonedWallClockToUtcMs(
  dateKey: string,
  hhmm: string,
  secondsAndMs: string,
  timezone: string
): number {
  const safeTime = isValidTimeHHmm(hhmm) ? hhmm : "00:00";
  const iso = `${dateKey}T${safeTime}:${secondsAndMs}`;
  try {
    const ms = fromZonedTime(iso, timezone).getTime();
    if (Number.isFinite(ms)) return ms;
  } catch {
    // Fallback to UTC below
  }
  return fromZonedTime(iso, "UTC").getTime();
}

function formatZonedDayTime(utcMs: number, timezone: string): string {
  try {
    return formatInTimeZone(utcMs, timezone, "EEE HH:mm");
  } catch {
    return formatInTimeZone(utcMs, "UTC", "EEE HH:mm");
  }
}

function diffDateKeys(fromDateKey: string, toDateKey: string): number {
  const [fy, fm, fd] = fromDateKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [ty, tm, td] = toDateKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

/**
 * Computes the ISO-8601 week key (`YYYY-Www`, e.g., `2026-W47`) for a calendar dateKey.
 */
export function getIsoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7; // Mon=1 .. Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const isoYear = dt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(
    ((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
}

function getIsoWeekBounds(dateKey: string): {
  periodStartDate: string;
  periodEndDate: string;
} {
  const dow = getDayOfWeekFromDateKey(dateKey);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const periodStartDate = addDaysToDateKey(dateKey, mondayOffset);
  const periodEndDate = addDaysToDateKey(periodStartDate, 6);
  return { periodStartDate, periodEndDate };
}

/**
 * Resolves the effective commenting policy for a monitor by merging the owner's
 * global `habitTrackerSettings` with any active per-monitor override (`useCustomPolicy`).
 */
export function resolveEffectivePolicy(
  globalSettings: PolicySettingsInput,
  monitorRow?: MonitorPolicyOverrideInput | null
): EffectiveCommentPolicy {
  const useCustom = Boolean(monitorRow?.useCustomPolicy);

  const rawMode = useCustom
    ? monitorRow?.customCommentMode ?? globalSettings.defaultCommentMode
    : globalSettings.defaultCommentMode;

  const rawStartDay = useCustom
    ? monitorRow?.customWindowStartDay ?? globalSettings.defaultWindowStartDay
    : globalSettings.defaultWindowStartDay;

  const rawStartTime = useCustom
    ? monitorRow?.customWindowStartTime ?? globalSettings.defaultWindowStartTime
    : globalSettings.defaultWindowStartTime;

  const rawEndDay = useCustom
    ? monitorRow?.customWindowEndDay ?? globalSettings.defaultWindowEndDay
    : globalSettings.defaultWindowEndDay;

  const rawEndTime = useCustom
    ? monitorRow?.customWindowEndTime ?? globalSettings.defaultWindowEndTime
    : globalSettings.defaultWindowEndTime;

  const rawIntervalDays = useCustom
    ? monitorRow?.customIntervalDays ?? globalSettings.defaultIntervalDays
    : globalSettings.defaultIntervalDays;

  const rawAnchorDate = useCustom
    ? monitorRow?.customIntervalAnchorDate ??
      globalSettings.defaultIntervalAnchorDate
    : globalSettings.defaultIntervalAnchorDate;

  const rawOpenHours = useCustom
    ? monitorRow?.customIntervalOpenHours ??
      globalSettings.defaultIntervalOpenHours
    : globalSettings.defaultIntervalOpenHours;

  const rawAllowReactions = useCustom
    ? monitorRow?.customAllowReactionsWhenLocked ??
      globalSettings.allowReactionsWhenLocked
    : globalSettings.allowReactionsWhenLocked;

  const clampedIntervalDays =
    typeof rawIntervalDays === "number" &&
    Number.isInteger(rawIntervalDays) &&
    rawIntervalDays >= 2 &&
    rawIntervalDays <= 30
      ? rawIntervalDays
      : DEFAULT_INTERVAL_DAYS;

  const clampedOpenHours =
    typeof rawOpenHours === "number" &&
    Number.isInteger(rawOpenHours) &&
    rawOpenHours >= 1 &&
    rawOpenHours <= 168
      ? rawOpenHours
      : DEFAULT_INTERVAL_OPEN_HOURS;

  return {
    source: useCustom ? "custom" : "global",
    mode: rawMode,
    windowStartDay: rawStartDay >= 0 && rawStartDay <= 6 ? rawStartDay : 6,
    windowStartTime: isValidTimeHHmm(rawStartTime) ? rawStartTime : "00:00",
    windowEndDay: rawEndDay >= 0 && rawEndDay <= 6 ? rawEndDay : 0,
    windowEndTime: isValidTimeHHmm(rawEndTime) ? rawEndTime : "23:59",
    intervalDays: clampedIntervalDays,
    intervalAnchorDate:
      rawAnchorDate && isValidDateKey(rawAnchorDate)
        ? rawAnchorDate
        : DEFAULT_INTERVAL_ANCHOR,
    intervalOpenHours: clampedOpenHours,
    allowReactionsWhenLocked: Boolean(rawAllowReactions),
  };
}

/**
 * Evaluates whether a monitor's commenting window is currently open in the
 * habit owner's IANA timezone, computing deterministic `cycleKey`, exact UTC
 * boundaries (`opensAtUtcMs` / `closesAtUtcMs`), and concise UI summary copy.
 */
export function evaluateCommentWindow(
  effectivePolicy: EffectiveCommentPolicy,
  ownerTimezone: string = "UTC",
  nowUtcMs: number = Date.now()
): CommentWindowState {
  const tz = ownerTimezone?.trim() || "UTC";
  const ownerLocalDate = getLocalDateKey(nowUtcMs, tz);

  if (effectivePolicy.mode === "anytime") {
    const bounds = getIsoWeekBounds(ownerLocalDate);
    return {
      isOpen: true,
      mode: "anytime",
      source: effectivePolicy.source,
      cycleKey: getIsoWeekKey(ownerLocalDate),
      lastClosedCycleKey: null,
      periodStartDate: bounds.periodStartDate,
      periodEndDate: bounds.periodEndDate,
      opensAtUtcMs: null,
      closesAtUtcMs: null,
      allowReactionsWhenLocked: effectivePolicy.allowReactionsWhenLocked,
      canReact: true,
      summary: "Review open anytime",
      ownerTimezone: tz,
    };
  }

  if (effectivePolicy.mode === "weekly_window") {
    const startDay = effectivePolicy.windowStartDay;
    const endDay = effectivePolicy.windowEndDay;
    const startTime = effectivePolicy.windowStartTime;
    const endTime = effectivePolicy.windowEndTime;

    let daySpan = (endDay - startDay + 7) % 7;
    if (
      daySpan === 0 &&
      parseTimeToMinutes(endTime) < parseTimeToMinutes(startTime)
    ) {
      daySpan = 7;
    }

    interface WeeklyCandidate {
      startDateKey: string;
      endDateKey: string;
      opensAtUtcMs: number;
      closesAtUtcMs: number;
      cycleKey: string;
    }

    const candidates: WeeklyCandidate[] = [];
    for (let offset = -14; offset <= 14; offset++) {
      const candidateStart = addDaysToDateKey(ownerLocalDate, offset);
      if (getDayOfWeekFromDateKey(candidateStart) !== startDay) continue;
      const candidateEnd = addDaysToDateKey(candidateStart, daySpan);
      const opensAtUtcMs = zonedWallClockToUtcMs(
        candidateStart,
        startTime,
        "00.000",
        tz
      );
      const closesAtUtcMs = zonedWallClockToUtcMs(
        candidateEnd,
        endTime,
        "59.999",
        tz
      );
      candidates.push({
        startDateKey: candidateStart,
        endDateKey: candidateEnd,
        opensAtUtcMs,
        closesAtUtcMs,
        cycleKey: getIsoWeekKey(candidateStart),
      });
    }

    candidates.sort((a, b) => a.opensAtUtcMs - b.opensAtUtcMs);

    const active = candidates.find(
      (c) => nowUtcMs >= c.opensAtUtcMs && nowUtcMs <= c.closesAtUtcMs
    );
    const previous = [...candidates]
      .reverse()
      .find((c) => c.closesAtUtcMs < nowUtcMs);

    if (active) {
      return {
        isOpen: true,
        mode: "weekly_window",
        source: effectivePolicy.source,
        cycleKey: active.cycleKey,
        lastClosedCycleKey: previous?.cycleKey ?? null,
        periodStartDate: addDaysToDateKey(active.endDateKey, -6),
        periodEndDate: active.endDateKey,
        opensAtUtcMs: active.opensAtUtcMs,
        closesAtUtcMs: active.closesAtUtcMs,
        allowReactionsWhenLocked: effectivePolicy.allowReactionsWhenLocked,
        canReact: true,
        summary: `Review open · Closes ${WEEKDAY_SHORTS[endDay]} ${endTime}`,
        ownerTimezone: tz,
      };
    }

    const upcoming = candidates.find((c) => c.opensAtUtcMs > nowUtcMs);
    const bounds = getIsoWeekBounds(ownerLocalDate);
    const cycleKey = upcoming?.cycleKey ?? getIsoWeekKey(ownerLocalDate);

    return {
      isOpen: false,
      mode: "weekly_window",
      source: effectivePolicy.source,
      cycleKey,
      lastClosedCycleKey: previous?.cycleKey ?? null,
      periodStartDate: upcoming
        ? addDaysToDateKey(upcoming.endDateKey, -6)
        : bounds.periodStartDate,
      periodEndDate: upcoming ? upcoming.endDateKey : bounds.periodEndDate,
      opensAtUtcMs: upcoming?.opensAtUtcMs ?? null,
      closesAtUtcMs: upcoming?.closesAtUtcMs ?? null,
      allowReactionsWhenLocked: effectivePolicy.allowReactionsWhenLocked,
      canReact: effectivePolicy.allowReactionsWhenLocked,
      summary: `Locked · Opens ${WEEKDAY_SHORTS[startDay]} ${startTime}`,
      ownerTimezone: tz,
    };
  }

  // interval_days mode (e.g., Every 4 or 5 days, open for `intervalOpenHours` at end of each cycle)
  const intervalDays = effectivePolicy.intervalDays;
  const openHours = effectivePolicy.intervalOpenHours;
  const anchorDate = effectivePolicy.intervalAnchorDate;
  const diffDays = diffDateKeys(anchorDate, ownerLocalDate);
  const approxK = Math.max(0, Math.floor(diffDays / intervalDays));

  interface IntervalCandidate {
    k: number;
    periodStartDate: string;
    periodEndDate: string;
    opensAtUtcMs: number;
    closesAtUtcMs: number;
    cycleKey: string;
  }

  const candidates: IntervalCandidate[] = [];
  const startK = Math.max(0, approxK - 2);
  const endK = approxK + 2;

  for (let k = startK; k <= endK; k++) {
    const periodStartDate = addDaysToDateKey(anchorDate, k * intervalDays);
    const periodEndDate = addDaysToDateKey(
      anchorDate,
      (k + 1) * intervalDays - 1
    );
    const closesAtUtcMs = zonedWallClockToUtcMs(
      periodEndDate,
      "23:59",
      "59.999",
      tz
    );

    let opensAtUtcMs: number;
    if (openHours % 24 === 0) {
      const openDaysCount = openHours / 24;
      const openDateKey = addDaysToDateKey(
        periodEndDate,
        -(openDaysCount - 1)
      );
      opensAtUtcMs = zonedWallClockToUtcMs(
        openDateKey,
        "00:00",
        "00.000",
        tz
      );
    } else {
      opensAtUtcMs = closesAtUtcMs - openHours * 3_600_000 + 1;
    }

    candidates.push({
      k,
      periodStartDate,
      periodEndDate,
      opensAtUtcMs,
      closesAtUtcMs,
      cycleKey: `${periodEndDate}_${intervalDays}d`,
    });
  }

  const active = candidates.find(
    (c) => nowUtcMs >= c.opensAtUtcMs && nowUtcMs <= c.closesAtUtcMs
  );
  const previous = [...candidates]
    .reverse()
    .find((c) => c.closesAtUtcMs < nowUtcMs);

  if (active) {
    const remainingHours = Math.max(
      1,
      Math.ceil((active.closesAtUtcMs - nowUtcMs) / 3_600_000)
    );
    return {
      isOpen: true,
      mode: "interval_days",
      source: effectivePolicy.source,
      cycleKey: active.cycleKey,
      lastClosedCycleKey: previous?.cycleKey ?? null,
      periodStartDate: active.periodStartDate,
      periodEndDate: active.periodEndDate,
      opensAtUtcMs: active.opensAtUtcMs,
      closesAtUtcMs: active.closesAtUtcMs,
      allowReactionsWhenLocked: effectivePolicy.allowReactionsWhenLocked,
      canReact: true,
      summary: `${intervalDays}-day check-in open for ${remainingHours}h`,
      ownerTimezone: tz,
    };
  }

  const upcoming = candidates.find((c) => c.opensAtUtcMs > nowUtcMs);
  const openLabel = upcoming
    ? formatZonedDayTime(upcoming.opensAtUtcMs, tz)
    : "soon";

  return {
    isOpen: false,
    mode: "interval_days",
    source: effectivePolicy.source,
    cycleKey: upcoming?.cycleKey ?? `${ownerLocalDate}_${intervalDays}d`,
    lastClosedCycleKey: previous?.cycleKey ?? null,
    periodStartDate: upcoming?.periodStartDate ?? ownerLocalDate,
    periodEndDate: upcoming?.periodEndDate ?? ownerLocalDate,
    opensAtUtcMs: upcoming?.opensAtUtcMs ?? null,
    closesAtUtcMs: upcoming?.closesAtUtcMs ?? null,
    allowReactionsWhenLocked: effectivePolicy.allowReactionsWhenLocked,
    canReact: effectivePolicy.allowReactionsWhenLocked,
    summary: `Locked · Next ${intervalDays}-day review opens ${openLabel}`,
    ownerTimezone: tz,
  };
}

/**
 * Returns `true` when an effective window transitioned from closed -> open
 * within the trailing `lookbackMs` (default 65m for hourly cron jitter safety).
 */
export function didWindowOpenWithinLookback(
  windowState: CommentWindowState,
  nowUtcMs: number,
  lookbackMs: number = 65 * 60 * 1000
): boolean {
  if (!windowState.isOpen || windowState.opensAtUtcMs === null) {
    return false;
  }
  return (
    windowState.opensAtUtcMs <= nowUtcMs &&
    windowState.opensAtUtcMs > nowUtcMs - lookbackMs
  );
}

/**
 * Human-readable badge copy describing a monitor's active commenting cadence.
 */
export function formatPolicyBadge(policy: EffectiveCommentPolicy): string {
  const prefix = policy.source === "custom" ? "Custom: " : "Global: ";
  if (policy.mode === "anytime") {
    return policy.source === "custom" ? "Custom: Anytime" : "Inherits Global";
  }
  if (policy.mode === "interval_days") {
    return policy.source === "custom"
      ? `Custom: Every ${policy.intervalDays} days`
      : "Inherits Global";
  }
  const startLabel = WEEKDAY_SHORTS[policy.windowStartDay] ?? "Sat";
  const endLabel = WEEKDAY_SHORTS[policy.windowEndDay] ?? "Sun";
  return policy.source === "custom"
    ? `${prefix}${startLabel}–${endLabel}`
    : "Inherits Global";
}

export function formatCycleDisplayLabel(cycleKey: string): string {
  const weekMatch = cycleKey.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) {
    return `Week ${Number(weekMatch[2])} · ${weekMatch[1]}`;
  }
  const intervalMatch = cycleKey.match(/^(\d{4}-\d{2}-\d{2})_(\d+)d$/);
  if (intervalMatch) {
    return `${intervalMatch[2]}-day cycle · ${intervalMatch[1]}`;
  }
  return cycleKey;
}
