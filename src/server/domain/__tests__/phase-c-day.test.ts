import { describe, expect, it } from "vitest";
import {
  applyEffectiveStatusesToLogs,
  buildDayChecklist,
  computeDayHighlights,
  getAdjacentDateKeys,
  getWeekdayFromDateKey,
  resolveRunHabitIds,
  type PhaseCDayHabit,
  type PhaseCDayLog,
  type PhaseCExcuseRange,
} from "../phase-c-day";

const habits: PhaseCDayHabit[] = [
  {
    id: "daily",
    title: "Daily habit",
    cadenceType: "daily",
    scheduledDaysJson: "[]",
    weeklyTargetCount: null,
    startDate: "2026-11-01",
  },
  {
    id: "wednesday",
    title: "Wednesday habit",
    cadenceType: "specific_days",
    scheduledDaysJson: "[3]",
    weeklyTargetCount: null,
    startDate: "2026-11-01",
  },
  {
    id: "run",
    title: "Morning Run",
    cadenceType: "weekly_target",
    scheduledDaysJson: "[]",
    weeklyTargetCount: 3,
    startDate: "2026-11-01",
    category: "Training",
  },
];

const ranges: PhaseCExcuseRange[] = [
  {
    startDate: "2026-11-17",
    endDate: "2026-11-17",
    habitIds: ["daily"],
  },
  {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    habitIds: [],
    deletedAt: 123,
  },
];

describe("applyEffectiveStatusesToLogs", () => {
  it("preserves explicit status and adds neutral skipped rows for active excuses", () => {
    const logs: PhaseCDayLog[] = [
      {
        habitId: "daily",
        dateKey: "2026-11-16",
        status: "missed",
        missReason: "tired",
        loggedAt: 10,
      },
      { habitId: "wednesday", dateKey: "2026-11-16", status: "done" },
    ];
    const result = applyEffectiveStatusesToLogs({
      habits,
      dateKeys: ["2026-11-16", "2026-11-17"],
      logs,
      excuseRanges: ranges,
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          habitId: "daily",
          dateKey: "2026-11-16",
          status: "missed",
          missReason: "tired",
          loggedAt: 10,
        }),
        expect.objectContaining({
          habitId: "daily",
          dateKey: "2026-11-17",
          status: "skipped",
          note: null,
          missReason: null,
        }),
      ])
    );
    expect(
      result.some(
        (row) => row.habitId === "run" && row.dateKey === "2026-11-17"
      )
    ).toBe(false);
  });

  it("lets explicit logs win over excuse ranges", () => {
    const result = applyEffectiveStatusesToLogs({
      habits,
      dateKeys: ["2026-11-17"],
      logs: [
        {
          habitId: "daily",
          dateKey: "2026-11-17",
          status: "done",
          loggedAt: 44,
        },
      ],
      excuseRanges: ranges,
    });
    expect(result.find((row) => row.habitId === "daily")?.status).toBe("done");
    expect(result.find((row) => row.habitId === "daily")?.loggedAt).toBe(44);
  });
});

describe("buildDayChecklist", () => {
  it("includes scheduled habits and excused extras, excluding unscheduled habits", () => {
    const items = buildDayChecklist({
      habits,
      dateKey: "2026-11-17",
      logs: [],
      excuseRanges: ranges,
    });

    expect(items.map((item) => item.habit.id)).toEqual(["daily", "run"]);
    expect(items.find((item) => item.habit.id === "daily")).toMatchObject({
      scheduled: true,
      status: "skipped",
      log: null,
    });
    expect(items.find((item) => item.habit.id === "run")).toMatchObject({
      scheduled: true,
      status: null,
      log: null,
    });
  });

  it("includes unscheduled habits only when they carry an explicit log", () => {
    const items = buildDayChecklist({
      habits,
      dateKey: "2026-11-17",
      logs: [
        {
          habitId: "wednesday",
          dateKey: "2026-11-17",
          status: "done",
          loggedAt: 5,
        },
      ],
      excuseRanges: [],
    });

    expect(items.map((item) => item.habit.id)).toEqual([
      "daily",
      "wednesday",
      "run",
    ]);
    expect(items[1]).toMatchObject({
      scheduled: false,
      status: "done",
      log: { habitId: "wednesday", status: "done" },
    });
  });

  it("returns nothing for a date before every habit starts", () => {
    expect(
      buildDayChecklist({
        habits,
        dateKey: "2026-10-31",
        logs: [],
        excuseRanges: [],
      })
    ).toEqual([]);
  });
});

describe("computeDayHighlights", () => {
  it("scores done vs missed with skipped neutral and surfaces streak/miss details", () => {
    const checklist = buildDayChecklist({
      habits,
      dateKey: "2026-11-18",
      logs: [
        {
          habitId: "daily",
          dateKey: "2026-11-18",
          status: "done",
          loggedAt: 1,
        },
        {
          habitId: "wednesday",
          dateKey: "2026-11-18",
          status: "missed",
          missReason: "work",
          loggedAt: 2,
        },
      ],
      excuseRanges: [],
    });

    const result = computeDayHighlights({
      checklist,
      monthAverage: 0.5,
      streakByHabitId: {
        daily: { currentStreak: 4, streakUnit: "days" },
        wednesday: { currentStreak: 2, streakUnit: "weeks" },
        run: { currentStreak: 3, streakUnit: "weeks" },
      },
    });

    expect(result.score).toBeCloseTo(0.5);
    expect(result.deltaPoints).toBe(0);
    expect(result.streaksKept).toEqual([
      {
        habitId: "daily",
        title: "Daily habit",
        streak: 4,
        streakUnit: "days",
        kind: "continued",
      },
    ]);
    expect(result.misses).toEqual([
      {
        habitId: "wednesday",
        title: "Wednesday habit",
        reason: "work",
      },
    ]);
  });

  it("preserves streaks on excused rest days and returns null for no score", () => {
    const checklist = buildDayChecklist({
      habits,
      dateKey: "2026-11-17",
      logs: [],
      excuseRanges: ranges,
    });
    const result = computeDayHighlights({
      checklist,
      monthAverage: null,
      streakByHabitId: {
        daily: { currentStreak: 6, streakUnit: "days" },
        wednesday: { currentStreak: 2, streakUnit: "days" },
      },
    });

    expect(result.score).toBeNull();
    expect(result.deltaPoints).toBeNull();
    expect(result.streaksKept).toEqual([
      {
        habitId: "daily",
        title: "Daily habit",
        streak: 6,
        streakUnit: "days",
        kind: "rest-day",
      },
    ]);
  });
});

describe("run habit and date helpers", () => {
  it("detects run habits from canonical title or category with word boundaries", () => {
    const ids = resolveRunHabitIds([
      ...habits.map((habit) => ({
        id: habit.id,
        title: habit.title,
        category: habit.category ?? null,
      })),
      {
        id: "sprint",
        title: "Sprint intervals",
        category: "Training",
      },
      {
        id: "runway",
        title: "Runway planning",
        category: null,
      },
    ]);
    expect(ids).toEqual(["run"]);
  });

  it("computes adjacent dates and blocks navigation past today", () => {
    expect(getAdjacentDateKeys("2026-11-16", "2026-11-18")).toEqual({
      previousDateKey: "2026-11-15",
      nextDateKey: "2026-11-17",
    });
    expect(getAdjacentDateKeys("2026-11-18", "2026-11-18")).toEqual({
      previousDateKey: "2026-11-17",
      nextDateKey: null,
    });
    expect(getAdjacentDateKeys("2026-01-01", "2026-11-18")).toEqual({
      previousDateKey: "2025-12-31",
      nextDateKey: "2026-01-02",
    });
  });

  it("maps a date key to a weekday number", () => {
    expect(getWeekdayFromDateKey("2026-11-18")).toBe(3);
    expect(getWeekdayFromDateKey("2026-11-15")).toBe(0);
  });
});
