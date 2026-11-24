import type { HabitLogStatus } from "@/server/db/schema";
import {
  isValidDateKey,
  isValidYearMonth,
} from "./habit-analytics";
import type { MonthRoster } from "./habit-evolution";

export interface ParsedHistoryLog {
  title: string;
  dateKey: string;
  status: HabitLogStatus;
}

export interface ParsedHistoryImport {
  rows: ParsedHistoryLog[];
  /** Distinct habit titles present in the source. */
  titles: string[];
  warnings: string[];
  error?: string;
}

export interface ParseHistoryOptions {
  /** YYYY-MM. Used when day columns contain plain day numbers (1–31) or weekday letters. */
  month?: string;
  /** Preview-only guard; the service re-checks against the server clock. */
  todayDateKey?: string;
}

export const MAX_HISTORY_LOG_ROWS = 20_000;
export const MAX_HISTORY_HABIT_TITLES = 500;

const WEEKDAY_HEADER_REGEX =
  /^(?:sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa|s|m|t|w|f)$/i;

const DAY_NUMBER_HEADER_REGEX =
  /^(\d{1,2})(?:$|[\s\r\n/-]+(?:sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa|s|m|t|w|f)$)/i;

const SUMMARY_ROW_LABELS = new Set([
  "total",
  "totals",
  "dailytotal",
  "summary",
  "average",
  "avg",
  "completion",
  "completionrate",
  "failurerate",
  "monthlyprogress",
  "weeklyprogress",
  "progress",
  "score",
  "rate",
  "coreday",
  "logged",
  "besthabit",
  "needsattention",
]);

const STATUS_ALIASES: Record<string, HabitLogStatus> = {
  done: "done",
  complete: "done",
  completed: "done",
  yes: "done",
  y: "done",
  "✔": "done",
  "✓": "done",
  "☑": "done",
  "✅": "done",
  "1": "done",
  true: "done",

  missed: "missed",
  fail: "missed",
  failed: "missed",
  no: "missed",
  n: "missed",
  "✗": "missed",
  "✘": "missed",
  "✕": "missed",
  "❌": "missed",
  "0": "missed",
  false: "missed",

  skipped: "skipped",
  skip: "skipped",
  rest: "skipped",
  "⚠": "skipped",
  "⚠️": "skipped",
  "?": "skipped",
};

/** Normalizes Excel checkmarks and text labels into a FOLIO log status. */
export function parseStatusCell(raw: unknown): HabitLogStatus | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;

  const cleaned = String(raw)
    .replace(/\uFE0F/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!cleaned) return null;
  return STATUS_ALIASES[cleaned] ?? null;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-.]/g, "")
    .replace(/\uFE0F/g, "");
}

export function isSummaryRowTitle(title: string): boolean {
  const normalized = normalizeHeader(title).replace(/[?:!]/g, "");
  return SUMMARY_ROW_LABELS.has(normalized);
}

function detectSeparator(rawText: string): string {
  // Inspect the first non-empty line outside quotes
  let inQuotes = false;
  let tabs = 0;
  let commas = 0;
  let started = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]!;
    if (ch === '"') {
      if (inQuotes && rawText[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      started = true;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (started) break;
    } else {
      if (ch.trim()) started = true;
      if (!inQuotes) {
        if (ch === "\t") tabs += 1;
        else if (ch === ",") commas += 1;
      }
    }
  }

  return tabs > 0 && tabs >= commas ? "\t" : ",";
}

/**
 * RFC-4180 quote-aware delimited row parser so multi-line Excel headers such
 * as `"1\nM"` remain intact inside a single cell instead of splitting rows.
 */
function parseDelimitedRows(rawText: string, separator: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]!;
    if (ch === '"') {
      if (inQuotes && rawText[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === separator) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && rawText[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function resolveWideDateColumns(
  header: string[],
  month: string | undefined,
  warnings: string[],
  lineNumber: number
): Array<{ column: number; dateKey: string }> {
  const result: Array<{ column: number; dateKey: string }> = [];
  let weekdayOrdinal = 0;

  for (let col = 1; col < header.length; col++) {
    const value = (header[col] ?? "").trim();
    if (!value) continue;

    if (isValidDateKey(value)) {
      result.push({ column: col, dateKey: value });
      continue;
    }

    const isoMatch = value.match(/^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})$/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      const padded = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      if (isValidDateKey(padded)) {
        result.push({ column: col, dateKey: padded });
      } else {
        warnings.push(`Line ${lineNumber}: invalid date header "${value}".`);
      }
      continue;
    }

    const dayMatch = value.match(DAY_NUMBER_HEADER_REGEX);
    if (dayMatch) {
      const day = Number(dayMatch[1]);
      if (!month) {
        warnings.push(
          `Line ${lineNumber}: day column "${value}" needs a month (YYYY-MM).`
        );
        continue;
      }
      if (!isValidYearMonth(month)) {
        warnings.push(`Line ${lineNumber}: invalid month "${month}".`);
        continue;
      }
      const padded = `${month}-${String(day).padStart(2, "0")}`;
      if (!isValidDateKey(padded)) {
        warnings.push(`Line ${lineNumber}: invalid date header "${value}".`);
        continue;
      }
      result.push({ column: col, dateKey: padded });
      continue;
    }

    if (WEEKDAY_HEADER_REGEX.test(value)) {
      weekdayOrdinal += 1;
      if (!month) {
        if (weekdayOrdinal === 1) {
          warnings.push(
            `Line ${lineNumber}: weekday headers require a month (YYYY-MM).`
          );
        }
        continue;
      }
      if (!isValidYearMonth(month)) {
        warnings.push(`Line ${lineNumber}: invalid month "${month}".`);
        continue;
      }
      const padded = `${month}-${String(weekdayOrdinal).padStart(2, "0")}`;
      if (isValidDateKey(padded)) {
        result.push({ column: col, dateKey: padded });
      }
    }
  }

  return result;
}

function looksLikeWideDateHeader(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    isValidDateKey(trimmed) ||
    /^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})$/.test(trimmed) ||
    DAY_NUMBER_HEADER_REGEX.test(trimmed) ||
    WEEKDAY_HEADER_REGEX.test(trimmed)
  );
}

function buildResult(
  collected: Map<string, ParsedHistoryLog>,
  warnings: string[]
): ParsedHistoryImport {
  const rows = Array.from(collected.values()).sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.title.localeCompare(b.title)
  );
  return {
    rows,
    titles: Array.from(new Set(rows.map((row) => row.title))).sort((a, b) =>
      a.localeCompare(b)
    ),
    warnings,
  };
}

function pushRow(
  collected: Map<string, ParsedHistoryLog>,
  title: string,
  dateKey: string,
  status: HabitLogStatus | null,
  todayDateKey: string | undefined,
  warnings: string[],
  lineNumber: number
): void {
  if (!title || !status) return;
  if (!isValidDateKey(dateKey)) {
    warnings.push(`Line ${lineNumber}: invalid date "${dateKey}".`);
    return;
  }
  if (todayDateKey && dateKey > todayDateKey) {
    warnings.push(`Line ${lineNumber}: skipped future date "${dateKey}".`);
    return;
  }
  collected.set(`${title.toLowerCase()}|${dateKey}`, {
    title,
    dateKey,
    status,
  });
}

function parseLongFormat(
  rows: string[][],
  headerIndex: number,
  options: ParseHistoryOptions
): ParsedHistoryImport {
  const headers = rows[headerIndex]!.map(normalizeHeader);
  const titleIndex = headers.findIndex((h) => h === "habit" || h === "title");
  const dateIndex = headers.indexOf("date");
  const statusIndex = headers.indexOf("status");
  const collected = new Map<string, ParsedHistoryLog>();
  const warnings: string[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const title = (cells[titleIndex] ?? "").trim().slice(0, 120);
    const rawDate = (cells[dateIndex] ?? "").trim();
    const rawStatus = (cells[statusIndex] ?? "").trim();
    if (!title && !rawDate && !rawStatus) continue;

    const status = parseStatusCell(rawStatus);
    if (!status) {
      if (rawStatus) {
        warnings.push(`Line ${i + 1}: unrecognized status "${rawStatus}".`);
      }
      continue;
    }
    pushRow(
      collected,
      title,
      rawDate,
      status,
      options.todayDateKey,
      warnings,
      i + 1
    );
  }

  return buildResult(collected, warnings);
}

function findWideHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i]!;
    const label = normalizeHeader(cells[0] ?? "");
    if (label !== "habit" && label !== "title" && label !== "") continue;

    const dateLike = cells.slice(1).filter(looksLikeWideDateHeader);
    if (dateLike.length >= 2) return i;
  }
  return -1;
}

function parseWideFormat(
  rows: string[][],
  headerIndex: number,
  options: ParseHistoryOptions
): ParsedHistoryImport {
  const header = rows[headerIndex]!;
  const warnings: string[] = [];
  const dateColumns = resolveWideDateColumns(
    header,
    options.month,
    warnings,
    headerIndex + 1
  );

  if (dateColumns.length === 0) {
    return {
      rows: [],
      titles: [],
      warnings,
      error:
        "No date columns found. Use ISO dates (2026-01-01) or day numbers 1–31 / weekday letters plus a month (YYYY-MM).",
    };
  }

  const collected = new Map<string, ParsedHistoryLog>();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const title = (cells[0] ?? "").trim().slice(0, 120);
    if (!title || normalizeHeader(title) === "habit" || isSummaryRowTitle(title)) {
      continue;
    }
    for (const { column, dateKey } of dateColumns) {
      const status = parseStatusCell(cells[column]);
      if (!status) continue;
      pushRow(
        collected,
        title,
        dateKey,
        status,
        options.todayDateKey,
        warnings,
        i + 1
      );
    }
  }

  return buildResult(collected, warnings);
}

/**
 * Derives per-month habit rosters directly from parsed completion rows so
 * multi-month `.csv`, `.txt`, and pasted grids support the same rename/merge/
 * removal detection as multi-sheet `.xlsx` workbooks.
 */
export function deriveMonthRostersFromLogs(
  rows: ParsedHistoryLog[]
): MonthRoster[] {
  const byMonth = new Map<string, Set<string>>();
  for (const row of rows) {
    const month = row.dateKey.slice(0, 7);
    if (!isValidYearMonth(month)) continue;
    const set = byMonth.get(month) ?? new Set<string>();
    set.add(row.title);
    byMonth.set(month, set);
  }
  return Array.from(byMonth.entries())
    .map(([month, titles]) => ({
      month,
      titles: Array.from(titles).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Parses habit completion history from either a long CSV
 * (`Habit,Date,Status`) or an Excel-style wide grid where rows are habits and
 * columns are dates (ISO dates, `1\nM` headers, bare day numbers 1–31, or
 * weekday letters interpreted with `options.month`).
 */
export function parseHabitHistoryImport(
  rawText: string,
  options: ParseHistoryOptions = {}
): ParsedHistoryImport {
  if (!rawText.trim()) {
    return {
      rows: [],
      titles: [],
      warnings: [],
      error: "Paste at least one habit row to import.",
    };
  }

  if (options.month && !isValidYearMonth(options.month)) {
    return {
      rows: [],
      titles: [],
      warnings: [],
      error: "Month must be in YYYY-MM format.",
    };
  }

  const separator = detectSeparator(rawText);
  const rows = parseDelimitedRows(rawText, separator);
  if (rows.length === 0) {
    return {
      rows: [],
      titles: [],
      warnings: [],
      error: "Paste at least one habit row to import.",
    };
  }

  const longHeaderIndex = rows.findIndex((cells) => {
    const headers = cells.map(normalizeHeader);
    const hasTitle = headers.some((h) => h === "habit" || h === "title");
    return (
      hasTitle && headers.includes("date") && headers.includes("status")
    );
  });

  const parsed =
    longHeaderIndex >= 0
      ? parseLongFormat(rows, longHeaderIndex, options)
      : (() => {
          const wideHeaderIndex = findWideHeaderIndex(rows);
          if (wideHeaderIndex < 0) {
            return {
              rows: [],
              titles: [],
              warnings: [] as string[],
              error:
                "Could not find a header row. Use 'Habit,Date,Status' columns or a grid with 'Habit' plus date columns.",
            };
          }
          return parseWideFormat(rows, wideHeaderIndex, options);
        })();

  if (parsed.error) return parsed;
  if (parsed.rows.length === 0) {
    return {
      ...parsed,
      error: "No completion marks found. Use ✔, ✗, ⚠ or done/missed/skipped.",
    };
  }
  if (parsed.rows.length > MAX_HISTORY_LOG_ROWS) {
    return {
      ...parsed,
      error: `History import supports up to ${MAX_HISTORY_LOG_ROWS.toLocaleString()} marks at once (found ${parsed.rows.length.toLocaleString()}).`,
    };
  }
  if (parsed.titles.length > MAX_HISTORY_HABIT_TITLES) {
    return {
      ...parsed,
      error: `History import supports up to ${MAX_HISTORY_HABIT_TITLES} habits at once (found ${parsed.titles.length}).`,
    };
  }

  return parsed;
}
