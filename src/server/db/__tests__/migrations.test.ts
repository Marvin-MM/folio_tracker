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

    expect(journal.entries.length).toBeGreaterThanOrEqual(10);

    for (let i = 1; i < journal.entries.length; i += 1) {
      const prev = journal.entries[i - 1]!;
      const curr = journal.entries[i]!;
      expect(curr.idx).toBe(prev.idx + 1);
      // Drizzle migrator skips any migration whose `when` is <= the previously
      // applied migration's `created_at`. Enforce strict monotonicity.
      expect(curr.when).toBeGreaterThan(prev.when);
    }
  });

  it("applies every migration cleanly to a fresh database including habit_month_rosters and habit_month_locks", async () => {
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
      expect(tableNames).toContain("habit_groups");
      expect(tableNames).toContain("habit_group_members");
      expect(tableNames).toContain("habit_group_shared_habits");
      expect(tableNames).toContain("habit_group_reviews");
      expect(tableNames).toHaveLength(30);
    } finally {
      client.close();
    }
  });

  it("allows invited group memberships in the committed schema", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      const db = drizzle(client);
      await migrate(db, {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      });

      const tableRes = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='habit_group_members'",
      );
      const schemaSql = String(tableRes.rows[0]?.sql ?? "");
      expect(schemaSql).toContain("'active'");
      expect(schemaSql).toContain("'invited'");
      expect(schemaSql).toContain("'left'");
    } finally {
      client.close();
    }
  });
});
