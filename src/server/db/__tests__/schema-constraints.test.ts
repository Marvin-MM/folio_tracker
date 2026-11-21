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
import { ForbiddenError } from "@/server/dal/errors";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  projectInvitations,
  projectMembers,
  projects,
  pushSubscriptions,
  reminders,
  tasks,
  users,
} from "@/server/db/schema";

describe("Drizzle SQLite schema constraints & ACID transactions", () => {
  let tempDir: string;
  let conn: DbConnection;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-db-test-"));
    const dbPath = path.join(tempDir, "test.db");
    conn = createDbConnection({ url: `file:${dbPath}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces foreign key constraints on tasks and project_members", async () => {
    await expect(
      conn.db.insert(tasks).values({
        userId: "01JNONEXISTENTUSER00000001",
        title: "Orphaned task",
      })
    ).rejects.toThrow();

    await expect(
      conn.db.insert(projectMembers).values({
        projectId: "01JNONEXISTENTPROJ00000001",
        userId: "01JNONEXISTENTUSER00000001",
        role: "owner",
      })
    ).rejects.toThrow();
  });

  it("enforces unique constraints across users, project_invitations, push_subscriptions, and composite PK", async () => {
    const [owner] = await conn.db
      .insert(users)
      .values({
        name: "Alice Paper",
        email: "alice@example.com",
        emailVerified: true,
      })
      .returning();

    expect(owner).toBeDefined();
    const ownerId = owner!.id;

    // Duplicate user email fails
    await expect(
      conn.db.insert(users).values({
        name: "Alice Duplicate",
        email: "alice@example.com",
        emailVerified: true,
      })
    ).rejects.toThrow();

    const [project] = await conn.db
      .insert(projects)
      .values({
        ownerId,
        name: "Q4 Architecture",
      })
      .returning();

    const projectId = project!.id;

    await conn.db.insert(projectMembers).values({
      projectId,
      userId: ownerId,
      role: "owner",
    });

    // Duplicate composite PK (projectId, userId) fails
    await expect(
      conn.db.insert(projectMembers).values({
        projectId,
        userId: ownerId,
        role: "editor",
      })
    ).rejects.toThrow();

    // Verify Drizzle-backed assertProjectRole works end-to-end
    const lookup = createDrizzleMembershipLookup(conn.db);
    const verified = await assertProjectRole(
      projectId,
      ownerId,
      ["owner"],
      lookup
    );
    expect(verified.role).toBe("owner");
    await expect(
      assertProjectRole(projectId, ownerId, ["viewer"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Unique invitation tokenHash
    await conn.db.insert(projectInvitations).values({
      projectId,
      invitedById: ownerId,
      email: "bob@example.com",
      role: "editor",
      tokenHash: "sha256-unique-token-hash-1",
      expiresAt: Date.now() + 86_400_000,
    });

    await expect(
      conn.db.insert(projectInvitations).values({
        projectId,
        invitedById: ownerId,
        email: "carol@example.com",
        role: "viewer",
        tokenHash: "sha256-unique-token-hash-1",
        expiresAt: Date.now() + 86_400_000,
      })
    ).rejects.toThrow();

    // Unique push subscription endpoint
    await conn.db.insert(pushSubscriptions).values({
      userId: ownerId,
      endpoint: "https://push.example.com/sub/123",
      p256dh: "p256dh-key",
      auth: "auth-key",
    });

    await expect(
      conn.db.insert(pushSubscriptions).values({
        userId: ownerId,
        endpoint: "https://push.example.com/sub/123",
        p256dh: "p256dh-key-2",
        auth: "auth-key-2",
      })
    ).rejects.toThrow();
  });

  it("rolls back all writes atomically when a transaction fails on a constraint violation", async () => {
    const [owner] = await conn.db
      .insert(users)
      .values({
        name: "Rollback Tester",
        email: "rollback@example.com",
        emailVerified: true,
      })
      .returning();

    const ownerId = owner!.id;
    const txProjectId = "01JTXROLLBACKPROJECT000001";

    await expect(
      conn.db.transaction(async (tx) => {
        await tx.insert(projects).values({
          id: txProjectId,
          ownerId,
          name: "Should Be Rolled Back",
        });

        await tx.insert(projectMembers).values({
          projectId: txProjectId,
          userId: ownerId,
          role: "owner",
        });

        // Trigger a foreign key violation inside the same transaction
        await tx.insert(reminders).values({
          userId: "01JDOESNOTEXISTUSER0000001",
          taskId: "01JFAKETASK000000000000001",
          noteId: null,
          remindAt: Date.now() + 3_600_000,
          timezone: "UTC",
        });
      })
    ).rejects.toThrow();

    // Neither the project nor its membership row may exist after rollback
    const persistedProjects = await conn.db
      .select()
      .from(projects)
      .where(eq(projects.id, txProjectId));
    const persistedMembers = await conn.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, txProjectId));

    expect(persistedProjects).toHaveLength(0);
    expect(persistedMembers).toHaveLength(0);
  });

  it("enforces ON DELETE SET NULL for task assignee and ON DELETE CASCADE for project tasks", async () => {
    const [creator] = await conn.db
      .insert(users)
      .values({
        name: "Creator User",
        email: "creator@example.com",
        emailVerified: true,
      })
      .returning();

    const [assignee] = await conn.db
      .insert(users)
      .values({
        name: "Assignee User",
        email: "assignee@example.com",
        emailVerified: true,
      })
      .returning();

    const [project] = await conn.db
      .insert(projects)
      .values({
        ownerId: creator!.id,
        name: "Cascade Test Project",
      })
      .returning();

    const [task] = await conn.db
      .insert(tasks)
      .values({
        userId: creator!.id,
        projectId: project!.id,
        assigneeId: assignee!.id,
        title: "Assigned project task",
      })
      .returning();

    // Deleting assignee sets assigneeId to NULL without deleting task
    await conn.db.delete(users).where(eq(users.id, assignee!.id));
    const [afterAssigneeDelete] = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task!.id));
    expect(afterAssigneeDelete).toBeDefined();
    expect(afterAssigneeDelete!.assigneeId).toBeNull();

    // Deleting project cascades and removes project task
    await conn.db.delete(projects).where(eq(projects.id, project!.id));
    const remainingTasks = await conn.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task!.id));
    expect(remainingTasks).toHaveLength(0);
  });
});
