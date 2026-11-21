import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  WebPushNotificationChannel,
  type PushTransport,
} from "@/server/providers/channels/web-push-notification-channel";

describe("WebPushNotificationChannel — 404/410 automatic subscription pruning", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userId: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-push-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [createdUser] = await conn.db
      .insert(users)
      .values({
        name: "Push Tester",
        email: "push@folio.test",
        emailVerified: true,
      })
      .returning();
    userId = createdUser!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("sends to all subscriptions via Promise.allSettled and immediately deletes 410 Gone and 404 endpoints", async () => {
    const repo = new DrizzleNotificationRepository(conn.db);

    const healthyEndpoint = "https://push.example.test/healthy";
    const goneEndpoint = "https://push.example.test/expired-410";
    const missingEndpoint = "https://push.example.test/missing-404";
    const transientFailEndpoint = "https://push.example.test/server-500";

    for (const endpoint of [
      healthyEndpoint,
      goneEndpoint,
      missingEndpoint,
      transientFailEndpoint,
    ]) {
      await repo.upsertPushSubscription({
        userId,
        endpoint,
        p256dh: "p256dh-test-key",
        auth: "auth-test-key",
        userAgent: "Vitest",
      });
    }

    const mockTransport: PushTransport = {
      isConfigured: () => true,
      async send(subscription) {
        if (subscription.endpoint === goneEndpoint) {
          throw Object.assign(new Error("Subscription expired"), {
            statusCode: 410,
          });
        }
        if (subscription.endpoint === missingEndpoint) {
          throw Object.assign(new Error("Endpoint not found"), {
            statusCode: 404,
          });
        }
        if (subscription.endpoint === transientFailEndpoint) {
          throw Object.assign(new Error("Upstream 500"), { statusCode: 500 });
        }
      },
    };

    const channel = new WebPushNotificationChannel(repo, mockTransport);
    const result = await channel.send({
      userId,
      type: "reminder.due",
      title: "Pay Umeme bill",
      body: "Due at 09:00",
      entityType: "task",
      entityId: "task-1",
      reminderId: "rem-1",
      deepLink: "/app/inbox?item=task-1",
    });

    expect(result.delivered).toBe(true);
    expect(result.removedEndpoints).toEqual(
      expect.arrayContaining([goneEndpoint, missingEndpoint])
    );
    expect(result.removedEndpoints).toHaveLength(2);

    // Remaining rows in SQLite must contain healthy + transient 500 only (410 & 404 deleted)
    const remaining = await repo.listPushSubscriptionsForUser(userId);
    const remainingEndpoints = remaining.map((r) => r.endpoint);
    expect(remainingEndpoints).toContain(healthyEndpoint);
    expect(remainingEndpoints).toContain(transientFailEndpoint);
    expect(remainingEndpoints).not.toContain(goneEndpoint);
    expect(remainingEndpoints).not.toContain(missingEndpoint);
  });
});
