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
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { projectInvitations, tasks, users } from "@/server/db/schema";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import { InMemoryPermissionCache } from "@/server/providers/redis/permission-cache";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import {
  hashInviteToken,
  INVITE_EXPIRY_MS,
  ProjectInviteService,
} from "@/server/services/project-invite-service";
import { ProjectService } from "@/server/services/project-service";
import { TaskService } from "@/server/services/task-service";

describe("ProjectInviteService — SHA-256 tokens, expiry, ACID acceptance & PermissionCache invalidation", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string;
  let inviteeId: string;
  let wrongUserId: string;
  let projectId: string;

  let projectRepo: DrizzleProjectRepository;
  let projectSvc: ProjectService;
  let permCache: InMemoryPermissionCache;
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
    permCache = new InMemoryPermissionCache();
    eventBus = new InMemoryEventBus();

    projectSvc = new ProjectService({
      database: conn.db,
      projects: projectRepo,
      membershipLookup: createDrizzleMembershipLookup(conn.db),
      permissionCache: permCache,
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

  it("hashes tokens with SHA-256, prevents duplicates, rejects mismatched email, accepts atomically, and invalidates PermissionCache on revocation", async () => {
    const fixedNow = Date.UTC(2026, 10, 21, 12, 0, 0);
    const lookup = createDrizzleMembershipLookup(conn.db);
    const inviteSvc = new ProjectInviteService({
      database: conn.db,
      projects: projectRepo,
      users: new DrizzleUserRepository(conn.db),
      membershipLookup: lookup,
      permissionCache: permCache,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus,
      now: () => fixedNow,
    });

    // Populate PermissionCache with a cached non-member ("none") entry for Bob first
    await expect(
      assertProjectRole(projectId, inviteeId, ["editor"], lookup, permCache)
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await permCache.getRole(projectId, inviteeId)).toBe("none");

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

    // 4. Matching authenticated user accepts atomically -> invalidates cached "none" immediately!
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
    expect(await permCache.getRole(projectId, inviteeId)).toBeNull();

    // Verify immediate editor authorization succeeds & populates PermissionCache with "editor"
    const membership = await assertProjectRole(
      projectId,
      inviteeId,
      ["editor"],
      lookup,
      permCache
    );
    expect(membership.role).toBe("editor");
    expect(await permCache.getRole(projectId, inviteeId)).toBe("editor");

    // 5. Idempotent re-click by Bob succeeds gracefully; invitation status is persisted as 'accepted'
    const [dbInv] = await conn.db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitation.id));
    expect(dbInv!.status).toBe("accepted");

    const reclick = await inviteSvc.acceptInvitation(rawToken, {
      id: inviteeId,
      email: "bob@invite.test",
      emailVerified: true,
    });
    expect(reclick.alreadyMember).toBe(true);

    // 6. Create a task assigned to Bob, then demote & remove Bob -> PermissionCache invalidates IMMEDIATELY
    const taskSvc = new TaskService({
      database: conn.db,
      tasks: new DrizzleTaskRepository(conn.db),
      projects: projectRepo,
      membershipLookup: lookup,
      permissionCache: permCache,
      eventBus,
    });
    const { task: assignedTask } = await taskSvc.createTask(ownerId, {
      projectId,
      title: "Assigned to Bob",
      assigneeId: inviteeId,
    });
    expect(assignedTask.assigneeId).toBe(inviteeId);

    await projectSvc.updateMemberRole(projectId, ownerId, inviteeId, "viewer");
    // Cache invalidated immediately — Bob is now rejected for editor writes!
    expect(await permCache.getRole(projectId, inviteeId)).toBeNull();
    await expect(
      assertProjectRole(projectId, inviteeId, ["editor"], lookup, permCache)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Remove Bob -> tasks unassigned inside transaction & PermissionCache invalidated immediately
    await projectSvc.removeMember(projectId, ownerId, inviteeId);
    expect(await permCache.getRole(projectId, inviteeId)).toBeNull();
    await expect(
      assertProjectRole(
        projectId,
        inviteeId,
        ["owner", "editor", "viewer"],
        lookup,
        permCache
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
      permissionCache: permCache,
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
