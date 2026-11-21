import { reminderRepository } from "@/server/dal/reminder-repository";
import { inngest } from "@/server/inngest/client";
import { reminderScheduledEvent } from "@/server/inngest/events";
import { EmailNotificationChannel } from "@/server/providers/channels/email-notification-channel";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { WebPushNotificationChannel } from "@/server/providers/channels/web-push-notification-channel";
import type { NotificationPayload } from "@/server/providers/notification-channel";
import { reminderService } from "@/server/services/reminder-service";

const inAppChannel = new InAppNotificationChannel();
const webPushChannel = new WebPushNotificationChannel();
const emailChannel = new EmailNotificationChannel();

export const scheduleReminderFn = inngest.createFunction(
  {
    id: "schedule-reminder",
    triggers: [reminderScheduledEvent],
    cancelOn: [
      {
        event: "app/reminder.cancelled",
        if: "async.data.reminderId == event.data.reminderId",
      },
      {
        event: "app/reminder.rescheduled",
        if: "async.data.reminderId == event.data.reminderId",
      },
    ],
  },
  async ({ event, step }) => {
    const { reminderId, userId, entityType, entityId, remindAt, version } =
      event.data;

    await step.sleepUntil("wait-until-due", new Date(remindAt));

    // Atomically verify status === 'scheduled' && version === event.data.version
    // and transition to 'sent' so retries or concurrent edits can never double-send.
    const claimed = await step.run("verify-and-claim-reminder", async () => {
      return reminderService.verifyAndClaimForDelivery(reminderId, version);
    });

    if (!claimed) {
      return {
        status: "skipped_stale_or_cancelled",
        reminderId,
        expectedVersion: version,
      };
    }

    const summary = await step.run("load-entity-context", async () => {
      return reminderRepository.getEntitySummary(entityType, entityId, userId);
    });

    const payload: NotificationPayload = {
      userId,
      type: "reminder.due",
      title: summary?.title ?? "Scheduled reminder",
      body: summary?.snippet ?? "Your reminder is due now.",
      entityType,
      entityId,
      reminderId,
      deepLink:
        summary?.deepLink ??
        (entityType === "note"
          ? `/app/notes?item=${encodeURIComponent(entityId)}`
          : `/app/inbox?item=${encodeURIComponent(entityId)}`),
      remindAt: claimed.remindAt,
      timezone: claimed.timezone,
    };

    const inAppResult = await step.run("dispatch-in-app", async () => {
      return inAppChannel.send(payload);
    });

    const webPushResult = await step.run("dispatch-web-push", async () => {
      return webPushChannel.send(payload);
    });

    const emailResult = await step.run("dispatch-email", async () => {
      return emailChannel.send(payload);
    });

    return {
      status: "delivered",
      reminderId,
      version,
      channels: [inAppResult, webPushResult, emailResult],
    };
  }
);
