import {
  INNGEST_CONCURRENCY_LIMIT,
  inngest,
} from "@/server/inngest/client";
import { testReminderEvent } from "@/server/inngest/events";
import { EmailNotificationChannel } from "@/server/providers/channels/email-notification-channel";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { WebPushNotificationChannel } from "@/server/providers/channels/web-push-notification-channel";
import type { NotificationPayload } from "@/server/providers/notification-channel";

const inAppChannel = new InAppNotificationChannel();
const webPushChannel = new WebPushNotificationChannel();
const emailChannel = new EmailNotificationChannel();

export const sendTestReminderFn = inngest.createFunction(
  {
    id: "send-test-reminder",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    triggers: [testReminderEvent],
  },
  async ({ event, step }) => {
    const payload: NotificationPayload = {
      userId: event.data.userId,
      type: "reminder.test",
      title: "Test reminder from Folio",
      body: "Durable multi-channel reminder delivery is active.",
      entityType: "task",
      entityId: "test-reminder",
      deepLink: "/app/settings/notifications",
      remindAt: Date.now(),
      timezone: event.data.timezone,
    };

    const inApp = await step.run("test-in-app", () =>
      inAppChannel.send(payload)
    );
    const push = await step.run("test-web-push", () =>
      webPushChannel.send(payload)
    );
    const email = await step.run("test-email", () =>
      emailChannel.send(payload)
    );

    return { channels: [inApp, push, email] };
  }
);
