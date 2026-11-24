import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sheet } from "read-excel-file/browser";
import {
  isLikelyHistoryWorkbook,
  readSheetMonth,
  validateImportFile,
  worksheetSheetsToHistoryImport,
  worksheetToHabitCsv,
} from "@/lib/spreadsheet-import";
import { ValidationError } from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitImportAliases,
  habitLogs,
  habits,
  users,
} from "@/server/db/schema";
import {
  parseAliasOverrides,
  planHabitEvolution,
} from "@/server/domain/habit-evolution";
import {
  deriveMonthRostersFromLogs,
  parseHabitHistoryImport,
} from "@/server/domain/habit-import";
import { HabitService } from "@/server/services/habit-service";

// Fixed server clock: 2026-03-31T12:00:00Z
const FIXED_NOW = Date.parse("2026-03-31T12:00:00.000Z");

describe("habit history import, spreadsheet parsing, and backfilled analytics", () => {
  let tempDir: string;
  let conn: DbConnection;
  let habitService: HabitService;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-habit-import-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    habitService = new HabitService({
      database: conn.db,
      habits: new DrizzleHabitRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      projects: new DrizzleProjectRepository(conn.db),
      now: () => FIXED_NOW,
    });

    const [a, b] = await conn.db
      .insert(users)
      .values([
        {
          id: "01IMPORTUSERA0000000000001",
          name: "Import Alice",
          email: "import.alice@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01IMPORTUSERB0000000000002",
          name: "Import Bob",
          email: "import.bob@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();

    userAId = a!.id;
    userBId = b!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses sheet names, UTC Excel dates, 1\\nM headers, weekday-letter grids with metadata columns, and skips summary rows", () => {
    expect(readSheetMonth("JAN", 2026).month).toBe("2026-01");
    expect(readSheetMonth("SEPT", 2026).month).toBe("2026-09");
    expect(readSheetMonth("January 2026", 2025).month).toBe("2026-01");
    expect(readSheetMonth("2026-11", 2025).month).toBe("2026-11");
    expect(readSheetMonth("Habit Tracker - Mar 2026", 2025).month).toBe(
      "2026-03"
    );
    expect(readSheetMonth("FEB '25", 2026).month).toBe("2025-02");
    expect(readSheetMonth("Summary", 2026).month).toBeNull();

    const sheets: Sheet[] = [
      {
        sheet: "JAN",
        data: [
          // Extra Category column + weekday-letter headers + trailing summary columns ("2026", "100%")
          ["Habit", "Category", "T", "F", "S", "2026", "100%"],
          ["Wake up at 4:30", "Routine", "✔", "✗", "⚠", "1", "1"],
          ["Odoo Documentation", "Craft", "✔", "✔", "✔", "1", "1"],
          ["Total", "", "1", "1", "1", "1", "1"],
        ],
      },
      {
        sheet: "February 2026",
        data: [
          ["Habit", "1\nS", "2\nM", new Date(Date.UTC(2026, 1, 3))],
          ["Wake up 4:30", "✔", "✔", "✔"],
          ["100 Push-ups", "", "", "✔"],
        ],
      },
      {
        sheet: "Summary",
        data: [["Notes", "Annual overview"]],
      },
    ];

    const converted = worksheetSheetsToHistoryImport(sheets, 2026);
    expect(converted.warnings).toContain(
      'Skipped sheet "Summary": no habit grid found.'
    );
    expect(converted.monthRosters).toEqual([
      { month: "2026-01", titles: ["Wake up at 4:30", "Odoo Documentation"] },
      { month: "2026-02", titles: ["Wake up 4:30", "100 Push-ups"] },
    ]);

    const parsed = parseHabitHistoryImport(converted.csv, {
      todayDateKey: "2026-03-31",
    });
    expect(parsed.error).toBeUndefined();
    // "Total" summary row must not be imported; "2026" and "100%" columns must not resolve to day 20/10
    expect(parsed.titles).not.toContain("Total");
    expect(
      parsed.rows.filter((r) => r.title === "Wake up at 4:30")
    ).toEqual([
      { title: "Wake up at 4:30", dateKey: "2026-01-01", status: "done" },
      { title: "Wake up at 4:30", dateKey: "2026-01-02", status: "missed" },
      { title: "Wake up at 4:30", dateKey: "2026-01-03", status: "skipped" },
    ]);
    // UTC Date(2026-02-03) stays exact "2026-02-03" in every timezone
    expect(
      parsed.rows.find(
        (r) => r.title === "100 Push-ups" && r.dateKey === "2026-02-03"
      )?.status
    ).toBe("done");

    // Habit definition worksheet conversion preserves startDate column
    const defCsv = worksheetToHabitCsv({
      sheet: "Habits",
      data: [
        ["title", "category", "cadence", "preferredTime", "startDate"],
        ["Deep Work", "Craft", "weekdays", "08:30", new Date(Date.UTC(2026, 0, 5))],
      ],
    });
    expect(defCsv).toContain("Deep Work,Craft,weekdays,08:30,2026-01-05");
  });

  it("parses pasted wide grids with quoted multi-line headers, weekday letters, and quoted alias commas", () => {
    const pastedMultiLine = `Habit,"1\nM","2\nT","3\nW"
Morning Run,✔,⚠,✗`;
    const parsedMulti = parseHabitHistoryImport(pastedMultiLine, {
      month: "2026-02",
      todayDateKey: "2026-03-31",
    });
    expect(parsedMulti.error).toBeUndefined();
    expect(parsedMulti.rows).toEqual([
      { title: "Morning Run", dateKey: "2026-02-01", status: "done" },
      { title: "Morning Run", dateKey: "2026-02-02", status: "skipped" },
      { title: "Morning Run", dateKey: "2026-02-03", status: "missed" },
    ]);

    const pastedWeekdays = `Habit,S,M,T
Read 20 pages,✔,✔,✗`;
    const parsedWeekdays = parseHabitHistoryImport(pastedWeekdays, {
      month: "2026-02",
      todayDateKey: "2026-03-31",
    });
    expect(parsedWeekdays.error).toBeUndefined();
    expect(parsedWeekdays.rows.map((r) => r.dateKey)).toEqual([
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
    ]);

    // Quoted comma titles in alias overrides
    const aliasParsed = parseAliasOverrides(
      'Source Title,Canonical Title\n"Read, Journal","Read, Journal & Reflect"'
    );
    expect(aliasParsed.error).toBeUndefined();
    expect(aliasParsed.overrides).toEqual([
      { sourceTitle: "Read, Journal", canonicalTitle: "Read, Journal & Reflect" },
    ]);

    // Suggestions always orient chronologically (earlier -> later)
    const evo = planHabitEvolution([
      { month: "2026-01", titles: ["Walk"] },
      { month: "2026-02", titles: ["Morning Walk Sprint"] },
    ]);
    const walkSuggestion = evo.suggestions.find(
      (s) => s.sourceTitle === "Walk" || s.canonicalTitle === "Walk"
    );
    if (walkSuggestion) {
      expect(walkSuggestion.sourceTitle).toBe("Walk");
      expect(walkSuggestion.canonicalTitle).toBe("Morning Walk Sprint");
    }
  });

  it("imports multi-month history with renames, same-day merge dedup, true mid-month startDate, archival, and accurate historical analytics", async () => {
    // Pre-create an existing habit starting TODAY (2026-03-31) to prove startDate backfill works
    const preExisting = await habitService.createHabit(userAId, "UTC", {
      title: "Morning Walk",
      startDate: "2026-03-31",
    });

    const csv = `Habit,Date,Status
Morning Walk,2026-01-01,✔
Morning Walk,2026-01-02,✔
Morning Walk,2026-01-03,✔
Wake up at 4:30,2026-01-01,✔
Wake up at 4:30,2026-01-02,✔
Wake up at 4:30,2026-01-03,✔
Wake up 4:30,2026-03-01,✔
Wake up 4:30,2026-03-02,✔
Wake up 4:30,2026-03-03,✔
Odoo Documentation,2026-01-01,✔
Odoo Documentation,2026-01-02,✔
Odoo Documentation,2026-01-03,✔
Mid-month Pushups,2026-02-15,✔
Mid-month Pushups,2026-02-16,✔
Mid-month Pushups,2026-02-17,✔
Mid-month Pushups,2026-03-01,✔
Old Focus A,2026-01-05,✔
Old Focus B,2026-01-05,✗
Unified Focus,2026-03-01,✔`;

    const parsed = parseHabitHistoryImport(csv, { todayDateKey: "2026-03-31" });
    expect(parsed.error).toBeUndefined();

    // Note: pass empty monthRosters to prove server derives rosters automatically from CSV dates!
    const result = await habitService.bulkImportHistory(userAId, "UTC", {
      rows: parsed.rows,
      createMissing: true,
      archiveRemoved: true,
      monthRosters: [],
      aliasOverrides: [
        { sourceTitle: "Old Focus A", canonicalTitle: "Unified Focus" },
        { sourceTitle: "Old Focus B", canonicalTitle: "Unified Focus" },
      ],
    });

    // 19 source rows, but Old Focus A (done) + Old Focus B (missed) collide on 2026-01-05 -> 18 deduped marks!
    expect(result.importedCount).toBe(18);
    expect(result.matchedTitleCount).toBe(1); // Morning Walk
    expect(result.createdHabits.map((h) => h.title).sort()).toEqual([
      "Mid-month Pushups",
      "Odoo Documentation",
      "Unified Focus",
      "Wake up 4:30",
    ]);
    // Both Morning Walk (last seen Jan) and Odoo Documentation (last seen Jan) are archived since lastMonth is 2026-03
    expect(result.archivedHabits.map((h) => h.title).sort()).toEqual([
      "Morning Walk",
      "Odoo Documentation",
    ]);

    const userAHabits = await conn.db
      .select()
      .from(habits)
      .where(eq(habits.userId, userAId));

    // 1. Existing habit startDate pulled back from 2026-03-31 -> 2026-01-01!
    const walkRow = userAHabits.find((h) => h.id === preExisting.id);
    expect(walkRow?.startDate).toBe("2026-01-01");

    // 2. Mid-month starter keeps true first appearance (2026-02-15), NOT 2026-02-01!
    const pushupsRow = userAHabits.find((h) => h.title === "Mid-month Pushups");
    expect(pushupsRow?.startDate).toBe("2026-02-15");
    expect(pushupsRow?.isArchived).toBe(false);

    // 3. Same-day merge collision preserves 'done' over 'missed'
    const unifiedRow = userAHabits.find((h) => h.title === "Unified Focus")!;
    const unifiedLogs = await conn.db
      .select()
      .from(habitLogs)
      .where(eq(habitLogs.habitId, unifiedRow.id));
    expect(
      unifiedLogs.find((l) => l.dateKey === "2026-01-05")?.status
    ).toBe("done");

    // 4. Aliases persisted in habit_import_aliases
    const savedAliases = await conn.db
      .select()
      .from(habitImportAliases)
      .where(eq(habitImportAliases.userId, userAId));
    expect(savedAliases.map((a) => a.sourceTitle).sort()).toEqual([
      "Old Focus A",
      "Old Focus B",
      "Wake up at 4:30",
    ]);

    // 5. Historical Analytics Accuracy — January 2026 MUST include archived habits that were active in Jan!
    const janWorkspace = await habitService.getMonthWorkspace(userAId, "UTC", {
      yearMonth: "2026-01",
      scoringMode: "elapsed",
    });
    expect(janWorkspace.habits.map((h) => h.title)).toContain(
      "Odoo Documentation"
    );
    expect(janWorkspace.habits.map((h) => h.title)).toContain("Morning Walk");
    expect(
      janWorkspace.analytics.byHabitId[preExisting.id]?.doneCount
    ).toBe(3);

    // 6. Current Month (March 2026) — archived habits with 0 March marks stay out of active grid!
    const marWorkspace = await habitService.getMonthWorkspace(userAId, "UTC", {
      yearMonth: "2026-03",
      scoringMode: "elapsed",
    });
    expect(marWorkspace.habits.map((h) => h.title)).not.toContain(
      "Odoo Documentation"
    );
    expect(marWorkspace.habits.map((h) => h.title)).toContain("Wake up 4:30");
    expect(marWorkspace.archivedHabits.map((h) => h.title)).toContain(
      "Odoo Documentation"
    );

    // 7. Mid-month starter in Feb 2026 has 14 scheduled days (Feb 15..28), NOT 28!
    const febWorkspace = await habitService.getMonthWorkspace(userAId, "UTC", {
      yearMonth: "2026-02",
      scoringMode: "full_month",
    });
    expect(
      febWorkspace.analytics.byHabitId[pushupsRow!.id]?.scheduledCount
    ).toBe(14);
    expect(
      febWorkspace.analytics.byHabitId[pushupsRow!.id]?.doneCount
    ).toBe(3);

    // 8. Re-importing via old alias ("Wake up at 4:30") resolves to the SAME habit with zero duplicates
    const secondImport = await habitService.bulkImportHistory(userAId, "UTC", {
      rows: [
        { title: "Wake up at 4:30", dateKey: "2026-03-04", status: "done" },
      ],
      createMissing: true,
      archiveRemoved: false,
      monthRosters: deriveMonthRostersFromLogs([
        { title: "Wake up at 4:30", dateKey: "2026-03-04", status: "done" },
      ]),
      aliasOverrides: [],
    });
    expect(secondImport.createdHabits).toHaveLength(0);
    expect(secondImport.matchedTitleCount).toBe(1);
    expect(secondImport.importedCount).toBe(1);

    // 9. Cross-tenant isolation: User B has 0 habits and 0 aliases
    const bobWorkspace = await habitService.getMonthWorkspace(userBId, "UTC", {
      yearMonth: "2026-01",
    });
    expect(bobWorkspace.habits).toHaveLength(0);
  });

  it("handles large chunked imports (>50 habits, >300 marks) without hitting SQLite bind variable limits and supports startDate in habit definitions", async () => {
    // Habit-definition importer optional startDate column
    const defImported = await habitService.bulkImportHabits(
      userBId,
      "UTC",
      `title,category,cadence,preferredTime,startDate
Early Bird,Routine,daily,06:00,2026-01-10`
    );
    expect(defImported).toHaveLength(1);
    expect(defImported[0]?.startDate).toBe("2026-01-10");

    // 65 habits x 6 days = 390 marks -> proves chunked createHabitsBatch & upsertLogsBatch
    const rows: Array<{ title: string; dateKey: string; status: "done" | "missed" | "skipped" }> = [];
    for (let h = 1; h <= 65; h++) {
      for (let d = 1; d <= 6; d++) {
        rows.push({
          title: `Batch Habit ${h}`,
          dateKey: `2026-02-0${d}`,
          status: d % 3 === 0 ? "skipped" : "done",
        });
      }
    }

    const res = await habitService.bulkImportHistory(userBId, "UTC", {
      rows,
      createMissing: true,
      archiveRemoved: false,
      monthRosters: [],
      aliasOverrides: [],
    });

    expect(res.createdHabits).toHaveLength(65);
    expect(res.importedCount).toBe(390);
  });

  it("restricts file uploads strictly to valid .xlsx, .csv, and .txt files and supports 1-sheet fallbackMonth + future-month skipping", async () => {
    const pdfFile = new File(["%PDF-1.4"], "tracker.pdf", {
      type: "application/pdf",
    });
    await expect(validateImportFile(pdfFile)).rejects.toThrow(
      /Only \.xlsx, \.csv, and \.txt/i
    );

    const legacyXls = new File(["binary"], "old-tracker.xls", {
      type: "application/vnd.ms-excel",
    });
    await expect(validateImportFile(legacyXls)).rejects.toThrow(
      /Only \.xlsx, \.csv, and \.txt/i
    );

    const fakeXlsx = new File(["not a zip file"], "spoofed.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(validateImportFile(fakeXlsx)).rejects.toThrow(
      /not a valid \.xlsx workbook/i
    );

    const validZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const validXlsx = new File([validZipBytes], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(validateImportFile(validXlsx)).resolves.toEqual({
      kind: "xlsx",
      extension: ".xlsx",
    });

    const validCsv = new File(["Habit,Date,Status\nWalk,2026-01-01,✔"], "h.csv", {
      type: "text/csv",
    });
    await expect(validateImportFile(validCsv)).resolves.toEqual({
      kind: "text",
      extension: ".csv",
    });

    // Single-sheet workbook named "Sheet1" resolves via fallbackMonth & filters Core day?/Logged? rows
    const singleSheet: Sheet[] = [
      {
        sheet: "Sheet1",
        data: [
          ["Habit", "1\nM", "2\nT"],
          ["Read 20 pages", "✔", "✔"],
          ["Core day?", "1", "1"],
          ["Logged?", "1", "1"],
        ],
      },
    ];
    expect(isLikelyHistoryWorkbook(singleSheet)).toBe(true);

    const singleRes = worksheetSheetsToHistoryImport(singleSheet, {
      defaultYear: 2026,
      fallbackMonth: "2026-03",
      maxMonth: "2026-03",
    });
    expect(singleRes.monthRosters).toEqual([
      { month: "2026-03", titles: ["Read 20 pages"] },
    ]);

    // Future month sheet ("APR" when maxMonth is 2026-03) is skipped cleanly
    const withFutureSheet: Sheet[] = [
      ...singleSheet,
      {
        sheet: "APR",
        data: [
          ["Habit", "1", "2"],
          ["Future Habit", "✔", "✔"],
        ],
      },
    ];
    const filtered = worksheetSheetsToHistoryImport(withFutureSheet, {
      defaultYear: 2026,
      maxMonth: "2026-03",
    });
    expect(
      filtered.warnings.some((w) => w.includes('Skipped future month sheet "APR"'))
    ).toBe(true);
    expect(filtered.csv).not.toContain("Future Habit");
  });

  it("enforces per-month habit rosters, carry-over editing across months, and strict future-month blocking", async () => {
    const [rosterUser] = await conn.db
      .insert(users)
      .values({
        id: "01ROSTERUSER00000000000003",
        name: "Monthly Roster User",
        email: "roster.user@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();

    let currentClockMs = Date.parse("2026-11-24T12:00:00.000Z");
    const clockAwareService = new HabitService({
      database: conn.db,
      habits: new DrizzleHabitRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      projects: new DrizzleProjectRepository(conn.db),
      now: () => currentClockMs,
    });

    // Future month (December 2026 while still in November 2026) MUST be blocked everywhere
    const clampedFuture = await clockAwareService.getMonthWorkspace(
      rosterUser!.id,
      "UTC",
      { yearMonth: "2026-12" }
    );
    expect(clampedFuture.yearMonth).toBe("2026-11");

    await expect(
      clockAwareService.saveMonthRoster(rosterUser!.id, "UTC", {
        yearMonth: "2026-12",
        habitIds: [],
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      clockAwareService.carryOverPreviousMonthRoster(rosterUser!.id, "UTC", {
        targetYearMonth: "2026-12",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      clockAwareService.createHabit(rosterUser!.id, "UTC", {
        title: "Too Early Habit",
        startDate: "2026-12-01",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    // Populate November 2026 with 12 habits via history import
    const novRows = Array.from({ length: 12 }, (_, idx) => ({
      title: `November Habit ${idx + 1}`,
      dateKey: "2026-11-01",
      status: "done" as const,
    }));
    await clockAwareService.bulkImportHistory(rosterUser!.id, "UTC", {
      rows: novRows,
      createMissing: true,
      archiveRemoved: false,
      monthRosters: [],
      aliasOverrides: [],
    });

    const novWs = await clockAwareService.getMonthWorkspace(
      rosterUser!.id,
      "UTC",
      { yearMonth: "2026-11" }
    );
    expect(novWs.habits).toHaveLength(12);
    expect(novWs.hasExplicitMonthRoster).toBe(true);

    // Advance server clock to December 2, 2026 -> December becomes trackable!
    currentClockMs = Date.parse("2026-12-02T12:00:00.000Z");

    const decBeforeCarry = await clockAwareService.getMonthWorkspace(
      rosterUser!.id,
      "UTC",
      { yearMonth: "2026-12" }
    );
    expect(decBeforeCarry.yearMonth).toBe("2026-12");
    expect(decBeforeCarry.habits).toHaveLength(0);
    expect(decBeforeCarry.previousRosterSource?.yearMonth).toBe("2026-11");
    expect(decBeforeCarry.previousRosterSource?.habitIds).toHaveLength(12);

    // Carry over all 12 from November -> then remove 1 habit from December ONLY -> December renders 11, November STILL renders 12!
    const carried = await clockAwareService.carryOverPreviousMonthRoster(
      rosterUser!.id,
      "UTC",
      { targetYearMonth: "2026-12" }
    );
    expect(carried.habitIds).toHaveLength(12);

    await clockAwareService.removeHabitFromMonth(rosterUser!.id, "UTC", {
      habitId: carried.habitIds[0]!,
      yearMonth: "2026-12",
    });

    const [decAfterEdit, novStillIntact, todayStrip] = await Promise.all([
      clockAwareService.getMonthWorkspace(rosterUser!.id, "UTC", {
        yearMonth: "2026-12",
      }),
      clockAwareService.getMonthWorkspace(rosterUser!.id, "UTC", {
        yearMonth: "2026-11",
      }),
      clockAwareService.getTodayHabitsStrip(rosterUser!.id, "UTC"),
    ]);

    expect(decAfterEdit.habits).toHaveLength(11);
    expect(novStillIntact.habits).toHaveLength(12);
    expect(todayStrip.items).toHaveLength(11);

    // Removing a habit from a month that ALREADY has logs in that month MUST
    // immediately remove it from that month's visible list & KPIs without deleting logs
    // or affecting other months.
    const removedFromNov = novStillIntact.habits[0]!;
    await clockAwareService.saveMonthRoster(rosterUser!.id, "UTC", {
      yearMonth: "2026-11",
      habitIds: novStillIntact.habits.slice(1).map((h) => h.id),
    });
    const novAfterRemove = await clockAwareService.getMonthWorkspace(
      rosterUser!.id,
      "UTC",
      { yearMonth: "2026-11" }
    );
    expect(novAfterRemove.habits).toHaveLength(11);
    expect(novAfterRemove.habits.map((h) => h.id)).not.toContain(
      removedFromNov.id
    );
    // Underlying log is still safely preserved if the user re-adds the habit to Nov later
    expect(
      novAfterRemove.logsByKey[`${removedFromNov.id}::2026-11-01`]?.status
    ).toBe("done");
  });
});
