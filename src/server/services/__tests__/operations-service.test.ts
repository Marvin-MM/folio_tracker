import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConcurrencyConflictError,
  NotFoundError,
  SecretScanBlockedError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleOperationRepository } from "@/server/dal/operations";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { DrizzleWorkspaceRepository } from "@/server/dal/workspace-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitMonthLocks,
  operationRuns,
  projectMembers,
  projects,
  tasks,
  users,
} from "@/server/db/schema";
import type { AppDomainEvent, EventBus } from "@/server/providers/event-bus";
import { HabitService } from "@/server/services/habit-service";
import { OperationRunService } from "@/server/services/operation-run-service";
import { OperationService } from "@/server/services/operation-service";
import { ReminderService } from "@/server/services/reminder-service";

class CapturingEventBus implements EventBus {
  readonly events: AppDomainEvent[] = [];
  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    if (Array.isArray(event)) this.events.push(...event);
    else this.events.push(event);
  }
}

describe("OperationService & OperationRunService — ACID, versioning, security & cross-module sync", () => {
  let tempDir: string;
  let conn: DbConnection;
  let ownerId: string;
  let otherUserId: string;
  let projectId: string;
  let linkedHabitId: string;
  const nowMs = Date.parse("2026-11-30T14:00:00.000Z"); // Last day of Nov 2026 (to also test locked-month edge case!)

  let eventBus: CapturingEventBus;
  let operationService: OperationService;
  let operationRunService: OperationRunService;
  let habitRepo: DrizzleHabitRepository;
  let habitService: HabitService;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-operations-test-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    eventBus = new CapturingEventBus();
    const opRepo = new DrizzleOperationRepository(conn.db);
    habitRepo = new DrizzleHabitRepository(conn.db);
    const taskRepo = new DrizzleTaskRepository(conn.db);
    const projectRepo = new DrizzleProjectRepository(conn.db);
    const reminderRepo = new DrizzleReminderRepository(conn.db);
    const userRepo = new DrizzleUserRepository(conn.db);
    const workspaceRepo = new DrizzleWorkspaceRepository(conn.db);
    const reminderService = new ReminderService({
      database: conn.db,
      reminders: reminderRepo,
      eventBus,
      now: () => nowMs,
    });

    operationService = new OperationService({
      database: conn.db,
      operations: opRepo,
      habits: habitRepo,
      tasks: taskRepo,
      projects: projectRepo,
      reminders: reminderRepo,
      workspace: workspaceRepo,
      reminderService,
      eventBus,
      now: () => nowMs,
    });

    operationRunService = new OperationRunService({
      database: conn.db,
      operations: opRepo,
      habits: habitRepo,
      tasks: taskRepo,
      reminders: reminderRepo,
      users: userRepo,
      reminderService,
      eventBus,
      now: () => nowMs,
    });

    habitService = new HabitService({
      database: conn.db,
      habits: habitRepo,
      tasks: taskRepo,
      projects: projectRepo,
      now: () => nowMs,
    });

    const [u1, u2] = await conn.db
      .insert(users)
      .values([
        {
          id: "01OPSOWNERUSER000000000001",
          name: "Ops Owner",
          email: "ops.owner@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01OPSOTHERUSER000000000002",
          name: "Other User",
          email: "ops.other@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();

    ownerId = u1!.id;
    otherUserId = u2!.id;

    const [proj] = await conn.db
      .insert(projects)
      .values({
        ownerId,
        name: "Infrastructure",
        colorToken: "collab",
      })
      .returning();
    projectId = proj!.id;
    await conn.db.insert(projectMembers).values({
      projectId,
      userId: ownerId,
      role: "owner",
    });

    const createdHabit = await habitService.createHabit(ownerId, "UTC", {
      title: "Weekly Server Check",
      cadenceType: "daily",
      startDate: "2026-11-01",
    });
    linkedHabitId = createdHabit.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("pins runs to immutable versions, enforces optimistic locking, and rolls back by appending a new version", async () => {
    const created = await operationService.createOperation(ownerId, {
      title: "Zero-Downtime Nginx Deploy",
      summary: "Safely reload Nginx across production nodes.",
      domain: "tech",
      projectId,
      linkedHabitId,
      variables: [
        { key: "server_ip", label: "Server IP", type: "text", required: true },
        { key: "ssh_pass", label: "SSH Password", type: "secret", required: true },
      ],
      prerequisites: [{ id: "pre1", label: "Confirm VPN connected" }],
      steps: [
        {
          key: "step_1",
          position: "a0",
          type: "command",
          title: "Check Nginx syntax",
          bodyMarkdown: "Verify config on `{{server_ip}}`.",
          codeBlock: { language: "bash", content: "ssh root@{{server_ip}} nginx -t" },
        },
      ],
    });

    const opId = created.operation.id;
    expect(created.operation.currentVersion).toBe(1);
    expect(created.operation.editVersion).toBe(1);

    // Start Run A while blueprint is on v1 (attempting to pass a secret value too!)
    const runA = await operationRunService.startRun(ownerId, opId, {
      variablesValues: {
        server_ip: "app-01.prod",
        ssh_pass: "NEVER_PERSIST_IN_DB",
      },
      prerequisitesChecked: ["pre1"],
    });

    // Verify secret variable was STRICTLY stripped from DB!
    expect(runA.variablesValues).toEqual({ server_ip: "app-01.prod" });
    const [rawRunRow] = await conn.db
      .select()
      .from(operationRuns)
      .where(eq(operationRuns.id, runA.run.id));
    expect(rawRunRow?.variablesValuesJson).not.toContain("NEVER_PERSIST_IN_DB");
    expect(rawRunRow?.variablesValuesJson).not.toContain("ssh_pass");

    // Publish v2 with 2 steps
    const v2 = await operationService.publishNewVersion(ownerId, opId, {
      expectedEditVersion: 1,
      title: "Zero-Downtime Nginx Deploy",
      summary: "Safely reload Nginx across production nodes.",
      domain: "tech",
      projectId,
      linkedHabitId,
      variables: [
        { key: "server_ip", label: "Server IP", type: "text", required: true },
        { key: "ssh_pass", label: "SSH Password", type: "secret", required: true },
      ],
      prerequisites: [{ id: "pre1", label: "Confirm VPN connected" }],
      steps: [
        {
          key: "step_1",
          position: "a0",
          type: "command",
          title: "Check Nginx syntax",
          bodyMarkdown: "Verify config on `{{server_ip}}`.",
        },
        {
          key: "step_2",
          position: "a1",
          type: "action",
          title: "Reload worker pool",
          bodyMarkdown: "Gracefully reload workers.",
          timerSeconds: 30,
        },
      ],
      changeSummary: "Added reload timer step",
    });

    expect(v2.operation.currentVersion).toBe(2);
    expect(v2.operation.editVersion).toBe(2);

    // Stale editVersion MUST throw ConcurrencyConflictError!
    await expect(
      operationService.publishNewVersion(ownerId, opId, {
        expectedEditVersion: 1, // stale!
        title: "Stale overwrite",
        domain: "tech",
        steps: [
          {
            key: "step_1",
            position: "a0",
            type: "action",
            title: "Stale step",
            bodyMarkdown: "",
          },
        ],
      })
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);

    // Run A MUST remain pinned to v1 (only 1 step!) even though blueprint is now v2!
    const refreshedRunA = await operationRunService.getRunDetail(
      ownerId,
      runA.run.id
    );
    expect(refreshedRunA.pinnedVersion.versionNumber).toBe(1);
    expect(refreshedRunA.pinnedVersion.steps).toHaveLength(1);

    // Rollback to v1 appends v3 without destroying v1 or v2!
    const v3 = await operationService.rollbackToVersion(ownerId, opId, {
      targetVersionNumber: 1,
      expectedEditVersion: 2,
    });
    expect(v3.operation.currentVersion).toBe(3);
    expect(v3.version.steps).toHaveLength(1);

    const detail = await operationService.getOperationDetail(ownerId, opId);
    expect(detail.versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
  });

  it("blocks publishing secrets when public/unlisted and stores unlisted tokens strictly as SHA-256 hash", async () => {
    const syntheticProviderKey = ["sk", "live", "51N9xAbCdEfGhIjKlMnOpQrStUv"].join("_");
    const created = await operationService.createOperation(ownerId, {
      title: "API Diagnostics",
      domain: "tech",
      visibility: "private",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "command",
          title: "Call API",
          bodyMarkdown: `Test with ${syntheticProviderKey}`,
        },
      ],
    });

    // Attempting to flip to public MUST fail with SecretScanBlockedError
    await expect(
      operationService.publishNewVersion(ownerId, created.operation.id, {
        expectedEditVersion: 1,
        title: "API Diagnostics",
        domain: "tech",
        visibility: "public",
        steps: [
          {
            key: "s1",
            position: "a0",
            type: "command",
            title: "Call API",
            bodyMarkdown: `Test with ${syntheticProviderKey}`,
          },
        ],
      })
    ).rejects.toBeInstanceOf(SecretScanBlockedError);

    // Replace hardcoded key with {{api_key}} secret variable and publish as unlisted
    const published = await operationService.publishNewVersion(
      ownerId,
      created.operation.id,
      {
        expectedEditVersion: 1,
        title: "API Diagnostics",
        domain: "tech",
        visibility: "unlisted",
        variables: [
          { key: "api_key", label: "API Key", type: "secret", required: true },
        ],
        steps: [
          {
            key: "s1",
            position: "a0",
            type: "command",
            title: "Call API",
            bodyMarkdown: "Test with {{api_key}}",
          },
        ],
      }
    );

    expect(published.mintedUnlistedToken).toBeTruthy();
    const expectedHash = createHash("sha256")
      .update(published.mintedUnlistedToken!)
      .digest("hex");
    expect(published.operation.unlistedTokenHash).toBe(expectedHash);
    expect(published.operation.unlistedTokenHash).not.toBe(
      published.mintedUnlistedToken
    );
  });

  it("enforces strict tenant isolation so another user cannot read, edit, or run private operations", async () => {
    const created = await operationService.createOperation(ownerId, {
      title: "Private Secret Sauce",
      domain: "cooking",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "action",
          title: "Simmer sauce",
          bodyMarkdown: "Simmer for 10 minutes.",
          timerSeconds: 600,
        },
      ],
    });

    await expect(
      operationService.getOperationDetail(otherUserId, created.operation.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      operationRunService.startRun(otherUserId, created.operation.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    const ownerRun = await operationRunService.startRun(
      ownerId,
      created.operation.id
    );

    await expect(
      operationRunService.getRunDetail(otherUserId, ownerRun.run.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      operationRunService.updateRunStep(otherUserId, ownerRun.run.id, {
        stepKey: "s1",
        status: "done",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("atomically syncs linked Habit on completeRun, creates blocked follow-up tasks, schedules run tasks with post-commit reminders, and survives locked months gracefully", async () => {
    const op = await operationService.createOperation(ownerId, {
      title: "Sunday Mobility & Check",
      domain: "fitness",
      projectId,
      linkedHabitId,
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "action",
          title: "Shoulder circles",
          bodyMarkdown: "2 minutes steady pace.",
          timerSeconds: 120,
        },
        {
          key: "s2",
          position: "a1",
          type: "action",
          title: "Core holds",
          bodyMarkdown: "Hold plank.",
          timerSeconds: 60,
        },
      ],
    });

    // 1. Schedule Run Task + Reminder (post-commit EventBus emission)
    const remindAt = nowMs + 60 * 60 * 1000;
    const scheduled = await operationService.scheduleOperationRunTask(
      ownerId,
      op.operation.id,
      {
        dueAt: remindAt,
        remindAt,
        timezone: "UTC",
      }
    );
    expect(scheduled.task.operationId).toBe(op.operation.id);
    expect(scheduled.task.projectId).toBe(projectId);
    expect(scheduled.reminder?.taskId).toBe(scheduled.task.id);
    expect(
      eventBus.events.some(
        (e) =>
          e.name === "app/reminder.scheduled" &&
          e.data.reminderId === scheduled.reminder?.id
      )
    ).toBe(true);

    // 2. Start Run, replay offline step mutations, create Blocked Step follow-up task, and Complete Run
    const run = await operationRunService.startRun(ownerId, op.operation.id);
    const synced = await operationRunService.syncOfflineRunMutations(
      ownerId,
      run.run.id,
      {
        stepUpdates: [{ stepKey: "s1", status: "done", note: "Felt great" }],
      }
    );
    expect(
      synced.stepStates.find((s) => s.stepKey === "s1")?.status
    ).toBe("done");

    const blocked = await operationRunService.createBlockedStepTask(
      ownerId,
      run.run.id,
      {
        stepKey: "s2",
        timezone: "UTC",
      }
    );
    expect(blocked.task.operationRunId).toBe(run.run.id);
    expect(blocked.task.operationId).toBe(op.operation.id);
    expect(blocked.task.projectId).toBe(projectId);

    const completed = await operationRunService.completeRun(
      ownerId,
      run.run.id,
      {
        markOperationVerified: true,
        autoLogLinkedHabit: true,
        timezone: "UTC",
      }
    );
    expect(completed.run.status).toBe("completed");
    expect(completed.verifiedUpdated).toBe(true);
    expect(completed.habitAutoLogged).toEqual({
      habitId: linkedHabitId,
      habitTitle: "Weekly Server Check",
      dateKey: "2026-11-30",
    });

    const logged = await habitRepo.getLogForHabitDay(
      ownerId,
      linkedHabitId,
      "2026-11-30"
    );
    expect(logged?.status).toBe("done");

    // 3. Manually lock 2026-11 -> completing another run MUST still succeed cleanly with notice!
    await conn.db.insert(habitMonthLocks).values({
      userId: ownerId,
      yearMonth: "2026-11",
      status: "locked",
      lockedAt: nowMs,
      unlockedAt: null,
      unlockedUntil: null,
      unlockReason: null,
      unlockCount: 0,
      updatedAt: nowMs,
    });

    const run2 = await operationRunService.startRun(ownerId, op.operation.id);
    const completed2 = await operationRunService.completeRun(
      ownerId,
      run2.run.id,
      {
        autoLogLinkedHabit: true,
        timezone: "UTC",
      }
    );
    expect(completed2.run.status).toBe("completed");
    expect(completed2.habitAutoLogged).toBeNull();
    expect(completed2.habitAutoLogSkippedReason).toContain("locked");

    // 4. Deleting the operation sets linked tasks.operation_id = NULL (ON DELETE SET NULL!)
    await operationService.deleteOperation(ownerId, op.operation.id);
    const [survivingTask] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, scheduled.task.id));
    expect(survivingTask).toBeTruthy();
    expect(survivingTask?.operationId).toBeNull();
  });
});
