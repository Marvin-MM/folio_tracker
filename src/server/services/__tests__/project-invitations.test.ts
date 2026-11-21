import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertProjectRole,
  createDrizzleMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { projectInvitations, tasks, users } from "@/server/db/schema";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import {
  hashInviteToken,
  INVITE_EXPIRY_MS,
  ProjectInviteService,
} from "@/server/services/project-invite-service";
import { ProjectService } from "@/server/services/project-service";
import { TaskService } from "@/server/services/task-service";

describe("ProjectInviteService — SHA-256 tokens, expiry, atomic single-use acceptance & direct-Turso RBAC", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string;
  let inviteeId: string;
  let wrongUserId: string;
  let projectId: string;

  let projectRepo: DrizzleProjectRepository;
  let projectSvc: ProjectService;
  let eventBus: InMemoryEventBus;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-invite-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const inserted = await conn.db
      .insert(users)
      .values([
        { name: "Alice Owner", email: "alice@invite.test", emailVerified: true },
        { name: "Bob Invitee", email: "bob@invite.test", emailVerified: true },
        { name: "Eve Wrong", email: "eve@invite.test", emailVerified: true },
      ])
      .returning();

    ownerId = inserted[0]!.id;
    inviteeId = inserted[1]!.id;
    wrongUserId = inserted[2]!.id;

    projectRepo = new DrizzleProjectRepository(conn.db);
    eventBus = new InMemoryEventBus();

    projectSvc = new ProjectService({
      database: conn.db,
      projects: projectRepo,
      reminders: new DrizzleReminderRepository(conn.db),
      membershipLookup: createDrizzleMembershipLookup(conn.db),
      eventBus,
    });

    const proj = await projectSvc.createProject(ownerId, {
      name: "Security Launch",
    });
    projectId = proj.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("hashes tokens with SHA-256, prevents duplicates, rejects mismatched email, enforces atomic single-use acceptance, and reflects revocations instantaneously via direct Turso lookup", async () => {
    const fixedNow = Date.UTC(2026, 10, 21, 12, 0, 0);
    const lookup = createDrizzleMembershipLookup(conn.db);
    const inviteSvc = new ProjectInviteService({
      database: conn.db,
      projects: projectRepo,
      users: new DrizzleUserRepository(conn.db),
      membershipLookup: lookup,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus,
      now: () => fixedNow,
    });

    // Before acceptance, Bob is rejected directly against Turso
    await expect(
      assertProjectRole(projectId, inviteeId, ["editor"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 1. Create invite -> raw token is NOT persisted; only SHA-256 hash is stored
    const { invitation, invitePath } = await inviteSvc.createInvitation(
      projectId,
      ownerId,
      { email: "bob@invite.test", role: "editor" }
    );
    const rawToken = invitePath.replace("/invite/", "");
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(invitation.tokenHash).toBe(hashInviteToken(rawToken));
    expect(invitation.tokenHash).not.toBe(rawToken);
    expect(invitation.expiresAt).toBe(fixedNow + INVITE_EXPIRY_MS);
    expect(eventBus.events.at(-1)?.name).toBe("app/project.invited");

    // 2. Duplicate active pending invite for same (projectId, email) is rejected
    await expect(
      inviteSvc.createInvitation(projectId, ownerId, {
        email: "BOB@invite.test",
        role: "viewer",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // 3. Mismatched authenticated email is rejected with EmailMismatchError
    await expect(
      inviteSvc.acceptInvitation(rawToken, {
        id: wrongUserId,
        email: "eve@invite.test",
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(EmailMismatchError);

    // 4. Matching authenticated user accepts atomically
    const accepted = await inviteSvc.acceptInvitation(rawToken, {
      id: inviteeId,
      email: "bob@invite.test",
      emailVerified: true,
    });
    expect(accepted).toEqual({
      projectId,
      role: "editor",
      alreadyMember: false,
    });

    // Verify immediate direct-Turso editor authorization succeeds
    const membership = await assertProjectRole(
      projectId,
      inviteeId,
      ["editor"],
      lookup
    );
    expect(membership.role).toBe("editor");

    // 5. Invitation is strictly single-use: status is 'accepted' and replay throws ConflictError
    const [dbInv] = await conn.db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitation.id));
    expect(dbInv!.status).toBe("accepted");

    await expect(
      inviteSvc.acceptInvitation(rawToken, {
        id: inviteeId,
        email: "bob@invite.test",
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // 6. Create a task assigned to Bob, then demote & remove Bob -> takes effect instantaneously
    const taskSvc = new TaskService({
      database: conn.db,
      tasks: new DrizzleTaskRepository(conn.db),
      reminders: new DrizzleReminderRepository(conn.db),
      projects: projectRepo,
      membershipLookup: lookup,
      eventBus,
    });
    const { task: assignedTask } = await taskSvc.createTask(ownerId, {
      projectId,
      title: "Assigned to Bob",
      assigneeId: inviteeId,
    });
    expect(assignedTask.assigneeId).toBe(inviteeId);

    await projectSvc.updateMemberRole(projectId, ownerId, inviteeId, "viewer");
    await expect(
      assertProjectRole(projectId, inviteeId, ["editor"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await projectSvc.removeMember(projectId, ownerId, inviteeId);
    await expect(
      assertProjectRole(
        projectId,
        inviteeId,
        ["owner", "editor", "viewer"],
        lookup
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    const [afterRemovalTask] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, assignedTask.id));
    expect(afterRemovalTask!.assigneeId).toBeNull();
  });

  it("rejects invitations older than 7 days and marks them expired", async () => {
    let clock = Date.UTC(2026, 10, 1, 0, 0, 0);
    const lookup = createDrizzleMembershipLookup(conn.db);
    const inviteSvc = new ProjectInviteService({
      database: conn.db,
      projects: projectRepo,
      users: new DrizzleUserRepository(conn.db),
      membershipLookup: lookup,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus,
      now: () => clock,
    });

    const { invitePath } = await inviteSvc.createInvitation(
      projectId,
      ownerId,
      { email: "eve@invite.test", role: "viewer" }
    );
    const rawToken = invitePath.replace("/invite/", "");

    // Advance clock past 7-day expiry
    clock += INVITE_EXPIRY_MS + 1_000;

    const preview = await inviteSvc.previewInvitationByToken(rawToken);
    expect(preview.status).toBe("expired");

    await expect(
      inviteSvc.acceptInvitation(rawToken, {
        id: wrongUserId,
        email: "eve@invite.test",
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
