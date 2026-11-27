import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { features, type FeatureFlag } from "@/config/features";
import { ConflictError, NotFoundError } from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleHabitViewRepository } from "@/server/dal/habit-views";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { habitLogs, users } from "@/server/db/schema";
import { HabitService } from "@/server/services/habit-service";

const MUTABLE_FLAGS = features as Record<FeatureFlag, boolean>;
const ORIGINAL_FLAGS = { ...MUTABLE_FLAGS };

describe("HabitService Phase B metadata and saved-view fixes", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userId: string;
  let habitSvc: HabitService;
  const nowMs = Date.parse("2026-11-18T12:00:00.000Z");

  beforeAll(async () => {
    MUTABLE_FLAGS.habitMetadata = true;
    MUTABLE_FLAGS.savedViews = true;
    MUTABLE_FLAGS.missReasonPrompt = true;

    tempDir = mkdtempSync(path.join(tmpdir(), "folio-metadata-test-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [user] = await conn.db
      .insert(users)
      .values({
        name: "Metadata Tester",
        email: "metadata@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();
    userId = user!.id;

    habitSvc = new HabitService({
      database: conn.db,
      habits: new DrizzleHabitRepository(conn.db),
      views: new DrizzleHabitViewRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      projects: new DrizzleProjectRepository(conn.db),
      now: () => nowMs,
    });
  });

  afterAll(() => {
    Object.assign(MUTABLE_FLAGS, ORIGINAL_FLAGS);
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates only the metadata fields explicitly provided", async () => {
    const habit = await habitSvc.createHabit(userId, "UTC", {
      title: "Custom routine",
      startDate: "2026-11-01",
      energyNeed: "low",
      place: "home",
      tags: ["core", "morning"],
    });

    const updated = await habitSvc.updateHabit(userId, habit.id, {
      energyNeed: "high",
    });
    expect(updated.energyNeed).toBe("high");
    expect(updated.place).toBe("home");
    expect(updated.tagsJson).toBe('["core","morning"]');
  });

  it("clears a micro-note even when an existing log supplies the miss reason", async () => {
    const habit = await habitSvc.createHabit(userId, "UTC", {
      title: "Note clearing",
      startDate: "2026-11-01",
    });
    const dateKey = "2026-11-17";

    await habitSvc.logHabitDay(userId, "UTC", {
      habitId: habit.id,
      dateKey,
      status: "missed",
      note: "keep this note",
      missReason: "tired",
    });
    const cleared = await habitSvc.logHabitDay(userId, "UTC", {
      habitId: habit.id,
      dateKey,
      status: "missed",
      note: null,
    });

    expect(cleared.log?.note).toBeNull();
    expect(cleared.log?.missReason).toBe("tired");
    const [row] = await conn.db
      .select()
      .from(habitLogs)
      .where(eq(habitLogs.id, cleared.log!.id));
    expect(row!.note).toBeNull();
  });

  it("maps duplicate names to ConflictError and ignores soft-deleted views on update", async () => {
    const first = await habitSvc.createHabitSavedView(userId, {
      name: "Deep work",
    });
    await expect(
      habitSvc.createHabitSavedView(userId, { name: "Deep work" })
    ).rejects.toBeInstanceOf(ConflictError);

    const second = await habitSvc.createHabitSavedView(userId, {
      name: "Shallow work",
    });
    await expect(
      habitSvc.updateHabitSavedView(userId, second.id, { name: "Deep work" })
    ).rejects.toBeInstanceOf(ConflictError);

    await habitSvc.deleteHabitSavedView(userId, second.id);
    await expect(
      habitSvc.updateHabitSavedView(userId, second.id, { hidden: true })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      habitSvc.listHabitSavedViews(userId)
    ).resolves.not.toContainEqual(expect.objectContaining({ id: second.id }));
    expect(first.name).toBe("Deep work");
  });
});
