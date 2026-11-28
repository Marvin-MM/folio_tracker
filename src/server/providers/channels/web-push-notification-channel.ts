import webpush from "web-push";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import type { PushSubscriptionRecord } from "@/server/db/schema";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";

export interface PushTransport {
  isConfigured(): boolean;
  send(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    serializedPayload: string
  ): Promise<void>;
}

function getHttpStatusCode(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return null;
}

export class WebPushTransport implements PushTransport {
  private vapidConfigured = false;

  private ensureVapid(): boolean {
    if (this.vapidConfigured) return true;

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const subject =
      process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@example.com";

    if (!publicKey || !privateKey) {
      return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.vapidConfigured = true;
    return true;
  }

  isConfigured(): boolean {
    return this.ensureVapid();
  }

  async send(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    serializedPayload: string
  ): Promise<void> {
    if (!this.ensureVapid()) {
      throw new Error("VAPID credentials are not configured.");
    }
    await webpush.sendNotification(subscription, serializedPayload);
  }
}

export class WebPushNotificationChannel implements NotificationChannel {
  readonly name = "web_push";

  constructor(
    private readonly repo: NotificationRepository = notificationRepository,
    private readonly transport: PushTransport = new WebPushTransport()
  ) {}

  async send(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult> {
    if (!this.transport.isConfigured()) {
      return {
        channel: this.name,
        delivered: false,
        skipped: true,
        detail: "VAPID keys not configured.",
      };
    }

    const subscriptions: PushSubscriptionRecord[] =
      await this.repo.listPushSubscriptionsForUser(payload.userId);

    if (subscriptions.length === 0) {
      return {
        channel: this.name,
        delivered: false,
        skipped: true,
        detail: "No active push subscriptions.",
      };
    }

    const serialized = JSON.stringify({
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink,
      reminderId: payload.reminderId ?? null,
      entityType: payload.entityType,
      entityId: payload.entityId,
    });

    const settled = await Promise.allSettled(
      subscriptions.map((sub) =>
        this.transport.send(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          serialized
        )
      )
    );

    const removedEndpoints: string[] = [];
    const retryableErrors: unknown[] = [];
    let successCount = 0;

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i]!;
      const sub = subscriptions[i]!;

      if (outcome.status === "fulfilled") {
        successCount += 1;
        continue;
      }

      const statusCode = getHttpStatusCode(outcome.reason);
      if (statusCode === 404 || statusCode === 410) {
        await this.repo.deletePushSubscriptionByEndpoint(sub.endpoint);
        removedEndpoints.push(sub.endpoint);
      } else if (
        statusCode === null ||
        statusCode === 429 ||
        statusCode >= 500
      ) {
        retryableErrors.push(outcome.reason);
      }
    }

    // Re-throw transient push service failures (5xx / 429 / network) when no
    // subscription succeeded so Inngest exponential retries can recover cleanly.
    if (successCount === 0 && retryableErrors.length > 0) {
      const firstError = retryableErrors[0];
      throw firstError instanceof Error
        ? firstError
        : new Error("Transient Web Push delivery failure.");
    }

    return {
      channel: this.name,
      delivered: successCount > 0,
      removedEndpoints,
      detail: `delivered=${successCount}/${subscriptions.length},pruned=${removedEndpoints.length}`,
    };
  }
}
