import { describe, expect, it } from "vitest";
import {
  getEffectiveHabitStatus,
  getEffectiveStatusMap,
  type EffectiveStatusExcuseRange,
} from "../effectiveStatus";

describe("effective habit status", () => {
  const ranges: EffectiveStatusExcuseRange[] = [
    { startDate: "2026-11-10", endDate: "2026-11-12", habitIds: [] },
    { startDate: "2026-11-14", endDate: "2026-11-14", habitIds: ["h2"] },
    {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      habitIds: [],
      deletedAt: 123,
    },
  ];

  it("prefers explicit logs over excuse ranges", () => {
    expect(
      getEffectiveHabitStatus({
        habitId: "h1",
        dateKey: "2026-11-10",
        log: { habitId: "h1", dateKey: "2026-11-10", status: "done" },
        excuseRanges: ranges,
      })
    ).toBe("done");
  });

  it("maps active excuse ranges to skipped (neutral/excused)", () => {
    expect(
      getEffectiveHabitStatus({
        habitId: "h1",
        dateKey: "2026-11-11",
        excuseRanges: ranges,
      })
    ).toBe("skipped");
  });

  it("respects habit subset and deleted ranges", () => {
    expect(
      getEffectiveHabitStatus({
        habitId: "h1",
        dateKey: "2026-11-14",
        excuseRanges: ranges,
      })
    ).toBeNull();
    expect(
      getEffectiveHabitStatus({
        habitId: "h2",
        dateKey: "2026-11-14",
        excuseRanges: ranges,
      })
    ).toBe("skipped");
    expect(
      getEffectiveHabitStatus({
        habitId: "h1",
        dateKey: "2026-11-05",
        excuseRanges: ranges,
      })
    ).toBeNull();
  });

  it("builds a memoizable keyed map for a habit/date partition", () => {
    const map = getEffectiveStatusMap({
      habitIds: ["h1", "h2"],
      dateKeys: ["2026-11-11", "2026-11-14", "2026-11-15"],
      logs: [
        {
          habitId: "h2",
          dateKey: "2026-11-11",
          status: "missed",
        },
      ],
      excuseRanges: ranges,
    });
    expect(map.get("h1|2026-11-11")).toBe("skipped");
    expect(map.get("h2|2026-11-11")).toBe("missed");
    expect(map.get("h2|2026-11-14")).toBe("skipped");
    expect(map.get("h1|2026-11-15")).toBeNull();
  });
});
