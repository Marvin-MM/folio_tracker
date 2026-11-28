import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  canUserReadEntity,
  createDrizzleMembershipLookup,
  resolveLiveUserShellStatus,
} from "@/server/dal/auth-guard";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleHabitSocialRepository } from "@/server/dal/habits-social";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { DrizzleOperationRepository } from "@/server/dal/operations";
import { DrizzleOperationsSocialRepository } from "@/server/dal/operations-social";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import {
  normalizePublicHandle,
  publicProfileCacheTag,
} from "@/server/dal/public-operations-cache";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { DrizzleWorkspaceRepository } from "@/server/dal/workspace-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitMonthRosters,
  notes,
  operationMembers,
  operationReferenceNotes,
  projectMembers,
  projects,
  tasks,
  users,
} from "@/server/db/schema";
import {
  WebPushNotificationChannel,
  type PushTransport,
} from "@/server/providers/channels/web-push-notification-channel";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";
import { AccountService } from "@/server/services/account-service";
import { HabitMonitorService } from "@/server/services/habit-monitor-service";
import { HabitService } from "@/server/services/habit-service";
import { OperationRunService } from "@/server/services/operation-run-service";
import { OperationService } from "@/server/services/operation-service";
import { OperationShareService } from "@/server/services/operation-share-service";

describe("End-to-End Audit Fixation Regressions — Security, Concurrency, Offline LWW & EXPLAIN QUERY PLAN", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  let unverifiedId: string;
  let suspendedId: string;
  let coOwnerDeleteId: string;
  let coOwnerSurvivorId: string;

  let opRepo: DrizzleOperationRepository;
  let opSocialRepo: DrizzleOperationsSocialRepository;
  let habitRepo: DrizzleHabitRepository;
  let habitSocialRepo: DrizzleHabitSocialRepository;
  let projectRepo: DrizzleProjectRepository;
  let taskRepo: DrizzleTaskRepository;
  let reminderRepo: DrizzleReminderRepository;
  let notifRepo: DrizzleNotificationRepository;
  let userRepo: DrizzleUserRepository;
  let workspaceRepo: DrizzleWorkspaceRepository;

  let opService: OperationService;
  let runService: OperationRunService;
  let shareService: OperationShareService;
  let habitService: HabitService;
  let habitMonitorService: HabitMonitorService;
  let accountService: AccountService;

  const fixedNowMs = Date.parse("2026-11-27T14:00:00.000Z");

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-audit-regressions-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    opRepo = new DrizzleOperationRepository(conn.db);
    opSocialRepo = new DrizzleOperationsSocialRepository(conn.db);
    habitRepo = new DrizzleHabitRepository(conn.db);
    habitSocialRepo = new DrizzleHabitSocialRepository(conn.db);
    projectRepo = new DrizzleProjectRepository(conn.db);
    taskRepo = new DrizzleTaskRepository(conn.db);
    reminderRepo = new DrizzleReminderRepository(conn.db);
    notifRepo = new DrizzleNotificationRepository(conn.db);
    userRepo = new DrizzleUserRepository(conn.db);
    workspaceRepo = new DrizzleWorkspaceRepository(
      conn.db,
      new InMemoryUnreadCounterCache()
    );

    const bus = new InMemoryEventBus();
    const rateLimiter = new InMemoryRateLimiter({ now: () => fixedNowMs });
    const membershipLookup = createDrizzleMembershipLookup(conn.db);

    opService = new OperationService({
      database: conn.db,
      operations: opRepo,
      habits: habitRepo,
      membershipLookup,
      now: () => fixedNowMs,
    });
    runService = new OperationRunService({
      database: conn.db,
      operations: opRepo,
      habits: habitRepo,
      tasks: taskRepo,
      reminders: reminderRepo,
      users: userRepo,
      eventBus: bus,
      membershipLookup,
      now: () => fixedNowMs,
    });
    shareService = new OperationShareService({
      database: conn.db,
      social: opSocialRepo,
      users: userRepo,
      projects: projectRepo,
      eventBus: bus,
      rateLimiter,
      now: () => fixedNowMs,
    });
    habitService = new HabitService({
      database: conn.db,
      habits: habitRepo,
      tasks: taskRepo,
      projects: projectRepo,
      rateLimiter,
      now: () => fixedNowMs,
    });
    habitMonitorService = new HabitMonitorService({
      database: conn.db,
      social: habitSocialRepo,
      habits: habitRepo,
      rateLimiter,
      eventBus: bus,
      now: () => fixedNowMs,
    });
    accountService = new AccountService({
      database: conn.db,
      users: userRepo,
      projects: projectRepo,
      reminders: reminderRepo,
      operationsSocial: opSocialRepo,
      unreadCache: new InMemoryUnreadCounterCache(),
      eventBus: bus,
    });

    const inserted = await conn.db
      .insert(users)
      .values([
        {
          id: "01AUDITOWNER00000000000001",
          name: "Audit Owner",
          email: "owner@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01AUDITMEMBER0000000000002",
          name: "Audit Member",
          email: "member@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01AUDITOUTSIDER00000000003",
          name: "Audit Outsider",
          email: "outsider@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01AUDITUNVERIFIED000000004",
          name: "Unverified User",
          email: "unverified@folio.test",
          emailVerified: false,
          timezone: "UTC",
        },
        {
          id: "01AUDITSUSPENDED0000000005",
          name: "Suspended Admin",
          email: "suspended@folio.test",
          emailVerified: true,
          role: "admin",
          isSuspended: true,
          timezone: "UTC",
        },
        {
          id: "01AUDITCOOWNERDEL000000006",
          name: "Departing CoOwner",
          email: "departing@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01AUDITCOOWNERSURV00000007",
          name: "Surviving CoOwner",
          email: "surviving@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();

    ownerId = inserted[0]!.id;
    memberId = inserted[1]!.id;
    outsiderId = inserted[2]!.id;
    unverifiedId = inserted[3]!.id;
    suspendedId = inserted[4]!.id;
    coOwnerDeleteId = inserted[5]!.id;
    coOwnerSurvivorId = inserted[6]!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("SEC-01/SEC-02: blocks suspended users in canUserReadEntity and resolveLiveUserShellStatus", async () => {
    const [suspendedTask] = await conn.db
      .insert(tasks)
      .values({
        userId: suspendedId,
        title: "Suspended user's private task",
        status: "todo",
        priority: "medium",
        position: "a0",
      })
      .returning();

    const canRead = await canUserReadEntity(
      suspendedId,
      { taskId: suspendedTask!.id },
      conn.db
    );
    expect(canRead).toBe(false);

    const status = await resolveLiveUserShellStatus(
      suspendedId,
      conn.db,
      "suspended@folio.test"
    );
    expect(status.isSuspended).toBe(true);
    expect(status.isAdmin).toBe(false);
  });

  it("SEC-03/SEC-04: rejects non-member updateMemberRole, enforces quick-pick allowlists, strips inviteUrl/tokenHash, and gates unverified acceptance", async () => {
    const created = await opService.createOperation(ownerId, {
      title: "Private Runbook",
      summary: "Restricted operational runbook.",
      domain: "tech",
      visibility: "private",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "action",
          title: "Step 1",
          bodyMarkdown: "Do step 1",
        },
      ],
    });

    // updateMemberRole MUST NOT insert a new row for a non-member
    await expect(
      shareService.updateMemberRole(ownerId, created.operation.id, outsiderId, "collaborator")
    ).rejects.toBeInstanceOf(NotFoundError);

    const leakedMember = await conn.db
      .select()
      .from(operationMembers)
      .where(
        and(
          eq(operationMembers.operationId, created.operation.id),
          eq(operationMembers.userId, outsiderId)
        )
      );
    expect(leakedMember).toHaveLength(0);

    // Quick-pick invite MUST reject an arbitrary outsiderId not in follows/circle/projects
    await expect(
      shareService.inviteQuickPickUser(ownerId, created.operation.id, {
        targetUserId: outsiderId,
        role: "viewer",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // HabitMonitorService.inviteCollaborator MUST reject an outsider not sharing a project
    await expect(
      habitMonitorService.inviteCollaborator(ownerId, {
        targetUserId: outsiderId,
        scope: "all",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Anti-enumeration: inviteByEmail returns uniform shape for registered & unknown emails
    const registeredInvite = await shareService.inviteByEmail(
      ownerId,
      created.operation.id,
      { email: "member@folio.test", role: "viewer" }
    );
    const unknownInvite = await shareService.inviteByEmail(
      ownerId,
      created.operation.id,
      { email: "nobody-anywhere@example.invalid", role: "viewer" }
    );
    expect(registeredInvite.message).toBe(unknownInvite.message);
    expect("inviteUrl" in registeredInvite).toBe(false);
    expect("inviteUrl" in unknownInvite).toBe(false);
    expect("tokenHash" in registeredInvite).toBe(false);
    expect("targetUserId" in registeredInvite).toBe(false);

    // Unverified user cannot accept an operation invitation
    const unverifiedInvite = await shareService.inviteByEmail(
      ownerId,
      created.operation.id,
      { email: "unverified@folio.test", role: "viewer" }
    );
    await expect(
      shareService.acceptInAppInvitation(unverifiedId, unverifiedInvite.invitationId!)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SEC-05 & CON-04 & ST-02: isolates referenceNotes to owner, re-checks access on live runs, preserves legacy habit roster, and enforces LWW offline sync", async () => {
    const habit = await habitService.createHabit(ownerId, "UTC", {
      title: "Evening Mobility",
      startDate: "2026-11-01",
    });
    // Ensure legacy state: 0 explicit habit_month_rosters rows exist for owner
    const rostersBefore = await conn.db
      .select()
      .from(habitMonthRosters)
      .where(eq(habitMonthRosters.userId, ownerId));
    expect(rostersBefore).toHaveLength(0);

    const [ownerPrivateNote] = await conn.db
      .insert(notes)
      .values({
        userId: ownerId,
        title: "Owner Secret Reference Note",
        content: "Private architectural credentials and internal context",
      })
      .returning();

    const created = await opService.createOperation(ownerId, {
      title: "Shared Mobility Routine",
      summary: "Daily mobility runbook",
      domain: "fitness",
      visibility: "private",
      linkedHabitId: habit.id,
      steps: [
        {
          key: "warmup",
          position: "a0",
          type: "action",
          title: "Warmup",
          bodyMarkdown: "5 min warmup",
        },
        {
          key: "stretch",
          position: "a1",
          type: "action",
          title: "Stretch",
          bodyMarkdown: "10 min stretch",
        },
      ],
    });

    await conn.db.insert(operationReferenceNotes).values({
      operationId: created.operation.id,
      noteId: ownerPrivateNote!.id,
    });

    // Grant memberId viewer access on private operation
    await conn.db.insert(operationMembers).values({
      operationId: created.operation.id,
      userId: memberId,
      role: "viewer",
      grantedById: ownerId,
      createdAt: fixedNowMs,
    });

    // Owner run DOES include owner's linked referenceNote
    const ownerRun = await runService.startRun(ownerId, created.operation.id, {});
    expect(ownerRun.referenceNotes.map((n) => n.id)).toContain(ownerPrivateNote!.id);

    // Non-owner runner MUST NEVER see owner's private referenceNotes
    const memberRun = await runService.startRun(memberId, created.operation.id, {});
    expect(memberRun.referenceNotes).toEqual([]);

    // ST-02 LWW: Newer queuedAtMs wins over older queuedAtMs even if listed earlier
    const synced = await runService.syncOfflineRunMutations(
      ownerId,
      ownerRun.run.id,
      {
        stepUpdates: [
          {
            stepKey: "warmup",
            status: "done",
            note: "newer-offline-edit",
            queuedAtMs: fixedNowMs + 5_000,
          },
          {
            stepKey: "warmup",
            status: "skipped",
            note: "older-stale-edit",
            queuedAtMs: fixedNowMs + 1_000,
          },
        ],
      }
    );
    const warmupState = synced.stepStates.find((s) => s.stepKey === "warmup");
    expect(warmupState?.status).toBe("done");
    expect(warmupState?.note).toBe("newer-offline-edit");

    // Completing owner run auto-logs linked habit WITHOUT creating an explicit habit_month_rosters row
    const completed = await runService.completeRun(ownerId, ownerRun.run.id, {
      autoLogLinkedHabit: true,
      timezone: "UTC",
    });
    expect(completed.habitAutoLogged?.habitId).toBe(habit.id);
    const rostersAfter = await conn.db
      .select()
      .from(habitMonthRosters)
      .where(eq(habitMonthRosters.userId, ownerId));
    expect(rostersAfter).toHaveLength(0);

    // Revoke memberId from private operation -> existing in-progress run is immediately blocked
    await shareService.revokeMember(ownerId, created.operation.id, memberId);
    await expect(
      runService.getRunDetail(memberId, memberRun.run.id)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runService.updateRunStep(memberId, memberRun.run.id, {
        stepKey: "warmup",
        status: "done",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runService.completeRun(memberId, memberRun.run.id, { timezone: "UTC" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("SEC-06: hides authored shared-project tasks from Today/Upcoming/Sidebar after member removal", async () => {
    const [proj] = await conn.db
      .insert(projects)
      .values({
        ownerId,
        name: "Confidential Launch",
        colorToken: "sage",
      })
      .returning();

    await conn.db.insert(projectMembers).values([
      { projectId: proj!.id, userId: ownerId, role: "owner" },
      { projectId: proj!.id, userId: memberId, role: "editor" },
    ]);

    const todayDueMs = Date.now();
    const upcomingDueMs = Date.now() + 4 * 24 * 60 * 60 * 1000;

    // Member authored both a Today task and an Upcoming task inside the shared project
    const [todayTask, upcomingTask] = await conn.db
      .insert(tasks)
      .values([
        {
          userId: memberId,
          projectId: proj!.id,
          assigneeId: memberId,
          title: "Confidential Today Deliverable",
          status: "todo",
          priority: "high",
          dueAt: todayDueMs,
          position: "a0",
        },
        {
          userId: memberId,
          projectId: proj!.id,
          assigneeId: memberId,
          title: "Confidential Upcoming Deliverable",
          status: "todo",
          priority: "medium",
          dueAt: upcomingDueMs,
          position: "a1",
        },
      ])
      .returning();

    // While active member, member sees both tasks
    const beforeToday = await taskRepo.listTodayWithReminders(memberId, "UTC");
    expect(beforeToday.items.some((i) => i.task.id === todayTask!.id)).toBe(true);

    // Remove member from project
    await conn.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, proj!.id),
          eq(projectMembers.userId, memberId)
        )
      );

    // After removal, member MUST NOT see either task in Today, Upcoming, or Sidebar counts
    const afterToday = await taskRepo.listTodayWithReminders(memberId, "UTC");
    const afterUpcoming = await taskRepo.listUpcomingWithReminders(memberId, "UTC");
    const sidebar = await workspaceRepo.getSidebarSummary(memberId, "UTC");

    expect(afterToday.items.some((i) => i.task.id === todayTask!.id)).toBe(false);
    expect(afterUpcoming.items.some((i) => i.task.id === upcomingTask!.id)).toBe(
      false
    );
    expect(sidebar.todayCount).toBe(0);
    expect(sidebar.upcomingCount).toBe(0);
  });

  it("SEC-08: preserves co-owned shared projects when original creator deletes their account", async () => {
    const [coOwnedProj] = await conn.db
      .insert(projects)
      .values({
        ownerId: coOwnerDeleteId,
        name: "Co-Owned Shared Project",
        colorToken: "amber",
      })
      .returning();

    await conn.db.insert(projectMembers).values([
      { projectId: coOwnedProj!.id, userId: coOwnerDeleteId, role: "owner" },
      { projectId: coOwnedProj!.id, userId: coOwnerSurvivorId, role: "owner" },
    ]);

    const result = await accountService.deleteAccount(coOwnerDeleteId);
    expect(result.deleted).toBe(true);

    const [survivingProject] = await conn.db
      .select()
      .from(projects)
      .where(eq(projects.id, coOwnedProj!.id));

    expect(survivingProject).toBeDefined();
    expect(survivingProject?.ownerId).toBe(coOwnerSurvivorId);
  });

  it("CON-02: blocks weakening month-lock settings without current PIN once PIN is configured", async () => {
    await habitService.setMonthLockPin(ownerId, { newPin: "4829" });

    // Attempting to disable auto-lock without PIN must fail
    await expect(
      habitService.updateSettings(ownerId, { monthLockEnabled: false })
    ).rejects.toBeInstanceOf(ValidationError);

    // Attempting to extend grace window with wrong PIN must fail
    await expect(
      habitService.updateSettings(ownerId, {
        monthLockGraceDays: 14,
        currentPin: "0000",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    // With valid PIN, relaxing grace window succeeds
    const updated = await habitService.updateSettings(ownerId, {
      monthLockGraceDays: 7,
      currentPin: "4829",
    });
    expect(updated.monthLockGraceDays).toBe(7);
  });

  it("CON-05: fractional index prepends below '0' and repeated prepends never collide", () => {
    let cursor = "0001";
    const seen = new Set<string>([cursor]);
    for (let i = 0; i < 40; i++) {
      const next = generatePositionBetween(null, cursor);
      expect(next < cursor).toBe(true);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      cursor = next;
    }

    // Degenerate "0" triggers rebalance threshold cleanly (> MAX_POSITION_KEY_LENGTH)
    const zeroKey = generatePositionBetween(null, "0");
    expect(zeroKey.length).toBeGreaterThan(MAX_POSITION_KEY_LENGTH);
  });

  it("CON-06: WebPushNotificationChannel re-throws transient 503/429 errors while pruning 410", async () => {
    await notifRepo.upsertPushSubscription({
      userId: ownerId,
      endpoint: "https://fcm.googleapis.com/fcm/send/transient-503",
      p256dh: "p256-a",
      auth: "auth-a",
    });
    await notifRepo.upsertPushSubscription({
      userId: ownerId,
      endpoint: "https://fcm.googleapis.com/fcm/send/expired-410",
      p256dh: "p256-b",
      auth: "auth-b",
    });

    const mockTransport: PushTransport = {
      isConfigured: () => true,
      async send(sub) {
        if (sub.endpoint.endsWith("expired-410")) {
          const err = new Error("Gone") as Error & { statusCode: number };
          err.statusCode = 410;
          throw err;
        }
        const err = new Error("Service Unavailable") as Error & {
          statusCode: number;
        };
        err.statusCode = 503;
        throw err;
      },
    };

    const channel = new WebPushNotificationChannel(notifRepo, mockTransport);

    await expect(
      channel.send({
        userId: ownerId,
        type: "reminder.due",
        title: "Test",
        body: "Body",
        entityType: "task",
        entityId: "task-1",
        deepLink: "/app/inbox",
        remindAt: fixedNowMs,
        timezone: "UTC",
      })
    ).rejects.toThrow("Service Unavailable");

    // Expired 410 subscription was pruned; 503 subscription remains intact for retry
    const remaining = await notifRepo.listPushSubscriptionsForUser(ownerId);
    expect(remaining.map((s) => s.endpoint)).toEqual([
      "https://fcm.googleapis.com/fcm/send/transient-503",
    ]);
  });

  it("DB-01 & ST-03: deduplicates system notifications via partial unique index and normalizes public cache tags", async () => {
    const first = await notifRepo.createIdempotent({
      userId: ownerId,
      type: "habit.nudge",
      title: "Evening Habit Check-in",
      body: "2 habits remaining",
      entityType: "habit_nudge",
      entityId: "2026-11-27",
    });
    const duplicate = await notifRepo.createIdempotent({
      userId: ownerId,
      type: "habit.nudge",
      title: "Evening Habit Check-in",
      body: "2 habits remaining",
      entityType: "habit_nudge",
      entityId: "2026-11-27",
    });

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.notification).toBeNull();

    // Public profile handle tag normalization strips leading `@` and lowercases
    expect(normalizePublicHandle("@Alice")).toBe("alice");
    expect(publicProfileCacheTag("@Alice")).toBe(publicProfileCacheTag("alice"));
    expect(publicProfileCacheTag("@Alice")).toBe("public-profile:alice");
  });

  it("DB-01..DB-03: verifies Migration 0010 EXPLAIN QUERY PLAN uses indexes with zero full table scans on hot paths", async () => {
    const queries: Array<{ name: string; sql: string; args: (string | number)[] }> = [
      {
        name: "inbox tasks ordered by position",
        sql: "SELECT id, title FROM tasks WHERE user_id = ? AND project_id IS NULL AND status != 'done' ORDER BY position ASC",
        args: [ownerId],
      },
      {
        name: "notes list ordered by is_pinned, updated_at",
        sql: "SELECT id, title FROM notes WHERE user_id = ? AND project_id IS NULL ORDER BY is_pinned DESC, updated_at DESC",
        args: [ownerId],
      },
      {
        name: "unread notification count",
        sql: "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0",
        args: [ownerId],
      },
      {
        name: "recent notifications ordered by created_at",
        sql: "SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
        args: [ownerId],
      },
      {
        name: "operation runs by runner ordered by updated_at",
        sql: "SELECT id FROM operation_runs WHERE runner_id = ? ORDER BY updated_at DESC LIMIT 20",
        args: [ownerId],
      },
      {
        name: "public explore operations ordered by updated_at",
        sql: "SELECT id FROM operations WHERE visibility = 'public' AND is_archived = 0 ORDER BY updated_at DESC LIMIT 60",
        args: [],
      },
      {
        name: "users lookup by normalized email",
        sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
        args: ["owner@folio.test"],
      },
    ];

    for (const q of queries) {
      const plan = await conn.client.execute({
        sql: `EXPLAIN QUERY PLAN ${q.sql}`,
        args: q.args,
      });
      const details = plan.rows.map((r) => String(r.detail ?? r[3] ?? "")).join(" | ");
      expect(details, `Expected index usage for "${q.name}": ${details}`).toMatch(
        /USING (COVERING )?INDEX/i
      );
      expect(details, `Unexpected full table SCAN for "${q.name}": ${details}`).not.toMatch(
        /\bSCAN\b/i
      );
      expect(
        details,
        `Unexpected TEMP B-TREE sort for "${q.name}": ${details}`
      ).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/i);
    }
  });
});
