import { and, count, desc, eq } from "drizzle-orm";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notifications,
  pushSubscriptions,
  type NotificationRecord,
  type PushSubscriptionRecord,
} from "@/server/db/schema";

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface UpsertPushSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

export interface NotificationRepository {
  create(
    input: CreateNotificationInput,
    executor?: DbExecutor
  ): Promise<NotificationRecord>;
  listRecentForUser(
    userId: string,
    limit?: number
  ): Promise<NotificationRecord[]>;
  countUnreadForUser(userId: string): Promise<number>;
  hasNotificationForEntity(
    userId: string,
    type: string,
    entityId: string
  ): Promise<boolean>;
  markRead(userId: string, notificationId: string): Promise<boolean>;
  markAllRead(userId: string): Promise<number>;
  upsertPushSubscription(
    input: UpsertPushSubscriptionInput
  ): Promise<PushSubscriptionRecord>;
  listPushSubscriptionsForUser(
    userId: string
  ): Promise<PushSubscriptionRecord[]>;
  countPushSubscriptionsForUser(userId: string): Promise<number>;
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<void>;
  deletePushSubscriptionForUser(
    userId: string,
    endpoint: string
  ): Promise<void>;
}

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async create(
    input: CreateNotificationInput,
    executor: DbExecutor = this.database
  ): Promise<NotificationRecord> {
    const [created] = await executor
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        isRead: false,
        createdAt: Date.now(),
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert notification record.");
    }
    return created;
  }

  async listRecentForUser(
    userId: string,
    limit = 20
  ): Promise<NotificationRecord[]> {
    return this.database
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      );

    return row?.value ?? 0;
  }

  async hasNotificationForEntity(
    userId: string,
    type: string,
    entityId: string
  ): Promise<boolean> {
    const [row] = await this.database
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, type),
          eq(notifications.entityId, entityId)
        )
      )
      .limit(1);

    return Boolean(row);
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const updated = await this.database
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )
      .returning({ id: notifications.id });

    return updated.length > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.database
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      )
      .returning({ id: notifications.id });

    return updated.length;
  }

  /**
   * Atomic SQLite UPSERT on unique `endpoint`: reassigns `userId` to the
   * currently authenticated user on shared devices with zero TOCTOU race.
   */
  async upsertPushSubscription(
    input: UpsertPushSubscriptionInput
  ): Promise<PushSubscriptionRecord> {
    return withDbRetry(async () => {
      const now = Date.now();
      const [upserted] = await this.database
        .insert(pushSubscriptions)
        .values({
          userId: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: input.userId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
          },
        })
        .returning();

      if (!upserted) {
        throw new Error("Failed to persist push subscription.");
      }
      return upserted;
    });
  }

  async listPushSubscriptionsForUser(
    userId: string
  ): Promise<PushSubscriptionRecord[]> {
    return this.database
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt));
  }

  async countPushSubscriptionsForUser(userId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    return row?.value ?? 0;
  }

  async deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
    await this.database
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async deletePushSubscriptionForUser(
    userId: string,
    endpoint: string
  ): Promise<void> {
    await this.database
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint)
        )
      );
  }
}

export const notificationRepository: NotificationRepository =
  new DrizzleNotificationRepository(db);
