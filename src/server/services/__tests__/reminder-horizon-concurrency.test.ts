import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError } from "@/server/dal/errors";
import { DrizzleNoteRepository } from "@/server/dal/note-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import {
  REMINDER_HORIZON_MS,
  ReminderService,
} from "@/server/services/reminder-service";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("ReminderService — 14-day hybrid horizon & optimistic version locking", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userId: string;
  let taskId: string;
  let noteId: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-reminder-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [createdUser] = await conn.db
      .insert(users)
      .values({
        name: "Horizon Tester",
        email: "horizon@folio.test",
        emailVerified: true,
        timezone: "Africa/Kampala",
      })
      .returning();
    userId = createdUser!.id;

    const taskRepo = new DrizzleTaskRepository(conn.db);
    const noteRepo = new DrizzleNoteRepository(conn.db);
    const task = await taskRepo.create({
      userId,
      title: "Renew passport",
      position: "a0",
    });
    const note = await noteRepo.create({
      userId,
      title: "Lease agreement terms",
      content: "30 day notice required",
    });
    taskId = task.id;
    noteId = note.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists <=14d reminders as 'scheduled' and emits app/reminder.scheduled, while >14d persists as 'pending_far' with no event", async () => {
    const fixedNow = Date.UTC(2026, 10, 21, 10, 0, 0);
    const bus = new InMemoryEventBus();
    const remSvc = new ReminderService({
      database: conn.db,
      reminders: new DrizzleReminderRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      notes: new DrizzleNoteRepository(conn.db),
      eventBus: bus,
      now: () => fixedNow,
    });

    // Near-horizon (3 days out) -> scheduled + event emitted
    const near = await remSvc.attachReminder(userId, {
      entityType: "task",
      entityId: taskId,
      remindAt: fixedNow + 3 * DAY_MS,
      timezone: "Africa/Kampala",
    });
    expect(near.status).toBe("scheduled");
    expect(near.version).toBe(1);
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]?.name).toBe("app/reminder.scheduled");

    bus.clear();

    // Far-horizon (20 days out) -> pending_far + ZERO Inngest event emitted
    const far = await remSvc.attachReminder(userId, {
      entityType: "note",
      entityId: noteId,
      remindAt: fixedNow + 20 * DAY_MS,
      timezone: "Africa/Kampala",
    });
    expect(far.status).toBe("pending_far");
    expect(far.version).toBe(1);
    expect(bus.events).toHaveLength(0);

    // Advance clock by 8 days so the 20-day reminder is now 12 days away (inside 14d horizon)
    const sweeperSvc = new ReminderService({
      database: conn.db,
      reminders: new DrizzleReminderRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      notes: new DrizzleNoteRepository(conn.db),
      eventBus: bus,
      now: () => fixedNow + 8 * DAY_MS,
    });

    const promotedCount = await sweeperSvc.sweepFarFutureReminders(50);
    expect(promotedCount).toBe(1);
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]).toEqual({
      name: "app/reminder.scheduled",
      data: {
        reminderId: far.id,
        userId,
        entityType: "note",
        entityId: noteId,
        remindAt: far.remindAt,
        version: 1,
      },
    });
  });

  it("increments version on reschedule/snooze and blocks stale delivery + duplicate claims", async () => {
    const fixedNow = Date.UTC(2026, 10, 21, 12, 0, 0);
    const bus = new InMemoryEventBus();
    const remSvc = new ReminderService({
      database: conn.db,
      reminders: new DrizzleReminderRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      notes: new DrizzleNoteRepository(conn.db),
      eventBus: bus,
      now: () => fixedNow,
    });

    const created = await remSvc.attachReminder(userId, {
      entityType: "task",
      entityId: taskId,
      remindAt: fixedNow + 60 * 60 * 1000,
      timezone: "Africa/Kampala",
    });
    expect(created.version).toBe(1);
    bus.clear();

    // Snooze +15m -> version increments to 2 and emits rescheduled + scheduled
    const snoozed = await remSvc.snoozeReminder(
      userId,
      created.id,
      "15m",
      "Africa/Kampala",
      1
    );
    expect(snoozed.version).toBe(2);
    expect(snoozed.status).toBe("scheduled");
    expect(snoozed.remindAt).toBe(fixedNow + 15 * 60 * 1000);
    expect(bus.events.map((e) => e.name)).toEqual([
      "app/reminder.rescheduled",
      "app/reminder.scheduled",
    ]);

    // Concurrent edit supplying stale version 1 fails with ConflictError
    await expect(
      remSvc.rescheduleReminder(userId, created.id, {
        remindAt: fixedNow + REMINDER_HORIZON_MS + DAY_MS,
        timezone: "UTC",
        expectedVersion: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Stale Inngest worker attempting to claim version 1 MUST be rejected
    const staleClaim = await remSvc.verifyAndClaimForDelivery(created.id, 1);
    expect(staleClaim).toBeNull();

    // Current Inngest worker claiming version 2 succeeds atomically
    const validClaim = await remSvc.verifyAndClaimForDelivery(created.id, 2);
    expect(validClaim).not.toBeNull();
    expect(validClaim!.status).toBe("sent");
    expect(validClaim!.sentAt).toBe(fixedNow);

    // Duplicate retry of version 2 MUST be rejected (idempotent — zero double-send)
    const duplicateClaim = await remSvc.verifyAndClaimForDelivery(created.id, 2);
    expect(duplicateClaim).toBeNull();
  });
});
