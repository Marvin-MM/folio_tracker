import { describe, expect, it } from "vitest";
import {
  computeHabitRate,
  computeRunsThisWeek,
  getMonthRangeForDate,
  getWeekRangeForDate,
  type RollupHabitLog,
} from "@/server/domain/rollups";

const logs: RollupHabitLog[] = [
  { habitId: "h1", dateKey: "2026-11-16", status: "done" },
  { habitId: "h2", dateKey: "2026-11-16", status: "missed" },
  { habitId: "h1", dateKey: "2026-11-17", status: "done" },
  { habitId: "h1", dateKey: "2026-11-17", status: "skipped" },
  { habitId: "h1", dateKey: "2026-11-20", status: "missed" },
  { habitId: "h2", dateKey: "2026-11-21", status: "done" },
];

describe("rollup date helpers", () => {
  it("computes week ranges from the configured week start", () => {
    expect(getWeekRangeForDate("2026-11-18", 1)).toEqual({
      start: "2026-11-16",
      end: "2026-11-22",
    });
    expect(getWeekRangeForDate("2026-11-18", 0)).toEqual({
      start: "2026-11-15",
      end: "2026-11-21",
    });
  });

  it("computes inclusive calendar month ranges including leap years", () => {
    expect(getMonthRangeForDate("2026-02-10")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(getMonthRangeForDate("2028-02-10")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });
});

describe("request-scoped rollups", () => {
  it("computes habit rate with skipped neutral and a null zero denominator", () => {
    expect(
      computeHabitRate(logs, { start: "2026-11-16", end: "2026-11-22" })
    ).toBeCloseTo(3 / 5);
    expect(
      computeHabitRate(logs, { start: "2026-11-24", end: "2026-11-30" })
    ).toBeNull();
  });

  it("counts each completed run day, not just each run habit", () => {
    const runLogs: RollupHabitLog[] = [
      { habitId: "run", dateKey: "2026-11-16", status: "done" },
      { habitId: "run", dateKey: "2026-11-18", status: "done" },
      { habitId: "run", dateKey: "2026-11-20", status: "done" },
      { habitId: "run", dateKey: "2026-11-20", status: "skipped" },
    ];
    expect(
      computeRunsThisWeek({
        logs: runLogs,
        runHabitIds: ["run", "other"],
        range: { start: "2026-11-16", end: "2026-11-22" },
        target: 3,
      })
    ).toEqual({ done: 3, target: 3 });
  });

  it("never serves cached results for changed inputs", () => {
    const range = { start: "2026-11-16", end: "2026-11-22" };
    const first = computeHabitRate(logs, range);
    const second = computeHabitRate([], range);
    expect(first).toBeCloseTo(3 / 5);
    expect(second).toBeNull();
  });
});
