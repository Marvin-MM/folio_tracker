"use server";

import { z } from "zod";
import { isAllowedWebPushEndpoint } from "@/lib/web-push-endpoint";
import { requireSession } from "@/server/dal/auth-guard";
import { RateLimitError } from "@/server/dal/errors";
import { notificationRepository } from "@/server/dal/notification-repository";
import type { PushSubscriptionRecord } from "@/server/db/schema";
import type { NotificationDispatchResult } from "@/server/providers/notification-channel";
import {
  defaultRateLimiter,
  defaultUnreadCounterCache,
} from "@/server/providers/redis";
import { notificationService } from "@/server/services/notification-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const pushEndpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine(isAllowedWebPushEndpoint, {
    message: "Push subscription endpoint must use a trusted HTTPS push service.",
  });

const savePushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  userAgent: z.string().max(512).nullable().optional(),
});

const removePushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
});

const markNotificationReadSchema = z.object({
  notificationId: z.string().min(1),
});

export async function savePushSubscriptionAction(
  input: z.input<typeof savePushSubscriptionSchema>
): Promise<ActionResult<PushSubscriptionRecord>> {
  const parsed = savePushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid push subscription payload.");
  }

  try {
    const { user } = await requireSession();
    const saved = await notificationRepository.upsertPushSubscription({
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      userAgent: parsed.data.userAgent ?? null,
    });
    return actionOk(saved);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function removePushSubscriptionAction(
  input: z.input<typeof removePushSubscriptionSchema>
): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = removePushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid subscription endpoint.");
  }

  try {
    const { user } = await requireSession();
    await notificationRepository.deletePushSubscriptionForUser(
      user.id,
      parsed.data.endpoint
    );
    return actionOk({ removed: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function sendTestReminderAction(): Promise<
  ActionResult<{ results: NotificationDispatchResult[] }>
> {
  try {
    const { user } = await requireSession();
    const limitResult = await defaultRateLimiter.limit("test_push", user.id);
    if (!limitResult.allowed) {
      throw new RateLimitError({
        message: `Test reminder limit reached (5 per 5 min). Retry in ${limitResult.retryAfterSeconds}s.`,
        retryAfterSeconds: limitResult.retryAfterSeconds,
        limit: limitResult.limit,
        remaining: limitResult.remaining,
        resetAtMs: limitResult.resetAtMs,
      });
    }

    const results = await notificationService.sendTestReminder(
      user.id,
      user.timezone || "UTC"
    );
    return actionOk({ results });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function markNotificationReadAction(
  input: z.input<typeof markNotificationReadSchema>
): Promise<ActionResult<{ marked: boolean }>> {
  const parsed = markNotificationReadSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid notification identifier.");
  }

  try {
    const { user } = await requireSession();
    const marked = await notificationRepository.markRead(
      user.id,
      parsed.data.notificationId
    );
    if (marked) {
      await defaultUnreadCounterCache.decrement(user.id, 1);
    }
    return actionOk({ marked });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ count: number }>
> {
  try {
    const { user } = await requireSession();
    const count = await notificationRepository.markAllRead(user.id);
    await defaultUnreadCounterCache.reset(user.id);
    return actionOk({ count });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
