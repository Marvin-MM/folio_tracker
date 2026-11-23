import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CommentWindowClosedError,
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import {
  DrizzleHabitMonitorReadDal,
  DrizzleHabitSocialRepository,
} from "@/server/dal/habits-social";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitMonitorRequests,
  habitWeeklySnapshots,
  notifications,
  users,
} from "@/server/db/schema";
import {
  dispatchHabitReviewDigestBatch,
  executeHabitReviewDigestDelivery,
} from "@/server/inngest/habit-review-digest";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";
import {
  HabitCommentService,
  HabitReactionService,
} from "@/server/services/habit-comment-service";
import { HabitMonitorService } from "@/server/services/habit-monitor-service";
import { HabitService } from "@/server/services/habit-service";

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

describe("Habits Phase B — Accountability Circle, Policy Enforcement, Isolation & Concurrency", () => {
  let tempDir: string;
  let conn: DbConnection;

  let ownerId: string; // Alice (Africa/Kampala)
  let monitorAId: string; // Bob (global inherit, selected scope)
  let monitorBId: string; // Clara (custom override)
  let intruderId: string; // Dan (non-monitor)

  let habitRepo: DrizzleHabitRepository;
  let socialRepo: DrizzleHabitSocialRepository;
  let readDal: DrizzleHabitMonitorReadDal;
  let notifRepo: DrizzleNotificationRepository;
  let habitSvc: HabitService;
  let bus: InMemoryEventBus;

  // Wednesday Nov 18 2026 12:00 UTC (15:00 EAT) -> Global Sat-Sun window is LOCKED
  const WED_LOCKED_NOW = Date.parse("2026-11-18T12:00:00.000Z");
  // Saturday Nov 21 2026 00:20 EAT = 2026-11-20T21:20:00Z -> Global Sat-Sun window JUST OPENED
  const SAT_OPEN_NOW = Date.parse("2026-11-20T21:20:00.000Z");

  let currentNowMs = WED_LOCKED_NOW;
  const clock = () => currentNowMs;

  let monitorSvc: HabitMonitorService;
  let commentSvc: HabitCommentService;
  let reactionSvc: HabitReactionService;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-habits-social-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [alice, bob, clara, dan] = await conn.db
      .insert(users)
      .values([
        {
          name: "Alice Owner",
          email: "alice-circle@folio.test",
          emailVerified: true,
          timezone: "Africa/Kampala",
        },
        {
          name: "Bob Monitor",
          email: "bob-circle@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Clara Custom",
          email: "clara-circle@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Dan Intruder",
          email: "dan-circle@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();

    ownerId = alice!.id;
    monitorAId = bob!.id;
    monitorBId = clara!.id;
    intruderId = dan!.id;

    habitRepo = new DrizzleHabitRepository(conn.db);
    socialRepo = new DrizzleHabitSocialRepository(conn.db);
    readDal = new DrizzleHabitMonitorReadDal(socialRepo, habitRepo);
    notifRepo = new DrizzleNotificationRepository(conn.db);
    bus = new InMemoryEventBus();

    habitSvc = new HabitService({
      database: conn.db,
      habits: habitRepo,
      tasks: new DrizzleTaskRepository(conn.db),
      projects: new DrizzleProjectRepository(conn.db),
      now: clock,
    });

    monitorSvc = new HabitMonitorService({
      database: conn.db,
      social: socialRepo,
      habits: habitRepo,
      rateLimiter: new InMemoryRateLimiter(),
      eventBus: bus,
      now: clock,
    });

    commentSvc = new HabitCommentService({
      database: conn.db,
      social: socialRepo,
      habits: habitRepo,
      eventBus: bus,
      now: clock,
    });

    reactionSvc = new HabitReactionService({
      database: conn.db,
      social: socialRepo,
      habits: habitRepo,
      now: clock,
    });
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("routes dual invites without email enumeration, enforces verified-email & expiry, and prevents concurrent double-accept", async () => {
    currentNowMs = WED_LOCKED_NOW;
    bus.clear();

    // 1. Existing user email -> creates in-app request (`targetUserId` populated, `tokenHash = null`)
    const existingRes = await monitorSvc.inviteByEmail(ownerId, {
      email: "BOB-CIRCLE@folio.test",
      scope: "all",
    });
    expect(existingRes.message).toBe(
      "Monitor invitation sent to bob-circle@folio.test"
    );

    const [bobReqRow] = await conn.db
      .select()
      .from(habitMonitorRequests)
      .where(eq(habitMonitorRequests.id, existingRes.requestId));
    expect(bobReqRow?.targetUserId).toBe(monitorAId);
    expect(bobReqRow?.tokenHash).toBeNull();
    expect(
      bus.events.some(
        (e) =>
          e.name === "app/habit.monitor_requested" &&
          e.data.targetUserId === monitorAId
      )
    ).toBe(true);

    // 2. External non-user email -> stores ONLY SHA-256 hash (`targetUserId = null`), returns identical neutral message
    bus.clear();
    const externalRes = await monitorSvc.inviteByEmail(ownerId, {
      email: "external-friend@example.com",
      scope: "all",
    });
    expect(externalRes.message).toBe(
      "Monitor invitation sent to external-friend@example.com"
    );

    const [extReqRow] = await conn.db
      .select()
      .from(habitMonitorRequests)
      .where(eq(habitMonitorRequests.id, externalRes.requestId));
    expect(extReqRow?.targetUserId).toBeNull();
    expect(extReqRow?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const inviteEvt = bus.events.find(
      (e) => e.name === "app/habit.monitor_invited"
    );
    expect(inviteEvt).toBeDefined();
    if (!inviteEvt || inviteEvt.name !== "app/habit.monitor_invited") {
      throw new Error("Expected monitor_invited event");
    }
    const rawToken = inviteEvt.data.inviteUrl.split("/invite/habit/")[1]!;
    expect(rawToken).toBeTruthy();
    expect(extReqRow?.tokenHash).not.toBe(rawToken); // Never stored plaintext!

    // Mismatched email rejected with EmailMismatchError
    await expect(
      monitorSvc.acceptTokenInvite(rawToken, {
        id: intruderId,
        email: "dan-circle@folio.test",
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(EmailMismatchError);

    // Expired token rejected with ValidationError
    currentNowMs = WED_LOCKED_NOW + 8 * 24 * 60 * 60 * 1000;
    const [extUser] = await conn.db
      .insert(users)
      .values({
        name: "External Friend",
        email: "external-friend@example.com",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();

    await expect(
      monitorSvc.acceptTokenInvite(rawToken, {
        id: extUser!.id,
        email: "external-friend@example.com",
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);

    // Reset clock & test atomic concurrent double-accept race on Bob's in-app request
    currentNowMs = WED_LOCKED_NOW;
    const outcomes = await Promise.allSettled([
      monitorSvc.acceptInAppRequest(existingRes.requestId, {
        id: monitorAId,
        email: "bob-circle@folio.test",
        emailVerified: true,
      }),
      monitorSvc.acceptInAppRequest(existingRes.requestId, {
        id: monitorAId,
        email: "bob-circle@folio.test",
        emailVerified: true,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );

    // Verify rate limiter blocks excessive monitor invite creation
    const tightMonitorSvc = new HabitMonitorService({
      database: conn.db,
      social: socialRepo,
      habits: habitRepo,
      rateLimiter: new InMemoryRateLimiter({
        policies: {
          habit_monitor_invite: {
            maxRequests: 1,
            windowMs: 60_000,
            upstashWindow: "1 m",
          },
        },
      }),
      eventBus: bus,
      now: clock,
    });

    await tightMonitorSvc.inviteByEmail(ownerId, {
      email: "rl-first@example.com",
      scope: "all",
    });
    await expect(
      tightMonitorSvc.inviteByEmail(ownerId, {
        email: "rl-second@example.com",
        scope: "all",
      })
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("enforces strict selective-scope zero-leak projection, server-side window lock, global vs custom override, and instant revocation", async () => {
    currentNowMs = WED_LOCKED_NOW;

    // Seed 5 habits for Alice (2 shared with Bob, 3 strictly private)
    const h1 = await habitSvc.createHabit(ownerId, "Africa/Kampala", {
      title: "Shared Habit 1",
      startDate: "2026-11-15",
    });
    const h2 = await habitSvc.createHabit(ownerId, "Africa/Kampala", {
      title: "Shared Habit 2",
      startDate: "2026-11-15",
    });
    const hPrivate1 = await habitSvc.createHabit(ownerId, "Africa/Kampala", {
      title: "Secret Private Habit 1",
      startDate: "2026-11-15",
    });
    const hPrivate2 = await habitSvc.createHabit(ownerId, "Africa/Kampala", {
      title: "Secret Private Habit 2",
      startDate: "2026-11-15",
    });
    const hPrivate3 = await habitSvc.createHabit(ownerId, "Africa/Kampala", {
      title: "Secret Private Habit 3",
      startDate: "2026-11-15",
    });

    // Complete shared habits 100% on Nov 15..18 (8/8), leave all 3 private habits 0% (missed) with private notes!
    for (const dateKey of [
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]) {
      await habitSvc.logHabitDay(ownerId, "Africa/Kampala", {
        habitId: h1.id,
        dateKey,
        status: "done",
        note: "Shared note",
      });
      await habitSvc.logHabitDay(ownerId, "Africa/Kampala", {
        habitId: h2.id,
        dateKey,
        status: "done",
      });
      await habitSvc.logHabitDay(ownerId, "Africa/Kampala", {
        habitId: hPrivate1.id,
        dateKey,
        status: "missed",
        note: "TOP SECRET JOURNAL",
      });
    }

    // Configure Bob's monitor row to scope = 'selected' (ONLY h1 & h2), inheriting global Sat-Sun window
    const bobMonitor = await socialRepo.getActiveMonitor(ownerId, monitorAId);
    expect(bobMonitor).not.toBeNull();
    await monitorSvc.updateMonitorConfiguration(ownerId, bobMonitor!.id, {
      scope: "selected",
      selectedHabitIds: [h1.id, h2.id],
      customPolicy: { useCustomPolicy: false },
    });

    // Invite & accept Clara with custom policy = 'anytime' on all habits
    const claraReq = await monitorSvc.inviteByEmail(ownerId, {
      email: "clara-circle@folio.test",
      scope: "all",
      customPolicy: {
        useCustomPolicy: true,
        customCommentMode: "anytime",
        customAllowReactionsWhenLocked: true,
      },
    });
    await monitorSvc.acceptInAppRequest(claraReq.requestId, {
      id: monitorBId,
      email: "clara-circle@folio.test",
      emailVerified: true,
    });

    // Owner posts a comment anchored to a PRIVATE habit (must NEVER leak to Bob!)
    await commentSvc.createComment(ownerId, {
      ownerId,
      cycleKey: "2026-W47",
      targetHabitId: hPrivate1.id,
      body: "Private note on unshared habit",
    });

    // Owner posts a general cycle comment (SHOULD be visible to Bob)
    await commentSvc.createComment(ownerId, {
      ownerId,
      cycleKey: "2026-W47",
      body: "General week 47 reflection",
    });

    // Verify Bob's scoped read workspace: ZERO leak of hPrivate1..3!
    const bobView = await readDal.getScopedFriendWorkspace({
      viewerUserId: monitorAId,
      ownerId,
      yearMonth: "2026-11",
      scoringMode: "elapsed",
      selectedCycleKey: "2026-W47",
      nowMs: WED_LOCKED_NOW,
    });

    expect(bobView.habits.map((h) => h.id).sort()).toEqual(
      [h1.id, h2.id].sort()
    );
    expect(bobView.habits.some((h) => h.id === hPrivate1.id)).toBe(false);
    expect(bobView.habits.some((h) => h.id === hPrivate2.id)).toBe(false);
    expect(bobView.habits.some((h) => h.id === hPrivate3.id)).toBe(false);
    // Scoped KPI must be 100% (8/8) — unshared 0% habits did NOT drag down KPI!
    expect(bobView.analytics.monthlyProgress.rate).toBe(1);
    expect(bobView.analytics.monthlyProgress.completedUnits).toBe(8);
    expect(bobView.analytics.monthlyProgress.targetUnits).toBe(8);
    expect(
      Object.values(bobView.logsByKey).some((l) =>
        l.note?.includes("TOP SECRET")
      )
    ).toBe(false);
    // Unshared-habit comment filtered out; general comment visible
    expect(bobView.comments.map((c) => c.body)).toEqual([
      "General week 47 reflection",
    ]);

    // Wednesday (locked for global Sat-Sun):
    // Bob (inherits global) -> blocked with CommentWindowClosedError (403)!
    await expect(
      commentSvc.createComment(monitorAId, {
        ownerId,
        body: "Trying to bypass lock on Wednesday",
      })
    ).rejects.toBeInstanceOf(CommentWindowClosedError);

    // Clara (custom override = 'anytime') -> SUCCEEDS on Wednesday!
    const claraComment = await commentSvc.createComment(monitorBId, {
      ownerId,
      body: "Clara custom anytime check-in!",
    });
    expect(claraComment.authorId).toBe(monitorBId);

    // Owner can ALWAYS reply even while global window is locked
    const ownerReply = await commentSvc.createComment(ownerId, {
      ownerId,
      parentCommentId: claraComment.id,
      body: "Thanks Clara — staying consistent!",
    });
    expect(ownerReply.parentCommentId).toBe(claraComment.id);

    // Bob reaction while locked: allowed when allowReactionsWhenLocked = true
    const reactToggle1 = await reactionSvc.toggleReaction(monitorAId, {
      ownerId,
      cycleKey: "2026-W47",
      reactionType: "solid",
    });
    expect(reactToggle1.active).toBe(true);

    // Owner updates global settings -> allowReactionsWhenLocked = false -> Bob reaction now blocked!
    await habitSvc.updateSettings(ownerId, { allowReactionsWhenLocked: false });
    await expect(
      reactionSvc.toggleReaction(monitorAId, {
        ownerId,
        cycleKey: "2026-W47",
        reactionType: "ack",
      })
    ).rejects.toBeInstanceOf(CommentWindowClosedError);

    // Move clock to Saturday 00:20 EAT (global window OPEN) and complete Nov 19..21 on shared habits
    currentNowMs = SAT_OPEN_NOW;
    for (const dateKey of ["2026-11-19", "2026-11-20", "2026-11-21"]) {
      await habitSvc.logHabitDay(ownerId, "Africa/Kampala", {
        habitId: h1.id,
        dateKey,
        status: "done",
      });
      await habitSvc.logHabitDay(ownerId, "Africa/Kampala", {
        habitId: h2.id,
        dateKey,
        status: "done",
      });
    }

    // Bob CANNOT comment on an unshared targetHabitId even when window is open!
    await expect(
      commentSvc.createComment(monitorAId, {
        ownerId,
        targetHabitId: hPrivate1.id,
        body: "Attempting IDOR targetHabitId",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Bob CAN comment on a shared habit while window is open
    const bobComment = await commentSvc.createComment(monitorAId, {
      ownerId,
      targetHabitId: h1.id,
      body: "Great consistency on Shared Habit 1!",
    });
    expect(bobComment.cycleKey).toBe("2026-W47");

    // Non-monitor Dan rejected everywhere with ForbiddenError
    await expect(
      readDal.getScopedFriendWorkspace({
        viewerUserId: intruderId,
        ownerId,
        nowMs: SAT_OPEN_NOW,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      commentSvc.createComment(intruderId, { ownerId, body: "Intruder comment" })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reactionSvc.toggleReaction(intruderId, {
        ownerId,
        cycleKey: "2026-W47",
        reactionType: "ack",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Monitor CANNOT mutate owner's habits or habit logs
    await expect(
      habitSvc.logHabitDay(monitorAId, "Africa/Kampala", {
        habitId: h1.id,
        dateKey: "2026-11-18",
        status: "missed",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      habitSvc.updateHabit(monitorAId, h1.id, { title: "Tampered" })
    ).rejects.toBeInstanceOf(NotFoundError);

    // Automated Inngest Review Digest: Saturday 00:20 EAT -> Bob's Sat-Sun window JUST opened!
    bus.clear();
    const batch = await dispatchHabitReviewDigestBatch(
      { limit: 200, offset: 0, nowMs: SAT_OPEN_NOW },
      { social: socialRepo, eventBus: bus }
    );
    expect(batch.eventsEmitted).toBeGreaterThanOrEqual(1);

    const bobDigestEvt = bus.events.find(
      (e) =>
        e.name === "app/habit.review_digest" &&
        e.data.monitorUserId === monitorAId
    );
    expect(bobDigestEvt).toBeDefined();
    if (!bobDigestEvt || bobDigestEvt.name !== "app/habit.review_digest") {
      throw new Error("Expected bob digest event");
    }

    const inApp = new InAppNotificationChannel(
      notifRepo,
      new InMemoryUnreadCounterCache()
    );
    const pushSpy = new SpyChannel("web_push");
    const emailSpy = new SpyChannel("email");

    const digest1 = await executeHabitReviewDigestDelivery(bobDigestEvt.data, {
      social: socialRepo,
      habits: habitRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: pushSpy,
      emailChannel: emailSpy,
      now: clock,
    });
    expect(digest1.status).toBe("delivered");
    // Scoped digest % for Bob must reflect ONLY his 2 shared habits (100% on completed days), NOT unshared 0% habits!
    if (digest1.status === "delivered") {
      expect(digest1.scopedPct).toBe(100);
    }
    expect(pushSpy.sent).toHaveLength(1);
    expect(pushSpy.sent[0]?.deepLink).toBe(`/app/habits/circle/${ownerId}`);
    expect(emailSpy.sent).toHaveLength(1);

    // Verify habit_weekly_snapshots row created
    const snapshots = await conn.db
      .select()
      .from(habitWeeklySnapshots)
      .where(eq(habitWeeklySnapshots.ownerId, ownerId));
    expect(snapshots).toHaveLength(1);

    // Duplicate delivery with same dedupKey MUST be skipped
    const digest2 = await executeHabitReviewDigestDelivery(bobDigestEvt.data, {
      social: socialRepo,
      habits: habitRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: pushSpy,
      emailChannel: emailSpy,
      now: clock,
    });
    expect(digest2.status).toBe("skipped_duplicate");
    expect(pushSpy.sent).toHaveLength(1);

    const savedDigestNotifs = await conn.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, bobDigestEvt.data.dedupKey));
    expect(savedDigestNotifs).toHaveLength(1);

    // Instant Revocation: revoking Bob cuts off read, comment, and reaction access immediately!
    await monitorSvc.revokeMonitor(ownerId, bobMonitor!.id);

    await expect(
      readDal.getScopedFriendWorkspace({
        viewerUserId: monitorAId,
        ownerId,
        nowMs: SAT_OPEN_NOW,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      commentSvc.createComment(monitorAId, {
        ownerId,
        body: "Post-revocation attempt",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reactionSvc.toggleReaction(monitorAId, {
        ownerId,
        cycleKey: "2026-W47",
        reactionType: "push",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Revoked monitor also skipped by digest worker
    const revokedDigest = await executeHabitReviewDigestDelivery(
      { ...bobDigestEvt.data, dedupKey: `${bobDigestEvt.data.dedupKey}-post-revoke` },
      {
        social: socialRepo,
        habits: habitRepo,
        notifications: notifRepo,
        inAppChannel: inApp,
        webPushChannel: pushSpy,
        emailChannel: emailSpy,
        now: clock,
      }
    );
    expect(revokedDigest.status).toBe("skipped_revoked_or_missing");
  });
});
