import { describe, expect, it } from "vitest";
import {
  getGroupWeek,
  parseGroupCycleKey,
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
