import { describe, expect, it } from "vitest";
import {
  evaluateStreakRisk,
  formatStreakPhrase,
  getGroupWeek,
  isWithinQuietHours,
  parseGroupCycleKey,
  type StreakRiskInput,
} from "@/server/domain/habit-group-policy";

describe("Group week anchor", () => {
  it("anchors group review weeks to Monday regardless of personal week preference", () => {
    expect(getGroupWeek("2026-11-24")).toEqual({
      cycleKey: "week-2026-11-23",
      periodStartDate: "2026-11-23",
      periodEndDate: "2026-11-29",
    });
    expect(getGroupWeek("2026-11-23")).toEqual(getGroupWeek("2026-11-24"));
    expect(getGroupWeek("2026-11-22")).toEqual({
      cycleKey: "week-2026-11-16",
      periodStartDate: "2026-11-16",
      periodEndDate: "2026-11-22",
    });
  });
});

describe("parseGroupCycleKey", () => {
  const today = "2026-11-24";

  it("accepts a valid Monday cycle that is not in the future", () => {
    expect(parseGroupCycleKey("week-2026-11-23", today)).toEqual({
      cycleKey: "week-2026-11-23",
      periodStartDate: "2026-11-23",
      periodEndDate: "2026-11-29",
    });
    expect(parseGroupCycleKey("week-2026-11-16", today)).toEqual({
      cycleKey: "week-2026-11-16",
      periodStartDate: "2026-11-16",
      periodEndDate: "2026-11-22",
    });
  });

  it("rejects malformed, nonexistent, non-Monday and future cycles", () => {
    expect(parseGroupCycleKey("week-2026-11-24", today)).toBeNull();
    expect(parseGroupCycleKey("week-2026-11-31", today)).toBeNull();
    expect(parseGroupCycleKey("week-2026-13-01", today)).toBeNull();
    expect(parseGroupCycleKey("2026-11-23", today)).toBeNull();
    expect(parseGroupCycleKey("week-2026-11-30", today)).toBeNull();
  });
});

describe("Streak-risk policy", () => {
  it("handles overnight and same-day quiet-hour ranges", () => {
    expect(isWithinQuietHours("21:30", "21:00", "08:00")).toBe(true);
    expect(isWithinQuietHours("07:59", "21:00", "08:00")).toBe(true);
    expect(isWithinQuietHours("12:00", "21:00", "08:00")).toBe(false);
    expect(isWithinQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(isWithinQuietHours("14:00", "12:00", "14:00")).toBe(false);
    expect(isWithinQuietHours("bad", "21:00", "08:00")).toBe(false);
  });

  it("only nudges for established streaks and genuine risk", () => {
    const base: StreakRiskInput = {
      currentStreak: 4,
      minStreak: 2,
      scheduledToday: true,
      todayStatus: null,
      localHour: 19,
      startHour: 18,
    };

    expect(evaluateStreakRisk(base)).toEqual({
      atRisk: true,
      reason: "unlogged",
    });
    expect(
      evaluateStreakRisk({ ...base, todayStatus: "missed", localHour: 9 })
    ).toEqual({ atRisk: true, reason: "missed" });
    expect(
      evaluateStreakRisk({ ...base, todayStatus: "done", localHour: 23 })
    ).toEqual({ atRisk: false, reason: null });
    expect(evaluateStreakRisk({ ...base, todayStatus: "skipped" })).toEqual({
      atRisk: false,
      reason: null,
    });
    expect(evaluateStreakRisk({ ...base, currentStreak: 1 })).toEqual({
      atRisk: false,
      reason: null,
    });
    expect(evaluateStreakRisk({ ...base, localHour: 17 })).toEqual({
      atRisk: false,
      reason: null,
    });
    expect(evaluateStreakRisk({ ...base, scheduledToday: false })).toEqual({
      atRisk: false,
      reason: null,
    });
  });

  it("formats streak phrases with singular/plural labels", () => {
    expect(formatStreakPhrase(1, "days")).toBe("1-day");
    expect(formatStreakPhrase(4, "days")).toBe("4-day");
    expect(formatStreakPhrase(2, "weeks")).toBe("2-week");
  });
});
