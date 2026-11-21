import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import { EmailNotificationChannel } from "@/server/providers/channels/email-notification-channel";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { WebPushNotificationChannel } from "@/server/providers/channels/web-push-notification-channel";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";

export class NotificationService {
  private readonly repo: NotificationRepository;
  private readonly channels: NotificationChannel[];

  constructor(deps?: {
    repo?: NotificationRepository;
    channels?: NotificationChannel[];
  }) {
    this.repo = deps?.repo ?? notificationRepository;
    this.channels = deps?.channels ?? [
      new InAppNotificationChannel(this.repo),
      new WebPushNotificationChannel(this.repo),
      new EmailNotificationChannel(undefined, this.repo),
    ];
  }

  async dispatchAll(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult[]> {
    const settled = await Promise.allSettled(
      this.channels.map((channel) => channel.send(payload))
    );

    return settled.map((result, idx) => {
      const channelName = this.channels[idx]?.name ?? "unknown";
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        channel: channelName,
        delivered: false,
        detail:
          result.reason instanceof Error
            ? result.reason.message
            : "Channel delivery failed.",
      };
    });
  }

  async sendTestReminder(
    userId: string,
    timezone: string
  ): Promise<NotificationDispatchResult[]> {
    return this.dispatchAll({
      userId,
      type: "reminder.test",
      title: "Test reminder from Folio",
      body: "Your multi-channel notification pipeline is active and ready.",
      entityType: "task",
      entityId: "test-reminder",
      deepLink: "/app/settings/notifications",
      remindAt: Date.now(),
      timezone,
    });
  }
}

export const notificationService = new NotificationService();
