import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SafeMarkdown,
  sanitizeMarkdownUrl,
} from "@/components/operations/safe-markdown";
import { createDrizzleMembershipLookup } from "@/server/dal/auth-guard";
import {
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  NotFoundError,
  SecretScanBlockedError,
  SecretScanWarningAckRequiredError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { resolveOperationAccess } from "@/server/dal/operation-auth";
import { DrizzleOperationRepository } from "@/server/dal/operations";
import { DrizzleOperationsSocialRepository } from "@/server/dal/operations-social";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleReminderRepository } from "@/server/dal/reminder-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { DrizzleUserRepository } from "@/server/dal/user-repository";
import { DrizzleWorkspaceRepository } from "@/server/dal/workspace-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  operations,
  projectMembers,
  projects,
  userFollows,
  users,
} from "@/server/db/schema";
import { validatePublicHandle } from "@/server/domain/operations";
import type { AppDomainEvent, EventBus } from "@/server/providers/event-bus";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { OperationFlagService } from "@/server/services/operation-flag-service";
import { OperationRunService } from "@/server/services/operation-run-service";
import { OperationService } from "@/server/services/operation-service";
import { OperationShareService } from "@/server/services/operation-share-service";
import { OperationSocialService } from "@/server/services/operation-social-service";
import { ReminderService } from "@/server/services/reminder-service";
import { UserPreferencesService } from "@/server/services/user-preferences-service";

class CapturingEventBus implements EventBus {
  readonly events: AppDomainEvent[] = [];
  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    if (Array.isArray(event)) this.events.push(...event);
    else this.events.push(event);
  }
}

describe("Operations Phase 2 — RBAC, Secret Gate, XSS/DTO Isolation, Dual Invites, Forking & Follows", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string;
  let collaboratorId: string;
  let viewerId: string;
  let projectEditorId: string;
  let outsiderId: string;
  let externalUserId: string;
  let sharedProjectId: string;

  const nowMs = Date.parse("2026-11-27T12:00:00.000Z");

  let eventBus: CapturingEventBus;
  let opRepo: DrizzleOperationRepository;
  let socialRepo: DrizzleOperationsSocialRepository;
  let operationService: OperationService;
  let operationRunService: OperationRunService;
  let shareService: OperationShareService;
  let flagService: OperationFlagService;
  let socialService: OperationSocialService;
  let prefsService: UserPreferencesService;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-ops-phase2-test-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    eventBus = new CapturingEventBus();
    const rateLimiter = new InMemoryRateLimiter();
    opRepo = new DrizzleOperationRepository(conn.db);
    socialRepo = new DrizzleOperationsSocialRepository(conn.db);
    const habitRepo = new DrizzleHabitRepository(conn.db);
    const taskRepo = new DrizzleTaskRepository(conn.db);
    const projectRepo = new DrizzleProjectRepository(conn.db);
    const reminderRepo = new DrizzleReminderRepository(conn.db);
    const userRepo = new DrizzleUserRepository(conn.db);
    const workspaceRepo = new DrizzleWorkspaceRepository(conn.db);
    const membershipLookup = createDrizzleMembershipLookup(conn.db);
    const reminderService = new ReminderService({
      database: conn.db,
      reminders: reminderRepo,
      eventBus,
      now: () => nowMs,
    });

    operationService = new OperationService({
      database: conn.db,
      operations: opRepo,
      social: socialRepo,
      habits: habitRepo,
      tasks: taskRepo,
      projects: projectRepo,
      reminders: reminderRepo,
      users: userRepo,
      workspace: workspaceRepo,
      membershipLookup,
      reminderService,
      eventBus,
      rateLimiter,
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

    shareService = new OperationShareService({
      database: conn.db,
      social: socialRepo,
      users: userRepo,
      projects: projectRepo,
      eventBus,
      rateLimiter,
      now: () => nowMs,
    });

    flagService = new OperationFlagService({
      database: conn.db,
      social: socialRepo,
      users: userRepo,
      eventBus,
      rateLimiter,
      now: () => nowMs,
    });

    socialService = new OperationSocialService({
      database: conn.db,
      social: socialRepo,
      users: userRepo,
      now: () => nowMs,
    });

    prefsService = new UserPreferencesService(userRepo);

    const insertedUsers = await conn.db
      .insert(users)
      .values([
        {
          id: "01P2OWNER00000000000000001",
          name: "Alice Owner",
          email: "alice.owner@folio.test",
          emailVerified: true,
          timezone: "UTC",
          handle: "alice_ops",
          bio: "Systems & sourdough blueprints.",
        },
        {
          id: "01P2COLLAB0000000000000002",
          name: "Bob Collaborator",
          email: "bob.collab@folio.test",
          emailVerified: true,
          timezone: "UTC",
          handle: "bob_collab",
        },
        {
          id: "01P2VIEWER0000000000000003",
          name: "Carol Viewer",
          email: "carol.viewer@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01P2PROJED0000000000000004",
          name: "Dan ProjectEditor",
          email: "dan.project@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01P2OUTSID0000000000000005",
          name: "Eve Outsider",
          email: "eve.outsider@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          id: "01P2EXTERN0000000000000006",
          name: "Frank External",
          email: "frank.external@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();

    ownerId = insertedUsers[0]!.id;
    collaboratorId = insertedUsers[1]!.id;
    viewerId = insertedUsers[2]!.id;
    projectEditorId = insertedUsers[3]!.id;
    outsiderId = insertedUsers[4]!.id;
    externalUserId = insertedUsers[5]!.id;

    const [proj] = await conn.db
      .insert(projects)
      .values({
        ownerId,
        name: "Platform Ops Team",
        colorToken: "collab",
      })
      .returning();
    sharedProjectId = proj!.id;

    await conn.db.insert(projectMembers).values([
      { projectId: sharedProjectId, userId: ownerId, role: "owner" },
      { projectId: sharedProjectId, userId: projectEditorId, role: "editor" },
    ]);
  });

  afterAll(async () => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces strict RBAC across Owner, Collaborator, Viewer, Project opt-in, Outsider 404 isolation, and instant revocation", async () => {
    const created = await operationService.createOperation(ownerId, {
      title: "Private Database Failover Runbook",
      summary: "Internal step-by-step failover procedure.",
      domain: "tech",
      visibility: "private",
      allowForking: true,
      projectId: sharedProjectId,
      shareWithProject: false,
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "command",
          title: "Check replica lag",
          bodyMarkdown: "Verify replication lag is below 200ms.",
          codeBlock: { language: "bash", content: "pg_isready -h {{db_host}}" },
          timerSeconds: null,
          verificationCue: "Lag < 200ms",
          rollbackHint: null,
          branchHint: null,
        },
      ],
    });
    const opId = created.operation.id;

    // 1. Outsider and non-opted-in project member MUST get 404 NotFoundError (zero existence leak!)
    await expect(
      operationService.getOperationDetail(outsiderId, opId)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      operationService.getOperationDetail(projectEditorId, opId)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      operationRunService.startRun(outsiderId, opId)
    ).rejects.toBeInstanceOf(NotFoundError);

    // 2. Opt-in Project Team sharing grants Project Editor -> Collaborator immediately
    await operationService.updateProjectSharing(ownerId, opId, {
      projectId: sharedProjectId,
      shareWithProject: true,
    });
    const projAccess = await resolveOperationAccess(
      { operationId: opId, sessionUserId: projectEditorId },
      conn.db
    );
    expect(projAccess.role).toBe("collaborator");
    expect(projAccess.accessSource).toBe("project_inherited");

    // Toggling off immediately revokes access (ZERO Redis auth caching)
    await operationService.updateProjectSharing(ownerId, opId, {
      projectId: sharedProjectId,
      shareWithProject: false,
    });
    await expect(
      resolveOperationAccess(
        { operationId: opId, sessionUserId: projectEditorId },
        conn.db
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    // 3. Invite Bob as Collaborator and Carol as Viewer via Smart Dual Invite
    const collabInvite = await shareService.inviteByEmail(ownerId, opId, {
      email: "bob.collab@folio.test",
      role: "collaborator",
    });
    expect(collabInvite.message).toBe("Invitation sent.");
    expect(collabInvite.inviteUrl).toBeNull(); // Existing user -> in-app invite
    await shareService.acceptInAppInvitation(
      collaboratorId,
      collabInvite.invitationId!
    );

    const viewerInvite = await shareService.inviteQuickPickUser(ownerId, opId, {
      targetUserId: viewerId,
      role: "viewer",
    });
    await shareService.acceptInAppInvitation(viewerId, viewerInvite.invitationId!);

    // 4. Viewer capabilities: read, own run, flag step, fork PASS; edit/rollback/resolve/delete FORBIDDEN
    const viewerDetail = await operationService.getOperationDetail(viewerId, opId);
    expect(viewerDetail.access.role).toBe("viewer");
    expect(viewerDetail.access.capabilities.canEditSteps).toBe(false);
    expect(viewerDetail.openFlags).toHaveLength(0); // Maintainer-only flags

    const ownerRun = await operationRunService.startRun(ownerId, opId);
    const viewerRun = await operationRunService.startRun(viewerId, opId);
    expect(viewerRun.run.runnerId).toBe(viewerId);

    // Strict private run isolation: Viewer CANNOT read Owner's run
    await expect(
      operationRunService.getRunDetail(viewerId, ownerRun.run.id)
    ).rejects.toBeInstanceOf(NotFoundError);

    const flag = await flagService.flagStep(viewerId, opId, {
      stepKey: "s1",
      message: "pg_isready flag updated in PG 17",
    });
    expect(flag.status).toBe("open");

    await expect(
      operationService.publishNewVersion(viewerId, opId, {
        title: "Hacked by Viewer",
        domain: "tech",
        expectedEditVersion: created.operation.editVersion,
        steps: created.version.steps,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      flagService.resolveFlag(viewerId, opId, flag.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 5. Collaborator capabilities: edit steps, publish v2, rollback, resolve flags PASS
    const publishedV2 = await operationService.publishNewVersion(
      collaboratorId,
      opId,
      {
        title: "Private Database Failover Runbook",
        summary: "Updated by collaborator for PG 17.",
        domain: "tech",
        expectedEditVersion: created.operation.editVersion,
        steps: [
          {
            ...created.version.steps[0]!,
            title: "Check replica lag (PG 17)",
          },
        ],
        changeSummary: "PG 17 update",
      }
    );
    expect(publishedV2.operation.currentVersion).toBe(2);

    const resolvedFlag = await flagService.resolveFlag(
      collaboratorId,
      opId,
      flag.id
    );
    expect(resolvedFlag.status).toBe("resolved");

    const rolledBack = await operationService.rollbackToVersion(
      collaboratorId,
      opId,
      {
        targetVersionNumber: 1,
        expectedEditVersion: publishedV2.operation.editVersion,
      }
    );
    expect(rolledBack.operation.currentVersion).toBe(3);

    // Collaborator MUST NOT change visibility, rotate links, manage sharing, or delete
    await expect(
      operationService.updateVisibility(collaboratorId, opId, {
        visibility: "public",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      operationService.rotateUnlistedToken(collaboratorId, opId)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      shareService.inviteByEmail(collaboratorId, opId, {
        email: "eve.outsider@folio.test",
        role: "viewer",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      shareService.revokeMember(collaboratorId, opId, viewerId)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      operationService.deleteOperation(collaboratorId, opId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 6. Instant Member Revocation takes effect on next query with zero delay
    await shareService.revokeMember(ownerId, opId, collaboratorId);
    await expect(
      operationService.getOperationDetail(collaboratorId, opId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enforces Pre-Publish Secret Scanner hard blockers, soft warning acknowledgement, and Unlisted token rotation", async () => {
    const secretOp = await operationService.createOperation(ownerId, {
      title: "Secret Scan Gate Test",
      summary: "Starts private with a hardcoded credential.",
      domain: "tech",
      visibility: "private",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "command",
          title: "Connect to DB",
          bodyMarkdown: "Connect to staging.",
          codeBlock: {
            language: "bash",
            content:
              "psql postgres://admin:SuperSecretPass123!@db.internal:5432/app",
          },
          timerSeconds: null,
          verificationCue: null,
          rollbackHint: null,
          branchHint: null,
        },
      ],
    });

    // Hard blocker rejects BOTH Public and Unlisted, keeping DB visibility = private
    await expect(
      operationService.updateVisibility(ownerId, secretOp.operation.id, {
        visibility: "public",
      })
    ).rejects.toBeInstanceOf(SecretScanBlockedError);

    await expect(
      operationService.updateVisibility(ownerId, secretOp.operation.id, {
        visibility: "unlisted",
      })
    ).rejects.toBeInstanceOf(SecretScanBlockedError);

    const [stillPrivate] = await conn.db
      .select()
      .from(operations)
      .where(eq(operations.id, secretOp.operation.id));
    expect(stillPrivate?.visibility).toBe("private");

    // Replace hardcoded DB password with a Secret variable + RFC1918 IP (soft warning)
    const v2 = await operationService.publishNewVersion(
      ownerId,
      secretOp.operation.id,
      {
        title: "Secret Scan Gate Test",
        summary: "Uses secret variable plus internal RFC1918 example IP.",
        domain: "tech",
        visibility: "private",
        expectedEditVersion: secretOp.operation.editVersion,
        variables: [
          {
            key: "db_url",
            label: "Database URL",
            type: "secret",
            required: true,
          },
        ],
        steps: [
          {
            key: "s1",
            position: "a0",
            type: "command",
            title: "Connect safely",
            bodyMarkdown: "Ensure bastion 10.0.14.22 is reachable.",
            codeBlock: { language: "bash", content: "psql {{db_url}}" },
            timerSeconds: null,
            verificationCue: null,
            rollbackHint: null,
            branchHint: null,
          },
        ],
      }
    );
    expect(v2.operation.currentVersion).toBe(2);

    // Without acknowledgeWarnings: true -> SecretScanWarningAckRequiredError
    await expect(
      operationService.updateVisibility(ownerId, secretOp.operation.id, {
        visibility: "unlisted",
      })
    ).rejects.toBeInstanceOf(SecretScanWarningAckRequiredError);

    // With acknowledgeWarnings: true -> Unlisted succeeds and mints a raw token!
    const unlistedRes = await operationService.updateVisibility(
      ownerId,
      secretOp.operation.id,
      {
        visibility: "unlisted",
        acknowledgeWarnings: true,
      }
    );
    expect(unlistedRes.operation.visibility).toBe("unlisted");
    expect(unlistedRes.mintedUnlistedToken).toBeTruthy();
    const firstToken = unlistedRes.mintedUnlistedToken!;

    // Wrong or missing token -> 404 NotFoundError
    await expect(
      resolveOperationAccess(
        { slug: unlistedRes.operation.slug, sessionUserId: null },
        conn.db
      )
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      resolveOperationAccess(
        {
          slug: unlistedRes.operation.slug,
          sessionUserId: null,
          unlistedToken: "wrong-token-value",
        },
        conn.db
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    // Valid token -> Guest unlisted_visitor access granted!
    const guestAccess = await resolveOperationAccess(
      {
        slug: unlistedRes.operation.slug,
        sessionUserId: null,
        unlistedToken: firstToken,
      },
      conn.db
    );
    expect(guestAccess.role).toBe("unlisted_visitor");
    expect(guestAccess.capabilities.canRun).toBe(true);
    expect(guestAccess.capabilities.canSaveRun).toBe(false);

    // Rotate unlisted token -> old token immediately rejected, new token accepted!
    const rotated = await operationService.rotateUnlistedToken(
      ownerId,
      secretOp.operation.id
    );
    await expect(
      resolveOperationAccess(
        {
          slug: unlistedRes.operation.slug,
          sessionUserId: null,
          unlistedToken: firstToken,
        },
        conn.db
      )
    ).rejects.toBeInstanceOf(NotFoundError);
    const afterRotate = await resolveOperationAccess(
      {
        slug: unlistedRes.operation.slug,
        sessionUserId: null,
        unlistedToken: rotated.mintedUnlistedToken,
      },
      conn.db
    );
    expect(afterRotate.role).toBe("unlisted_visitor");
  });

  it("blocks XSS payloads in SafeMarkdown and strips all private fields from Public DTOs", async () => {
    expect(sanitizeMarkdownUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeMarkdownUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(sanitizeMarkdownUrl("//evil.example/payload.js")).toBe("");
    expect(sanitizeMarkdownUrl("https://docs.example.com/guide")).toBe(
      "https://docs.example.com/guide"
    );

    const maliciousMd = [
      "Hello <script>alert('xss')</script> world",
      `<img src="x" onerror="alert(1)" />`,
      "[Click XSS](javascript:alert(1))",
      "[Click Data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "[Safe Docs](https://docs.example.com/runbook)",
    ].join("\n\n");

    const rendered = renderToStaticMarkup(
      createElement(SafeMarkdown, { content: maliciousMd })
    );
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("onerror");
    expect(rendered).not.toContain("javascript:");
    expect(rendered).not.toContain("data:text/html");
    expect(rendered).toContain('href="https://docs.example.com/runbook"');
    expect(rendered).toContain('rel="noopener noreferrer"');

    // Publish one clean Public operation & verify Explore/Detail/Profile DTO isolation
    const pub = await operationService.createOperation(ownerId, {
      title: "Sunday Sourdough Boule",
      summary: "High-hydration naturally leavened boule.",
      domain: "cooking",
      visibility: "public",
      projectId: sharedProjectId,
      steps: [
        {
          key: "mix",
          position: "a0",
          type: "action",
          title: "Autolyse flour and water",
          bodyMarkdown: "Mix 500g flour with 375g water.",
          codeBlock: null,
          timerSeconds: 1800,
          verificationCue: "No dry flour spots remain.",
          rollbackHint: null,
          branchHint: null,
        },
      ],
    });

    const exploreCards = await socialRepo.listPublicExploreOperations({});
    // Only the public op is returned; private & unlisted ops are NEVER listed
    expect(exploreCards.map((c) => c.id)).toEqual([pub.operation.id]);

    const publicDetail = await socialRepo.getPublicOperationBySlug(
      pub.operation.slug
    );
    expect(publicDetail).not.toBeNull();

    const serializedDetail = JSON.stringify(publicDetail);
    expect(serializedDetail).not.toContain("alice.owner@folio.test");
    expect(serializedDetail).not.toContain("unlistedTokenHash");
    expect(serializedDetail).not.toContain("projectId");
    expect(serializedDetail).not.toContain("linkedHabitId");
    expect(serializedDetail).not.toContain("openFlags");

    const profile = await socialRepo.getPublicCreatorProfileByHandle("alice_ops");
    expect(profile).not.toBeNull();
    expect(profile?.operations.map((o) => o.id)).toEqual([pub.operation.id]);
    expect(JSON.stringify(profile)).not.toContain("alice.owner@folio.test");
  });

  it("handles Dual Invite concurrency atomically, Forking attribution on delete, and self-follow prevention", async () => {
    const source = await operationService.createOperation(ownerId, {
      title: "Pool Threshold Swim Set",
      summary: "1500m aerobic threshold drill.",
      domain: "fitness",
      visibility: "public",
      allowForking: true,
      steps: [
        {
          key: "warmup",
          position: "a0",
          type: "action",
          title: "300m easy warmup",
          bodyMarkdown: "Focus on smooth bilateral breathing.",
          codeBlock: null,
          timerSeconds: 300,
          verificationCue: null,
          rollbackHint: null,
          branchHint: null,
        },
      ],
    });

    // 1. Dual Invite concurrency: parallel accepts yield strictly 1 winner + 1 ConflictError
    const inAppInv = await shareService.inviteByEmail(ownerId, source.operation.id, {
      email: "eve.outsider@folio.test",
      role: "viewer",
    });
    expect(inAppInv.message).toBe("Invitation sent.");
    expect(inAppInv.inviteUrl).toBeNull();

    const [r1, r2] = await Promise.allSettled([
      shareService.acceptInAppInvitation(outsiderId, inAppInv.invitationId!),
      shareService.acceptInAppInvitation(outsiderId, inAppInv.invitationId!),
    ]);
    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );

    // 2. External non-user email invite mints 7-day token link + enforces email match
    const extInv = await shareService.inviteByEmail(ownerId, source.operation.id, {
      email: "brand.new.user@external.example",
      role: "viewer",
    });
    expect(extInv.message).toBe("Invitation sent."); // Anti-enumeration uniform message
    expect(extInv.inviteUrl).toContain("/invite/operation/");
    const rawToken = extInv.inviteUrl!.split("/invite/operation/")[1]!;

    // Wrong account email throws EmailMismatchError
    await expect(
      shareService.acceptTokenInvitation(externalUserId, rawToken)
    ).rejects.toBeInstanceOf(EmailMismatchError);

    // 3. Attributed Forking + atomic forkCount increment + survives source deletion
    const forkedRes = await operationService.forkOperation(
      viewerId,
      source.operation.id
    );
    expect(forkedRes.forked.ownerId).toBe(viewerId);
    expect(forkedRes.forked.visibility).toBe("private");
    expect(forkedRes.forked.forkedFromId).toBe(source.operation.id);
    expect(forkedRes.newForkCount).toBe(1);

    await operationService.deleteOperation(ownerId, source.operation.id);
    const survivingFork = await opRepo.getById(forkedRes.forked.id);
    expect(survivingFork).not.toBeNull();
    expect(survivingFork?.forkedFromId).toBeNull(); // ON DELETE SET NULL

    // 4. Follow Graph + Self-Follow Prevention (service AND SQLite CHECK constraint)
    await expect(
      socialService.followCreator(ownerId, ownerId)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      conn.db.insert(userFollows).values({
        followerId: ownerId,
        followingId: ownerId,
        createdAt: nowMs,
      })
    ).rejects.toThrow();

    const followRes = await socialService.followCreator(viewerId, ownerId);
    expect(followRes.following).toBe(true);
    expect(followRes.followerCount).toBe(1);

    const unfollowRes = await socialService.unfollowCreator(viewerId, ownerId);
    expect(unfollowRes.following).toBe(false);
    expect(unfollowRes.followerCount).toBe(0);

    // 5. Public handle validation & reserved words
    expect(validatePublicHandle("admin").ok).toBe(false);
    expect(validatePublicHandle("explore").ok).toBe(false);
    expect(validatePublicHandle("ab").ok).toBe(false);
    expect(validatePublicHandle("@Chef_Kira-9").ok).toBe(true);
    const updatedPrefs = await prefsService.updatePreferences(viewerId, {
      name: "Carol Viewer",
      timezone: "UTC",
      emailRemindersEnabled: true,
      handle: "carol_runs",
      bio: "Testing checklists.",
    });
    expect(updatedPrefs.handle).toBe("carol_runs");
    expect(updatedPrefs.bio).toBe("Testing checklists.");
  });
});
