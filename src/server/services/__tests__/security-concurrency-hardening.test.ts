import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_POSITION_KEY_LENGTH } from "@/lib/fractional-index";
import {
  canUserReadEntity,
  createDrizzleMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleNoteRepository } from "@/server/dal/note-repository";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { withDbRetry } from "@/server/db/retry";
import {
  projectMembers,
  pushSubscriptions,
  reminders,
  tasks,
  users,
} from "@/server/db/schema";
import { executeScheduledReminderDelivery } from "@/server/inngest/functions/schedule-reminder";
import {
  InMemoryEventBus,
  type EventBus,
} from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";
import { AccountService } from "@/server/services/account-service";
import { NoteService } from "@/server/services/note-service";
import { ProjectInviteService } from "@/server/services/project-invite-service";
import { ProjectService } from "@/server/services/project-service";
import { ReminderService } from "@/server/services/reminder-service";
import { TaskService } from "@/server/services/task-service";

function createSpyChannel(name: string): {
  channel: NotificationChannel;
  payloads: NotificationPayload[];
} {
  const payloads: NotificationPayload[] = [];
  return {
    payloads,
    channel: {
      name,
      async send(payload: NotificationPayload): Promise<NotificationDispatchResult> {
        payloads.push(payload);
        return { channel: name, delivered: true };
      },
    },
  };
}

describe("Security, Concurrency, Outbox & Scale Hardening Verification Suite", () => {
  let tempDir: string;
  let conn: DbConnection;

  let userAId: string;
  let userBId: string;
  let userCId: string;

  let projectRepo: DrizzleProjectRepository;
  let taskRepo: DrizzleTaskRepository;
  let noteRepo: DrizzleNoteRepository;
  let remRepo: DrizzleReminderRepository;
  let notifRepo: DrizzleNotificationRepository;
  let userRepo: DrizzleUserRepository;
  let bus: InMemoryEventBus;

  let projectSvc: ProjectService;
  let inviteSvc: ProjectInviteService;
  let reminderSvc: ReminderService;
  let taskSvc: TaskService;
  let noteSvc: NoteService;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-hardening-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const inserted = await conn.db
      .insert(users)
      .values([
        { name: "Alice TenantA", email: "alice@hardening.test", emailVerified: true, timezone: "UTC" },
        { name: "Bob TenantB", email: "bob@hardening.test", emailVerified: true, timezone: "UTC" },
        { name: "Carol Offboard", email: "carol@hardening.test", emailVerified: true, timezone: "UTC" },
      ])
      .returning();

    userAId = inserted[0]!.id;
    userBId = inserted[1]!.id;
    userCId = inserted[2]!.id;

    projectRepo = new DrizzleProjectRepository(conn.db);
    taskRepo = new DrizzleTaskRepository(conn.db);
    noteRepo = new DrizzleNoteRepository(conn.db);
    remRepo = new DrizzleReminderRepository(conn.db);
    notifRepo = new DrizzleNotificationRepository(conn.db);
    userRepo = new DrizzleUserRepository(conn.db);
    bus = new InMemoryEventBus();

    const lookup = createDrizzleMembershipLookup(conn.db);

    projectSvc = new ProjectService({
      database: conn.db,
      projects: projectRepo,
      reminders: remRepo,
      membershipLookup: lookup,
      eventBus: bus,
    });

    inviteSvc = new ProjectInviteService({
      database: conn.db,
      projects: projectRepo,
      users: userRepo,
      membershipLookup: lookup,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus: bus,
    });

    reminderSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      eventBus: bus,
    });

    taskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      reminders: remRepo,
      projects: projectRepo,
      membershipLookup: lookup,
      reminderService: reminderSvc,
      eventBus: bus,
    });

    noteSvc = new NoteService({
      database: conn.db,
      notes: noteRepo,
      reminders: remRepo,
      projects: projectRepo,
      membershipLookup: lookup,
      reminderService: reminderSvc,
      eventBus: bus,
    });
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("1. Cross-Tenant IDOR Suite: blocks User B across User A's private Inbox task, private Note, and private Project", async () => {
    const { task: privateTask } = await taskSvc.createTask(userAId, {
      title: "Alice secret tax filing",
    });
    const { note: privateNote } = await noteSvc.createNote(userAId, {
      title: "Alice private medical note",
      content: "Confidential details",
    });
    const privateProject = await projectSvc.createProject(userAId, {
      name: "Alice Private Strategy",
    });
    const { task: privateProjectTask } = await taskSvc.createTask(userAId, {
      projectId: privateProject.id,
      title: "Confidential launch date",
    });

    // Centralized read guard denies all 3
    expect(
      await canUserReadEntity(userBId, { taskId: privateTask.id }, conn.db)
    ).toBe(false);
    expect(
      await canUserReadEntity(userBId, { noteId: privateNote.id }, conn.db)
    ).toBe(false);
    expect(
      await canUserReadEntity(userBId, { taskId: privateProjectTask.id }, conn.db)
    ).toBe(false);

    // User B cannot read private project
    await expect(
      projectSvc.getProjectWorkspace(privateProject.id, userBId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // User B cannot update, toggle, reorder, or delete User A's private task
    await expect(
      taskSvc.updateTask(userBId, privateTask.id, { title: "IDOR tampered" })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      taskSvc.toggleTaskStatus(userBId, privateTask.id, "done")
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      taskSvc.reorderTask(userBId, privateTask.id, { prevPosition: null, nextPosition: null })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      taskSvc.deleteTask(userBId, privateTask.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // User B cannot update, pin, or delete User A's private note
    await expect(
      noteSvc.updateNote(userBId, privateNote.id, { content: "IDOR tampered" })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      noteSvc.togglePin(userBId, privateNote.id)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      noteSvc.deleteNote(userBId, privateNote.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // User B cannot attach reminders to User A's private task, note, or project task
    await expect(
      reminderSvc.attachReminder(userBId, {
        taskId: privateTask.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reminderSvc.attachReminder(userBId, {
        noteId: privateNote.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reminderSvc.attachReminder(userBId, {
        taskId: privateProjectTask.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // User B cannot reschedule or cancel User A's reminder (NotFoundError)
    const aliceRem = await reminderSvc.attachReminder(userAId, {
      taskId: privateTask.id,
      remindAt: Date.now() + 3_600_000,
      timezone: "UTC",
    });
    await expect(
      reminderSvc.rescheduleReminder(userBId, aliceRem.id, {
        remindAt: Date.now() + 7_200_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      reminderSvc.cancelReminder(userBId, aliceRem.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("2. Revoked-Access Delivery Test: cancels sleeping reminder and sends ZERO Push/Email/In-App notifications after project removal", async () => {
    const project = await projectSvc.createProject(userAId, {
      name: "Revoked Access Project",
    });
    await projectRepo.addMember({
      projectId: project.id,
      userId: userBId,
      role: "viewer",
    });

    const { task: sharedTask } = await taskSvc.createTask(userAId, {
      projectId: project.id,
      title: "Secret M&A Memo",
      description: "Must never leak to removed viewer",
    });

    // User B (viewer) legitimately attaches a personal reminder
    const viewerReminder = await reminderSvc.attachReminder(userBId, {
      taskId: sharedTask.id,
      remindAt: Date.now() + 3_600_000,
      timezone: "UTC",
    });
    expect(viewerReminder.status).toBe("scheduled");

    // Owner removes User B while the reminder is sleeping in Inngest
    await projectSvc.removeMember(project.id, userAId, userBId);

    // Simulated Inngest wakeup runs
    const inApp = createSpyChannel("in-app");
    const webPush = createSpyChannel("web-push");
    const email = createSpyChannel("email");

    const outcome = await executeScheduledReminderDelivery(
      {
        reminderId: viewerReminder.id,
        userId: userBId,
        taskId: sharedTask.id,
        noteId: null,
        remindAt: viewerReminder.remindAt,
        version: viewerReminder.version,
      },
      {
        database: conn.db,
        reminders: remRepo,
        reminderService: reminderSvc,
        inAppChannel: inApp.channel,
        webPushChannel: webPush.channel,
        emailChannel: email.channel,
      }
    );

    expect(outcome.status).toBe("cancelled_access_revoked");
    expect(inApp.payloads).toHaveLength(0);
    expect(webPush.payloads).toHaveLength(0);
    expect(email.payloads).toHaveLength(0);

    // DB row transitioned to 'cancelled'
    const [dbRem] = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, viewerReminder.id));
    expect(dbRem!.status).toBe("cancelled");
  });

  it("3. Concurrent Double-Accept & Double-Delivery Tests: strictly ONE succeeds with zero duplicates", async () => {
    const project = await projectSvc.createProject(userAId, {
      name: "Concurrency Arena",
    });
    const { invitePath } = await inviteSvc.createInvitation(
      project.id,
      userAId,
      { email: "bob@hardening.test", role: "editor" }
    );
    const rawToken = invitePath.replace("/invite/", "");

    // Fire two concurrent invite acceptances
    const acceptResults = await Promise.allSettled([
      inviteSvc.acceptInvitation(rawToken, {
        id: userBId,
        email: "bob@hardening.test",
        emailVerified: true,
      }),
      inviteSvc.acceptInvitation(rawToken, {
        id: userBId,
        email: "bob@hardening.test",
        emailVerified: true,
      }),
    ]);

    const fulfilledAccepts = acceptResults.filter(
      (r) => r.status === "fulfilled"
    );
    const rejectedAccepts = acceptResults.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    expect(fulfilledAccepts).toHaveLength(1);
    expect(rejectedAccepts).toHaveLength(1);
    expect(rejectedAccepts[0]!.reason).toBeInstanceOf(ConflictError);

    // Strictly one membership row for Bob in this project
    const bobMemberships = await conn.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, userBId)
        )
      );
    expect(bobMemberships).toHaveLength(1);

    // Concurrent Double-Delivery on a single scheduled reminder
    const { task: deliveryTask } = await taskSvc.createTask(userAId, {
      projectId: project.id,
      title: "Concurrent delivery check",
    });
    const dueReminder = await reminderSvc.attachReminder(userAId, {
      taskId: deliveryTask.id,
      remindAt: Date.now() + 60_000,
      timezone: "UTC",
    });

    const inApp = createSpyChannel("in-app");
    const webPush = createSpyChannel("web-push");
    const email = createSpyChannel("email");

    const deliveryPayload = {
      reminderId: dueReminder.id,
      userId: userAId,
      taskId: deliveryTask.id,
      noteId: null,
      remindAt: dueReminder.remindAt,
      version: dueReminder.version,
    };

    const deliveryDeps = {
      database: conn.db,
      reminders: remRepo,
      reminderService: reminderSvc,
      inAppChannel: inApp.channel,
      webPushChannel: webPush.channel,
      emailChannel: email.channel,
    };

    const [d1, d2] = await Promise.all([
      executeScheduledReminderDelivery(deliveryPayload, deliveryDeps),
      executeScheduledReminderDelivery(deliveryPayload, deliveryDeps),
    ]);

    const outcomes = [d1.status, d2.status].sort();
    expect(outcomes).toEqual(["delivered", "skipped_stale_or_cancelled"]);
    expect(inApp.payloads).toHaveLength(1);
    expect(webPush.payloads).toHaveLength(1);
    expect(email.payloads).toHaveLength(1);
  });

  it("4. Outbox Recovery Test: failed EventBus emit leaves dispatchedAt = null and reconciliation recovers cleanly", async () => {
    let clock = Date.UTC(2026, 10, 22, 9, 0, 0);
    const { task } = await taskSvc.createTask(userAId, {
      title: "Outbox recovery target",
    });

    const failingBus: EventBus = {
      async emit() {
        throw new Error("Simulated Inngest HTTP 503 outage");
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outageRemSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      eventBus: failingBus,
      now: () => clock,
    });

    // Reminder commits cleanly in Turso even though Inngest threw
    const created = await outageRemSvc.attachReminder(userAId, {
      taskId: task.id,
      remindAt: clock + 2 * 3_600_000,
      timezone: "UTC",
    });
    warnSpy.mockRestore();

    const [beforeReconcile] = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, created.id));
    expect(beforeReconcile!.status).toBe("scheduled");
    expect(beforeReconcile!.dispatchedAt).toBeNull();

    // Advance past the 60s minimum outbox age and run reconciliation with healthy bus
    const healthyBus = new InMemoryEventBus();
    const reconcileNow = beforeReconcile!.updatedAt + 65_000;
    clock = reconcileNow;

    const reconcilerSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      eventBus: healthyBus,
      now: () => clock,
    });

    const reconciledCount = await reconcilerSvc.reconcileUndispatchedBatch(
      200,
      60_000
    );
    expect(reconciledCount).toBeGreaterThanOrEqual(1);

    const matchedEvent = healthyBus.events.find(
      (e) =>
        e.name === "app/reminder.scheduled" &&
        e.data.reminderId === created.id
    );
    expect(matchedEvent).toEqual({
      id: `reminder-sched-${created.id}-v1`,
      name: "app/reminder.scheduled",
      data: {
        reminderId: created.id,
        userId: userAId,
        taskId: task.id,
        noteId: null,
        remindAt: created.remindAt,
        version: 1,
      },
    });

    const [afterReconcile] = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, created.id));
    expect(afterReconcile!.dispatchedAt).toBe(reconcileNow);

    // Second run is a no-op (already stamped)
    healthyBus.clear();
    const secondRun = await reconcilerSvc.reconcileUndispatchedBatch(200, 60_000);
    expect(secondRun).toBe(0);
    expect(healthyBus.events).toHaveLength(0);
  });

  it("5. Cascading Integrity Test: enforces XOR CHECK, cascades SQLite deletes, and emits batched app/reminder.cancelled across task/note/project deletes", async () => {
    const project = await projectSvc.createProject(userAId, {
      name: "Cascade Verification Project",
    });
    await projectRepo.addMember({
      projectId: project.id,
      userId: userBId,
      role: "viewer",
    });

    const { task: taskToDelete } = await taskSvc.createTask(userAId, {
      projectId: project.id,
      title: "Delete me with reminders",
    });
    const { note: noteToDelete } = await noteSvc.createNote(userAId, {
      projectId: project.id,
      title: "Delete note with reminders",
    });

    // XOR CHECK rejects (null, null) and (taskId, noteId)
    await expect(
      conn.db.insert(reminders).values({
        userId: userAId,
        taskId: null,
        noteId: null,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toThrow();

    await expect(
      conn.db.insert(reminders).values({
        userId: userAId,
        taskId: taskToDelete.id,
        noteId: noteToDelete.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toThrow();

    // Attach reminders from BOTH owner (A) and viewer (B) on the task & note
    const taskRemA = await reminderSvc.attachReminder(userAId, {
      taskId: taskToDelete.id,
      remindAt: Date.now() + 3_600_000,
      timezone: "UTC",
    });
    const taskRemB = await reminderSvc.attachReminder(userBId, {
      taskId: taskToDelete.id,
      remindAt: Date.now() + 4 * 3_600_000,
      timezone: "UTC",
    });

    bus.clear();
    await taskSvc.deleteTask(userAId, taskToDelete.id);

    // SQLite ON DELETE CASCADE removed both reminders
    const remainingTaskRems = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.taskId, taskToDelete.id));
    expect(remainingTaskRems).toHaveLength(0);

    // Batched app/reminder.cancelled emitted for BOTH owner & viewer reminders
    const cancelledTaskRemIds = bus.events
      .filter((e) => e.name === "app/reminder.cancelled")
      .map((e) => e.data.reminderId)
      .sort();
    expect(cancelledTaskRemIds).toEqual([taskRemA.id, taskRemB.id].sort());

    // Delete note with active reminder
    const noteRem = await reminderSvc.attachReminder(userAId, {
      noteId: noteToDelete.id,
      remindAt: Date.now() + 3_600_000,
      timezone: "UTC",
    });
    bus.clear();
    await noteSvc.deleteNote(userAId, noteToDelete.id);

    const remainingNoteRems = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, noteRem.id));
    expect(remainingNoteRems).toHaveLength(0);
    expect(bus.events.map((e) => e.name)).toContain("app/reminder.cancelled");

    // Delete entire project -> cascades child tasks/notes/reminders & emits batched cancellations
    const { task: projTask } = await taskSvc.createTask(userAId, {
      projectId: project.id,
      title: "Project task before project delete",
    });
    const projTaskRem = await reminderSvc.attachReminder(userBId, {
      taskId: projTask.id,
      remindAt: Date.now() + 3_600_000,
      timezone: "UTC",
    });

    bus.clear();
    await projectSvc.deleteProject(project.id, userAId);

    const remainingProjRem = await conn.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, projTaskRem.id));
    expect(remainingProjRem).toHaveLength(0);
    expect(
      bus.events.some(
        (e) =>
          e.name === "app/reminder.cancelled" &&
          e.data.reminderId === projTaskRem.id
      )
    ).toBe(true);
  });

  it("6. Push Endpoint Reassignment, Safe Account Offboarding, Fractional Rebalancing & SQLite Busy Retry", async () => {
    // 6a. Shared-device Push Endpoint atomic reassignment
    const sharedEndpoint = "https://fcm.googleapis.com/fcm/send/shared-device-E";
    await notifRepo.upsertPushSubscription({
      userId: userAId,
      endpoint: sharedEndpoint,
      p256dh: "key-A",
      auth: "auth-A",
      userAgent: "Chrome-Shared",
    });
    await notifRepo.upsertPushSubscription({
      userId: userBId,
      endpoint: sharedEndpoint,
      p256dh: "key-B",
      auth: "auth-B",
      userAgent: "Chrome-Shared",
    });

    const subRows = await conn.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sharedEndpoint));
    expect(subRows).toHaveLength(1);
    expect(subRows[0]!.userId).toBe(userBId);
    expect(subRows[0]!.p256dh).toBe("key-B");

    // 6b. Fractional rebalancing when position exceeds 32 chars
    const rebalanceProject = await projectSvc.createProject(userAId, {
      name: "Rebalance Test Project",
    });
    const { task: t1 } = await taskSvc.createTask(userAId, {
      projectId: rebalanceProject.id,
      title: "First",
    });
    const { task: t2 } = await taskSvc.createTask(userAId, {
      projectId: rebalanceProject.id,
      title: "Second",
    });
    // Force an overly long boundary key (>32 chars) placed before t1 ("n")
    const longPrev = "a".repeat(33);
    const longNext = `${"a".repeat(33)}z`;
    const reordered = await taskSvc.reorderTask(userAId, t2.id, {
      prevPosition: longPrev,
      nextPosition: longNext,
    });
    expect(reordered.position.length).toBeLessThanOrEqual(
      MAX_POSITION_KEY_LENGTH
    );

    const projectTasksOrdered = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, rebalanceProject.id))
      .orderBy(asc(tasks.position), asc(tasks.id));
    // Rebalancing preserves the exact reordered rank: t2 ("aaa...") before t1 ("n")
    expect(projectTasksOrdered.map((t) => t.id)).toEqual([t2.id, t1.id]);
    for (const row of projectTasksOrdered) {
      expect(row.position.length).toBeLessThanOrEqual(MAX_POSITION_KEY_LENGTH);
    }

    // 6c. Safe Account Offboarding (AccountService.deleteAccount)
    const unreadCache = new InMemoryUnreadCounterCache();
    await unreadCache.set(userCId, 4);

    const accountSvc = new AccountService({
      database: conn.db,
      users: userRepo,
      projects: projectRepo,
      reminders: remRepo,
      unreadCache,
      eventBus: bus,
    });

    const carolSharedProject = await projectSvc.createProject(userCId, {
      name: "Carol Shared Venture",
    });
    await projectRepo.addMember({
      projectId: carolSharedProject.id,
      userId: userAId,
      role: "editor",
    });

    const { task: carolPersonalTask, reminder: carolReminder } =
      await taskSvc.createTask(userCId, {
        title: "Carol personal task",
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      });

    // Blocked while sole owner of shared project with active members
    await expect(accountSvc.deleteAccount(userCId)).rejects.toBeInstanceOf(
      ValidationError
    );

    // After removing the other member, Carol can cleanly delete her account
    await projectSvc.removeMember(carolSharedProject.id, userCId, userAId);
    bus.clear();

    const deleted = await accountSvc.deleteAccount(userCId);
    expect(deleted.deleted).toBe(true);
    expect(deleted.cancelledReminderCount).toBeGreaterThanOrEqual(1);
    expect(await unreadCache.get(userCId)).toBe(0);

    // Verify cascade removed Carol's task & reminder, and emitted cancellation
    expect(
      await conn.db.select().from(tasks).where(eq(tasks.id, carolPersonalTask.id))
    ).toHaveLength(0);
    expect(
      bus.events.some(
        (e) =>
          e.name === "app/reminder.cancelled" &&
          e.data.reminderId === carolReminder!.id
      )
    ).toBe(true);

    // 6d. withDbRetry retries transient SQLITE_BUSY and succeeds
    let attempts = 0;
    const retryResult = await withDbRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return "recovered";
      },
      { maxAttempts: 3, baseDelayMs: 5, maxJitterMs: 5 }
    );
    expect(retryResult).toBe("recovered");
    expect(attempts).toBe(3);
  });
});
