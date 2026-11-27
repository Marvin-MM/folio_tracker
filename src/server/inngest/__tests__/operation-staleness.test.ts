import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { DrizzleOperationRepository } from "@/server/dal/operations";
import { DrizzleOperationsSocialRepository } from "@/server/dal/operations-social";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { operations, users } from "@/server/db/schema";
import {
  computeStaleCycleBucket,
  deliverStaleOperationNudge,
  dispatchStaleOperationsBatch,
  type StaleOperationAuditPayload,
} from "@/server/inngest/operation-staleness";
import type { AppDomainEvent, EventBus } from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";

class CapturingEventBus implements EventBus {
  readonly events: AppDomainEvent[] = [];
  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    if (Array.isArray(event)) this.events.push(...event);
    else this.events.push(event);
  }
}

class StubChannel implements NotificationChannel {
  readonly sent: NotificationPayload[] = [];
  constructor(
    readonly name: "in_app" | "web_push" | "email",
    private readonly shouldDeliver: boolean,
    private readonly onSend?: (payload: NotificationPayload) => Promise<void>
  ) {}

  async send(payload: NotificationPayload): Promise<NotificationDispatchResult> {
    this.sent.push(payload);
    if (this.onSend) {
      await this.onSend(payload);
    }
    return { channel: this.name, delivered: this.shouldDeliver };
  }
}

describe("Operation Staleness Audit Cron & Worker", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.parse("2026-11-27T07:00:00.000Z");

  let tempDir: string;
  let conn: DbConnection;
  let ownerId: string;
  let staleOpId: string;
  let freshOpId: string;
  let archivedStaleOpId: string;

  let opRepo: DrizzleOperationRepository;
  let socialRepo: DrizzleOperationsSocialRepository;
  let notifRepo: DrizzleNotificationRepository;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-ops-staleness-test-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    opRepo = new DrizzleOperationRepository(conn.db);
    socialRepo = new DrizzleOperationsSocialRepository(conn.db);
    notifRepo = new DrizzleNotificationRepository(conn.db);

    const [owner] = await conn.db
      .insert(users)
      .values({
        id: "01STALEOWNER00000000000001",
        name: "Stale Owner",
        email: "stale.owner@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();
    ownerId = owner!.id;

    const insertedOps = await conn.db
      .insert(operations)
      .values([
        {
          id: "01STALEOP00000000000000001",
          ownerId,
          slug: "stale-ssl-renewal",
          title: "SSL Certificate Renewal",
          summary: "Needs quarterly verification.",
          domain: "tech",
          reviewCycleDays: 90,
          lastVerifiedAt: nowMs - 100 * DAY_MS,
          isArchived: false,
          createdAt: nowMs - 120 * DAY_MS,
          updatedAt: nowMs - 100 * DAY_MS,
        },
        {
          id: "01FRESHOP00000000000000002",
          ownerId,
          slug: "fresh-backup-check",
          title: "Fresh Backup Check",
          summary: "Recently verified.",
          domain: "tech",
          reviewCycleDays: 90,
          lastVerifiedAt: nowMs - 10 * DAY_MS,
          isArchived: false,
          createdAt: nowMs - 60 * DAY_MS,
          updatedAt: nowMs - 10 * DAY_MS,
        },
        {
          id: "01ARCHOP000000000000000003",
          ownerId,
          slug: "archived-old-op",
          title: "Archived Legacy Procedure",
          summary: "Should never trigger nudges.",
          domain: "general",
          reviewCycleDays: 30,
          lastVerifiedAt: nowMs - 200 * DAY_MS,
          isArchived: true,
          createdAt: nowMs - 250 * DAY_MS,
          updatedAt: nowMs - 200 * DAY_MS,
        },
      ])
      .returning();

    staleOpId = insertedOps[0]!.id;
    freshOpId = insertedOps[1]!.id;
    archivedStaleOpId = insertedOps[2]!.id;
  });

  afterAll(async () => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("computes deterministic cycle buckets per review cycle", () => {
    const b1 = computeStaleCycleBucket({
      anchorMs: nowMs - 95 * DAY_MS,
      reviewCycleDays: 90,
      nowMs,
    });
    expect(b1).toEqual({ daysSinceVerified: 95, cycleBucket: 1 });

    const b2 = computeStaleCycleBucket({
      anchorMs: nowMs - 185 * DAY_MS,
      reviewCycleDays: 90,
      nowMs,
    });
    expect(b2).toEqual({ daysSinceVerified: 185, cycleBucket: 2 });
  });

  it("dispatches deterministic events only for stale non-archived operations and deduplicates worker delivery", async () => {
    const eventBus = new CapturingEventBus();
    const dispatch = await dispatchStaleOperationsBatch(
      { limit: 200, offset: 0, nowMs },
      { social: socialRepo, eventBus }
    );

    expect(dispatch.candidatesChecked).toBe(1);
    expect(dispatch.eventsEmitted).toBe(1);
    expect(eventBus.events).toHaveLength(1);

    const emitted = eventBus.events[0]!;
    expect(emitted.name).toBe("app/operation.stale_audit");
    expect(emitted.id).toBe(`op-stale-${staleOpId}-1`);
    expect(emitted.id).not.toContain(freshOpId);
    expect(emitted.id).not.toContain(archivedStaleOpId);

    const payload = emitted.data as StaleOperationAuditPayload;

    // 1. First worker delivery writes notification and falls back to email when push fails
    const inApp = new StubChannel("in_app", true, async (p) => {
      await notifRepo.create({
        userId: p.userId,
        type: p.type,
        title: p.title,
        body: p.body,
        entityType: p.entityType,
        entityId: p.entityId,
      });
    });
    const pushFailed = new StubChannel("web_push", false);
    const emailFallback = new StubChannel("email", true);

    const firstOutcome = await deliverStaleOperationNudge(payload, {
      operations: opRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: pushFailed,
      emailChannel: emailFallback,
      now: () => nowMs,
    });
    expect(firstOutcome.status).toBe("delivered");
    expect(inApp.sent).toHaveLength(1);
    expect(pushFailed.sent).toHaveLength(1);
    expect(emailFallback.sent).toHaveLength(1);

    // 2. Duplicate delivery for same cycle bucket is skipped immediately!
    const dupOutcome = await deliverStaleOperationNudge(payload, {
      operations: opRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: pushFailed,
      emailChannel: emailFallback,
      now: () => nowMs,
    });
    expect(dupOutcome.status).toBe("skipped_duplicate");
    expect(inApp.sent).toHaveLength(1);

    // 3. If owner marks operation verified before a later bucket fires, worker skips!
    await conn.db
      .update(operations)
      .set({ lastVerifiedAt: nowMs })
      .where(eq(operations.id, staleOpId));

    const nextCyclePayload: StaleOperationAuditPayload = {
      ...payload,
      cycleBucket: 2,
      dedupKey: `op-stale-${staleOpId}-2`,
    };
    const verifiedSkip = await deliverStaleOperationNudge(nextCyclePayload, {
      operations: opRepo,
      notifications: notifRepo,
      inAppChannel: inApp,
      webPushChannel: pushFailed,
      emailChannel: emailFallback,
      now: () => nowMs,
    });
    expect(verifiedSkip.status).toBe("skipped_verified_or_archived");
    expect(inApp.sent).toHaveLength(1);
  });
});
