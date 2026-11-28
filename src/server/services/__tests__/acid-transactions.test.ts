import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleNoteRepository } from "@/server/dal/note-repository";
import {
  DrizzleReminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { notes, reminders, tasks, users } from "@/server/db/schema";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import { NoteService } from "@/server/services/note-service";
import { ReminderService } from "@/server/services/reminder-service";
import { TaskService } from "@/server/services/task-service";

function makeFailingReminderRepo(
  realReminders: DrizzleReminderRepository,
  errorMessage: string
): ReminderRepository {
  return {
    create: async () => {
      throw new Error(errorMessage);
    },
    getByIdForUser: realReminders.getByIdForUser.bind(realReminders),
    listActiveForTarget: realReminders.listActiveForTarget.bind(realReminders),
    listActiveForUserWithEntities:
      realReminders.listActiveForUserWithEntities.bind(realReminders),
    updateWithVersion: realReminders.updateWithVersion.bind(realReminders),
    markDispatched: realReminders.markDispatched.bind(realReminders),
    markDispatchedBatch: realReminders.markDispatchedBatch.bind(realReminders),
    claimForDelivery: realReminders.claimForDelivery.bind(realReminders),
    cancelIfRevoked: realReminders.cancelIfRevoked.bind(realReminders),
    cancelActiveForTarget:
      realReminders.cancelActiveForTarget.bind(realReminders),
    findActiveScheduledForTask:
      realReminders.findActiveScheduledForTask.bind(realReminders),
    findActiveScheduledForNote:
      realReminders.findActiveScheduledForNote.bind(realReminders),
    findActiveScheduledForProject:
      realReminders.findActiveScheduledForProject.bind(realReminders),
    findActiveScheduledForUserAccountDeletion:
      realReminders.findActiveScheduledForUserAccountDeletion.bind(
        realReminders
      ),
    findPendingFarWithinHorizon:
      realReminders.findPendingFarWithinHorizon.bind(realReminders),
    promotePendingFarToScheduled:
      realReminders.promotePendingFarToScheduled.bind(realReminders),
    findUndispatchedScheduled:
      realReminders.findUndispatchedScheduled.bind(realReminders),
    getEntitySummary: realReminders.getEntitySummary.bind(realReminders),
  };
}

describe("ACID transactions across TaskService & NoteService", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userId: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-acid-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [createdUser] = await conn.db
      .insert(users)
      .values({
        name: "ACID Tester",
        email: "acid@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();
    userId = createdUser!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rolls back Task insert atomically if linked Reminder insert fails mid-transaction", async () => {
    const bus = new InMemoryEventBus();
    const realReminders = new DrizzleReminderRepository(conn.db);
    const failingReminders = makeFailingReminderRepo(
      realReminders,
      "Simulated reminder constraint failure"
    );

    const taskRepo = new DrizzleTaskRepository(conn.db);
    const taskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      reminders: failingReminders,
      eventBus: bus,
    });

    await expect(
      taskSvc.createTask(userId, {
        title: "Must roll back completely",
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toThrow("Simulated reminder constraint failure");

    const remainingTasks = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.title, "Must roll back completely"));
    expect(remainingTasks).toHaveLength(0);
    expect(bus.events).toHaveLength(0);
  });

  it("rolls back Note insert atomically if linked Reminder insert fails mid-transaction", async () => {
    const bus = new InMemoryEventBus();
    const realReminders = new DrizzleReminderRepository(conn.db);
    const failingReminders = makeFailingReminderRepo(
      realReminders,
      "Simulated note reminder failure"
    );

    const noteRepo = new DrizzleNoteRepository(conn.db);
    const noteSvc = new NoteService({
      database: conn.db,
      notes: noteRepo,
      reminders: failingReminders,
      eventBus: bus,
    });

    await expect(
      noteSvc.createNote(userId, {
        title: "Orphan note forbidden",
        content: "Body text",
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toThrow("Simulated note reminder failure");

    const remainingNotes = await conn.db
      .select()
      .from(notes)
      .where(eq(notes.title, "Orphan note forbidden"));
    expect(remainingNotes).toHaveLength(0);
    expect(bus.events).toHaveLength(0);
  });

  it("completing a task sets completedAt and cancels active reminders in the same ACID transaction", async () => {
    const bus = new InMemoryEventBus();
    const taskRepo = new DrizzleTaskRepository(conn.db);
    const remRepo = new DrizzleReminderRepository(conn.db);
    const remSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      eventBus: bus,
    });
    const taskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      reminders: remRepo,
      reminderService: remSvc,
      eventBus: bus,
    });

    const { task, reminder } = await taskSvc.createTask(userId, {
      title: "Submit quarterly filing",
      remindAt: Date.now() + 2 * 3_600_000,
      timezone: "UTC",
    });

    expect(reminder).not.toBeNull();
    expect(reminder!.taskId).toBe(task.id);
    expect(reminder!.noteId).toBeNull();
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]?.name).toBe("app/reminder.scheduled");

    bus.clear();
    const toggled = await taskSvc.toggleTaskStatus(userId, task.id, "done");
    expect(toggled.task.status).toBe("done");
    expect(toggled.task.completedAt).not.toBeNull();
    expect(toggled.cancelledReminderCount).toBe(1);

    const [updatedRem] = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminder!.id));
    expect(updatedRem!.status).toBe("cancelled");
    expect(updatedRem!.version).toBe(2);

    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]).toEqual({
      id: `reminder-cancel-${reminder!.id}-v2`,
      name: "app/reminder.cancelled",
      data: {
        reminderId: reminder!.id,
        userId,
        version: 2,
      },
    });
  });
});
