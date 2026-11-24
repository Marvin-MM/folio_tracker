import type { HabitLogStatus } from "@/server/db/schema";
import {
  isValidDateKey,
  isValidYearMonth,
  splitCsvLine,
} from "./habit-analytics";

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
  /** YYYY-MM. Used when day columns contain plain day numbers (1–31). */
  month?: string;
  /** Preview-only guard; the service re-checks against the server clock. */
  todayDateKey?: string;
}

export const MAX_HISTORY_LOG_ROWS = 20_000;
export const MAX_HISTORY_HABIT_TITLES = 500;

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
    .replace(/️/g, "");
}

function detectSeparator(lines: string[]): string {
  const first = lines.find((line) => line.trim().length > 0) ?? "";
  return first.includes("\t") ? "\t" : ",";
}

function dayHeaderToDateKey(
  raw: string,
  month: string | undefined,
  warnings: string[],
  lineNumber: number
): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (isValidDateKey(value)) return value;

  const monthMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (monthMatch) {
    const [, y, m, d] = monthMatch;
    const padded = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    if (isValidDateKey(padded)) return padded;
    warnings.push(`Line ${lineNumber}: invalid date header "${value}".`);
    return null;
  }

  if (/^\d{1,2}$/.test(value)) {
    const day = Number(value);
    if (!month) {
      warnings.push(
        `Line ${lineNumber}: day column "${value}" needs a month (YYYY-MM).`
      );
      return null;
    }
    if (!isValidYearMonth(month)) {
      warnings.push(`Line ${lineNumber}: invalid month "${month}".`);
      return null;
    }
    const padded = `${month}-${String(day).padStart(2, "0")}`;
    if (!isValidDateKey(padded)) {
      warnings.push(`Line ${lineNumber}: invalid date header "${value}".`);
      return null;
    }
    return padded;
  }

  return null;
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
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = rows[i]!;
    const label = normalizeHeader(cells[0] ?? "");
    if (label !== "habit" && label !== "title" && label !== "") continue;

    const dateLike = cells.slice(1).filter((cell) => {
      const value = cell.trim();
      return isValidDateKey(value) || /^\d{1,2}$/.test(value);
    });
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
  const dateColumns = header
    .slice(1)
    .map((value, index) => ({
      column: index + 1,
      dateKey: dayHeaderToDateKey(
        value,
        options.month,
        warnings,
        headerIndex + 1
      ),
    }))
    .filter((entry): entry is { column: number; dateKey: string } =>
      Boolean(entry.dateKey)
    );

  if (dateColumns.length === 0) {
    return {
      rows: [],
      titles: [],
      warnings,
      error:
        "No date columns found. Use ISO dates (2026-01-01) or day numbers 1–31 plus a month.",
    };
  }

  const collected = new Map<string, ParsedHistoryLog>();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const title = (cells[0] ?? "").trim().slice(0, 120);
    if (!title) continue;
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
 * Parses habit completion history from either a long CSV
 * (`Habit,Date,Status`) or an Excel-style wide grid where rows are habits and
 * columns are dates (ISO dates or day numbers interpreted with `options.month`).
 */
export function parseHabitHistoryImport(
  rawText: string,
  options: ParseHistoryOptions = {}
): ParsedHistoryImport {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
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

  const separator = detectSeparator(lines);
  const rows = lines.map((line) => splitCsvLine(line, separator));

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
