"use client";

import readWorkbookFile, { type Sheet } from "read-excel-file/browser";
import { parseStatusCell } from "@/server/domain/habit-import";
import { isValidDateKey } from "@/server/domain/habit-analytics";
import type { MonthRoster } from "@/server/domain/habit-evolution";

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

const WEEKDAY_HEADER = /^(s|m|t|w|f|th)$/i;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
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

/** Recognizes sheet names such as JAN, "Sept", "January 2026" or "2026-11". */
export function readSheetMonth(
  sheetName: string,
  defaultYear: number
): SheetMonthInfo {
  const name = sheetName.trim();
  const yearMatch = name.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const isoMatch = name.match(/^(20\d{2})[-_/](0?[1-9]|1[0-2])$/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: `${isoMatch[1]}-${isoMatch[2]!.padStart(2, "0")}`,
    };
  }

  const word = name.replace(/[^A-Za-z]/g, "").toLowerCase();
  const monthNumber = MONTH_LOOKUP[word];
  if (monthNumber) {
    const resolvedYear = year ?? defaultYear;
    return {
      year: resolvedYear,
      month: `${resolvedYear}-${String(monthNumber).padStart(2, "0")}`,
    };
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

    // "1", "1\n M", "1 M", "01" all resolve to the first day of the month.
    const leadingDay = value.match(/^(\d{1,2})/);
    if (leadingDay) {
      return { index, dateKey: isValidDay(month, Number(leadingDay[1])) };
    }

    // Weekday-letter headers (S, M, T, W, T, F, S ...) map by column position.
    if (WEEKDAY_HEADER.test(value)) {
      return { index, dateKey: isValidDay(month, index) };
    }

    return { index, dateKey: null };
  });
}

function looksLikeDateHeader(value: string): boolean {
  return (
    isValidDateKey(value) ||
    /^\d{1,2}/.test(value) ||
    WEEKDAY_HEADER.test(value)
  );
}

function findHabitHeaderRow(data: unknown[][]): number {
  for (let i = 0; i < Math.min(data.length, 15); i++) {
    const row = data[i]!;
    const label = normalizeLabel(cellToString(row[0]));
    if (label !== "habit" && label !== "title") continue;
    const dateLike = row
      .slice(1)
      .filter((cell) => looksLikeDateHeader(cellToString(cell)));
    if (dateLike.length >= 2) return i;
  }
  return -1;
}

export interface WorkbookHistoryImport {
  csv: string;
  monthRosters: MonthRoster[];
  warnings: string[];
}

/**
 * Converts spreadsheet sheets into a long-form history CSV
 * (`Habit,Date,Status`) plus the per-month habit rosters needed to detect
 * adds, removals, renames and merges. Sheet names such as JAN/NOV are resolved
 * to months, so an 11-sheet tracker can be imported in one go.
 */
export function worksheetSheetsToHistoryImport(
  sheets: Sheet[],
  defaultYear = new Date().getFullYear()
): WorkbookHistoryImport {
  const lines = ["Habit,Date,Status"];
  const warnings: string[] = [];
  const rosterByMonth = new Map<string, Set<string>>();

  for (const sheet of sheets) {
    const data = sheet.data as unknown[][];
    const headerIndex = findHabitHeaderRow(data);
    if (headerIndex < 0) {
      if (data.some((row) => cellToString(row[0]))) {
        warnings.push(`Skipped sheet "${sheet.sheet}": no habit grid found.`);
      }
      continue;
    }

    const { month } = readSheetMonth(sheet.sheet, defaultYear);
    if (!month) {
      warnings.push(
        `Skipped sheet "${sheet.sheet}": could not determine its month.`
      );
      continue;
    }

    const columns = resolveDateColumns(data[headerIndex]!, month);
    const roster = rosterByMonth.get(month) ?? new Set<string>();
    let markCount = 0;

    for (let i = headerIndex + 1; i < data.length; i++) {
      const row = data[i]!;
      const title = cellToString(row[0]);
      if (!title || normalizeLabel(title) === "habit") continue;

      let rowHasMark = false;
      for (const column of columns) {
        if (!column.dateKey) continue;
        const status = parseStatusCell(row[column.index]);
        if (!status) continue;
        lines.push(toCsvLine([title, column.dateKey, status]));
        rowHasMark = true;
        markCount += 1;
      }
      if (rowHasMark) roster.add(title);
    }

    rosterByMonth.set(month, roster);
    if (markCount === 0) {
      warnings.push(`Sheet "${sheet.sheet}" had no recognizable marks.`);
    }
  }

  const monthRosters = Array.from(rosterByMonth.entries())
    .map(([month, titles]) => ({
      month,
      titles: Array.from(titles),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { csv: lines.join("\n"), monthRosters, warnings };
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

export async function readWorkbook(file: File): Promise<Sheet[]> {
  return readWorkbookFile(file);
}
