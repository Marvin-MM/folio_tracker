import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import {
  defaultUnreadCounterCache,
  type UnreadCounterCache,
} from "@/server/providers/redis/unread-counter-cache";

export class InAppNotificationChannel implements NotificationChannel {
  readonly name = "in_app";

  constructor(
    private readonly repo: NotificationRepository = notificationRepository,
    private readonly unreadCache: UnreadCounterCache = defaultUnreadCounterCache
  ) {}

  async send(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult> {
    const created = await this.repo.create({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      entityType: payload.entityType,
      entityId: payload.reminderId
        ? `${payload.entityId}::${payload.reminderId}`
        : payload.entityId,
    });

    await this.unreadCache.increment(payload.userId, 1);

    return {
      channel: this.name,
      delivered: true,
      detail: created.id,
    };
  }
}
