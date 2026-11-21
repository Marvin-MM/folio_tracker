"use client";

import { removePushSubscriptionAction } from "@/actions/notifications";
import { authClient } from "@/lib/auth-client";

const SW_READY_TIMEOUT_MS = 2_000;

async function cleanupBrowserPushSubscription(
  revokeOnServer: boolean
): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return;
  }

  try {
    const registration = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)
      ),
    ]);

    if (!registration?.pushManager) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    if (revokeOnServer) {
      try {
        await removePushSubscriptionAction({ endpoint: subscription.endpoint });
      } catch {
        // Best-effort server deletion; still unsubscribe locally below
      }
    }

    try {
      await subscription.unsubscribe();
    } catch {
      // Ignore browser unsubscribe errors so sign-out always completes
    }
  } catch {
    // Ignore SW errors on unsupported or restricted contexts
  }
}

/**
 * Shared-device safe sign-out:
 * 1. Deletes the active browser push endpoint from `push_subscriptions` while still authenticated.
 * 2. Unsubscribes the local browser PushManager subscription.
 * 3. Completes Better Auth sign-out.
 */
export async function performSecureSignOut(
  options: { revokePushOnServer?: boolean } = {}
): Promise<void> {
  await cleanupBrowserPushSubscription(options.revokePushOnServer ?? true);
  await authClient.signOut();
}
