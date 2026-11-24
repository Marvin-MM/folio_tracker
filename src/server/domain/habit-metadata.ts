/**
 * Phase B habit metadata adapter.
 *
 * FOLIO's current schema has no `energyNeed`, `place`, `tags`, `timeBlock`, or
 * `isCore` columns. Rather than rewriting existing habits, these values are
 * derived from the existing title/category/preferredTime fields where possible
 * and persisted only in the new additive columns (`energy_need`, `place`,
 * `tags_json`). The pure helpers here are the single source of truth for those
 * defaults and normalization rules.
 */

export const ENERGY_NEEDS = ["low", "medium", "high"] as const;
export type EnergyNeed = (typeof ENERGY_NEEDS)[number];

export const PLACES = ["home", "commute", "work", "anywhere"] as const;
export type Place = (typeof PLACES)[number];

export const MISS_REASONS = [
  "tired",
  "work",
  "travel",
  "forgot",
  "sick",
  "low_motivation",
  "other",
] as const;
export type MissReason = (typeof MISS_REASONS)[number];

export const TIME_BLOCKS = ["morning", "afternoon", "evening", "anytime"] as const;
export type TimeBlock = (typeof TIME_BLOCKS)[number];

export const LOG_SOURCES = ["manual", "rule", "button", "range"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export interface HabitMetadata {
  energyNeed: EnergyNeed;
  place: Place;
  tags: string[];
}

export const DEFAULT_HABIT_METADATA: HabitMetadata = {
  energyNeed: "medium",
  place: "anywhere",
  tags: [],
};

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;

/** Core anchors from the product spec; used as a read-only adapter for `isCore` filters. */
export const CORE_HABIT_ANCHORS = [
  "Wake up 4:30",
  "Hydrate",
  "Pray·Meditate·Gratitude",
  "100 push-ups",
  "Close the day",
  "Sleep 11pm",
] as const;

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[·•.,!?–—_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isEnergyNeed(value: unknown): value is EnergyNeed {
  return typeof value === "string" && (ENERGY_NEEDS as readonly string[]).includes(value);
}

export function isPlace(value: unknown): value is Place {
  return typeof value === "string" && (PLACES as readonly string[]).includes(value);
}

export function isMissReason(value: unknown): value is MissReason {
  return typeof value === "string" && (MISS_REASONS as readonly string[]).includes(value);
}

export function isLogSource(value: unknown): value is LogSource {
  return typeof value === "string" && (LOG_SOURCES as readonly string[]).includes(value);
}

/**
 * Miss reasons only apply to `missed` logs. Any other status clears the reason
 * so a stale chip can never contradict the visible mark.
 */
export function resolveMissReasonForLog(
  status: "done" | "missed" | "skipped" | null,
  reason: MissReason | null | undefined
): MissReason | null {
  if (status !== "missed") return null;
  return isMissReason(reason) ? reason : null;
}

export function normalizeTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length >= MAX_TAGS) break;
  }
  return normalized.sort();
}

export function serializeTags(tags: string[] | null | undefined): string {
  return JSON.stringify(normalizeTags(tags));
}

export function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed.filter((tag): tag is string => typeof tag === "string"));
  } catch {
    return [];
  }
}

/**
 * Deterministic seed defaults derived from the canonical habit names in the
 * product spec. Unknown habits get `medium` / `anywhere` / no tags.
 */
export function defaultHabitMetadata(title: string): HabitMetadata {
  const needle = normalizeTitle(title);
  if (!needle) return { ...DEFAULT_HABIT_METADATA, tags: [] };

  const highNeed =
    needle.includes("study") ||
    needle.includes("workout") ||
    needle.includes("run") ||
    needle.includes("push up") ||
    needle.includes("gym") ||
    needle.includes("exercise") ||
    needle.includes("swim");
  const lowNeed =
    needle.includes("journal") ||
    needle.includes("meditat") ||
    needle.includes("gratitude") ||
    needle.includes("pray") ||
    needle.includes("hydrate") ||
    needle.includes("sleep") ||
    needle.includes("wind down") ||
    needle.includes("read");

  const energyNeed: EnergyNeed = highNeed ? "high" : lowNeed ? "low" : "medium";

  let place: Place = "anywhere";
  if (needle.includes("commute") || needle.includes("travel") || needle.includes("ride")) {
    place = "commute";
  } else if (
    needle.includes("work") ||
    needle.includes("study") ||
    needle.includes("office")
  ) {
    place = "work";
  } else if (
    needle.includes("sleep") ||
    needle.includes("wake") ||
    needle.includes("hydrate") ||
    needle.includes("journal") ||
    needle.includes("meditat") ||
    needle.includes("gratitude") ||
    needle.includes("pray") ||
    needle.includes("push up")
  ) {
    place = "home";
  }

  return { energyNeed, place, tags: [] };
}

/** Adapts the existing preferredTime field to the spec's timeBlock filter. */
export function deriveTimeBlock(preferredTime: string | null | undefined): TimeBlock {
  if (!preferredTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
    return "anytime";
  }
  const hour = Number(preferredTime.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Read-only adapter for the spec's `isCore` flag using canonical anchor titles. */
export function deriveIsCore(title: string, category?: string | null): boolean {
  const needle = normalizeTitle(title);
  if ((category ?? "").trim().toLowerCase() === "core") return true;
  return CORE_HABIT_ANCHORS.some((anchor) => normalizeTitle(anchor) === needle);
}
