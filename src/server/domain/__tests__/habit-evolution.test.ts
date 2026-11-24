import { describe, expect, it } from "vitest";
import {
  normalizeImportTitle,
  parseAliasOverrides,
  planHabitEvolution,
  resolveCanonicalTitle,
  titleSimilarity,
  type MonthRoster,
} from "../habit-evolution";

function roster(month: string, titles: string[]): MonthRoster {
  return { month, titles };
}

describe("habit evolution planning", () => {
  it("normalizes titles without losing distinguishing parenthetical detail", () => {
    expect(normalizeImportTitle("Wake up at 4:30")).toBe("wake up at 4 30");
    expect(normalizeImportTitle("Hydrate (Full Black Bottle)")).toBe(
      "hydrate full black bottle"
    );
  });

  it("matches renames but keeps similarly named distinct habits apart", () => {
    expect(titleSimilarity("Wake up at 4:30", "Wake up 4:30")).toBeGreaterThan(0.6);
    expect(titleSimilarity("Journal", "Journal (Dialy Prompt Challenge )")).toBeGreaterThan(0.6);
    expect(titleSimilarity("Edu - Podcasts", "French + podcast")).toBeLessThan(0.6);
    // Distinct parenthetical qualifiers stay separate so they do not falsely auto-merge
    expect(
      titleSimilarity("Hydrate (Full Black Bottle)", "Hydrate (Hot spices)")
    ).toBeLessThan(0.6);
  });

  it("keeps a renamed habit as one identity across months", () => {
    const plan = planHabitEvolution([
      roster("2026-01", ["Wake up at 4:30", "Meditate"]),
      roster("2026-02", ["Wake up 4:30", "Meditate"]),
      roster("2026-03", ["Wake up 4:30", "Meditate"]),
    ]);

    expect(plan.groups).toHaveLength(2);
    const wake = plan.groups.find((g) => g.canonicalTitle === "Wake up 4:30");
    expect(wake?.aliases).toEqual(["Wake up at 4:30"]);
    expect(wake?.firstMonth).toBe("2026-01");
    expect(wake?.lastMonth).toBe("2026-03");
  });

  it("merges several old habits into a single later habit", () => {
    const plan = planHabitEvolution([
      roster("2026-01", ["Pray and read Daily Text", "Meditate", "Gratitude"]),
      roster("2026-02", ["Meditate", "Gratitude"]),
      roster("2026-03", ["Pray · Meditate · Gratitude"]),
    ]);

    const merged = plan.groups.find(
      (g) => g.canonicalTitle === "Pray · Meditate · Gratitude"
    );
    expect(merged?.aliases).toEqual(["Gratitude", "Meditate"]);
    expect(merged?.isMerge).toBe(true);
    expect(plan.groups.some((g) => g.canonicalTitle === "Pray and read Daily Text")).toBe(true);
    expect(
      plan.suggestions.some(
        (s) =>
          s.sourceTitle === "Pray and read Daily Text" &&
          s.canonicalTitle === "Pray · Meditate · Gratitude"
      )
    ).toBe(true);
  });

  it("tracks added and removed habits from month rosters", () => {
    const plan = planHabitEvolution([
      roster("2026-01", ["Chores", "Odoo Documentation"]),
      roster("2026-02", ["Chores", "100 Push-ups"]),
      roster("2026-03", ["Chores", "100 Push-ups"]),
    ]);

    expect(plan.firstMonth).toBe("2026-01");
    expect(plan.lastMonth).toBe("2026-03");
    const odoo = plan.groups.find((g) => g.canonicalTitle === "Odoo Documentation");
    expect(odoo?.lastMonth).toBe("2026-01");
    const pushups = plan.groups.find((g) => g.canonicalTitle === "100 Push-ups");
    expect(pushups?.firstMonth).toBe("2026-02");
  });

  it("applies explicit overrides and resolves aliases", () => {
    const rosters = [
      roster("2026-01", ["Pray and read Daily Text"]),
      roster("2026-02", ["Pray · Meditate · Gratitude"]),
    ];
    const overrides = parseAliasOverrides(
      "Source Title,Canonical Title\nPray and read Daily Text,Pray · Meditate · Gratitude"
    ).overrides;

    expect(overrides).toHaveLength(1);
    const plan = planHabitEvolution(rosters, overrides);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.aliases).toEqual(["Pray and read Daily Text"]);
    expect(
      resolveCanonicalTitle("Pray and read Daily Text", plan, overrides)
    ).toBe("Pray · Meditate · Gratitude");
  });

  it("does not merge habits that coexist in the same month", () => {
    const plan = planHabitEvolution([
      roster("2026-01", ["No Sugar", "No Junk Food"]),
      roster("2026-02", ["No Sugar", "No Junk Food"]),
    ]);
    expect(plan.groups).toHaveLength(2);
  });
});

describe("alias override parsing", () => {
  it("rejects rows without both columns", () => {
    const result = parseAliasOverrides("Only a title");
    expect(result.error).toBeDefined();
    expect(result.overrides).toEqual([]);
  });

  it("deduplicates normalized source titles", () => {
    const result = parseAliasOverrides("Old Name,Current\nold  name,Current");
    expect(result.overrides).toHaveLength(1);
  });
});
