import { describe, expect, it } from "vitest";
import {
  BUILT_IN_VIEWS,
  builtInViewId,
  filterHabitsForView,
  isBuiltInViewId,
  mergeHabitViews,
  normalizeSavedViewFilter,
  parseSavedViewFilter,
  rowToSavedView,
  seedBuiltInViews,
  serializeSavedViewFilter,
  type FilterHabitLike,
  type HabitSavedView,
} from "@/server/domain/habit-views";

function makeView(overrides: Partial<HabitSavedView> = {}): HabitSavedView {
  return {
    id: "custom:view",
    name: "Custom",
    kind: "today",
    builtIn: false,
    hidden: false,
    order: 0,
    filter: {},
    groupBy: "none",
    sortBy: "order",
    updatedAt: 100,
    ...overrides,
  };
}

function makeHabit(overrides: Partial<FilterHabitLike> = {}): FilterHabitLike {
  return {
    id: "habit",
    title: "Habit",
    category: null,
    preferredTime: null,
    cadenceType: "daily",
    scheduledDaysJson: "[]",
    energyNeed: "medium",
    place: "anywhere",
    tagsJson: "[]",
    position: "000",
    ...overrides,
  };
}

const sampleHabits: FilterHabitLike[] = [
  makeHabit({
    id: "anchor",
    title: "Wake up 4:30",
    preferredTime: "07:00",
    energyNeed: "low",
    place: "home",
    tagsJson: '["core"]',
    position: "001",
  }),
  makeHabit({
    id: "study",
    title: "Study",
    category: "Work",
    preferredTime: "14:00",
    energyNeed: "high",
    place: "work",
    tagsJson: '["study"]',
    position: "002",
  }),
  makeHabit({
    id: "ride",
    title: "Commute",
    preferredTime: "08:00",
    cadenceType: "specific_days",
    scheduledDaysJson: "[0,6]",
    tagsJson: '["travel"]',
    place: "commute",
    position: "003",
  }),
];

describe("built-in saved views", () => {
  it("exposes the six spec views with stable ids", () => {
    expect(BUILT_IN_VIEWS.map((view) => view.name)).toEqual([
      "Today",
      "Low-energy day",
      "Morning block",
      "Commute",
      "Needs attention",
      "By category",
    ]);

    const id = builtInViewId("user-1", "low-energy-day");
    expect(id).toBe("builtin:user-1:low-energy-day");
    expect(isBuiltInViewId("user-1", id)).toBe(true);
    expect(isBuiltInViewId("user-2", id)).toBe(false);
    expect(isBuiltInViewId("user-1", "custom:low-energy-day")).toBe(false);
  });

  it("seeds deterministic rows idempotently", () => {
    const first = seedBuiltInViews("user-1", 1_000);
    const second = seedBuiltInViews("user-1", 2_000);

    expect(first).toHaveLength(6);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(first.every((row) => row.builtIn && !row.hidden)).toBe(true);
    expect(parseSavedViewFilter(first[1]!.filterJson)).toEqual({
      energyNeeds: ["low"],
    });
  });
});

describe("saved view filter serialization", () => {
  it("normalizes valid fields and drops invalid ones", () => {
    expect(
      normalizeSavedViewFilter({
        categories: [" Work ", "Work", ""],
        timeBlocks: ["morning", "midnight" as "morning"],
        energyNeeds: ["low", "urgent" as "low"],
        places: ["home", "mars" as "home"],
        tags: [" #Core ", "core"],
        isCore: true,
        activeToday: false,
        minRate: 0.25,
        maxRate: 1.5,
        hasMissReason: "tired",
      })
    ).toEqual({
      categories: ["Work"],
      timeBlocks: ["morning"],
      energyNeeds: ["low"],
      places: ["home"],
      tags: ["core"],
      isCore: true,
      activeToday: false,
      minRate: 0.25,
      hasMissReason: "tired",
    });
  });

  it("round-trips JSON and tolerates corrupt rows", () => {
    const filter = normalizeSavedViewFilter({
      energyNeeds: ["low"],
      maxRate: 0.5,
    });
    expect(parseSavedViewFilter(serializeSavedViewFilter(filter))).toEqual(
      filter
    );
    expect(parseSavedViewFilter("not json")).toEqual({});
    expect(parseSavedViewFilter(null)).toEqual({});
    expect(parseSavedViewFilter("[1,2]")).toEqual({});
  });
});

describe("rowToSavedView and mergeHabitViews", () => {
  it("maps rows and ignores deleted entries", () => {
    const row = {
      ...seedBuiltInViews("user-1", 1_000)[0]!,
      hidden: true,
      orderIndex: 9,
      filterJson: '{"places":["home"]}',
    };
    expect(rowToSavedView(row)).toMatchObject({
      id: row.id,
      hidden: true,
      order: 9,
      filter: { places: ["home"] },
    });

    const seeds = seedBuiltInViews("user-1", 1_000);
    const overridden = {
      ...seeds[1]!,
      name: "Energy saver",
      hidden: true,
      orderIndex: 20,
    };
    const custom = {
      ...seeds[0]!,
      id: "custom:quiet",
      name: "Quiet",
      builtIn: false,
      orderIndex: 30,
      filterJson: '{"energyNeeds":["low"]}',
      groupBy: "none" as const,
      sortBy: "order" as const,
    };
    const deleted = {
      ...custom,
      id: "custom:gone",
      name: "Gone",
      deletedAt: 500,
    };

    const merged = mergeHabitViews("user-1", [overridden, custom, deleted]);
    expect(merged).toHaveLength(7);
    const lowEnergy = merged.find((view) => view.id === seeds[1]!.id)!;
    expect(lowEnergy.name).toBe("Energy saver");
    expect(lowEnergy.hidden).toBe(true);
    expect(lowEnergy.order).toBe(20);
    expect(lowEnergy.filter).toEqual({ energyNeeds: ["low"] });
    expect(merged.find((view) => view.id === "custom:gone")).toBeUndefined();
    expect(merged.find((view) => view.id === "custom:quiet")).toMatchObject({
      builtIn: false,
      groupBy: "none",
    });
  });

  it("keeps built-ins present even before persistence", () => {
    expect(mergeHabitViews("user-9", [])).toHaveLength(6);
  });
});

describe("filterHabitsForView", () => {
  it("applies built-in filters with AND semantics", () => {
    const ctx = { rateByHabitId: { anchor: 0.3, study: 0.8 } };
    const ids = (viewIndex: number) =>
      filterHabitsForView(
        sampleHabits,
        makeView({
          id: BUILT_IN_VIEWS[viewIndex]!.slug,
          ...BUILT_IN_VIEWS[viewIndex]!,
        }),
        ctx
      ).map((habit) => habit.id);

    expect(ids(0)).toEqual(["anchor", "study", "ride"]);
    expect(ids(1)).toEqual(["anchor"]);
    expect(ids(2)).toEqual(["anchor", "ride"]);
    expect(ids(3)).toEqual(["ride"]);
    expect(ids(4)).toEqual(["anchor"]);

    const lowEnergyView = makeView({
      id: BUILT_IN_VIEWS[1]!.slug,
      ...BUILT_IN_VIEWS[1]!,
    });
    expect(
      filterHabitsForView(
        [
          makeHabit({ id: "pushups", title: "100 push-ups", energyNeed: "high" }),
          makeHabit({ id: "hydrate", title: "Hydrate", energyNeed: "low" }),
        ],
        lowEnergyView
      ).map((habit) => habit.id)
    ).toEqual(["hydrate"]);
  });

  it("combines custom metadata filters", () => {
    const result = filterHabitsForView(
      sampleHabits,
      makeView({
        filter: { tags: ["travel"], places: ["commute"], isCore: false },
      })
    );
    expect(result.map((habit) => habit.id)).toEqual(["ride"]);
  });

  it("uses analytics context for rate, streak, and miss reasons", () => {
    const rates = filterHabitsForView(
      sampleHabits,
      makeView({ filter: { minRate: 0.5 }, sortBy: "rate" }),
      {
        rateByHabitId: { anchor: 0.3, study: 0.9, ride: 0.7 },
      }
    );
    expect(rates.map((habit) => habit.id)).toEqual(["study", "ride"]);

    const streaks = filterHabitsForView(
      sampleHabits,
      makeView({ sortBy: "streak" }),
      { streakByHabitId: { anchor: 1, study: 5, ride: 3 } }
    );
    expect(streaks.map((habit) => habit.id)).toEqual([
      "study",
      "ride",
      "anchor",
    ]);

    const reasons = filterHabitsForView(
      sampleHabits,
      makeView({ filter: { hasMissReason: "tired" } }),
      { missReasonByHabitId: { study: "tired" } }
    );
    expect(reasons.map((habit) => habit.id)).toEqual(["study"]);
  });

  it("resolves activeToday from cadence or an explicit id set", () => {
    const view = makeView({ filter: { activeToday: true } });
    expect(
      filterHabitsForView(sampleHabits, view, { weekday: 1 }).map(
        (habit) => habit.id
      )
    ).toEqual(["anchor", "study"]);

    expect(
      filterHabitsForView(sampleHabits, view, {
        activeTodayIds: new Set(["ride"]),
      }).map((habit) => habit.id)
    ).toEqual(["ride"]);
  });
});
