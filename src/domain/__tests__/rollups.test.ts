import { describe, expect, it } from "vitest";
import {
  computeGoalTotal,
  computeHabitRate,
  computeHoursForRange,
  computeLoanBalance,
  computeRollupVersion,
  computeRunsThisWeek,
  computeSpending,
  createPartitionedSelector,
  createRollupPartitionKey,
  getMonthRangeForDate,
  getWeekRangeForDate,
  selectGoalTotal,
  selectHabitRate,
  selectHoursForRange,
  selectLoanBalance,
  selectRunsThisWeek,
  selectSpending,
  type RollupHabitLog,
  type RollupValueEvent,
} from "@/domain/rollups";

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

  it("builds stable partition keys and versions", () => {
    expect(
      createRollupPartitionKey("u1", "rate-month", {
        start: "2026-11-01",
        end: "2026-11-30",
      })
    ).toBe("u1|rate-month|2026-11-01..2026-11-30");
    expect(
      computeRollupVersion([
        { loggedAt: 10 },
        { updatedAt: 99 },
        { loggedAt: Number.NaN },
        {},
      ])
    ).toBe(99);
  });
});

describe("partitioned selector memoization", () => {
  it("recomputes only the partition whose version changed", () => {
    let calls = 0;
    const selector = createPartitionedSelector(
      (input: { partitionKey: string; version: number; value: number }) => {
        calls += 1;
        return input.value * 2;
      }
    );

    expect(selector({ partitionKey: "nov", version: 1, value: 2 })).toBe(4);
    expect(selector({ partitionKey: "nov", version: 1, value: 99 })).toBe(4);
    expect(selector({ partitionKey: "dec", version: 1, value: 3 })).toBe(6);
    expect(selector({ partitionKey: "nov", version: 2, value: 5 })).toBe(10);
    expect(calls).toBe(3);
  });
});

describe("pure rollup selectors", () => {
  it("computes habit rate with skipped neutral and a null zero denominator", () => {
    expect(
      computeHabitRate(logs, { start: "2026-11-16", end: "2026-11-22" })
    ).toBeCloseTo(3 / 5);
    expect(
      computeHabitRate(logs, { start: "2026-11-24", end: "2026-11-30" })
    ).toBeNull();
  });

  it("computes goal total from a starting value plus linked goal values", () => {
    const values: RollupValueEvent[] = [
      { dateKey: "2026-10-01", kind: "goal", value: 2, habitId: "h1" },
      { dateKey: "2026-11-01", kind: "goal", value: 3, habitId: "h1" },
      { dateKey: "2026-11-01", kind: "goal", value: 50, habitId: "h2" },
      { dateKey: "2026-11-01", kind: "hours", value: 9, habitId: "h1" },
    ];
    expect(computeGoalTotal({ startingValue: 10, habitId: "h1", values })).toBe(15);
    expect(computeGoalTotal({ startingValue: null, habitId: "h1", values })).toBeNull();
  });

  it("computes hours for a range with optional habit filter", () => {
    const values: RollupValueEvent[] = [
      { dateKey: "2026-11-16", kind: "hours", value: 1.5, habitId: "study" },
      { dateKey: "2026-11-17", kind: "hours", value: 2, habitId: "run" },
      { dateKey: "2026-11-23", kind: "hours", value: 4, habitId: "study" },
      { dateKey: "2026-11-17", kind: "expense", value: 99, habitId: "study" },
    ];
    expect(
      computeHoursForRange({
        values,
        range: { start: "2026-11-16", end: "2026-11-22" },
      })
    ).toBe(3.5);
    expect(
      computeHoursForRange({
        values,
        range: { start: "2026-11-16", end: "2026-11-22" },
        habitIds: ["study"],
      })
    ).toBe(1.5);
  });

  it("counts each run habit once in the week and preserves the target", () => {
    expect(
      computeRunsThisWeek({
        logs,
        runHabitIds: ["h1"],
        range: { start: "2026-11-16", end: "2026-11-22" },
        target: 3,
      })
    ).toEqual({ done: 1, target: 3 });
  });

  it("computes spending and loan balance without persisting anything", () => {
    const values: RollupValueEvent[] = [
      { dateKey: "2026-11-16", kind: "expense", value: 12.5 },
      { dateKey: "2026-11-17", kind: "expense", value: 7.5 },
      { dateKey: "2026-11-20", kind: "expense", value: 100 },
      { dateKey: "2026-01-01", kind: "principal", value: 5_000 },
      { dateKey: "2026-02-01", kind: "repayment", value: 1_200 },
    ];
    expect(
      computeSpending({
        values,
        range: { start: "2026-11-16", end: "2026-11-17" },
      })
    ).toBe(20);
    expect(computeLoanBalance(values)).toBe(3_800);
  });

  it("memoizes every exported selector by partition and version", () => {
    const range = { start: "2026-11-16", end: "2026-11-22" };
    const values: RollupValueEvent[] = [
      { dateKey: "2026-11-16", kind: "hours", value: 2 },
      { dateKey: "2026-11-16", kind: "expense", value: 5 },
      { dateKey: "2026-11-16", kind: "goal", value: 1, habitId: "h1" },
      { dateKey: "2026-01-01", kind: "principal", value: 100 },
      { dateKey: "2026-02-01", kind: "repayment", value: 25 },
    ];
    const base = { partitionKey: "memo-test", version: 1 };

    expect(
      selectHabitRate({ ...base, logs, range })
    ).toBeCloseTo(3 / 5);
    expect(
      selectGoalTotal({ ...base, startingValue: 10, habitId: "h1", values })
    ).toBe(11);
    expect(selectHoursForRange({ ...base, values, range })).toBe(2);
    expect(
      selectRunsThisWeek({
        ...base,
        logs,
        range,
        runHabitIds: ["h1"],
        target: 3,
      })
    ).toEqual({ done: 1, target: 3 });
    expect(selectSpending({ ...base, values, range })).toBe(5);
    expect(selectLoanBalance({ ...base, values })).toBe(75);

    // Same partition + version returns the cached values even with new inputs.
    expect(
      selectHabitRate({
        ...base,
        logs: [],
        range,
      })
    ).toBeCloseTo(3 / 5);
    expect(
      selectHabitRate({
        ...base,
        version: 2,
        logs: [],
        range,
      })
    ).toBeNull();
  });
});
