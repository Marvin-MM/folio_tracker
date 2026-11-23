import { describe, expect, it } from "vitest";
import {
  didWindowOpenWithinLookback,
  evaluateCommentWindow,
  formatPolicyBadge,
  resolveEffectivePolicy,
  type MonitorPolicyOverrideInput,
  type PolicySettingsInput,
} from "@/server/domain/comment-window-policy";

const BASE_GLOBAL_SETTINGS: PolicySettingsInput = {
  defaultCommentMode: "weekly_window",
  defaultWindowStartDay: 6, // Saturday
  defaultWindowStartTime: "00:00",
  defaultWindowEndDay: 0, // Sunday
  defaultWindowEndTime: "23:59",
  defaultIntervalDays: 4,
  defaultIntervalAnchorDate: "2026-11-01",
  defaultIntervalOpenHours: 24,
  allowReactionsWhenLocked: true,
};

describe("comment-window-policy pure domain engine", () => {
  it("enforces default Sat 00:00 -> Sun 23:59 window boundaries accurately in Africa/Kampala (UTC+3)", () => {
    const policy = resolveEffectivePolicy(BASE_GLOBAL_SETTINGS, null);
    expect(policy.source).toBe("global");

    // 2026-11-20 is Friday, 2026-11-21 is Saturday, 2026-11-22 is Sunday, 2026-11-23 is Monday
    // Friday 23:59 EAT = 2026-11-20T20:59:00Z -> LOCKED
    const friLate = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-20T20:59:00.000Z")
    );
    expect(friLate.isOpen).toBe(false);
    expect(friLate.summary).toContain("Sat 00:00");

    // Saturday 00:00 EAT = 2026-11-20T21:00:00Z -> OPEN
    const satStart = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-20T21:00:00.000Z")
    );
    expect(satStart.isOpen).toBe(true);
    expect(satStart.cycleKey).toBe("2026-W47");
    expect(satStart.summary).toContain("Sun 23:59");

    // Sunday 23:59 EAT = 2026-11-22T20:59:30Z -> STILL OPEN
    const sunEnd = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-22T20:59:30.000Z")
    );
    expect(sunEnd.isOpen).toBe(true);
    expect(sunEnd.cycleKey).toBe("2026-W47");

    // Monday 00:01 EAT = 2026-11-22T21:01:00Z -> LOCKED
    const monEarly = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-22T21:01:00.000Z")
    );
    expect(monEarly.isOpen).toBe(false);
    expect(monEarly.lastClosedCycleKey).toBe("2026-W47");
    expect(monEarly.summary).toContain("Opens Sat 00:00");
  });

  it("handles cross-midnight wrap-around weekly windows (Sun 18:00 -> Mon 12:00) under one cycleKey", () => {
    const wrapPolicy = resolveEffectivePolicy(
      {
        ...BASE_GLOBAL_SETTINGS,
        defaultWindowStartDay: 0, // Sun
        defaultWindowStartTime: "18:00",
        defaultWindowEndDay: 1, // Mon
        defaultWindowEndTime: "12:00",
      },
      null
    );

    // Sun 17:59 EAT (2026-11-22T14:59Z) -> LOCKED
    expect(
      evaluateCommentWindow(
        wrapPolicy,
        "Africa/Kampala",
        Date.parse("2026-11-22T14:59:00.000Z")
      ).isOpen
    ).toBe(false);

    // Sun 18:00 EAT (2026-11-22T15:00Z) -> OPEN
    const sunOpen = evaluateCommentWindow(
      wrapPolicy,
      "Africa/Kampala",
      Date.parse("2026-11-22T15:00:00.000Z")
    );
    expect(sunOpen.isOpen).toBe(true);

    // Mon 11:59 EAT (2026-11-23T08:59Z) -> STILL OPEN with SAME cycleKey!
    const monStillOpen = evaluateCommentWindow(
      wrapPolicy,
      "Africa/Kampala",
      Date.parse("2026-11-23T08:59:00.000Z")
    );
    expect(monStillOpen.isOpen).toBe(true);
    expect(monStillOpen.cycleKey).toBe(sunOpen.cycleKey);

    // Mon 12:01 EAT (2026-11-23T09:01Z) -> LOCKED
    expect(
      evaluateCommentWindow(
        wrapPolicy,
        "Africa/Kampala",
        Date.parse("2026-11-23T09:01:00.000Z")
      ).isOpen
    ).toBe(false);
  });

  it("evaluates interval_days mode accurately for 4-day and 5-day cycles with exact open durations", () => {
    // Anchor: 2026-11-01, every 4 days, open 24h at end of cycle -> Cycle 0 ends 2026-11-04 (open Nov 4 00:00..23:59)
    const every4d = resolveEffectivePolicy(
      {
        ...BASE_GLOBAL_SETTINGS,
        defaultCommentMode: "interval_days",
        defaultIntervalDays: 4,
        defaultIntervalAnchorDate: "2026-11-01",
        defaultIntervalOpenHours: 24,
      },
      null
    );

    // Nov 3 12:00 UTC -> LOCKED (next review opens Nov 4 00:00)
    const nov3 = evaluateCommentWindow(
      every4d,
      "UTC",
      Date.parse("2026-11-03T12:00:00.000Z")
    );
    expect(nov3.isOpen).toBe(false);
    expect(nov3.cycleKey).toBe("2026-11-04_4d");
    expect(nov3.summary).toContain("4-day review opens Wed 00:00");

    // Nov 4 10:00 UTC -> OPEN (14h remaining)
    const nov4 = evaluateCommentWindow(
      every4d,
      "UTC",
      Date.parse("2026-11-04T10:00:00.000Z")
    );
    expect(nov4.isOpen).toBe(true);
    expect(nov4.cycleKey).toBe("2026-11-04_4d");
    expect(nov4.summary).toBe("4-day check-in open for 14h");

    // Nov 5 00:01 UTC -> LOCKED (next cycle ends Nov 8)
    const nov5 = evaluateCommentWindow(
      every4d,
      "UTC",
      Date.parse("2026-11-05T00:01:00.000Z")
    );
    expect(nov5.isOpen).toBe(false);
    expect(nov5.cycleKey).toBe("2026-11-08_4d");

    // Every 5 days, open 48h -> Cycle 0 is Nov 1..5, open Nov 4 00:00 .. Nov 5 23:59
    const every5d48h = resolveEffectivePolicy(
      {
        ...BASE_GLOBAL_SETTINGS,
        defaultCommentMode: "interval_days",
        defaultIntervalDays: 5,
        defaultIntervalAnchorDate: "2026-11-01",
        defaultIntervalOpenHours: 48,
      },
      null
    );

    expect(
      evaluateCommentWindow(
        every5d48h,
        "UTC",
        Date.parse("2026-11-03T23:59:00.000Z")
      ).isOpen
    ).toBe(false);
    const nov4Open5d = evaluateCommentWindow(
      every5d48h,
      "UTC",
      Date.parse("2026-11-04T00:00:00.000Z")
    );
    expect(nov4Open5d.isOpen).toBe(true);
    expect(nov4Open5d.cycleKey).toBe("2026-11-05_5d");
  });

  it("supports anytime mode and distinguishes Global Inheritance vs Per-Monitor Custom Overrides", () => {
    const inheritingMonitor: MonitorPolicyOverrideInput = {
      useCustomPolicy: false,
      customCommentMode: null,
      customWindowStartDay: null,
      customWindowStartTime: null,
      customWindowEndDay: null,
      customWindowEndTime: null,
      customIntervalDays: null,
      customIntervalAnchorDate: null,
      customIntervalOpenHours: null,
      customAllowReactionsWhenLocked: null,
    };

    const customMonitor: MonitorPolicyOverrideInput = {
      useCustomPolicy: true,
      customCommentMode: "interval_days",
      customWindowStartDay: null,
      customWindowStartTime: null,
      customWindowEndDay: null,
      customWindowEndTime: null,
      customIntervalDays: 4,
      customIntervalAnchorDate: "2026-11-01",
      customIntervalOpenHours: 24,
      customAllowReactionsWhenLocked: false,
    };

    // Change global settings to 'anytime' -> inheriting monitor updates immediately, custom monitor stays on 4-day interval!
    const updatedGlobal: PolicySettingsInput = {
      ...BASE_GLOBAL_SETTINGS,
      defaultCommentMode: "anytime",
    };

    const resolvedInherited = resolveEffectivePolicy(
      updatedGlobal,
      inheritingMonitor
    );
    const resolvedCustom = resolveEffectivePolicy(updatedGlobal, customMonitor);

    expect(resolvedInherited.source).toBe("global");
    expect(resolvedInherited.mode).toBe("anytime");
    expect(formatPolicyBadge(resolvedInherited)).toBe("Inherits Global");

    const anytimeEval = evaluateCommentWindow(
      resolvedInherited,
      "Africa/Kampala",
      Date.parse("2026-11-18T12:00:00.000Z")
    );
    expect(anytimeEval.isOpen).toBe(true);
    expect(anytimeEval.summary).toBe("Review open anytime");

    expect(resolvedCustom.source).toBe("custom");
    expect(resolvedCustom.mode).toBe("interval_days");
    expect(resolvedCustom.intervalDays).toBe(4);
    expect(resolvedCustom.allowReactionsWhenLocked).toBe(false);
    expect(formatPolicyBadge(resolvedCustom)).toBe("Custom: Every 4 days");
  });

  it("detects closed -> open transition cleanly within the 65-minute digest lookback", () => {
    const policy = resolveEffectivePolicy(BASE_GLOBAL_SETTINGS, null);
    // Sat 00:15 EAT = 2026-11-20T21:15:00Z (15m after Sat 00:00 open)
    const opened15mAgo = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-20T21:15:00.000Z")
    );
    expect(
      didWindowOpenWithinLookback(
        opened15mAgo,
        Date.parse("2026-11-20T21:15:00.000Z")
      )
    ).toBe(true);

    // Sat 02:00 EAT = 2026-11-20T23:00:00Z (2h after open -> should NOT re-trigger)
    const opened2hAgo = evaluateCommentWindow(
      policy,
      "Africa/Kampala",
      Date.parse("2026-11-20T23:00:00.000Z")
    );
    expect(
      didWindowOpenWithinLookback(
        opened2hAgo,
        Date.parse("2026-11-20T23:00:00.000Z")
      )
    ).toBe(false);
  });
});
