import type {
  HabitMonthLockRecord,
  HabitTrackerSettingsRecord,
} from "@/server/db/schema";
import { isValidDateKey, isValidYearMonth, shiftYearMonth } from "./habit-analytics";

export const DEFAULT_MONTH_LOCK_GRACE_DAYS = 3;
export const MIN_MONTH_LOCK_GRACE_DAYS = 0;
export const MAX_MONTH_LOCK_GRACE_DAYS = 14;
export const TEMP_UNLOCK_DURATION_MS = 30 * 60 * 1000;
export const PIN_LOCKOUT_THRESHOLD = 5;
export const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export type MonthLockPhase =
  | "open"
  | "closing_today"
  | "grace_open"
  | "locked_manual"
  | "locked_auto"
  | "unlocked_temp";

export interface MonthLockState {
  yearMonth: string;
  phase: MonthLockPhase;
  isLocked: boolean;
  isManuallyLocked: boolean;
  canLockNow: boolean;
  canUnlock: boolean;
  autoLockEnabled: boolean;
  graceDays: number;
  graceEndDateKey: string | null;
  graceDaysRemaining: number | null;
  lockedAtMs: number | null;
  unlockedUntilMs: number | null;
  remainingUnlockMinutes: number | null;
  unlockCount: number;
  hasBeenUnlocked: boolean;
}

export interface MonthLockIntegritySummary {
  phase: MonthLockPhase;
  isLocked: boolean;
  unlockCount: number;
  hasBeenUnlocked: boolean;
}

export type ClientHabitTrackerSettings = Omit<
  HabitTrackerSettingsRecord,
  | "monthLockPinHash"
  | "monthLockPinSalt"
  | "monthLockPinFailedAttempts"
  | "monthLockPinLockedUntil"
> & {
  hasMonthLockPin: boolean;
};

/**
 * Strips all server-only PIN credentials and brute-force counters before
 * serializing habit tracker settings to any client component or API response.
 */
export function sanitizeHabitTrackerSettings(
  record: HabitTrackerSettingsRecord
): ClientHabitTrackerSettings {
  const {
    monthLockPinHash,
    monthLockPinSalt,
    monthLockPinFailedAttempts: _attempts,
    monthLockPinLockedUntil: _lockedUntil,
    ...safe
  } = record;
  void _attempts;
  void _lockedUntil;
  return {
    ...safe,
    hasMonthLockPin: Boolean(monthLockPinHash && monthLockPinSalt),
  };
}

export function isValidMonthLockPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function clampGraceDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_MONTH_LOCK_GRACE_DAYS;
  return Math.min(
    MAX_MONTH_LOCK_GRACE_DAYS,
    Math.max(MIN_MONTH_LOCK_GRACE_DAYS, Math.trunc(days))
  );
}

/**
 * Returns the exact final calendar date (`YYYY-MM-DD`) of a `YYYY-MM` month.
 */
export function getLastDayOfMonthDateKey(yearMonth: string): string {
  if (!isValidYearMonth(yearMonth)) {
    return `${yearMonth}-28`;
  }
  const [yStr, mStr] = yearMonth.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Computes the last editable calendar date (`YYYY-MM-DD`, inclusive) for a
 * completed month under `graceDays`.
 * - `graceDays === 0`: locks immediately on day 1 of the next month (last editable day is month-end).
 * - `graceDays === 3`: editable through day 3 of the following month; auto-locks on day 4.
 */
export function computeGraceEndDateKey(
  yearMonth: string,
  graceDays: number
): string {
  const safeGrace = clampGraceDays(graceDays);
  if (safeGrace === 0) {
    return getLastDayOfMonthDateKey(yearMonth);
  }
  const nextMonth = shiftYearMonth(yearMonth, 1);
  return `${nextMonth}-${String(safeGrace).padStart(2, "0")}`;
}

function daysBetweenDateKeys(fromKey: string, toKey: string): number {
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey)) return 0;
  const [y1, m1, d1] = fromKey.split("-").map(Number);
  const [y2, m2, d2] = toKey.split("-").map(Number);
  const ms1 = Date.UTC(y1!, m1! - 1, d1!);
  const ms2 = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((ms2 - ms1) / 86_400_000);
}

/**
 * Pure, deterministic evaluation of a month's lock state with zero cron drift.
 * All date comparisons use the user's IANA-timezone-resolved `todayDateKey`.
 */
export function evaluateMonthLockState(params: {
  yearMonth: string;
  todayDateKey: string;
  nowMs: number;
  settings: Pick<
    HabitTrackerSettingsRecord,
    "monthLockEnabled" | "monthLockGraceDays"
  >;
  lockRow: HabitMonthLockRecord | null;
}): MonthLockState {
  const { yearMonth, todayDateKey, nowMs, settings, lockRow } = params;
  const currentMonth = todayDateKey.slice(0, 7);
  const autoLockEnabled = Boolean(settings.monthLockEnabled);
  const graceDays = clampGraceDays(settings.monthLockGraceDays);
  const graceEndDateKey = computeGraceEndDateKey(yearMonth, graceDays);
  const lastDayKey = getLastDayOfMonthDateKey(yearMonth);

  const unlockCount = lockRow?.unlockCount ?? 0;
  const hasBeenUnlocked = unlockCount > 0;
  const lockedAtMs = lockRow?.lockedAt ?? null;

  const activeTempUnlockUntil =
    lockRow?.status === "unlocked_override" &&
    typeof lockRow.unlockedUntil === "number" &&
    lockRow.unlockedUntil > nowMs
      ? lockRow.unlockedUntil
      : null;

  // 1. Active temporary 30-minute unlock override
  if (activeTempUnlockUntil !== null) {
    const remainingUnlockMinutes = Math.max(
      1,
      Math.ceil((activeTempUnlockUntil - nowMs) / 60_000)
    );
    return {
      yearMonth,
      phase: "unlocked_temp",
      isLocked: false,
      isManuallyLocked: false,
      canLockNow: true,
      canUnlock: false,
      autoLockEnabled,
      graceDays,
      graceEndDateKey: yearMonth < currentMonth ? graceEndDateKey : null,
      graceDaysRemaining: null,
      lockedAtMs,
      unlockedUntilMs: activeTempUnlockUntil,
      remainingUnlockMinutes,
      unlockCount,
      hasBeenUnlocked,
    };
  }

  // 2. Manual lock (either directly locked or an expired temp-unlock of a manually locked month)
  const isManuallyLocked =
    lockRow?.status === "locked" ||
    (lockRow?.status === "unlocked_override" &&
      activeTempUnlockUntil === null &&
      lockRow.lockedAt !== null);

  if (isManuallyLocked) {
    return {
      yearMonth,
      phase: "locked_manual",
      isLocked: true,
      isManuallyLocked: true,
      canLockNow: false,
      canUnlock: true,
      autoLockEnabled,
      graceDays,
      graceEndDateKey: yearMonth < currentMonth ? graceEndDateKey : null,
      graceDaysRemaining: null,
      lockedAtMs,
      unlockedUntilMs: null,
      remainingUnlockMinutes: null,
      unlockCount,
      hasBeenUnlocked,
    };
  }

  // 3. Completed past month
  if (yearMonth < currentMonth) {
    if (autoLockEnabled) {
      if (todayDateKey > graceEndDateKey) {
        return {
          yearMonth,
          phase: "locked_auto",
          isLocked: true,
          isManuallyLocked: false,
          canLockNow: false,
          canUnlock: true,
          autoLockEnabled,
          graceDays,
          graceEndDateKey,
          graceDaysRemaining: 0,
          lockedAtMs: null,
          unlockedUntilMs: null,
          remainingUnlockMinutes: null,
          unlockCount,
          hasBeenUnlocked,
        };
      }

      const graceDaysRemaining = Math.max(
        1,
        daysBetweenDateKeys(todayDateKey, graceEndDateKey) + 1
      );
      return {
        yearMonth,
        phase: "grace_open",
        isLocked: false,
        isManuallyLocked: false,
        canLockNow: true,
        canUnlock: false,
        autoLockEnabled,
        graceDays,
        graceEndDateKey,
        graceDaysRemaining,
        lockedAtMs: null,
        unlockedUntilMs: null,
        remainingUnlockMinutes: null,
        unlockCount,
        hasBeenUnlocked,
      };
    }

    // Auto-lock disabled: past month stays editable, manual lock still available
    return {
      yearMonth,
      phase: "open",
      isLocked: false,
      isManuallyLocked: false,
      canLockNow: true,
      canUnlock: false,
      autoLockEnabled,
      graceDays,
      graceEndDateKey: null,
      graceDaysRemaining: null,
      lockedAtMs: null,
      unlockedUntilMs: null,
      remainingUnlockMinutes: null,
      unlockCount,
      hasBeenUnlocked,
    };
  }

  // 4. Current month on its final calendar day -> allow immediate closing lock
  if (yearMonth === currentMonth && todayDateKey === lastDayKey) {
    return {
      yearMonth,
      phase: "closing_today",
      isLocked: false,
      isManuallyLocked: false,
      canLockNow: true,
      canUnlock: false,
      autoLockEnabled,
      graceDays,
      graceEndDateKey: autoLockEnabled ? graceEndDateKey : null,
      graceDaysRemaining: null,
      lockedAtMs: null,
      unlockedUntilMs: null,
      remainingUnlockMinutes: null,
      unlockCount,
      hasBeenUnlocked,
    };
  }

  // 5. Open current month (before final day)
  return {
    yearMonth,
    phase: "open",
    isLocked: false,
    isManuallyLocked: false,
    canLockNow: false,
    canUnlock: false,
    autoLockEnabled,
    graceDays,
    graceEndDateKey: null,
    graceDaysRemaining: null,
    lockedAtMs: null,
    unlockedUntilMs: null,
    remainingUnlockMinutes: null,
    unlockCount,
    hasBeenUnlocked,
  };
}
