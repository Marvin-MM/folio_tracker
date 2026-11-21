"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, Loader2, Send, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  removePushSubscriptionAction,
  sendTestReminderAction,
  savePushSubscriptionAction,
} from "@/actions/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PushSubscriptionRecord } from "@/server/db/schema";

interface NotificationsSettingsPanelProps {
  vapidPublicKey: string | null;
  initialSubscriptions: PushSubscriptionRecord[];
  emailRemindersEnabled: boolean;
  timezone: string;
}

const emptySubscribe = () => () => {};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getPushEnvironmentSnapshot(): {
  mounted: boolean;
  isIosNonStandalone: boolean;
  pushSupported: boolean;
} {
  if (typeof window === "undefined") {
    return {
      mounted: false,
      isIosNonStandalone: false,
      pushSupported: false,
    };
  }

  const ua = window.navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    );

  const pushSupported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  return {
    mounted: true,
    isIosNonStandalone: isIos && !isStandalone,
    pushSupported,
  };
}

const SERVER_ENV_SNAPSHOT = {
  mounted: false,
  isIosNonStandalone: false,
  pushSupported: false,
};

let cachedClientSnapshot: ReturnType<typeof getPushEnvironmentSnapshot> | null =
  null;

function getClientEnvSnapshot() {
  if (!cachedClientSnapshot) {
    cachedClientSnapshot = getPushEnvironmentSnapshot();
  }
  return cachedClientSnapshot;
}

export function NotificationsSettingsPanel({
  vapidPublicKey,
  initialSubscriptions,
  emailRemindersEnabled,
  timezone,
}: NotificationsSettingsPanelProps) {
  const env = useSyncExternalStore(
    emptySubscribe,
    getClientEnvSnapshot,
    () => SERVER_ENV_SNAPSHOT
  );

  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isTesting, startTestTransition] = useTransition();

  useEffect(() => {
    if (!env.mounted || !env.pushSupported) return;

    let cancelled = false;
    navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => {
        if (!cancelled) {
          setBrowserSubscribed(Boolean(sub));
        }
      })
      .catch(() => {
        // Ignore unavailable service worker inspection
      });

    return () => {
      cancelled = true;
    };
  }, [env.mounted, env.pushSupported]);

  const handleTogglePush = async (checked: boolean) => {
    if (!env.pushSupported) {
      toast.error("Web Push is not supported in this browser.");
      return;
    }

    if (!vapidPublicKey) {
      toast.error("VAPID public key is not configured on the server.");
      return;
    }

    setIsToggling(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      if (checked) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notification permission was not granted.");
          setBrowserSubscribed(false);
          return;
        }

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }

        const json = subscription.toJSON();
        const p256dh = json.keys?.p256dh;
        const auth = json.keys?.auth;
        if (!subscription.endpoint || !p256dh || !auth) {
          toast.error("Browser returned an incomplete push subscription.");
          return;
        }

        const res = await savePushSubscriptionAction({
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent.slice(0, 240),
        });

        if (!res.ok) {
          toast.error(res.error.message);
          return;
        }

        setBrowserSubscribed(true);
        setSubscriptions((prev) => [
          res.data,
          ...prev.filter((s) => s.endpoint !== res.data.endpoint),
        ]);
        toast.success("Browser push notifications enabled.");
      } else {
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          const endpoint = existing.endpoint;
          await existing.unsubscribe();
          await removePushSubscriptionAction({ endpoint });
          setSubscriptions((prev) =>
            prev.filter((s) => s.endpoint !== endpoint)
          );
        }
        setBrowserSubscribed(false);
        toast.success("Browser push notifications disabled.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update push subscription."
      );
    } finally {
      setIsToggling(false);
    }
  };

  const handleRemoveDevice = async (endpoint: string) => {
    const res = await removePushSubscriptionAction({ endpoint });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setSubscriptions((prev) => prev.filter((s) => s.endpoint !== endpoint));
    toast.success("Subscription removed.");
  };

  const handleSendTest = () => {
    startTestTransition(async () => {
      const res = await sendTestReminderAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }

      const delivered = res.data.results
        .filter((r) => r.delivered)
        .map((r) => r.channel.replace("_", " "));

      toast.success(
        delivered.length > 0
          ? `Test reminder dispatched via: ${delivered.join(", ")}.`
          : "Test reminder queued."
      );
    });
  };

  return (
    <div className="space-y-4">
      {/* iOS Safari Non-Standalone Callout */}
      {env.mounted && env.isIosNonStandalone ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-md border border-reminder/40 bg-reminder/10 p-3 text-xs text-foreground"
        >
          <Smartphone className="mt-0.5 size-4 shrink-0 text-reminder" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              Install Folio for iOS push reminders
            </p>
            <p className="text-muted-foreground">
              Tap Share → Add to Home Screen to enable mobile push reminders on
              iOS.
            </p>
          </div>
        </div>
      ) : null}

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">
                Web Push Notifications
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Receive desktop and mobile alerts even when Folio is closed.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={
                vapidPublicKey
                  ? "border-done/40 text-[10px] font-normal text-done"
                  : "border-reminder/40 text-[10px] font-normal text-reminder"
              }
            >
              {vapidPublicKey ? "VAPID Ready" : "VAPID Unconfigured"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2.5">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="push-browser-toggle" className="text-xs">
                Push alerts on this device
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {env.mounted && !env.pushSupported
                  ? "Push API is unavailable in this browser context."
                  : browserSubscribed
                    ? "This browser is actively subscribed to timed reminders."
                    : "Register this browser's service worker to receive push reminders."}
              </p>
            </div>
            <Switch
              id="push-browser-toggle"
              name="pushBrowserEnabled"
              checked={browserSubscribed}
              disabled={isToggling || !vapidPublicKey || (env.mounted && !env.pushSupported)}
              onCheckedChange={handleTogglePush}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">
                Test multi-channel delivery
              </p>
              <p className="text-[11px] text-muted-foreground">
                Sends a live reminder to your In-App Bell, active Web Push
                devices, and email ({emailRemindersEnabled ? "enabled" : "fallback only"}).
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isTesting}
              onClick={handleSendTest}
              className="mira-row gap-1.5 border-border bg-card text-xs"
            >
              {isTesting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="size-3.5 text-reminder" />
                  Send Test Reminder
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            Subscribed devices ({subscriptions.length})
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Expired endpoints returning HTTP 404 or 410 Gone are automatically
            pruned on delivery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
              <Bell className="mx-auto mb-1.5 size-4 text-muted-foreground" />
              No push devices registered yet.
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="mira-row flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {sub.userAgent || "Web Push Device"}
                    </p>
                    <p className="mono-tabular truncate text-[10px] text-muted-foreground">
                      Added{" "}
                      {formatInTimeZone(
                        sub.createdAt,
                        timezone,
                        "MMM d, yyyy · HH:mm"
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveDevice(sub.endpoint)}
                    aria-label="Remove push device"
                    className="mira-icon-btn shrink-0 text-muted-foreground hover:text-overdue"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
