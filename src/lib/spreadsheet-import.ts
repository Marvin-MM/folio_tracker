"use client";

import type { Sheet } from "read-excel-file/browser";
import {
  isValidDateKey,
  isValidYearMonth,
} from "@/server/domain/habit-analytics";
import type { MonthRoster } from "@/server/domain/habit-evolution";
import {
  isSummaryRowTitle,
  parseStatusCell,
} from "@/server/domain/habit-import";

export const MAX_SPREADSHEET_FILE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap

export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".csv", ".txt"] as const;
export type AllowedImportExtension = (typeof ALLOWED_IMPORT_EXTENSIONS)[number];

export const IMPORT_FILE_ACCEPT =
  ".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain";

const ALLOWED_TEXT_MIME_TYPES = new Set([
  "",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel", // Windows browsers sometimes tag .csv as vnd.ms-excel
]);

const ALLOWED_XLSX_MIME_TYPES = new Set([
  "",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY_HEADER =
  /^(?:sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa|s|m|t|w|f)$/i;

const DAY_NUMBER_HEADER =
  /^(\d{1,2})(?:$|[\s\r\n/-]+(?:sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa|s|m|t|w|f)$)/i;

/**
 * Strictly validates that an uploaded file is one of Folio's allowed import
 * formats (`.xlsx`, `.csv`, `.txt`), within the 10 MB cap, and (for `.xlsx`)
 * starts with valid OOXML ZIP magic bytes (`PK\x03\x04`).
 */
export async function validateImportFile(file: File): Promise<{
  kind: "xlsx" | "text";
  extension: AllowedImportExtension;
}> {
  const lowerName = file.name.trim().toLowerCase();
  const matchedExt = ALLOWED_IMPORT_EXTENSIONS.find((ext) =>
    lowerName.endsWith(ext)
  );

  if (!matchedExt) {
    throw new Error(
      "Unsupported file format. Only .xlsx, .csv, and .txt files can be imported."
    );
  }

  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  if (file.size > MAX_SPREADSHEET_FILE_BYTES) {
    throw new Error("Import files must be 10 MB or smaller.");
  }

  const mime = (file.type || "").toLowerCase();

  if (matchedExt === ".xlsx") {
    if (mime && !ALLOWED_XLSX_MIME_TYPES.has(mime)) {
      throw new Error(
        "Invalid Excel file type. Upload a standard .xlsx spreadsheet."
      );
    }
    // Inspect first 4 bytes for ZIP/OOXML magic signature (PK\x03\x04)
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip =
      head.length >= 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      (head[2] === 0x03 || head[2] === 0x05) &&
      (head[3] === 0x04 || head[3] === 0x06);
    if (!isZip) {
      throw new Error(
        "This file is not a valid .xlsx workbook. Save it as Excel Workbook (.xlsx) or CSV (.csv) and try again."
      );
    }
    return { kind: "xlsx", extension: ".xlsx" };
  }

  if (mime && !ALLOWED_TEXT_MIME_TYPES.has(mime)) {
    throw new Error(
      "Unsupported file type. Only plain .csv, .txt, and .xlsx files are allowed."
    );
  }

  return { kind: "text", extension: matchedExt };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // read-excel-file parses Excel date cells into UTC midnight Dates;
    // always read UTC components to avoid -1 day timezone shift in western zones.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsvLine(values: string[]): string {
  return values.map(escapeCsv).join(",");
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.]/g, "");
}

export interface SheetMonthInfo {
  month: string | null;
  year: number | null;
}

/**
 * Recognizes sheet names such as "JAN", "Sept", "January 2026",
 * "Habit Tracker - Feb 2026", "JAN '26", or "2026-11".
 */
export function readSheetMonth(
  sheetName: string,
  defaultYear: number
): SheetMonthInfo {
  const name = sheetName.trim();

  const isoMatch = name.match(/\b(20\d{2})[-_/](0?[1-9]|1[0-2])\b/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: `${isoMatch[1]}-${isoMatch[2]!.padStart(2, "0")}`,
    };
  }

  const fullYearMatch = name.match(/\b(20\d{2})\b/);
  const shortYearMatch = !fullYearMatch
    ? name.match(/(?:['’]|^|\s)(2[0-9]|3[0-9])\b/)
    : null;
  const year = fullYearMatch
    ? Number(fullYearMatch[1])
    : shortYearMatch
      ? 2000 + Number(shortYearMatch[1])
      : null;

  // Match standalone alphabetic tokens so "Habit Tracker - Jan 2026" resolves
  // while non-month names like "Summary" or "Notes" return null.
  const tokens = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const monthNumber = MONTH_LOOKUP[token];
    if (monthNumber) {
      const resolvedYear = year ?? defaultYear;
      return {
        year: resolvedYear,
        month: `${resolvedYear}-${String(monthNumber).padStart(2, "0")}`,
      };
    }
  }

  return { year, month: null };
}

interface DateColumn {
  index: number;
  dateKey: string | null;
}

function isValidDay(month: string, day: number): string | null {
  const key = `${month}-${String(day).padStart(2, "0")}`;
  return isValidDateKey(key) ? key : null;
}

function resolveDateColumns(
  header: unknown[],
  month: string | null
): DateColumn[] {
  let weekdayOrdinal = 0;

  return header.map((raw, index) => {
    if (index === 0) return { index, dateKey: null };
    const value = cellToString(raw);
    if (!value) return { index, dateKey: null };

    if (isValidDateKey(value)) return { index, dateKey: value };

    const iso = value.match(
      /^(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])$/
    );
    if (iso) {
      const padded = `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
      return { index, dateKey: isValidDateKey(padded) ? padded : null };
    }

    if (!month) return { index, dateKey: null };

    // "1", "01", "1\nM", "1 M", "1 Mon" resolve cleanly without matching "2026" or "100%".
    const leadingDay = value.match(DAY_NUMBER_HEADER);
    if (leadingDay) {
      return { index, dateKey: isValidDay(month, Number(leadingDay[1])) };
    }

    // Weekday-letter headers (S, M, T, W, T, F, S ...) count sequentially from day 1,
    // even if extra metadata columns (e.g. Category/Goal) precede day 1.
    if (WEEKDAY_HEADER.test(value)) {
      weekdayOrdinal += 1;
      return { index, dateKey: isValidDay(month, weekdayOrdinal) };
    }

    return { index, dateKey: null };
  });
}

function looksLikeDateHeader(value: string): boolean {
  return (
    isValidDateKey(value) ||
    /^(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])$/.test(value) ||
    DAY_NUMBER_HEADER.test(value) ||
    WEEKDAY_HEADER.test(value)
  );
}

function findHabitHeaderRow(data: unknown[][]): number {
  for (let i = 0; i < Math.min(data.length, 15); i++) {
    const row = data[i]!;
    const label = normalizeLabel(cellToString(row[0]));
    if (label !== "habit" && label !== "title" && label !== "") continue;
    const dateLike = row
      .slice(1)
      .filter((cell) => looksLikeDateHeader(cellToString(cell)));
    if (dateLike.length >= 2) return i;
  }
  return -1;
}

/**
 * Returns true if an uploaded workbook looks like a completion-history matrix
 * (multiple month sheets or a habit-by-day grid with ✔/✗/⚠ marks) rather than
 * a flat habit-definition CSV.
 */
export function isLikelyHistoryWorkbook(sheets: Sheet[]): boolean {
  if (sheets.length === 0) return false;
  const monthNamedSheets = sheets.filter(
    (s) => readSheetMonth(s.sheet, 2026).month !== null
  );
  if (monthNamedSheets.length >= 2) return true;
  return sheets.some((s) => findHabitHeaderRow(s.data as unknown[][]) >= 0);
}

export interface WorkbookHistoryImportOptions {
  defaultYear?: number;
  /** Optional YYYY-MM fallback used for a 1-sheet workbook whose tab is named e.g. "Sheet1". */
  fallbackMonth?: string;
  /** Optional YYYY-MM ceiling (e.g. current month); future month sheets are skipped cleanly. */
  maxMonth?: string;
}

export interface WorkbookHistoryImport {
  csv: string;
  monthRosters: MonthRoster[];
  warnings: string[];
  sheetSummaries: Array<{
    sheet: string;
    month: string | null;
    habitCount: number;
    markCount: number;
    skippedReason?: string;
  }>;
}

/**
 * Converts 1, 2, or many spreadsheet sheets into a long-form history CSV
 * (`Habit,Date,Status`) plus per-month habit rosters needed to detect adds,
 * removals, renames, merges, and per-month active habit sets.
 */
export function worksheetSheetsToHistoryImport(
  sheets: Sheet[],
  yearOrOptions: number | WorkbookHistoryImportOptions = new Date().getFullYear()
): WorkbookHistoryImport {
  const opts: WorkbookHistoryImportOptions =
    typeof yearOrOptions === "number"
      ? { defaultYear: yearOrOptions }
      : yearOrOptions;

  const defaultYear = opts.defaultYear ?? new Date().getFullYear();
  const fallbackMonth =
    opts.fallbackMonth && isValidYearMonth(opts.fallbackMonth)
      ? opts.fallbackMonth
      : null;
  const maxMonth =
    opts.maxMonth && isValidYearMonth(opts.maxMonth) ? opts.maxMonth : null;

  const lines = ["Habit,Date,Status"];
  const warnings: string[] = [];
  const rosterByMonth = new Map<string, Set<string>>();
  const sheetSummaries: WorkbookHistoryImport["sheetSummaries"] = [];

  for (const sheet of sheets) {
    const data = sheet.data as unknown[][];
    const headerIndex = findHabitHeaderRow(data);
    if (headerIndex < 0) {
      if (data.some((row) => cellToString(row[0]))) {
        const msg = `Skipped sheet "${sheet.sheet}": no habit grid found.`;
        warnings.push(msg);
        sheetSummaries.push({
          sheet: sheet.sheet,
          month: null,
          habitCount: 0,
          markCount: 0,
          skippedReason: "No habit grid found",
        });
      }
      continue;
    }

    const detected = readSheetMonth(sheet.sheet, defaultYear).month;
    const resolvedMonth =
      detected ?? (sheets.length === 1 ? fallbackMonth : null);

    if (resolvedMonth && maxMonth && resolvedMonth > maxMonth) {
      warnings.push(
        `Skipped future month sheet "${sheet.sheet}" (${resolvedMonth} has not begun yet).`
      );
      sheetSummaries.push({
        sheet: sheet.sheet,
        month: resolvedMonth,
        habitCount: 0,
        markCount: 0,
        skippedReason: `Future month (${resolvedMonth})`,
      });
      continue;
    }

    const columns = resolveDateColumns(data[headerIndex]!, resolvedMonth);
    const hasResolvedColumns = columns.some((col) => Boolean(col.dateKey));

    if (!resolvedMonth && !hasResolvedColumns) {
      warnings.push(
        `Skipped sheet "${sheet.sheet}": could not determine its month. Rename the tab (e.g. "NOV" or "2026-11") or set the Month field for a single-sheet file.`
      );
      sheetSummaries.push({
        sheet: sheet.sheet,
        month: null,
        habitCount: 0,
        markCount: 0,
        skippedReason: "Month not recognized",
      });
      continue;
    }

    let markCount = 0;
    const sheetHabitTitles = new Set<string>();
    let skippedFutureDates = 0;

    for (let i = headerIndex + 1; i < data.length; i++) {
      const row = data[i]!;
      const title = cellToString(row[0]);
      if (
        !title ||
        normalizeLabel(title) === "habit" ||
        isSummaryRowTitle(title)
      ) {
        continue;
      }

      let rowHasAnyValidMark = false;
      for (const column of columns) {
        if (!column.dateKey) continue;
        const colMonth = column.dateKey.slice(0, 7);
        if (maxMonth && colMonth > maxMonth) {
          skippedFutureDates += 1;
          continue;
        }
        const status = parseStatusCell(row[column.index]);
        if (!status) continue;
        lines.push(toCsvLine([title, column.dateKey, status]));
        const roster = rosterByMonth.get(colMonth) ?? new Set<string>();
        roster.add(title);
        rosterByMonth.set(colMonth, roster);
        rowHasAnyValidMark = true;
        markCount += 1;
      }
      if (rowHasAnyValidMark) {
        sheetHabitTitles.add(title);
      }
    }

    if (skippedFutureDates > 0) {
      warnings.push(
        `Sheet "${sheet.sheet}": skipped marks in future months beyond ${maxMonth}.`
      );
    }

    if (markCount === 0) {
      warnings.push(`Sheet "${sheet.sheet}" had no recognizable marks.`);
    }

    sheetSummaries.push({
      sheet: sheet.sheet,
      month: resolvedMonth,
      habitCount: sheetHabitTitles.size,
      markCount,
    });
  }

  const monthRosters = Array.from(rosterByMonth.entries())
    .map(([month, titles]) => ({
      month,
      titles: Array.from(titles),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { csv: lines.join("\n"), monthRosters, warnings, sheetSummaries };
}

/** Backwards-compatible CSV-only helper. */
export function worksheetSheetsToHistoryCsv(
  sheets: Sheet[],
  defaultYear = new Date().getFullYear()
): string {
  return worksheetSheetsToHistoryImport(sheets, defaultYear).csv;
}

/** Converts a sheet to CSV text for the habit-definition importer. */
export function worksheetToHabitCsv(sheet: Sheet): string {
  return (sheet.data as unknown[][])
    .map((row) => toCsvLine(row.map(cellToString)))
    .filter((line) => line.replace(/,/g, "").trim().length > 0)
    .join("\n");
}

/**
 * Validates file type/size/signature and dynamically loads the Excel parser
 * only when the user actually uploads a `.xlsx` file.
 */
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const checked = await validateImportFile(file);
  if (checked.kind !== "xlsx") {
    throw new Error("Expected a valid .xlsx Excel workbook.");
  }
  const { default: readWorkbookFile } = await import("read-excel-file/browser");
  return readWorkbookFile(file);
}
