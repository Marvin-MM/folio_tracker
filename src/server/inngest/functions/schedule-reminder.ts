import { canUserReadEntity } from "@/server/dal/auth-guard";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { db, type AppDatabase } from "@/server/db";
import { getReminderTarget } from "@/server/db/schema";
import {
  INNGEST_CONCURRENCY_LIMIT,
  inngest,
} from "@/server/inngest/client";
import { reminderScheduledEvent } from "@/server/inngest/events";
import { EmailNotificationChannel } from "@/server/providers/channels/email-notification-channel";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { WebPushNotificationChannel } from "@/server/providers/channels/web-push-notification-channel";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import {
  reminderService,
  type ReminderService,
} from "@/server/services/reminder-service";

const defaultInAppChannel = new InAppNotificationChannel();
const defaultWebPushChannel = new WebPushNotificationChannel();
const defaultEmailChannel = new EmailNotificationChannel();

export interface ScheduledReminderDeliveryInput {
  reminderId: string;
  userId: string;
  taskId: string | null;
  noteId: string | null;
  remindAt: number;
  version: number;
}

export interface ScheduledReminderDeliveryDeps {
  database?: AppDatabase;
  reminders?: ReminderRepository;
  reminderService?: ReminderService;
  inAppChannel?: NotificationChannel;
  webPushChannel?: NotificationChannel;
  emailChannel?: NotificationChannel;
  runStep?: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
}

export type ScheduledReminderDeliveryOutcome =
  | {
      status: "cancelled_access_revoked";
      reminderId: string;
      expectedVersion: number;
    }
  | {
      status: "skipped_stale_or_cancelled";
      reminderId: string;
      expectedVersion: number;
    }
  | {
      status: "delivered";
      reminderId: string;
      version: number;
      channels: NotificationDispatchResult[];
    };

/**
 * Pure, testable wakeup delivery orchestrator shared by Inngest `scheduleReminderFn`
 * and Vitest security/concurrency tests.
 *
 * SECURITY INVARIANT:
 * 1. Re-verifies `canUserReadEntity()` directly against Turso BEFORE loading entity
 *    content or firing any Push/Email channel. If access was revoked while sleeping
 *    (e.g., viewer removed from shared project), marks reminder `'cancelled'` and
 *    sends NOTHING.
 * 2. Atomically claims `WHERE id = ? AND user_id = ? AND status = 'scheduled' AND version = ? RETURNING *`
 *    so concurrent wakeups or retries can never double-send.
 */
export async function executeScheduledReminderDelivery(
  input: ScheduledReminderDeliveryInput,
  deps: ScheduledReminderDeliveryDeps = {}
): Promise<ScheduledReminderDeliveryOutcome> {
  const database = deps.database ?? db;
  const remRepo = deps.reminders ?? reminderRepository;
  const remSvc = deps.reminderService ?? reminderService;
  const inApp = deps.inAppChannel ?? defaultInAppChannel;
  const webPush = deps.webPushChannel ?? defaultWebPushChannel;
  const email = deps.emailChannel ?? defaultEmailChannel;
  const runStep =
    deps.runStep ?? (async <T>(_id: string, fn: () => Promise<T>) => fn());

  const { reminderId, userId, taskId, noteId, version } = input;

  // 1. Re-verify tenant read authorization directly in Turso BEFORE touching content
  const canStillRead = await runStep("verify-entity-access", async () => {
    return canUserReadEntity(userId, { taskId, noteId }, database);
  });

  if (!canStillRead) {
    await runStep("cancel-revoked-reminder", async () => {
      await remSvc.cancelForRevokedAccess(reminderId, userId, version);
    });
    return {
      status: "cancelled_access_revoked",
      reminderId,
      expectedVersion: version,
    };
  }

  // 2. Atomically claim reminder for delivery (0 rows -> already sent/edited/cancelled)
  const claimed = await runStep("verify-and-claim-reminder", async () => {
    return remSvc.verifyAndClaimForDelivery(reminderId, userId, version);
  });

  if (!claimed) {
    return {
      status: "skipped_stale_or_cancelled",
      reminderId,
      expectedVersion: version,
    };
  }

  const target = getReminderTarget(claimed);

  // 3. Load scoped entity context (re-enforces `canUserReadEntity` inside repository)
  const summary = await runStep("load-entity-context", async () => {
    return remRepo.getEntitySummary(
      claimed.taskId
        ? { taskId: claimed.taskId, noteId: null }
        : { noteId: claimed.noteId!, taskId: null },
      userId,
      database
    );
  });

  if (!summary) {
    // Access vanished or entity was deleted right between claim and load; send nothing
    return {
      status: "cancelled_access_revoked",
      reminderId,
      expectedVersion: version,
    };
  }

  const payload: NotificationPayload = {
    userId,
    type: "reminder.due",
    title: summary.title,
    body: summary.snippet,
    entityType: target.entityType,
    entityId: target.entityId,
    reminderId,
    deepLink: summary.deepLink,
    remindAt: claimed.remindAt,
    timezone: claimed.timezone,
  };

  const inAppResult = await runStep("dispatch-in-app", async () => {
    return inApp.send(payload);
  });

  const webPushResult = await runStep("dispatch-web-push", async () => {
    return webPush.send(payload);
  });

  const emailResult = await runStep("dispatch-email", async () => {
    return email.send(payload);
  });

  return {
    status: "delivered",
    reminderId,
    version,
    channels: [inAppResult, webPushResult, emailResult],
  };
}

export const scheduleReminderFn = inngest.createFunction(
  {
    id: "schedule-reminder",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [reminderScheduledEvent],
    cancelOn: [
      {
        event: "app/reminder.cancelled",
        if: "async.data.reminderId == event.data.reminderId && async.data.version >= event.data.version",
      },
      {
        event: "app/reminder.rescheduled",
        if: "async.data.reminderId == event.data.reminderId && async.data.version > event.data.version",
      },
    ],
  },
  async ({ event, step }) => {
    await step.sleepUntil("wait-until-due", new Date(event.data.remindAt));

    return executeScheduledReminderDelivery(event.data, {
      runStep: async <T>(stepId: string, fn: () => Promise<T>): Promise<T> =>
        (await step.run(stepId, fn)) as T,
    });
  }
);
