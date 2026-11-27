import type { Metadata } from "next";
import { NotificationsSettingsPanel } from "@/components/workspace/notifications-settings-panel";
import { SettingsSubnav } from "@/components/workspace/settings-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { notificationRepository } from "@/server/dal/notification-repository";


export const metadata: Metadata = {
  title: "Notification Settings",
};

export default async function NotificationsSettingsPage() {
  const { user } = await requireSession();
  const subscriptions =
    await notificationRepository.listPushSubscriptionsForUser(user.id);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Settings"
        subtitle="Web Push subscriptions and reminder delivery"
        meta={`${subscriptions.length} ${subscriptions.length === 1 ? "device" : "devices"}`}
      />
      <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
        <SettingsSubnav />
        <NotificationsSettingsPanel
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null}
          initialSubscriptions={subscriptions}
          emailRemindersEnabled={user.emailRemindersEnabled ?? true}
          timezone={user.timezone || "UTC"}
        />
      </div>
    </div>
  );
}
