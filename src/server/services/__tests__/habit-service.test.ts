import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  DrizzleHabitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import {
  DrizzleTaskRepository,
  type TaskRepository,
} from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitLogs,
  habits,
  notifications,
  tasks,
  users,
} from "@/server/db/schema";
import {
  dispatchHabitNudgeBatch,
  executeHabitNudgeDelivery,
  isTimeInCurrent15MinWindow,
} from "@/server/inngest/habit-reminders";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";
import { HabitService } from "@/server/services/habit-service";
import { ReminderService } from "@/server/services/reminder-service";
import { TaskService } from "@/server/services/task-service";

class SpyChannel implements NotificationChannel {
  readonly sent: NotificationPayload[] = [];
  constructor(readonly name: string) {}
  async send(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult> {
    this.sent.push(payload);
    return { channel: this.name, delivered: true };
  }
}

describe("HabitService ACID sync, tenant isolation, bulk import, and habit nudges", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userAId: string;
  let userBId: string;

  let habitRepo: DrizzleHabitRepository;
  let taskRepo: DrizzleTaskRepository;
  let projectRepo: DrizzleProjectRepository;
  let userRepo: DrizzleUserRepository;
  let notifRepo: DrizzleNotificationRepository;
  let habitSvc: HabitService;
  let taskSvc: TaskService;

  // Fixed clock: 2026-11-18T12:00:00Z (15:00 in Africa/Kampala)
  const FIXED_NOW = Date.parse("2026-11-18T12:00:00.000Z");

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-habits-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [userA] = await conn.db
      .insert(users)
      .values({
        name: "Alice Habit",
        email: "alice-habits@folio.test",
        emailVerified: true,
        timezone: "Africa/Kampala",
      })
      .returning();
    const [userB] = await conn.db
      .insert(users)
      .values({
        name: "Bob Intruder",
        email: "bob-habits@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();

    userAId = userA!.id;
    userBId = userB!.id;

    habitRepo = new DrizzleHabitRepository(conn.db);
    taskRepo = new DrizzleTaskRepository(conn.db);
    projectRepo = new DrizzleProjectRepository(conn.db);
    userRepo = new DrizzleUserRepository(conn.db);
    notifRepo = new DrizzleNotificationRepository(conn.db);

    const bus = new InMemoryEventBus();
    const remRepo = new DrizzleReminderRepository(conn.db);
    const remSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      eventBus: bus,
    });

    habitSvc = new HabitService({
      database: conn.db,
      habits: habitRepo,
      tasks: taskRepo,
      projects: projectRepo,
      now: () => FIXED_NOW,
    });

    taskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      reminders: remRepo,
      projects: projectRepo,
      habits: habitRepo,
      users: userRepo,
      reminderService: remSvc,
      eventBus: bus,
    });
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("synchronizes Task <-> Habit bidirectionally in ACID transactions and handles promoteTaskToHabit", async () => {
    const { task } = await taskSvc.createTask(userAId, {
      title: "Ship daily PR",
      dueAt: FIXED_NOW,
      timezone: "Africa/Kampala",
    });

    // Promote task to habit
    const promoted = await habitSvc.promoteTaskToHabit(
      userAId,
      "Africa/Kampala",
      task.id,
      { cadenceType: "daily", preferredTime: "15:00" }
    );

    expect(promoted.habit.title).toBe("Ship daily PR");
    expect(promoted.task.habitId).toBe(promoted.habit.id);
    expect(promoted.task.habitDateKey).toBe("2026-11-18");
    expect(promoted.initialLog).toBeNull();

    // Promoting an already linked task must fail with ConflictError
    await expect(
      habitSvc.promoteTaskToHabit(userAId, "Africa/Kampala", task.id)
    ).rejects.toBeInstanceOf(ConflictError);

    // Direction 1: Completing task via TaskService -> creates 'done' habit log in same transaction
    await taskSvc.toggleTaskStatus(userAId, task.id, "done", {
      timezone: "Africa/Kampala",
    });

    const logAfterTaskDone = await habitRepo.getLogForHabitDay(
      userAId,
      promoted.habit.id,
      "2026-11-18"
    );
    expect(logAfterTaskDone?.status).toBe("done");

    // Direction 1b: Reopening task -> deletes habit log
    await taskSvc.toggleTaskStatus(userAId, task.id, "todo", {
      timezone: "Africa/Kampala",
    });
    const logAfterReopen = await habitRepo.getLogForHabitDay(
      userAId,
      promoted.habit.id,
      "2026-11-18"
    );
    expect(logAfterReopen).toBeNull();

    // Direction 2: Logging habit 'done' -> marks linked task 'done' with completedAt
    const logged = await habitSvc.logHabitDay(userAId, "Africa/Kampala", {
      habitId: promoted.habit.id,
      dateKey: "2026-11-18",
      status: "done",
      note: "Merged cleanly",
    });
    expect(logged.log?.status).toBe("done");
    expect(logged.log?.note).toBe("Merged cleanly");
    expect(logged.syncedTaskCount).toBe(1);

    const [taskAfterHabitDone] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(taskAfterHabitDone?.status).toBe("done");
    expect(taskAfterHabitDone?.completedAt).not.toBeNull();

    // Direction 2b: Cycling habit to 'missed' without passing note preserves micro-note AND reopens task
    const cycled = await habitSvc.logHabitDay(userAId, "Africa/Kampala", {
      habitId: promoted.habit.id,
      dateKey: "2026-11-18",
      status: "missed",
    });
    expect(cycled.log?.status).toBe("missed");
    expect(cycled.log?.note).toBe("Merged cleanly");

    const [taskAfterMissed] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(taskAfterMissed?.status).toBe("todo");
    expect(taskAfterMissed?.completedAt).toBeNull();

    // Foreign key ON DELETE SET NULL: deleting habit keeps the task intact with habitId = null
    await habitSvc.deleteHabit(userAId, promoted.habit.id);
    const [survivingTask] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(survivingTask).toBeDefined();
    expect(survivingTask?.habitId).toBeNull();

    const orphanedLogs = await conn.db
      .select()
      .from(habitLogs)
      .where(eq(habitLogs.habitId, promoted.habit.id));
    expect(orphanedLogs).toHaveLength(0);
  });

  it("rolls back habitLog atomically if linked task synchronization fails mid-transaction", async () => {
    const habit = await habitSvc.createHabit(userAId, "UTC", {
      title: "Rollback Guard Habit",
      startDate: "2026-11-10",
    });

    const failingTasks: TaskRepository = {
      ...taskRepo,
      create: taskRepo.create.bind(taskRepo),
      getAuthMetadata: taskRepo.getAuthMetadata.bind(taskRepo),
      getByIdForUser: taskRepo.getByIdForUser.bind(taskRepo),
      getLastPositionForScope: taskRepo.getLastPositionForScope.bind(taskRepo),
      updatePersonalTask: taskRepo.updatePersonalTask.bind(taskRepo),
      updateProjectTask: taskRepo.updateProjectTask.bind(taskRepo),
      deletePersonalTask: taskRepo.deletePersonalTask.bind(taskRepo),
      deleteProjectTask: taskRepo.deleteProjectTask.bind(taskRepo),
      rebalancePositions: taskRepo.rebalancePositions.bind(taskRepo),
      listInboxWithReminders: taskRepo.listInboxWithReminders.bind(taskRepo),
      listTodayWithReminders: taskRepo.listTodayWithReminders.bind(taskRepo),
      listUpcomingWithReminders:
        taskRepo.listUpcomingWithReminders.bind(taskRepo),
      syncLinkedTasksForHabitDay: async () => {
        throw new Error("Simulated linked-task sync crash");
      },
      syncLinkedTasksForHabitLogs:
        taskRepo.syncLinkedTasksForHabitLogs.bind(taskRepo),
    };

    const brokenHabitSvc = new HabitService({
      database: conn.db,
      habits: habitRepo,
      tasks: failingTasks,
      projects: projectRepo,
      now: () => FIXED_NOW,
    });

    await expect(
      brokenHabitSvc.logHabitDay(userAId, "UTC", {
        habitId: habit.id,
        dateKey: "2026-11-17",
        status: "done",
      })
    ).rejects.toThrow("Simulated linked-task sync crash");

    // Verify habit_logs write rolled back completely
    const leaked = await habitRepo.getLogForHabitDay(
      userAId,
      habit.id,
      "2026-11-17"
    );
    expect(leaked).toBeNull();
  });

  it("rolls back task completion atomically if linked habitLog upsert fails mid-transaction", async () => {
    const { task } = await taskSvc.createTask(userAId, {
      title: "Task Rollback Sync Check",
      dueAt: FIXED_NOW,
      timezone: "UTC",
    });
    await habitSvc.promoteTaskToHabit(userAId, "UTC", task.id);

    const failingHabitRepo: HabitRepository = {
      ...habitRepo,
      getOrCreateSettings: habitRepo.getOrCreateSettings.bind(habitRepo),
      updateSettings: habitRepo.updateSettings.bind(habitRepo),
      listHabitsForUser: habitRepo.listHabitsForUser.bind(habitRepo),
      listHabitsForUsers: habitRepo.listHabitsForUsers.bind(habitRepo),
      getHabitForUser: habitRepo.getHabitForUser.bind(habitRepo),
      getLastHabitPosition: habitRepo.getLastHabitPosition.bind(habitRepo),
      createHabit: habitRepo.createHabit.bind(habitRepo),
      createHabitsBatch: habitRepo.createHabitsBatch.bind(habitRepo),
      updateHabitForUser: habitRepo.updateHabitForUser.bind(habitRepo),
      updateHabitsMetadataBatch:
        habitRepo.updateHabitsMetadataBatch.bind(habitRepo),
      listAliasesForUser: habitRepo.listAliasesForUser.bind(habitRepo),
      upsertAliasesBatch: habitRepo.upsertAliasesBatch.bind(habitRepo),
      listMonthRosterHabitIds:
        habitRepo.listMonthRosterHabitIds.bind(habitRepo),
      hasAnyMonthRosterForUser:
        habitRepo.hasAnyMonthRosterForUser.bind(habitRepo),
      findLatestMonthRosterBefore:
        habitRepo.findLatestMonthRosterBefore.bind(habitRepo),
      upsertMonthRosterEntries:
        habitRepo.upsertMonthRosterEntries.bind(habitRepo),
      replaceMonthRoster: habitRepo.replaceMonthRoster.bind(habitRepo),
      removeHabitFromMonthRoster:
        habitRepo.removeHabitFromMonthRoster.bind(habitRepo),
      upsertLogsBatch: habitRepo.upsertLogsBatch.bind(habitRepo),
      upsertLogsAndRostersPipelined:
        habitRepo.upsertLogsAndRostersPipelined.bind(habitRepo),
      getMonthLock: habitRepo.getMonthLock.bind(habitRepo),
      listMonthLocksForMonths:
        habitRepo.listMonthLocksForMonths.bind(habitRepo),
      upsertMonthLock: habitRepo.upsertMonthLock.bind(habitRepo),
      unlockMonthAtomically: habitRepo.unlockMonthAtomically.bind(habitRepo),
      updateMonthLockPin: habitRepo.updateMonthLockPin.bind(habitRepo),
      recordPinFailureAtomically:
        habitRepo.recordPinFailureAtomically.bind(habitRepo),
      updatePinFailureState: habitRepo.updatePinFailureState.bind(habitRepo),
      deleteHabitForUser: habitRepo.deleteHabitForUser.bind(habitRepo),
      rebalanceHabitPositions:
        habitRepo.rebalanceHabitPositions.bind(habitRepo),
      listLogsForRange: habitRepo.listLogsForRange.bind(habitRepo),
      listLogsForUsersInRange: habitRepo.listLogsForUsersInRange.bind(habitRepo),
      listLogNotesForRange: habitRepo.listLogNotesForRange.bind(habitRepo),
      getLogForHabitDay: habitRepo.getLogForHabitDay.bind(habitRepo),
      updateLogMissReason: habitRepo.updateLogMissReason.bind(habitRepo),
      deleteLogForUser: habitRepo.deleteLogForUser.bind(habitRepo),
      listLinkedTasksForRange:
        habitRepo.listLinkedTasksForRange.bind(habitRepo),
      listNudgeUserCandidatesPage:
        habitRepo.listNudgeUserCandidatesPage.bind(habitRepo),
      isUserActive: habitRepo.isUserActive.bind(habitRepo),
      upsertLog: async () => {
        throw new Error("Simulated habit log upsert crash");
      },
    };

    const brokenTaskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      projects: projectRepo,
      habits: failingHabitRepo,
      users: userRepo,
      eventBus: new InMemoryEventBus(),
    });

    await expect(
      brokenTaskSvc.toggleTaskStatus(userAId, task.id, "done", {
        timezone: "UTC",
      })
    ).rejects.toThrow("Simulated habit log upsert crash");

    const [taskRow] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(taskRow?.status).toBe("todo");
    expect(taskRow?.completedAt).toBeNull();
  });

  it("enforces strict cross-tenant IDOR rejection on habits, logs, tasks promotion, and settings", async () => {
    const aliceHabit = await habitSvc.createHabit(userAId, "Africa/Kampala", {
      title: "Alice Private Routine",
      startDate: "2026-11-01",
    });
    await habitSvc.logHabitDay(userAId, "Africa/Kampala", {
      habitId: aliceHabit.id,
      dateKey: "2026-11-18",
      status: "done",
      note: "Private journal note",
    });
    await habitSvc.updateSettings(userAId, {
      weekStartsOn: 0,
      eveningCheckinTime: "21:30",
    });

    const { task: aliceTask } = await taskSvc.createTask(userAId, {
      title: "Alice Private Task",
    });

    // User B cannot update, archive, log, or delete Alice's habit
    await expect(
      habitSvc.updateHabit(userBId, aliceHabit.id, { title: "Hijacked" })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      habitSvc.archiveHabit(userBId, aliceHabit.id, true)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      habitSvc.logHabitDay(userBId, "UTC", {
        habitId: aliceHabit.id,
        dateKey: "2026-11-18",
        status: "missed",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      habitSvc.deleteHabit(userBId, aliceHabit.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    // User B cannot promote Alice's task into a habit
    await expect(
      habitSvc.promoteTaskToHabit(userBId, "UTC", aliceTask.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // User B's workspace & settings must be completely isolated from Alice
    const bobWorkspace = await habitSvc.getMonthWorkspace(userBId, "UTC", {
      yearMonth: "2026-11",
    });
    expect(
      bobWorkspace.habits.find((h) => h.id === aliceHabit.id)
    ).toBeUndefined();
    expect(
      bobWorkspace.logsByKey[`${aliceHabit.id}::2026-11-18`]
    ).toBeUndefined();
    expect(bobWorkspace.settings.userId).toBe(userBId);
    expect(bobWorkspace.settings.weekStartsOn).toBe(1); // default, not Alice's 0
    expect(bobWorkspace.settings.eveningCheckinTime).toBeNull();

    // Future-date logging is rejected even for owner
    await expect(
      habitSvc.logHabitDay(userAId, "Africa/Kampala", {
        habitId: aliceHabit.id,
        dateKey: "2026-11-19",
        status: "done",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("bulk imports habits atomically and rejects >50 rows", async () => {
    const imported = await habitSvc.bulkImportHabits(
      userBId,
      "UTC",
      `Hydrate 2L,Health,daily,08:00
Deep focus,Work,weekdays,09:30
Stretch,Health,3x,20:00`
    );
    expect(imported).toHaveLength(3);
    expect(imported[0]!.position < imported[1]!.position).toBe(true);
    expect(imported[1]!.position < imported[2]!.position).toBe(true);

    const tooMany = Array.from({ length: 51 }, (_, i) => `Item ${i + 1}`).join(
      "\n"
    );
    await expect(
      habitSvc.bulkImportHabits(userBId, "UTC", tooMany)
    ).rejects.toBeInstanceOf(ValidationError);

    const bobHabits = await conn.db
      .select()
      .from(habits)
      .where(eq(habits.userId, userBId));
    expect(bobHabits).toHaveLength(3);
  });

  it("dispatches bounded habit nudges in IANA timezones and deduplicates delivery cleanly", async () => {
    expect(isTimeInCurrent15MinWindow("15:00", "15:00")).toBe(true);
    expect(isTimeInCurrent15MinWindow("15:14", "15:00")).toBe(true);
    expect(isTimeInCurrent15MinWindow("15:15", "15:00")).toBe(false);

    // Create an unlogged habit for Alice with preferredTime = 15:05 (Africa/Kampala at FIXED_NOW is 15:00!)
    const nudgeHabit = await habitSvc.createHabit(userAId, "Africa/Kampala", {
      title: "Afternoon posture reset",
      startDate: "2026-11-01",
      preferredTime: "15:05",
    });
    await habitSvc.updateSettings(userAId, { eveningCheckinTime: "15:10" });

    const bus = new InMemoryEventBus();
    const dispatched = await dispatchHabitNudgeBatch(
      { limit: 200, offset: 0, nowMs: FIXED_NOW },
      { habits: habitRepo, eventBus: bus }
    );

    expect(dispatched.candidatesChecked).toBeGreaterThanOrEqual(1);
    const aliceEvents = bus.events.filter(
      (e) => e.name === "app/habit.nudge" && e.data.userId === userAId
    );
    expect(aliceEvents.length).toBeGreaterThanOrEqual(2); // preferred + evening check-in

    const prefEvent = aliceEvents.find(
      (e) =>
        e.name === "app/habit.nudge" &&
        e.data.kind === "habit_preferred" &&
        e.data.habitId === nudgeHabit.id
    );
    expect(prefEvent).toBeDefined();
    if (!prefEvent || prefEvent.name !== "app/habit.nudge") {
      throw new Error("Expected habit_preferred event");
    }

    const unreadCache = new InMemoryUnreadCounterCache();
    const inApp = new InAppNotificationChannel(notifRepo, unreadCache);
    const webPush = new SpyChannel("web_push");
    const email = new SpyChannel("email");

    // First delivery succeeds and records notification deep-linking to /app/habits
    const firstDelivery = await executeHabitNudgeDelivery(prefEvent.data, {
      habits: habitRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: webPush,
      emailChannel: email,
    });
    expect(firstDelivery.status).toBe("delivered");
    expect(webPush.sent).toHaveLength(1);
    expect(webPush.sent[0]?.deepLink).toBe("/app/habits");
    expect(email.sent).toHaveLength(1);

    // Second invocation with same dedupKey MUST be skipped with zero duplicate rows/emails
    const duplicateDelivery = await executeHabitNudgeDelivery(prefEvent.data, {
      habits: habitRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: webPush,
      emailChannel: email,
    });
    expect(duplicateDelivery.status).toBe("skipped_duplicate");
    expect(webPush.sent).toHaveLength(1);
    expect(email.sent).toHaveLength(1);

    const savedNotifs = await conn.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, prefEvent.data.dedupKey));
    expect(savedNotifs).toHaveLength(1);
    expect(savedNotifs[0]?.entityType).toBe("habit_nudge");

    // If the user logs the habit BEFORE an evening/new nudge fires, delivery skips cleanly
    await habitSvc.logHabitDay(userAId, "Africa/Kampala", {
      habitId: nudgeHabit.id,
      dateKey: "2026-11-18",
      status: "done",
    });
    const afterLogDelivery = await executeHabitNudgeDelivery(
      {
        ...prefEvent.data,
        dedupKey: `${prefEvent.data.dedupKey}-fresh`,
      },
      {
        habits: habitRepo,
        notifications: notifRepo,
        inAppChannel: inApp,
        webPushChannel: webPush,
        emailChannel: email,
      }
    );
    expect(afterLogDelivery.status).toBe("skipped_already_logged_or_inactive");
  });
});
