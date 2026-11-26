import { describe, expect, it } from "vitest";
import {
  buildMonthCalendar,
  computeHabitMonthAnalytics,
  computeHabitStreaks,
  computeIsBackfilledLate,
  getLocalDateKey,
  parseBulkHabitImport,
  type AnalyticsHabitInput,
  type AnalyticsHabitLogInput,
} from "@/server/domain/habit-analytics";

describe("habit-analytics pure domain engine", () => {
  describe("real calendar alignment across 28/29/30/31-day months", () => {
    it("builds exact 28-day Feb 2026 and 29-day leap Feb 2024 calendars", () => {
      const feb2026 = buildMonthCalendar("2026-02", 1);
      expect(feb2026.daysInMonth).toBe(28);
      expect(feb2026.days).toHaveLength(28);
      expect(feb2026.days[0]?.dateKey).toBe("2026-02-01");
      expect(feb2026.days[27]?.dateKey).toBe("2026-02-28");
      // Feb 1 2026 is Sunday -> W1 is solo Sun Feb 1 when weekStartsOn = Mon
      expect(feb2026.weeks[0]?.days.map((d) => d.dayOfMonth)).toEqual([1]);
      expect(feb2026.weeks.flatMap((w) => w.days)).toHaveLength(28);

      const feb2024 = buildMonthCalendar("2024-02", 0);
      expect(feb2024.daysInMonth).toBe(29);
      expect(feb2024.days[28]?.dateKey).toBe("2024-02-29");
      expect(feb2024.weeks.flatMap((w) => w.days)).toHaveLength(29);
    });

    it("includes days 29, 30, and 31 in 30-day and 31-day months (both grid and chart series)", () => {
      const nov = buildMonthCalendar("2026-11", 1);
      expect(nov.daysInMonth).toBe(30);
      expect(nov.days.map((d) => d.dayOfMonth)).toContain(29);
      expect(nov.days.map((d) => d.dayOfMonth)).toContain(30);

      const dec = buildMonthCalendar("2026-12", 1);
      expect(dec.daysInMonth).toBe(31);
      expect(dec.days.map((d) => d.dayOfMonth)).toContain(29);
      expect(dec.days.map((d) => d.dayOfMonth)).toContain(30);
      expect(dec.days.map((d) => d.dayOfMonth)).toContain(31);

      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "Daily read",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-12-01",
        },
      ];
      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-12",
        todayDateKey: "2026-12-31",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs: [
          { habitId: "h1", dateKey: "2026-12-29", status: "done" },
          { habitId: "h1", dateKey: "2026-12-30", status: "done" },
          { habitId: "h1", dateKey: "2026-12-31", status: "done" },
        ],
      });

      expect(analytics.dailySeries).toHaveLength(31);
      expect(analytics.dailySeries[28]?.dateKey).toBe("2026-12-29");
      expect(analytics.dailySeries[28]?.completionRate).toBe(100);
      expect(analytics.dailySeries[29]?.dateKey).toBe("2026-12-30");
      expect(analytics.dailySeries[30]?.dateKey).toBe("2026-12-31");
      expect(analytics.dailySeries[30]?.completionRate).toBe(100);
    });
  });

  describe("honest elapsed-to-date scoring, startDate, skipped exclusion, and weekly_target", () => {
    it("prevents denominator distortion for mid-month startDate and compares elapsed vs full_month", () => {
      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "Mid-month starter",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-15",
        },
      ];
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h1", dateKey: "2026-11-15", status: "done" },
        { habitId: "h1", dateKey: "2026-11-16", status: "done" },
        { habitId: "h1", dateKey: "2026-11-17", status: "done" },
        { habitId: "h1", dateKey: "2026-11-18", status: "done" },
      ];

      const elapsed = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-18",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs,
      });

      expect(elapsed.byHabitId.h1?.scheduledCount).toBe(4);
      expect(elapsed.byHabitId.h1?.doneCount).toBe(4);
      expect(elapsed.byHabitId.h1?.completionRate).toBe(1);
      expect(elapsed.monthlyProgress.rate).toBe(1);

      const fullMonth = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-18",
        weekStartsOn: 1,
        scoringMode: "full_month",
        habits,
        logs,
      });

      // Nov 15..30 inclusive = 16 days
      expect(fullMonth.byHabitId.h1?.scheduledCount).toBe(16);
      expect(fullMonth.byHabitId.h1?.completionRate).toBeCloseTo(4 / 16, 6);
    });

    it("computes monthly progress as unweighted average of per-habit completion rates", () => {
      // h1: 9/10 = 90%, h2: 1/4 scheduled days = 25%
      // Weighted would be 10/14 = 71.43%; unweighted average should be 57.5%.
      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "High volume",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h2",
          title: "Low volume",
          cadenceType: "specific_days",
          scheduledDays: [1, 2], // Mon/Tue only
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
      ];
      const logs: AnalyticsHabitLogInput[] = [];
      for (let d = 1; d <= 9; d++) logs.push({ habitId: "h1", dateKey: `2026-11-${String(d).padStart(2, "0")}`, status: "done" });
      logs.push({ habitId: "h1", dateKey: "2026-11-10", status: "missed" });
      // 2026-11-02 is Mon, 2026-11-03 is Tue, 2026-11-09 Mon, 2026-11-10 Tue in range
      logs.push({ habitId: "h2", dateKey: "2026-11-02", status: "done" });
      logs.push({ habitId: "h2", dateKey: "2026-11-03", status: "missed" });
      logs.push({ habitId: "h2", dateKey: "2026-11-09", status: "missed" });
      logs.push({ habitId: "h2", dateKey: "2026-11-10", status: "missed" });

      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-10",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs,
      });

      // h1: 9/10 = 90%, h2: 1/4 = 25%
      // Weighted = 10/14 = 71.43%; unweighted average = 57.5%
      expect(analytics.byHabitId.h1?.completionRate).toBeCloseTo(0.9, 6);
      expect(analytics.byHabitId.h2?.completionRate).toBeCloseTo(0.25, 6);
      expect(analytics.monthlyProgress.rate).toBeCloseTo(0.575, 6);
    });

    it("excludes unscored (null-rate) habits from monthly average and returns null when none are scored", () => {
      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "Scored habit",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h2",
          title: "All-skipped habit",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h3",
          title: "Starts later in month",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-20",
        },
      ];
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h1", dateKey: "2026-11-01", status: "done" },
        { habitId: "h1", dateKey: "2026-11-02", status: "missed" },
        { habitId: "h2", dateKey: "2026-11-01", status: "skipped" },
        { habitId: "h2", dateKey: "2026-11-02", status: "skipped" },
      ];

      const mixed = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-02",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs,
      });

      expect(mixed.byHabitId.h1?.completionRate).toBeCloseTo(0.5, 6);
      expect(mixed.byHabitId.h2?.completionRate).toBeNull();
      expect(mixed.byHabitId.h3?.completionRate).toBeNull();
      // Only h1 is scored -> average is 50%, not 50%/3
      expect(mixed.monthlyProgress.rate).toBeCloseTo(0.5, 6);

      const allUnscored = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-02",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits: [habits[1]!, habits[2]!],
        logs: logs.filter((l) => l.habitId !== "h1"),
      });

      expect(allUnscored.monthlyProgress.rate).toBeNull();
    });

    it("excludes 'skipped' rest days from denominators and preserves active streaks", () => {
      const habit: AnalyticsHabitInput = {
        id: "h1",
        title: "Running",
        cadenceType: "daily",
        scheduledDays: [],
        weeklyTargetCount: null,
        startDate: "2026-11-01",
      };
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h1", dateKey: "2026-11-01", status: "done" },
        { habitId: "h1", dateKey: "2026-11-02", status: "done" },
        { habitId: "h1", dateKey: "2026-11-03", status: "skipped" },
        { habitId: "h1", dateKey: "2026-11-04", status: "done" },
        // Nov 5 (today) is unlogged -> shouldn't break streak!
      ];

      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-05",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits: [habit],
        logs,
      });

      // 5 elapsed days minus 1 skipped = 4 effective denominator; 3 done = 75%
      expect(analytics.byHabitId.h1?.skippedCount).toBe(1);
      expect(analytics.byHabitId.h1?.scheduledCount).toBe(4);
      expect(analytics.byHabitId.h1?.completionRate).toBeCloseTo(3 / 4, 6);
      expect(analytics.byHabitId.h1?.currentStreak).toBe(3);
      expect(analytics.byHabitId.h1?.bestStreak).toBe(3);

      // Verify computeHabitStreaks explicitly breaks on 'missed'
      const brokenMap = new Map([
        ["2026-11-01", "done" as const],
        ["2026-11-02", "missed" as const],
        ["2026-11-03", "done" as const],
      ]);
      const broken = computeHabitStreaks(habit, brokenMap, "2026-11-03", 1);
      expect(broken.currentStreak).toBe(1);
      expect(broken.bestStreak).toBe(1);
    });

    it("scores weekly_target habits fairly in full weeks and partial edge weeks", () => {
      // Nov 2026 (weekStartsOn=1):
      // W1: Sun Nov 1 (1 day partial edge week) -> effective target min(4, 1) = 1
      // W2: Mon Nov 2 .. Sun Nov 8 (7 days) -> effective target min(4, 7) = 4
      const habit: AnalyticsHabitInput = {
        id: "h-wk",
        title: "Strength training",
        cadenceType: "weekly_target",
        scheduledDays: [],
        weeklyTargetCount: 4,
        startDate: "2026-11-01",
      };
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h-wk", dateKey: "2026-11-01", status: "done" }, // 1/1 in W1
        { habitId: "h-wk", dateKey: "2026-11-02", status: "done" },
        { habitId: "h-wk", dateKey: "2026-11-04", status: "done" },
        { habitId: "h-wk", dateKey: "2026-11-06", status: "done" },
        { habitId: "h-wk", dateKey: "2026-11-08", status: "done" }, // 4/4 in W2
      ];

      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-08",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits: [habit],
        logs,
      });

      expect(analytics.byHabitId["h-wk"]?.scheduledCount).toBe(5);
      expect(analytics.byHabitId["h-wk"]?.doneCount).toBe(5);
      expect(analytics.byHabitId["h-wk"]?.completionRate).toBe(1);
      expect(analytics.byHabitId["h-wk"]?.streakUnit).toBe("weeks");
      expect(analytics.byHabitId["h-wk"]?.currentStreak).toBe(2);
      expect(analytics.weeklySeries[0]?.completionRate).toBe(100);
      expect(analytics.weeklySeries[1]?.completionRate).toBe(100);
      expect(analytics.weeklySeries[1]?.deltaFromPrevPct).toBe(0);
    });
  });

  describe("Best Habit & Needs Attention tie-awareness (zero self-duplication)", () => {
    it("returns needsAttention = null when all qualifying habits are tied at the same rate", () => {
      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "Git commit",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h2",
          title: "Morning walk",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
      ];
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h1", dateKey: "2026-11-01", status: "done" },
        { habitId: "h1", dateKey: "2026-11-02", status: "done" },
        { habitId: "h1", dateKey: "2026-11-03", status: "done" },
        { habitId: "h2", dateKey: "2026-11-01", status: "done" },
        { habitId: "h2", dateKey: "2026-11-02", status: "done" },
        { habitId: "h2", dateKey: "2026-11-03", status: "done" },
      ];

      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-03",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs,
      });

      expect(analytics.bestHabit).toEqual({
        primaryTitle: "Git commit",
        tieCount: 1,
        tiedTitles: ["Git commit", "Morning walk"],
        rate: 1,
      });
      // Must NOT show the same tied habits as Needs Attention!
      expect(analytics.needsAttention).toBeNull();
    });

    it("excludes habits with fewer than 3 elapsed scheduled days and reports distinct Best vs Needs Attention", () => {
      const habits: AnalyticsHabitInput[] = [
        {
          id: "h1",
          title: "Meditation",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h2",
          title: "Reading",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-01",
        },
        {
          id: "h3",
          title: "Brand new habit",
          cadenceType: "daily",
          scheduledDays: [],
          weeklyTargetCount: null,
          startDate: "2026-11-04", // only 2 elapsed days on Nov 5 -> ineligible
        },
      ];
      const logs: AnalyticsHabitLogInput[] = [
        { habitId: "h1", dateKey: "2026-11-01", status: "done" },
        { habitId: "h1", dateKey: "2026-11-02", status: "done" },
        { habitId: "h1", dateKey: "2026-11-03", status: "done" },
        { habitId: "h1", dateKey: "2026-11-04", status: "done" },
        { habitId: "h1", dateKey: "2026-11-05", status: "done" },
        { habitId: "h2", dateKey: "2026-11-01", status: "done" },
        { habitId: "h2", dateKey: "2026-11-02", status: "missed" },
      ];

      const analytics = computeHabitMonthAnalytics({
        yearMonth: "2026-11",
        todayDateKey: "2026-11-05",
        weekStartsOn: 1,
        scoringMode: "elapsed",
        habits,
        logs,
      });

      expect(analytics.byHabitId.h3?.eligibleForRanking).toBe(false);
      expect(analytics.bestHabit?.primaryTitle).toBe("Meditation");
      expect(analytics.bestHabit?.rate).toBe(1);
      expect(analytics.needsAttention?.primaryTitle).toBe("Reading");
      expect(analytics.needsAttention?.rate).toBeCloseTo(1 / 5, 6);
    });
  });

  describe("48-hour retroactive backfill detection across IANA timezones", () => {
    it("flags logs >48h past local end-of-day accurately in Africa/Kampala, America/New_York, and UTC", () => {
      // Africa/Kampala is UTC+3. End-of-day for 2026-11-10 is 2026-11-10T23:59:59.999+03:00 = 2026-11-10T20:59:59.999Z
      // +48h threshold is 2026-11-12T20:59:59.999Z
      const justBefore48hKampala = Date.parse("2026-11-12T20:59:00.000Z");
      const justAfter48hKampala = Date.parse("2026-11-12T21:01:00.000Z");

      expect(
        computeIsBackfilledLate("2026-11-10", justBefore48hKampala, "Africa/Kampala")
      ).toBe(false);
      expect(
        computeIsBackfilledLate("2026-11-10", justAfter48hKampala, "Africa/Kampala")
      ).toBe(true);

      // Same instant 2026-11-12T21:01:00Z in UTC is still within 48h of 2026-11-10T23:59:59.999Z!
      expect(
        computeIsBackfilledLate("2026-11-10", justAfter48hKampala, "UTC")
      ).toBe(false);

      // America/New_York in Nov (EST = UTC-5): end-of-day 2026-11-10 is 2026-11-11T04:59:59.999Z
      // +48h threshold is 2026-11-13T04:59:59.999Z
      expect(
        computeIsBackfilledLate(
          "2026-11-10",
          Date.parse("2026-11-13T04:50:00.000Z"),
          "America/New_York"
        )
      ).toBe(false);
      expect(
        computeIsBackfilledLate(
          "2026-11-10",
          Date.parse("2026-11-13T05:05:00.000Z"),
          "America/New_York"
        )
      ).toBe(true);

      // Verify getLocalDateKey shifts across midnight in Kampala
      expect(
        getLocalDateKey(Date.parse("2026-11-10T21:30:00.000Z"), "Africa/Kampala")
      ).toBe("2026-11-11");
      expect(
        getLocalDateKey(Date.parse("2026-11-10T21:30:00.000Z"), "UTC")
      ).toBe("2026-11-10");
    });
  });

  describe("bulk CSV and newline habit import parser", () => {
    it("parses CSV with header, cadences, preferredTime, and deduplicates titles", () => {
      const parsed = parseBulkHabitImport(`title,category,cadence,preferredTime
Morning walk,Health,daily,07:00
Strength training,Fitness,4x,17:30
Daily Git commit,Craft,weekdays,18:00
morning walk,Health,daily,08:00`);

      expect(parsed.error).toBeUndefined();
      expect(parsed.rows).toHaveLength(3);
      expect(parsed.rows[0]).toMatchObject({
        title: "Morning walk",
        category: "Health",
        cadenceType: "daily",
        preferredTime: "07:00",
      });
      expect(parsed.rows[1]).toMatchObject({
        title: "Strength training",
        cadenceType: "weekly_target",
        weeklyTargetCount: 4,
        preferredTime: "17:30",
      });
      expect(parsed.rows[2]).toMatchObject({
        title: "Daily Git commit",
        cadenceType: "specific_days",
        scheduledDays: [1, 2, 3, 4, 5],
      });
    });

    it("rejects imports exceeding 50 rows", () => {
      const raw = Array.from({ length: 51 }, (_, i) => `Habit ${i + 1}`).join(
        "\n"
      );
      const parsed = parseBulkHabitImport(raw);
      expect(parsed.rows).toHaveLength(0);
      expect(parsed.error).toMatch(/50/);
    });
  });
});
