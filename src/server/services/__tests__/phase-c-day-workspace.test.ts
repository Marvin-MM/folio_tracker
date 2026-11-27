import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const featureState = vi.hoisted(() => ({
  enabled: new Set<string>(),
}));

vi.mock("@/config/features", () => ({
  isFeatureEnabled: (flag: string) => featureState.enabled.has(flag),
}));

import { ValidationError } from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitDayEntries,
  habitExcuseRanges,
  habitLogs,
  users,
} from "@/server/db/schema";
import { HabitService } from "@/server/services/habit-service";

describe("Phase C day workspace and lazy day entries", () => {
  let tempDir: string;
  let conn: DbConnection;
  let habitSvc: HabitService;
  let userCounter = 0;

  // Fixed clock: 2026-11-18T12:00:00Z.
  const FIXED_NOW = Date.parse("2026-11-18T12:00:00.000Z");

  const resetFeatures = () => {
    featureState.enabled = new Set([
      "phaseAFoundation",
      "excuseRanges",
      "effectiveStatus",
      "undoStack",
      "dayPage",
      "rollups",
      "energySleepInput",
    ]);
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-phase-c-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    habitSvc = new HabitService({
      database: conn.db,
      habits: new DrizzleHabitRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      now: () => FIXED_NOW,
    });
  });

  beforeEach(() => {
    resetFeatures();
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function createUser() {
    userCounter += 1;
    const [user] = await conn.db
      .insert(users)
      .values({
        name: `Phase C User ${userCounter}`,
        email: `phase-c-${userCounter}@folio.test`,
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();
    return user!;
  }

  async function dayEntryRows(userId: string) {
    return conn.db
      .select()
      .from(habitDayEntries)
      .where(eq(habitDayEntries.userId, userId));
  }

  it("reads a day without creating a row and keeps future days locked", async () => {
    const user = await createUser();
    const workspace = await habitSvc.getDayWorkspace(
      user.id,
      "UTC",
      "2026-11-17"
    );

    expect(workspace.dateKey).toBe("2026-11-17");
    expect(workspace.todayDateKey).toBe("2026-11-18");
    expect(workspace.dayEntry).toBeNull();
    expect(workspace.flags).toEqual({
      energySleepInput: true,
      rollups: true,
      missReasons: true,
    });
    expect(workspace.rollups).toEqual({
      habitRate: { day: null, month: null },
      runsThisWeek: null,
    });
    expect(await dayEntryRows(user.id)).toHaveLength(0);

    await expect(
      habitSvc.getDayWorkspace(user.id, "UTC", "2026-11-19")
    ).rejects.toThrow("Future days cannot be opened.");
    await expect(
      habitSvc.saveDayEntry(user.id, "UTC", {
        dateKey: "2026-11-19",
        note: "future",
      })
    ).rejects.toThrow("Cannot edit a future day.");
  });

  it("creates a day row only on first edit and updates it idempotently", async () => {
    const user = await createUser();
    const patch = { dateKey: "2026-11-17" };

    const savedNote = await habitSvc.saveDayEntry(user.id, "UTC", {
      ...patch,
      note: "  Lesson learned  ",
    });
    expect(savedNote.note).toBe("Lesson learned");
    expect(await dayEntryRows(user.id)).toHaveLength(1);

    const savedJournal = await habitSvc.saveDayEntry(user.id, "UTC", {
      ...patch,
      journalPromptId: "prompt-1",
      journalText: "  Reflected on the day.  ",
    });
    expect(savedJournal.id).toBe(savedNote.id);
    expect(savedJournal.note).toBe("Lesson learned");
    expect(savedJournal.journalText).toBe("Reflected on the day.");

    const clearedNote = await habitSvc.saveDayEntry(user.id, "UTC", {
      ...patch,
      note: null,
    });
    expect(clearedNote.note).toBeNull();
    const rows = await dayEntryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeNull();

    const reread = await habitSvc.getDayWorkspace(
      user.id,
      "UTC",
      "2026-11-17"
    );
    expect(reread.dayEntry?.journalText).toBe("Reflected on the day.");
    expect(reread.dayEntry?.note).toBeNull();
  });

  it("gates energy and sleep behind the feature flag", async () => {
    const user = await createUser();
    featureState.enabled.delete("energySleepInput");

    await expect(
      habitSvc.saveDayEntry(user.id, "UTC", {
        dateKey: "2026-11-17",
        energy: 7,
      })
    ).rejects.toThrow("Energy and sleep inputs are disabled.");
    expect(await dayEntryRows(user.id)).toHaveLength(0);

    featureState.enabled.add("energySleepInput");
    const saved = await habitSvc.saveDayEntry(user.id, "UTC", {
      dateKey: "2026-11-17",
      energy: 7,
      sleepHours: 7.5,
    });
    expect(saved.energy).toBe(7);
    expect(saved.sleepHours).toBe(7.5);

    await expect(
      habitSvc.saveDayEntry(user.id, "UTC", {
        dateKey: "2026-11-17",
        energy: 11,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses effective skipped status in the checklist and neutralizes it in rollups", async () => {
    const user = await createUser();
    const excused = await habitSvc.createHabit(user.id, "UTC", {
      title: "Excused habit",
      startDate: "2026-11-01",
    });
    const missed = await habitSvc.createHabit(user.id, "UTC", {
      title: "Missed habit",
      startDate: "2026-11-01",
    });

    await conn.db.insert(habitExcuseRanges).values({
      userId: user.id,
      startDate: "2026-11-17",
      endDate: "2026-11-17",
      reason: "travel",
      habitIdsJson: JSON.stringify([excused.id]),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await conn.db.insert(habitLogs).values({
      userId: user.id,
      habitId: missed.id,
      dateKey: "2026-11-17",
      status: "missed",
      loggedAt: FIXED_NOW,
    });
    await habitSvc.setHabitMissReason(user.id, {
      habitId: missed.id,
      dateKey: "2026-11-17",
      reason: "work",
    });

    const workspace = await habitSvc.getDayWorkspace(
      user.id,
      "UTC",
      "2026-11-17"
    );
    const excusedItem = workspace.checklist.find(
      (item) => item.habit.id === excused.id
    );
    const missedItem = workspace.checklist.find(
      (item) => item.habit.id === missed.id
    );

    expect(excusedItem?.status).toBe("skipped");
    expect(excusedItem?.log).toBeNull();
    expect(missedItem?.status).toBe("missed");
    expect(missedItem?.log?.missReason).toBe("work");
    expect(workspace.rollups.habitRate.day).toBe(0);
    expect(workspace.highlights?.score).toBe(0);
    expect(workspace.highlights?.misses).toEqual([
      { habitId: missed.id, title: "Missed habit", reason: "work" },
    ]);
  });

  it("counts runs logged across a month boundary in the same week", async () => {
    const user = await createUser();
    const run = await habitSvc.createHabit(user.id, "UTC", {
      title: "Morning Run",
      cadenceType: "weekly_target",
      weeklyTargetCount: 2,
      startDate: "2026-10-01",
    });
    await conn.db.insert(habitLogs).values([
      {
        userId: user.id,
        habitId: run.id,
        dateKey: "2026-10-31",
        status: "done",
        loggedAt: FIXED_NOW,
      },
      {
        userId: user.id,
        habitId: run.id,
        dateKey: "2026-11-01",
        status: "done",
        loggedAt: FIXED_NOW,
      },
    ]);

    const workspace = await habitSvc.getDayWorkspace(
      user.id,
      "UTC",
      "2026-11-01"
    );
    expect(workspace.rollups.runsThisWeek).toEqual({ done: 2, target: 2 });
  });

  it("tolerates malformed excuse-range habit ids JSON", async () => {
    const user = await createUser();
    const habit = await habitSvc.createHabit(user.id, "UTC", {
      title: "Corrupt excuse range",
      startDate: "2026-11-01",
    });
    await conn.db.insert(habitExcuseRanges).values({
      userId: user.id,
      startDate: "2026-11-17",
      endDate: "2026-11-17",
      reason: "travel",
      habitIdsJson: "{not-json",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });

    const workspace = await habitSvc.getDayWorkspace(
      user.id,
      "UTC",
      "2026-11-17"
    );
    expect(
      workspace.checklist.find((item) => item.habit.id === habit.id)?.status
    ).not.toBe("skipped");
  });
});
