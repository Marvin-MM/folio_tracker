import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";

interface DrizzleJournal {
  entries: Array<{
    idx: number;
    tag: string;
    when: number;
  }>;
}

describe("Drizzle migrations integrity", () => {
  it("keeps strictly ascending idx and when timestamps in _journal.json", () => {
    const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as DrizzleJournal;

    expect(journal.entries.length).toBeGreaterThanOrEqual(13);

    for (let i = 1; i < journal.entries.length; i += 1) {
      const prev = journal.entries[i - 1]!;
      const curr = journal.entries[i]!;
      expect(curr.idx).toBe(prev.idx + 1);
      // Drizzle migrator skips any migration whose `when` is <= the previously
      // applied migration's `created_at`. Enforce strict monotonicity.
      expect(curr.when).toBeGreaterThan(prev.when);
    }
  });

  it("keeps a matching snapshot for every journal entry", () => {
    const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as DrizzleJournal;

    let previousId = "00000000-0000-0000-0000-000000000000";
    for (const entry of journal.entries) {
      const snapshotPath = path.resolve(
        process.cwd(),
        `drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`
      );
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
        id: string;
        prevId: string;
      };

      expect(snapshot.prevId).toBe(previousId);
      previousId = snapshot.id;
    }
  });

  it("applies every migration cleanly to a fresh database including month locks and Phase A foundations", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      const db = drizzle(client);
      await migrate(db, {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      });

      const tablesRes = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
      );
      const tableNames = tablesRes.rows.map((row) => String(row.name));

      expect(tableNames).toContain("habit_import_aliases");
      expect(tableNames).toContain("admin_audit_logs");
      expect(tableNames).toContain("habit_month_rosters");
      expect(tableNames).toContain("habit_month_locks");
      expect(tableNames).toContain("operations");
      expect(tableNames).toContain("operation_versions");
      expect(tableNames).toContain("operation_reference_notes");
      expect(tableNames).toContain("operation_runs");
      expect(tableNames).toContain("operation_run_steps");
      expect(tableNames).toContain("user_follows");
      expect(tableNames).toContain("operation_members");
      expect(tableNames).toContain("operation_invitations");
      expect(tableNames).toContain("operation_step_flags");
      expect(tableNames).toContain("habit_excuse_ranges");
      expect(tableNames).toContain("habit_day_entries");
      expect(tableNames).toContain("undo_snapshots");
      expect(tableNames).toContain("habit_saved_views");
      expect(tableNames).toHaveLength(39);

      const habitColumnsRes = await client.execute(
        "PRAGMA table_info('habits')",
      );
      const habitColumns = habitColumnsRes.rows.map((row) => String(row.name));
      expect(habitColumns).toEqual(
        expect.arrayContaining(["energy_need", "place", "tags_json"]),
      );

      const logColumnsRes = await client.execute(
        "PRAGMA table_info('habit_logs')",
      );
      const logColumns = logColumnsRes.rows.map((row) => String(row.name));
      expect(logColumns).toEqual(
        expect.arrayContaining(["miss_reason", "source"]),
      );

      const schemaRes = await client.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('habits','habit_logs','habit_saved_views')"
      );
      const schemaByTable = new Map(
        schemaRes.rows.map((row) => [String(row.name), String(row.sql ?? "")])
      );
      expect(schemaByTable.get("habits")).toContain(
        "habits_energy_need_check"
      );
      expect(schemaByTable.get("habits")).toContain("habits_place_check");
      expect(schemaByTable.get("habit_logs")).toContain(
        "habit_logs_miss_reason_check"
      );
      expect(schemaByTable.get("habit_logs")).toContain(
        "habit_logs_source_check"
      );
      expect(schemaByTable.get("habit_saved_views")).toContain(
        "habit_saved_views_kind_check"
      );
      expect(schemaByTable.get("habit_saved_views")).toContain(
        "habit_saved_views_group_by_check"
      );
      expect(schemaByTable.get("habit_saved_views")).toContain(
        "habit_saved_views_sort_by_check"
      );

      // Verify Migration 0012 rebuild preserved Migration 0010 FK/perf indexes
      const idxRes = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('habits','habit_logs')"
      );
      const idxNames = idxRes.rows.map((r) => String(r.name));
      expect(idxNames).toEqual(
        expect.arrayContaining([
          "habits_user_archived_pos_idx",
          "habits_archived_preferred_time_idx",
          "habits_linked_project_id_idx",
          "habit_logs_habit_date_uq",
          "habit_logs_user_date_idx",
          "habit_logs_logged_at_idx",
        ])
      );
    } finally {
      client.close();
    }
  });

  it("migrates a populated database cleanly through 0012 without FK cascade loss", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.execute("PRAGMA foreign_keys = ON;");
      // Apply migrations 0000..0011 first
      const journalPath = path.resolve(
        process.cwd(),
        "drizzle/meta/_journal.json"
      );
      const journal = JSON.parse(
        readFileSync(journalPath, "utf8")
      ) as DrizzleJournal;
      for (const entry of journal.entries.filter((e) => e.idx <= 11)) {
        const sqlText = readFileSync(
          path.resolve(process.cwd(), `drizzle/${entry.tag}.sql`),
          "utf8"
        );
        for (const stmt of sqlText.split("--> statement-breakpoint")) {
          const clean = stmt.trim();
          if (clean) await client.execute(clean);
        }
      }

      // Seed existing user, habit, log, and linked operation BEFORE Migration 0012
      await client.execute(
        "INSERT INTO users (id, name, email, email_verified, timezone, created_at, updated_at) VALUES ('u1', 'Test', 't@example.com', 1, 'UTC', 1, 1)"
      );
      await client.execute(
        "INSERT INTO habits (id, user_id, title, start_date, created_at, updated_at) VALUES ('h1', 'u1', 'Swim', '2026-11-01', 1, 1)"
      );
      await client.execute(
        "INSERT INTO habit_logs (id, habit_id, user_id, date_key, status, logged_at) VALUES ('l1', 'h1', 'u1', '2026-11-01', 'done', 1)"
      );
      await client.execute(
        "INSERT INTO operations (id, owner_id, linked_habit_id, slug, title, summary, created_at, updated_at) VALUES ('op1', 'u1', 'h1', 'swim-op', 'Swim Op', 'Summary', 1, 1)"
      );

      // Now run Migration 0012 with foreign keys ON!
      const m12 = readFileSync(
        path.resolve(process.cwd(), "drizzle/0012_phase_b_habit_extensions.sql"),
        "utf8"
      );
      for (const stmt of m12.split("--> statement-breakpoint")) {
        const clean = stmt.trim();
        if (clean) await client.execute(clean);
      }

      // All rows and FK links MUST survive intact with new default columns!
      const habitRow = await client.execute(
        "SELECT id, energy_need, place, tags_json FROM habits WHERE id = 'h1'"
      );
      expect(habitRow.rows[0]).toMatchObject({
        id: "h1",
        energy_need: "medium",
        place: "anywhere",
        tags_json: "[]",
      });
      const logRow = await client.execute(
        "SELECT id, source, miss_reason FROM habit_logs WHERE id = 'l1'"
      );
      expect(logRow.rows[0]).toMatchObject({
        id: "l1",
        source: "manual",
        miss_reason: null,
      });
      const opRow = await client.execute(
        "SELECT linked_habit_id FROM operations WHERE id = 'op1'"
      );
      expect(opRow.rows[0]?.linked_habit_id).toBe("h1");
    } finally {
      client.close();
    }
  });
});
