import {
  deriveIsCore,
  deriveTimeBlock,
  isEnergyNeed,
  isPlace,
  isMissReason,
  normalizeTags,
  TIME_BLOCKS,
  type EnergyNeed,
  type MissReason,
  type Place,
  type TimeBlock,
} from "@/server/domain/habit-metadata";

export const VIEW_KINDS = ["today", "grid", "calendar", "board"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_GROUP_BY = [
  "timeBlock",
  "category",
  "energyNeed",
  "place",
  "none",
] as const;
export type ViewGroupBy = (typeof VIEW_GROUP_BY)[number];

export const VIEW_SORT_BY = ["order", "rate", "streak"] as const;
export type ViewSortBy = (typeof VIEW_SORT_BY)[number];

export interface SavedViewFilter {
  categories?: string[];
  timeBlocks?: TimeBlock[];
  energyNeeds?: EnergyNeed[];
  places?: Place[];
  tags?: string[];
  isCore?: boolean;
  activeToday?: boolean;
  maxRate?: number;
  minRate?: number;
  hasMissReason?: MissReason;
}

export interface HabitSavedView {
  id: string;
  name: string;
  kind: ViewKind;
  builtIn: boolean;
  hidden: boolean;
  order: number;
  filter: SavedViewFilter;
  groupBy: ViewGroupBy;
  sortBy: ViewSortBy;
  updatedAt: number;
}

export interface HabitSavedViewRow {
  id: string;
  name: string;
  kind: ViewKind;
  builtIn: boolean;
  hidden: boolean;
  orderIndex: number;
  filterJson: string;
  groupBy: ViewGroupBy;
  sortBy: ViewSortBy;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface NewHabitSavedViewRow {
  id: string;
  userId: string;
  name: string;
  kind: ViewKind;
  builtIn: boolean;
  hidden: boolean;
  orderIndex: number;
  filterJson: string;
  groupBy: ViewGroupBy;
  sortBy: ViewSortBy;
  createdAt: number;
  updatedAt: number;
}

interface BuiltInViewSeed {
  slug: string;
  name: string;
  kind: ViewKind;
  groupBy: ViewGroupBy;
  sortBy: ViewSortBy;
  filter: SavedViewFilter;
}

export const BUILT_IN_VIEWS: readonly BuiltInViewSeed[] = [
  {
    slug: "today",
    name: "Today",
    kind: "today",
    groupBy: "timeBlock",
    sortBy: "order",
    filter: {},
  },
  {
    slug: "low-energy-day",
    name: "Low-energy day",
    kind: "today",
    groupBy: "none",
    sortBy: "order",
    filter: { energyNeeds: ["low"] },
  },
  {
    slug: "morning-block",
    name: "Morning block",
    kind: "today",
    groupBy: "none",
    sortBy: "order",
    filter: { timeBlocks: ["morning"] },
  },
  {
    slug: "commute",
    name: "Commute",
    kind: "today",
    groupBy: "none",
    sortBy: "order",
    filter: { places: ["commute"] },
  },
  {
    slug: "needs-attention",
    name: "Needs attention",
    kind: "grid",
    groupBy: "none",
    sortBy: "rate",
    filter: { maxRate: 0.5 },
  },
  {
    slug: "by-category",
    name: "By category",
    kind: "board",
    groupBy: "category",
    sortBy: "order",
    filter: {},
  },
] as const;

export function builtInViewId(userId: string, slug: string): string {
  return `builtin:${userId}:${slug}`;
}

export function isBuiltInViewId(userId: string, viewId: string): boolean {
  return BUILT_IN_VIEWS.some((seed) => builtInViewId(userId, seed.slug) === viewId);
}

export function normalizeSavedViewFilter(input: SavedViewFilter | null | undefined): SavedViewFilter {
  const source = input ?? {};
  const out: SavedViewFilter = {};

  const categories = (source.categories ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().slice(0, 48))
    .filter(Boolean);
  if (categories.length > 0) out.categories = [...new Set(categories)];

  const timeBlocks = (source.timeBlocks ?? []).filter((value): value is TimeBlock =>
    (TIME_BLOCKS as readonly string[]).includes(String(value))
  );
  if (timeBlocks.length > 0) out.timeBlocks = [...new Set(timeBlocks)];

  const energyNeeds = (source.energyNeeds ?? []).filter(isEnergyNeed);
  if (energyNeeds.length > 0) out.energyNeeds = [...new Set(energyNeeds)];

  const places = (source.places ?? []).filter(isPlace);
  if (places.length > 0) out.places = [...new Set(places)];

  const tags = normalizeTags(source.tags ?? []);
  if (tags.length > 0) out.tags = tags;

  if (typeof source.isCore === "boolean") out.isCore = source.isCore;
  if (typeof source.activeToday === "boolean") out.activeToday = source.activeToday;
  if (typeof source.hasMissReason === "string" && isMissReason(source.hasMissReason)) {
    out.hasMissReason = source.hasMissReason;
  }

  for (const key of ["minRate", "maxRate"] as const) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
      out[key] = value;
    }
  }

  return out;
}

export function serializeSavedViewFilter(filter: SavedViewFilter): string {
  return JSON.stringify(normalizeSavedViewFilter(filter));
}

export function parseSavedViewFilter(value: string | null | undefined): SavedViewFilter {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return normalizeSavedViewFilter(parsed as SavedViewFilter);
  } catch {
    return {};
  }
}

export function seedBuiltInViews(userId: string, now: number): NewHabitSavedViewRow[] {
  return BUILT_IN_VIEWS.map((seed, index) => ({
    id: builtInViewId(userId, seed.slug),
    userId,
    name: seed.name,
    kind: seed.kind,
    builtIn: true,
    hidden: false,
    orderIndex: index,
    filterJson: serializeSavedViewFilter(seed.filter),
    groupBy: seed.groupBy,
    sortBy: seed.sortBy,
    createdAt: now,
    updatedAt: now,
  }));
}

export function rowToSavedView(row: HabitSavedViewRow): HabitSavedView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    builtIn: row.builtIn,
    hidden: row.hidden,
    order: row.orderIndex,
    filter: parseSavedViewFilter(row.filterJson),
    groupBy: row.groupBy,
    sortBy: row.sortBy,
    updatedAt: row.updatedAt,
  };
}

/**
 * Built-ins always exist in memory, even before their first persisted seed.
 * User rows may override a built-in's name/hidden/order but never its filter,
 * groupBy, or sortBy. Deleted rows are ignored.
 */
export function mergeHabitViews(
  userId: string,
  rows: HabitSavedViewRow[],
  now = Date.now()
): HabitSavedView[] {
  const byId = new Map(rows.filter((row) => !row.deletedAt).map((row) => [row.id, row]));
  const merged: HabitSavedView[] = BUILT_IN_VIEWS.map((seed, index) => {
    const builtInId = builtInViewId(userId, seed.slug);
    const row = byId.get(builtInId);
    return {
      id: builtInId,
      name: row?.name ?? seed.name,
      kind: seed.kind,
      builtIn: true,
      hidden: row?.hidden ?? false,
      order: row?.orderIndex ?? index,
      filter: seed.filter,
      groupBy: seed.groupBy,
      sortBy: seed.sortBy,
      updatedAt: row?.updatedAt ?? now,
    };
  });

  for (const row of rows) {
    if (row.deletedAt || row.builtIn || isBuiltInViewId(userId, row.id)) {
      continue;
    }
    merged.push(rowToSavedView(row));
  }

  return merged.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface FilterHabitLike {
  id: string;
  title: string;
  category: string | null;
  preferredTime: string | null;
  cadenceType: "daily" | "specific_days" | "weekly_target";
  scheduledDaysJson: string;
  energyNeed: "low" | "medium" | "high";
  place: "home" | "commute" | "work" | "anywhere";
  tagsJson: string;
  position: string;
}

export interface HabitViewSelectorContext {
  /** Rates are 0..1; null/undefined means no eligible denominator. */
  rateByHabitId?: Record<string, number | null>;
  streakByHabitId?: Record<string, number>;
  missReasonByHabitId?: Record<string, MissReason | null>;
  activeTodayIds?: Set<string>;
  weekday?: number;
}

function parseViewScheduledDays(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6
    );
  } catch {
    return [];
  }
}

function isHabitActiveToday(
  habit: FilterHabitLike,
  ctx: HabitViewSelectorContext
): boolean {
  if (ctx.activeTodayIds) return ctx.activeTodayIds.has(habit.id);
  if (habit.cadenceType === "daily") return true;
  const days = parseViewScheduledDays(habit.scheduledDaysJson);
  if (habit.cadenceType === "weekly_target") return days.length === 0;
  const weekday = ctx.weekday ?? new Date().getUTCDay();
  return days.includes(weekday);
}

/**
 * Pure saved-view selector. It reads only the supplied in-memory habits/context;
 * selecting a view never touches storage or refetches server data.
 */
export function filterHabitsForView<T extends FilterHabitLike>(
  habits: T[],
  view: HabitSavedView,
  ctx: HabitViewSelectorContext = {}
): T[] {
  const filter = normalizeSavedViewFilter(view.filter);
  const filtered = habits.filter((habit) => {
    if (filter.categories?.length) {
      if (!habit.category || !filter.categories.includes(habit.category)) return false;
    }
    if (filter.timeBlocks?.length) {
      if (!filter.timeBlocks.includes(deriveTimeBlock(habit.preferredTime))) return false;
    }
    if (filter.energyNeeds?.length) {
      if (!filter.energyNeeds.includes(habit.energyNeed)) return false;
    }
    if (filter.places?.length) {
      if (!filter.places.includes(habit.place)) return false;
    }
    if (filter.tags?.length) {
      const tags = parseViewTags(habit.tagsJson);
      if (!filter.tags.some((tag) => tags.includes(tag))) return false;
    }
    if (
      filter.isCore !== undefined &&
      deriveIsCore(parseViewTags(habit.tagsJson), habit.category) !==
        filter.isCore
    ) {
      return false;
    }
    if (filter.activeToday && !isHabitActiveToday(habit, ctx)) return false;

    const rate = ctx.rateByHabitId?.[habit.id] ?? null;
    if (filter.minRate !== undefined && (rate === null || rate < filter.minRate)) return false;
    if (filter.maxRate !== undefined && (rate === null || rate > filter.maxRate)) return false;
    if (filter.hasMissReason && ctx.missReasonByHabitId?.[habit.id] !== filter.hasMissReason) {
      return false;
    }
    return true;
  });

  if (view.sortBy === "rate") {
    return [...filtered].sort((a, b) => {
      const aRate = ctx.rateByHabitId?.[a.id] ?? null;
      const bRate = ctx.rateByHabitId?.[b.id] ?? null;
      if (aRate === null && bRate === null) return a.position.localeCompare(b.position);
      if (aRate === null) return 1;
      if (bRate === null) return -1;
      return bRate - aRate || a.position.localeCompare(b.position);
    });
  }
  if (view.sortBy === "streak") {
    return [...filtered].sort(
      (a, b) =>
        (ctx.streakByHabitId?.[b.id] ?? 0) - (ctx.streakByHabitId?.[a.id] ?? 0) ||
        a.position.localeCompare(b.position)
    );
  }
  return [...filtered].sort((a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id));
}

function parseViewTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}
