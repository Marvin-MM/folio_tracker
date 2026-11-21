import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzleMembershipLookup } from "@/server/dal/auth-guard";
import { ForbiddenError } from "@/server/dal/errors";
import { DrizzleNoteRepository } from "@/server/dal/note-repository";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import { InMemoryPermissionCache } from "@/server/providers/redis/permission-cache";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { NoteService } from "@/server/services/note-service";
import { ProjectInviteService } from "@/server/services/project-invite-service";
import { ProjectService } from "@/server/services/project-service";
import { ReminderService } from "@/server/services/reminder-service";
import { TaskService } from "@/server/services/task-service";

describe("Shared Projects RBAC Matrix (owner / editor / viewer / outsider)", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let outsiderId: string;
  let projectId: string;

  let projectSvc: ProjectService;
  let inviteSvc: ProjectInviteService;
  let taskSvc: TaskService;
  let noteSvc: NoteService;
  let reminderSvc: ReminderService;
  let permCache: InMemoryPermissionCache;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-rbac-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const inserted = await conn.db
      .insert(users)
      .values([
        { name: "Owner User", email: "owner@rbac.test", emailVerified: true },
        { name: "Editor User", email: "editor@rbac.test", emailVerified: true },
        { name: "Viewer User", email: "viewer@rbac.test", emailVerified: true },
        {
          name: "Outsider User",
          email: "outsider@rbac.test",
          emailVerified: true,
        },
      ])
      .returning();

    ownerId = inserted[0]!.id;
    editorId = inserted[1]!.id;
    viewerId = inserted[2]!.id;
    outsiderId = inserted[3]!.id;

    const projectRepo = new DrizzleProjectRepository(conn.db);
    const taskRepo = new DrizzleTaskRepository(conn.db);
    const noteRepo = new DrizzleNoteRepository(conn.db);
    const remRepo = new DrizzleReminderRepository(conn.db);
    const userRepo = new DrizzleUserRepository(conn.db);
    const lookup = createDrizzleMembershipLookup(conn.db);
    const bus = new InMemoryEventBus();
    permCache = new InMemoryPermissionCache();

    projectSvc = new ProjectService({
      database: conn.db,
      projects: projectRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
    });

    inviteSvc = new ProjectInviteService({
      database: conn.db,
      projects: projectRepo,
      users: userRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus: bus,
    });

    reminderSvc = new ReminderService({
      database: conn.db,
      reminders: remRepo,
      tasks: taskRepo,
      notes: noteRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
      eventBus: bus,
    });

    taskSvc = new TaskService({
      database: conn.db,
      tasks: taskRepo,
      reminders: remRepo,
      projects: projectRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
      reminderService: reminderSvc,
      eventBus: bus,
    });

    noteSvc = new NoteService({
      database: conn.db,
      notes: noteRepo,
      reminders: remRepo,
      projects: projectRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
      reminderService: reminderSvc,
      eventBus: bus,
    });

    const project = await projectSvc.createProject(ownerId, {
      name: "Shared Engineering Roadmap",
    });
    projectId = project.id;

    await projectRepo.addMember({ projectId, userId: editorId, role: "editor" });
    await projectRepo.addMember({ projectId, userId: viewerId, role: "viewer" });
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces owner/editor/viewer/outsider permissions on project tasks, notes, settings, and invites", async () => {
    // Owner and Editor can create & mutate project tasks and notes
    const { task: ownerTask } = await taskSvc.createTask(ownerId, {
      projectId,
      title: "Finalize Q4 architecture",
      assigneeId: editorId,
    });

    const { task: editorTask } = await taskSvc.createTask(editorId, {
      projectId,
      title: "Write API integration specs",
    });

    const { note: editorNote } = await noteSvc.createNote(editorId, {
      projectId,
      title: "Release checklist",
      content: "- Run migrations\n- Verify health endpoint",
    });

    // Editor can toggle owner's project task and assign tasks
    await expect(
      taskSvc.toggleTaskStatus(editorId, ownerTask.id, "done")
    ).resolves.toMatchObject({ task: { status: "done" } });

    // Editor CANNOT update project settings, delete project, or invite members
    await expect(
      projectSvc.updateProject(projectId, editorId, { name: "Hijacked" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      projectSvc.deleteProject(projectId, editorId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      inviteSvc.createInvitation(projectId, editorId, {
        email: "new@rbac.test",
        role: "viewer",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Viewer CAN read the project workspace
    const viewerWorkspace = await projectSvc.getProjectWorkspace(
      projectId,
      viewerId
    );
    expect(viewerWorkspace.viewerRole).toBe("viewer");
    expect(viewerWorkspace.pendingInvitations).toHaveLength(0);
    expect(viewerWorkspace.tasks.length).toBeGreaterThanOrEqual(2);
    expect(viewerWorkspace.notes.length).toBeGreaterThanOrEqual(1);
    expect(viewerWorkspace.activities.length).toBeGreaterThanOrEqual(3);

    // Viewer CANNOT create, edit, toggle, or delete shared tasks or notes
    await expect(
      taskSvc.createTask(viewerId, { projectId, title: "Illegal viewer task" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      taskSvc.toggleTaskStatus(viewerId, editorTask.id, "done")
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      taskSvc.updateTask(viewerId, editorTask.id, { title: "Tampered" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      taskSvc.deleteTask(viewerId, editorTask.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      noteSvc.createNote(viewerId, { projectId, title: "Illegal viewer note" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      noteSvc.updateNote(viewerId, editorNote.id, { content: "Tampered" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Viewer CAN attach & snooze private personal reminders on shared project tasks and notes!
    const viewerTaskReminder = await reminderSvc.attachReminder(viewerId, {
      entityType: "task",
      entityId: editorTask.id,
      remindAt: Date.now() + 2 * 3_600_000,
      timezone: "UTC",
    });
    expect(viewerTaskReminder.userId).toBe(viewerId);
    expect(viewerTaskReminder.entityId).toBe(editorTask.id);

    const viewerNoteReminder = await reminderSvc.attachReminder(viewerId, {
      entityType: "note",
      entityId: editorNote.id,
      remindAt: Date.now() + 3 * 3_600_000,
      timezone: "UTC",
    });
    expect(viewerNoteReminder.userId).toBe(viewerId);

    const snoozed = await reminderSvc.snoozeReminder(
      viewerId,
      viewerTaskReminder.id,
      "15m",
      "UTC"
    );
    expect(snoozed.version).toBe(2);

    // Non-member outsider is rejected on EVERY read, mutation, and reminder attempt
    await expect(
      projectSvc.getProjectWorkspace(projectId, outsiderId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      taskSvc.updateTask(outsiderId, editorTask.id, { title: "Outsider hack" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      reminderSvc.attachReminder(outsiderId, {
        entityType: "task",
        entityId: editorTask.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps personal Inbox tasks and unlinked notes strictly private to their creator", async () => {
    const { task: personalTask } = await taskSvc.createTask(ownerId, {
      title: "Private personal errand",
    });
    const { note: personalNote } = await noteSvc.createNote(ownerId, {
      title: "Private journal entry",
    });

    await expect(
      taskSvc.updateTask(editorId, personalTask.id, { title: "Snooped" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      noteSvc.updateNote(editorId, personalNote.id, { content: "Snooped" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      reminderSvc.attachReminder(editorId, {
        entityType: "task",
        entityId: personalTask.id,
        remindAt: Date.now() + 3_600_000,
        timezone: "UTC",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
