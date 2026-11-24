import { isValidYearMonth } from "./habit-analytics";

/** The set of habit titles present in one month of a tracker workbook. */
export interface MonthRoster {
  month: string;
  titles: string[];
}

/** Explicit user override: `sourceTitle` should be treated as `canonicalTitle`. */
export interface AliasOverride {
  sourceTitle: string;
  canonicalTitle: string;
}

export type EvolutionConfidence = "exact" | "high" | "override";

export interface HabitEvolutionGroup {
  /** Stable id, derived from the canonical title. */
  id: string;
  canonicalTitle: string;
  sourceTitles: string[];
  aliases: string[];
  firstMonth: string;
  lastMonth: string;
  months: string[];
  confidence: EvolutionConfidence;
  isMerge: boolean;
}

export interface EvolutionSuggestion {
  sourceTitle: string;
  canonicalTitle: string;
  score: number;
  reason: string;
}

export interface HabitEvolutionPlan {
  groups: HabitEvolutionGroup[];
  suggestions: EvolutionSuggestion[];
  warnings: string[];
  firstMonth: string | null;
  lastMonth: string | null;
}

const GENERIC_TOKENS = new Set([
  "a",
  "an",
  "and",
  "at",
  "daily",
  "day",
  "days",
  "for",
  "full",
  "hour",
  "hours",
  "in",
  "max",
  "min",
  "minute",
  "minutes",
  "no",
  "of",
  "on",
  "one",
  "or",
  "the",
  "time",
  "times",
  "week",
  "with",
]);

/** Aggressive key used only for matching, never for display. */
export function normalizeImportTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[·|()]/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same key with parenthetical detail removed (e.g. "Journal (Prompt)" -> "journal"). */
function coreTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[·|]/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .split(" ")
      .filter((token) => token.length > 0 && !GENERIC_TOKENS.has(token))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const union = new Set([...a, ...b]);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / union.size;
}

/**
 * Conservative title similarity for rename detection. Parenthetical detail is
 * kept in the main key (so "Hydrate (Full...)" and "Hydrate (Hot...)" stay
 * distinct) but ignored in the core key (so "Journal" and "Journal (Prompt)"
 * still match). No edit-distance fallback: short unrelated titles used to
 * chain into one giant false group.
 */
export function titleSimilarity(left: string, right: string): number {
  const fullA = normalizeImportTitle(left);
  const fullB = normalizeImportTitle(right);
  const coreA = coreTitle(left);
  const coreB = coreTitle(right);
  if (!fullA || !fullB) return 0;

  if (coreA === coreB && coreA.length >= 4) return 1;

  if (fullA.includes(fullB) || fullB.includes(fullA)) {
    const shorter = fullA.length < fullB.length ? fullA : fullB;
    if (shorter.length >= 5) return 0.9;
  }

  return Math.max(
    jaccard(meaningfulTokens(coreA), meaningfulTokens(coreB)),
    jaccard(meaningfulTokens(fullA), meaningfulTokens(fullB))
  );
}

function monthIndex(month: string): number {
  const [year, mm] = month.split("-").map(Number);
  return year! * 12 + (mm! - 1);
}

function minTemporalGap(
  monthsA: Set<string>,
  monthsB: Set<string>
): number {
  if (monthsA.size === 0 || monthsB.size === 0) return 0;
  let best = Number.MAX_SAFE_INTEGER;
  for (const a of monthsA) {
    for (const b of monthsB) {
      best = Math.min(best, Math.abs(monthIndex(a) - monthIndex(b)));
    }
  }
  return best;
}

function latestMonth(months: Set<string>): string | null {
  let latest: string | null = null;
  for (const month of months) {
    if (!latest || month > latest) latest = month;
  }
  return latest;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    let root = value;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cursor = value;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }

  groups(): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      const bucket = byRoot.get(root) ?? [];
      bucket.push(value);
      byRoot.set(root, bucket);
    }
    return Array.from(byRoot.values());
  }
}

function sortedMonths(months: Set<string>): string[] {
  return Array.from(months).sort();
}

function pickCanonicalTitle(
  titles: string[],
  titleMonths: Map<string, Set<string>>,
  preferred: string | null
): string {
  if (preferred && titles.includes(preferred)) return preferred;
  return [...titles].sort((a, b) => {
    const monthA = latestMonth(titleMonths.get(a) ?? new Set()) ?? "";
    const monthB = latestMonth(titleMonths.get(b) ?? new Set()) ?? "";
    if (monthA !== monthB) return monthB.localeCompare(monthA);
    if (a.length !== b.length) return b.length - a.length;
    return a.localeCompare(b);
  })[0]!;
}

/**
 * Detects how a habit roster changes across months: renames, merges,
 * additions, and removals. Grouping is conservative; ambiguous cases are
 * returned as suggestions so the UI can ask the user to confirm.
 */
export function planHabitEvolution(
  rosters: MonthRoster[],
  overrides: AliasOverride[] = []
): HabitEvolutionPlan {
  const warnings: string[] = [];
  const validRosters = rosters
    .map((roster) => ({
      month: roster.month,
      titles: Array.from(new Set(roster.titles.map((t) => t.trim()).filter(Boolean))),
    }))
    .filter((roster) => isValidYearMonth(roster.month))
    .sort((a, b) => a.month.localeCompare(b.month));

  if (validRosters.length === 0) {
    return {
      groups: [],
      suggestions: [],
      warnings: ["No valid month rosters were found."],
      firstMonth: null,
      lastMonth: null,
    };
  }

  const titleMonths = new Map<string, Set<string>>();
  for (const roster of validRosters) {
    for (const title of roster.titles) {
      const months = titleMonths.get(title) ?? new Set<string>();
      months.add(roster.month);
      titleMonths.set(title, months);
    }
  }

  const overrideByNormalized = new Map<string, string>();
  for (const override of overrides) {
    const source = override.sourceTitle.trim();
    const canonical = override.canonicalTitle.trim();
    if (!source || !canonical) continue;
    if (!titleMonths.has(source)) titleMonths.set(source, new Set());
    if (!titleMonths.has(canonical)) titleMonths.set(canonical, new Set());
    overrideByNormalized.set(normalizeImportTitle(source), canonical);
    for (const [title, months] of titleMonths) {
      if (title !== source && normalizeImportTitle(title) === normalizeImportTitle(source)) {
        overrideByNormalized.set(normalizeImportTitle(title), canonical);
      }
    }
  }

  const cooccurs = new Set<string>();
  for (const roster of validRosters) {
    for (let i = 0; i < roster.titles.length; i++) {
      for (let j = i + 1; j < roster.titles.length; j++) {
        cooccurs.add(`${roster.titles[i]!}\u0000${roster.titles[j]!}`);
        cooccurs.add(`${roster.titles[j]!}\u0000${roster.titles[i]!}`);
      }
    }
  }

  const uf = new UnionFind();
  for (const title of titleMonths.keys()) uf.add(title);

  const allTitles = Array.from(titleMonths.keys()).sort();
  const explicitPairs = new Set<string>();
  for (const override of overrides) {
    const source = override.sourceTitle.trim();
    const canonical = override.canonicalTitle.trim();
    if (!source || !canonical) continue;
    uf.union(source, canonical);
    explicitPairs.add(`${source}\u0000${canonical}`);
  }

  for (let i = 0; i < allTitles.length; i++) {
    for (let j = i + 1; j < allTitles.length; j++) {
      const a = allTitles[i]!;
      const b = allTitles[j]!;
      if (cooccurs.has(`${a}\u0000${b}`)) continue;

      const score = titleSimilarity(a, b);
      const gap = minTemporalGap(
        titleMonths.get(a) ?? new Set(),
        titleMonths.get(b) ?? new Set()
      );
      const substringMatch = score >= 0.85;
      const allowedGap = substringMatch ? 11 : 1;

      if (score >= 0.6 && gap <= allowedGap) {
        uf.union(a, b);
        explicitPairs.add(`${a}\u0000${b}`);
      }
    }
  }

  const preferredByRoot = new Map<string, string>();
  for (const override of overrides) {
    const source = override.sourceTitle.trim();
    const canonical = override.canonicalTitle.trim();
    if (source && canonical) preferredByRoot.set(uf.find(source), canonical);
  }

  const groups: HabitEvolutionGroup[] = [];
  for (const titles of uf.groups()) {
    const months = new Set<string>();
    for (const title of titles) {
      for (const month of titleMonths.get(title) ?? []) months.add(month);
    }
    const canonicalTitle = pickCanonicalTitle(
      titles,
      titleMonths,
      preferredByRoot.get(uf.find(titles[0]!)) ?? null
    );
    const keys = new Set(titles.map(normalizeImportTitle));
    const confidence: EvolutionConfidence = titles.some(
      (title) =>
        overrides.some((o) => o.sourceTitle.trim() === title) ||
        overrides.some((o) => o.canonicalTitle.trim() === title)
    )
      ? "override"
      : keys.size === 1
        ? "exact"
        : "high";
    const orderedMonths = sortedMonths(months);

    groups.push({
      id: normalizeImportTitle(canonicalTitle) || canonicalTitle,
      canonicalTitle,
      sourceTitles: [...titles].sort((a, b) => a.localeCompare(b)),
      aliases: titles
        .filter((title) => title !== canonicalTitle)
        .sort((a, b) => a.localeCompare(b)),
      firstMonth: orderedMonths[0] ?? "",
      lastMonth: orderedMonths[orderedMonths.length - 1] ?? "",
      months: orderedMonths,
      confidence,
      isMerge: titles.length > 2,
    });
  }

  groups.sort((a, b) => a.canonicalTitle.localeCompare(b.canonicalTitle));

  const suggestions: EvolutionSuggestion[] = [];
  for (let i = 0; i < allTitles.length; i++) {
    for (let j = i + 1; j < allTitles.length; j++) {
      const a = allTitles[i]!;
      const b = allTitles[j]!;
      if (explicitPairs.has(`${a}\u0000${b}`)) continue;
      if (cooccurs.has(`${a}\u0000${b}`)) continue;
      if (uf.find(a) === uf.find(b)) continue;

      const score = titleSimilarity(a, b);
      const gap = minTemporalGap(
        titleMonths.get(a) ?? new Set(),
        titleMonths.get(b) ?? new Set()
      );
      if (gap > 2) continue;

      const tokensA = normalizeImportTitle(a).split(" ").filter((t) => t && !GENERIC_TOKENS.has(t));
      const tokensB = normalizeImportTitle(b).split(" ").filter((t) => t && !GENERIC_TOKENS.has(t));
      const shared = tokensA.filter((t) => tokensB.includes(t));
      const leadingMatch = shared.length > 0 && tokensA[0] === tokensB[0];

      if (score >= 0.35 || leadingMatch) {
        suggestions.push({
          sourceTitle: a,
          canonicalTitle: b,
          score: Math.round(score * 100) / 100,
          reason: leadingMatch ? "shares a leading topic word" : "similar title",
        });
      }
    }
  }
  suggestions.sort((a, b) => b.score - a.score);
  const suggestionsTrimmed = suggestions.slice(0, 25);

  const firstMonth = validRosters[0]!.month;
  const lastMonth = validRosters[validRosters.length - 1]!.month;
  const removed = groups.filter(
    (group) => group.lastMonth && group.lastMonth < lastMonth
  );
  const added = groups.filter(
    (group) => group.firstMonth && group.firstMonth > firstMonth
  );

  if (groups.length > 0) {
    warnings.push(
      `${groups.length} habit identities detected across ${validRosters.length} months ` +
        `(${added.length} added later, ${removed.length} no longer present in the last month).`
    );
  }
  if (suggestionsTrimmed.length > 0) {
    warnings.push(
      `${suggestionsTrimmed.length} possible matches need confirmation; review them below or add an explicit alias mapping.`
    );
  }

  return {
    groups,
    suggestions: suggestionsTrimmed,
    warnings,
    firstMonth,
    lastMonth,
  };
}

/** Resolves a source title to its canonical habit title. */
export function resolveCanonicalTitle(
  title: string,
  plan: HabitEvolutionPlan,
  overrides: AliasOverride[] = []
): string {
  const trimmed = title.trim();
  const normalized = normalizeImportTitle(trimmed);

  for (const override of overrides) {
    if (normalizeImportTitle(override.sourceTitle) === normalized) {
      return override.canonicalTitle.trim();
    }
  }

  for (const group of plan.groups) {
    if (
      group.sourceTitles.includes(trimmed) ||
      group.sourceTitles.some((source) => normalizeImportTitle(source) === normalized) ||
      normalizeImportTitle(group.canonicalTitle) === normalized
    ) {
      return group.canonicalTitle;
    }
  }

  return trimmed;
}

export function monthStartKey(month: string): string {
  return `${month}-01`;
}

/** Parses a two-column `Source Title,Canonical Title` override CSV. */
export function parseAliasOverrides(rawText: string): {
  overrides: AliasOverride[];
  error?: string;
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { overrides: [] };

  const dataLines = /^(source\s*title|alias)\s*,/i.test(lines[0]!)
    ? lines.slice(1)
    : lines;
  const overrides: AliasOverride[] = [];
  const seen = new Set<string>();

  for (const line of dataLines) {
    const comma = line.indexOf(",");
    const source = (comma >= 0 ? line.slice(0, comma) : line).trim();
    const canonical = (comma >= 0 ? line.slice(comma + 1) : "").trim();
    if (!source || !canonical) {
      return {
        overrides: [],
        error: "Each alias row needs 'Source Title,Canonical Title'.",
      };
    }
    const key = normalizeImportTitle(source);
    if (seen.has(key)) continue;
    seen.add(key);
    overrides.push({ sourceTitle: source, canonicalTitle: canonical });
  }

  if (overrides.length > 500) {
    return { overrides: [], error: "Alias mapping supports up to 500 rows." };
  }
  return { overrides };
}
