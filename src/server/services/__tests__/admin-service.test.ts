import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DrizzleAdminRepository } from "@/server/dal/admin-repository";
import { ForbiddenError, ValidationError } from "@/server/dal/errors";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  adminAuditLogs,
  habitLogs,
  habitMonitorRequests,
  habits,
  notes,
  projectInvitations,
  projectMembers,
  projects,
  reminders,
  sessions,
  tasks,
  users,
  verifications,
} from "@/server/db/schema";
import { AdminService } from "@/server/services/admin-service";

describe("AdminService KPIs, diagnostics, user controls & audited actions", () => {
  let tempDir: string;
  let conn: DbConnection;
  let repo: DrizzleAdminRepository;
  let service: AdminService;
  const mockReconcile = vi.fn(async () => 3);

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-admin-service-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;
    conn = createDbConnection({ url: dbUrl });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    repo = new DrizzleAdminRepository(conn.db);
    service = new AdminService(repo, conn.db, {
      reconcileUndispatchedBatch: mockReconcile,
    });

    const now = Date.now();
    const nowDate = new Date(now);
    const pastDate = new Date(now - 3_600_000);
    const futureDate = new Date(now + 86_400_000);

    await conn.db.insert(users).values([
      {
        id: "u-admin",
        name: "Platform Admin",
        email: "admin@folio.test",
        emailVerified: true,
        role: "admin",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: nowDate,
        updatedAt: nowDate,
      },
      {
        id: "u-admin-2",
        name: "Co-Admin",
        email: "coadmin@folio.test",
        emailVerified: true,
        role: "admin",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: nowDate,
        updatedAt: nowDate,
      },
      {
        id: "u-member",
        name: "Jordan Member",
        email: "jordan@folio.test",
        emailVerified: true,
        role: "user",
        isSuspended: false,
        timezone: "America/New_York",
        emailRemindersEnabled: true,
        createdAt: nowDate,
        updatedAt: nowDate,
      },
    ]);

    await conn.db.insert(sessions).values([
      {
        id: "s-member-active",
        userId: "u-member",
        token: "tok-member-active",
        expiresAt: futureDate,
        createdAt: nowDate,
        updatedAt: nowDate,
      },
      {
        id: "s-member-expired",
        userId: "u-member",
        token: "tok-member-expired",
        expiresAt: pastDate,
        createdAt: pastDate,
        updatedAt: pastDate,
      },
    ]);

    await conn.db.insert(verifications).values({
      id: "v-expired",
      identifier: "jordan@folio.test",
      value: "expired-token",
      expiresAt: pastDate,
      createdAt: pastDate,
      updatedAt: pastDate,
    });

    await conn.db.insert(projects).values({
      id: "p-shared",
      ownerId: "u-admin",
      name: "Launch Ops",
      colorToken: "collab",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    await conn.db.insert(projectMembers).values([
      { projectId: "p-shared", userId: "u-admin", role: "owner", joinedAt: now },
      { projectId: "p-shared", userId: "u-member", role: "editor", joinedAt: now },
    ]);

    await conn.db.insert(projectInvitations).values({
      id: "inv-expired",
      projectId: "p-shared",
      invitedById: "u-admin",
      email: "late@folio.test",
      role: "viewer",
      tokenHash: "hash-expired-1",
      status: "pending",
      expiresAt: now - 10_000,
      createdAt: now - 20_000,
    });

    await conn.db.insert(habitMonitorRequests).values({
      id: "hmr-expired",
      ownerId: "u-admin",
      targetEmail: "monitor@folio.test",
      scope: "all",
      selectedHabitIdsJson: "[]",
      status: "pending",
      expiresAt: now - 10_000,
      createdAt: now - 20_000,
    });

    await conn.db.insert(tasks).values({
      id: "t-done",
      userId: "u-member",
      projectId: "p-shared",
      title: "Ship release",
      status: "done",
      priority: "high",
      position: "a0",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await conn.db.insert(notes).values({
      id: "n-pinned",
      userId: "u-member",
      title: "Architecture Runbook",
      content: "Private note body",
      tagsJson: '["ops"]',
      isPinned: true,
      createdAt: now,
      updatedAt: now,
    });

    await conn.db.insert(habits).values({
      id: "h-daily",
      userId: "u-member",
      title: "Deep Work",
      cadenceType: "daily",
      scheduledDaysJson: "[0,1,2,3,4,5,6]",
      startDate: "2026-11-20",
      autoSyncDailyTask: false,
      position: "a0",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    await conn.db.insert(habitLogs).values({
      id: "hl-1",
      habitId: "h-daily",
      userId: "u-member",
      dateKey: "2026-11-24",
      status: "done",
      loggedAt: now,
      isBackfilledLate: false,
    });

    await conn.db.insert(reminders).values({
      id: "rem-backlog",
      userId: "u-member",
      taskId: "t-done",
      remindAt: now + 3_600_000,
      timezone: "UTC",
      status: "scheduled",
      version: 1,
      dispatchedAt: null,
      createdAt: now - 180_000,
      updatedAt: now - 180_000,
    });
  });

  afterAll(async () => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("aggregates accurate platform KPIs, 14-day series, user directory & health report", async () => {
    const overview = await service.getOverview();
    expect(overview.kpis.users.total).toBe(3);
    expect(overview.kpis.users.admins).toBe(2);
    expect(overview.kpis.users.activeSessions).toBe(1);
    expect(overview.kpis.workspace.sharedProjects).toBe(1);
    expect(overview.kpis.workspace.tasksCompleted).toBe(1);
    expect(overview.kpis.workspace.notesPinned).toBe(1);
    expect(overview.kpis.habits.activeHabits).toBe(1);
    expect(overview.kpis.habits.logs7d).toBe(1);
    expect(overview.kpis.delivery.undispatchedOutboxBacklog).toBe(1);
    expect(overview.dailySeries).toHaveLength(14);
    expect(overview.health.subsystems.map((s) => s.key)).toEqual([
      "database",
      "redis",
      "inngest",
      "auth",
      "channels",
    ]);
    expect(overview.usersPage.items).toHaveLength(3);

    // Verify SQL GROUP BY daily series captured today's UTC metrics accurately
    const latestPoint = overview.dailySeries[overview.dailySeries.length - 1];
    expect(latestPoint?.newUsers).toBe(3);
    expect(latestPoint?.tasksCreated).toBe(1);
    expect(latestPoint?.tasksCompleted).toBe(1);
    expect(latestPoint?.habitLogs).toBe(1);

    // Verify health schema count reflects all 26 tables
    const dbSub = overview.health.subsystems.find((s) => s.key === "database");
    expect(
      dbSub?.details.some((d) => d.label === "Schema" && d.value.includes("26 tables"))
    ).toBe(true);

    // Verify section-scoped endpoints return accurate independent payloads
    const [summarySection, usersSection, timelineSection] = await Promise.all([
      service.getOverviewSummary(14),
      service.getUsersDirectorySection({ query: "jordan" }),
      service.getTimelineSection("user", 10),
    ]);
    expect(summarySection.kpis.users.total).toBe(3);
    expect(summarySection.dailySeries).toHaveLength(14);
    expect(usersSection.usersPage.total).toBe(1);
    expect(usersSection.usersPage.items[0]?.email).toBe("jordan@folio.test");
    expect(timelineSection.timeline.length).toBeGreaterThanOrEqual(3);

    // Search filter scopes directory accurately
    const filtered = await service.getOverview({ query: "jordan" });
    expect(filtered.usersPage.total).toBe(1);
    expect(filtered.usersPage.items[0]?.email).toBe("jordan@folio.test");
  });

  it("runs audited operational actions (outbox reconcile & expired sweep) and persists immutable audit logs", async () => {
    const outboxRes = await service.reconcileOutboxNow("u-admin");
    expect(outboxRes.reconciledCount).toBe(3);
    expect(mockReconcile).toHaveBeenCalledTimes(1);

    const sweepRes = await service.sweepExpiredRecordsNow("u-admin");
    expect(sweepRes.expiredProjectInvitations).toBe(1);
    expect(sweepRes.expiredHabitRequests).toBe(1);
    expect(sweepRes.prunedSessions).toBe(1);
    expect(sweepRes.prunedVerifications).toBe(1);

    const [invRow] = await conn.db
      .select({ status: projectInvitations.status })
      .from(projectInvitations)
      .where(eq(projectInvitations.id, "inv-expired"));
    expect(invRow?.status).toBe("expired");

    const auditRows = await conn.db.select().from(adminAuditLogs);
    const actions = auditRows.map((a) => a.action);
    expect(actions).toContain("admin.outbox_reconciled");
    expect(actions).toContain("admin.expired_swept");
  });

  it("enforces self/admin suspension guardrails, revokes sessions on suspend, and restores cleanly", async () => {
    // Self-suspension blocked
    await expect(
      service.setUserSuspension("u-admin", "u-admin", true)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Suspending another active admin blocked
    await expect(
      service.setUserSuspension("u-admin", "u-admin-2", true)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Self session revocation blocked
    await expect(
      service.revokeUserSessions("u-admin", "u-admin")
    ).rejects.toBeInstanceOf(ValidationError);

    // Suspending a regular member atomically sets isSuspended=true and revokes active sessions
    const suspended = await service.setUserSuspension(
      "u-admin",
      "u-member",
      true
    );
    expect(suspended.isSuspended).toBe(true);
    expect(suspended.revokedSessions).toBe(1);

    const remainingSessions = await conn.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, "u-member"));
    expect(remainingSessions).toHaveLength(0);

    // Restoring the member clears isSuspended and logs audit row
    const restored = await service.setUserSuspension(
      "u-admin",
      "u-member",
      false
    );
    expect(restored.isSuspended).toBe(false);

    const timeline = await repo.listPlatformTimeline("audit", 20);
    expect(timeline.some((e) => e.action === "admin.user_suspended")).toBe(true);
    expect(timeline.some((e) => e.action === "admin.user_unsuspended")).toBe(
      true
    );
  });
});
