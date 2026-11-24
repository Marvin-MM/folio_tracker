import { describe, expect, it } from "vitest";
import type {
  HabitMonthLockRecord,
  HabitTrackerSettingsRecord,
} from "@/server/db/schema";
import {
  computeGraceEndDateKey,
  evaluateMonthLockState,
  getLastDayOfMonthDateKey,
  isValidMonthLockPin,
  sanitizeHabitTrackerSettings,
  TEMP_UNLOCK_DURATION_MS,
} from "@/server/domain/habit-month-lock";
import {
  hashMonthLockPin,
  verifyMonthLockPin,
} from "@/server/security/pin-crypto";

function makeSettings(
  overrides: Partial<HabitTrackerSettingsRecord> = {}
): HabitTrackerSettingsRecord {
  return {
    userId: "u-test",
    weekStartsOn: 1,
    defaultCommentMode: "weekly_window",
    defaultWindowStartDay: 6,
    defaultWindowStartTime: "00:00",
    defaultWindowEndDay: 0,
    defaultWindowEndTime: "23:59",
    defaultIntervalDays: null,
    defaultIntervalAnchorDate: null,
    defaultIntervalOpenHours: 24,
    allowReactionsWhenLocked: true,
    eveningCheckinTime: null,
    partnerNudgesEnabled: false,
    partnerNudgeStartHour: 18,
    partnerNudgeMinStreak: 2,
    nudgeQuietHoursStart: "21:00",
    nudgeQuietHoursEnd: "08:00",
    monthLockEnabled: true,
    monthLockGraceDays: 3,
    monthLockPinHash: null,
    monthLockPinSalt: null,
    monthLockPinFailedAttempts: 0,
    monthLockPinLockedUntil: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("habit-month-lock domain policy & scrypt PIN crypto", () => {
  it("computes exact month-end and grace-end date keys including leap years and year rollovers", () => {
    expect(getLastDayOfMonthDateKey("2024-02")).toBe("2024-02-29");
    expect(getLastDayOfMonthDateKey("2026-02")).toBe("2026-02-28");
    expect(getLastDayOfMonthDateKey("2026-11")).toBe("2026-11-30");

    expect(computeGraceEndDateKey("2026-11", 0)).toBe("2026-11-30");
    expect(computeGraceEndDateKey("2026-11", 3)).toBe("2026-12-03");
    expect(computeGraceEndDateKey("2026-12", 3)).toBe("2027-01-03");
    expect(computeGraceEndDateKey("2026-11", 99)).toBe("2026-12-14");
  });

  it("evaluates every lifecycle transition deterministically without cron drift", () => {
    const settings = makeSettings({
      monthLockEnabled: true,
      monthLockGraceDays: 3,
    });
    const nowMs = Date.parse("2026-11-27T12:00:00.000Z");

    // 1. Mid-month current month -> open, cannot lock early
    const midCurrent = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-11-27",
      nowMs,
      settings,
      lockRow: null,
    });
    expect(midCurrent.phase).toBe("open");
    expect(midCurrent.isLocked).toBe(false);
    expect(midCurrent.canLockNow).toBe(false);

    // 2. Final day of current month -> closing_today, canLockNow = true
    const closingToday = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-11-30",
      nowMs: Date.parse("2026-11-30T18:00:00.000Z"),
      settings,
      lockRow: null,
    });
    expect(closingToday.phase).toBe("closing_today");
    expect(closingToday.isLocked).toBe(false);
    expect(closingToday.canLockNow).toBe(true);

    // 3. New month day 1 -> grace_open with 3 days remaining
    const graceDay1 = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-01",
      nowMs: Date.parse("2026-12-01T08:00:00.000Z"),
      settings,
      lockRow: null,
    });
    expect(graceDay1.phase).toBe("grace_open");
    expect(graceDay1.isLocked).toBe(false);
    expect(graceDay1.canLockNow).toBe(true);
    expect(graceDay1.graceEndDateKey).toBe("2026-12-03");
    expect(graceDay1.graceDaysRemaining).toBe(3);

    // 4. New month day 3 -> grace_open with 1 day remaining (last editable day)
    const graceDay3 = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-03",
      nowMs: Date.parse("2026-12-03T20:00:00.000Z"),
      settings,
      lockRow: null,
    });
    expect(graceDay3.phase).toBe("grace_open");
    expect(graceDay3.graceDaysRemaining).toBe(1);

    // 5. New month day 4 -> automatic lock (locked_auto)
    const autoLocked = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-04",
      nowMs: Date.parse("2026-12-04T00:05:00.000Z"),
      settings,
      lockRow: null,
    });
    expect(autoLocked.phase).toBe("locked_auto");
    expect(autoLocked.isLocked).toBe(true);
    expect(autoLocked.isManuallyLocked).toBe(false);
    expect(autoLocked.canUnlock).toBe(true);

    // 6. Manual lock row overrides grace window immediately
    const manualLockRow: HabitMonthLockRecord = {
      userId: "u-test",
      yearMonth: "2026-11",
      status: "locked",
      lockedAt: Date.parse("2026-12-01T10:00:00.000Z"),
      unlockedAt: null,
      unlockedUntil: null,
      unlockReason: null,
      unlockCount: 0,
      updatedAt: Date.parse("2026-12-01T10:00:00.000Z"),
    };
    const manualLocked = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-01",
      nowMs: Date.parse("2026-12-01T10:05:00.000Z"),
      settings,
      lockRow: manualLockRow,
    });
    expect(manualLocked.phase).toBe("locked_manual");
    expect(manualLocked.isLocked).toBe(true);
    expect(manualLocked.isManuallyLocked).toBe(true);

    // 7. Temporary 30-min unlock window -> editable while active, auto-relocks when expired
    const unlockStart = Date.parse("2026-12-05T10:00:00.000Z");
    const tempUnlockRow: HabitMonthLockRecord = {
      userId: "u-test",
      yearMonth: "2026-11",
      status: "unlocked_override",
      lockedAt: null,
      unlockedAt: unlockStart,
      unlockedUntil: unlockStart + TEMP_UNLOCK_DURATION_MS,
      unlockReason: "Fix travel log",
      unlockCount: 1,
      updatedAt: unlockStart,
    };
    const activeTemp = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-05",
      nowMs: unlockStart + 10 * 60_000,
      settings,
      lockRow: tempUnlockRow,
    });
    expect(activeTemp.phase).toBe("unlocked_temp");
    expect(activeTemp.isLocked).toBe(false);
    expect(activeTemp.canLockNow).toBe(true);
    expect(activeTemp.remainingUnlockMinutes).toBe(20);
    expect(activeTemp.hasBeenUnlocked).toBe(true);

    const expiredTemp = evaluateMonthLockState({
      yearMonth: "2026-11",
      todayDateKey: "2026-12-05",
      nowMs: unlockStart + TEMP_UNLOCK_DURATION_MS + 1_000,
      settings,
      lockRow: tempUnlockRow,
    });
    expect(expiredTemp.phase).toBe("locked_auto");
    expect(expiredTemp.isLocked).toBe(true);
    expect(expiredTemp.unlockCount).toBe(1);

    // 8. Auto-lock disabled keeps completed months open but still allows manual locking
    const disabledSettings = makeSettings({ monthLockEnabled: false });
    const openPast = evaluateMonthLockState({
      yearMonth: "2026-08",
      todayDateKey: "2026-12-05",
      nowMs: unlockStart,
      settings: disabledSettings,
      lockRow: null,
    });
    expect(openPast.phase).toBe("open");
    expect(openPast.isLocked).toBe(false);
    expect(openPast.canLockNow).toBe(true);
  });

  it("hashes and verifies 4-6 digit PINs safely and strips secret fields from client settings", () => {
    expect(isValidMonthLockPin("1234")).toBe(true);
    expect(isValidMonthLockPin("987654")).toBe(true);
    expect(isValidMonthLockPin("123")).toBe(false);
    expect(isValidMonthLockPin("1234567")).toBe(false);
    expect(isValidMonthLockPin("12ab")).toBe(false);

    const first = hashMonthLockPin("4829");
    const second = hashMonthLockPin("4829");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(verifyMonthLockPin("4829", first.hash, first.salt)).toBe(true);
    expect(verifyMonthLockPin("0000", first.hash, first.salt)).toBe(false);
    expect(verifyMonthLockPin("4829", "short", first.salt)).toBe(false);

    const sanitized = sanitizeHabitTrackerSettings(
      makeSettings({
        monthLockPinHash: first.hash,
        monthLockPinSalt: first.salt,
        monthLockPinFailedAttempts: 2,
        monthLockPinLockedUntil: 999,
      })
    );
    expect(sanitized.hasMonthLockPin).toBe(true);
    expect("monthLockPinHash" in sanitized).toBe(false);
    expect("monthLockPinSalt" in sanitized).toBe(false);
    expect("monthLockPinFailedAttempts" in sanitized).toBe(false);
    expect("monthLockPinLockedUntil" in sanitized).toBe(false);
  });
});
