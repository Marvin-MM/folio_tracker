import type { Metadata } from "next";
import { SettingsPanel } from "@/components/workspace/settings-panel";
import { SettingsSubnav } from "@/components/workspace/settings-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { userRepository } from "@/server/dal/user-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

function getSupportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    return ["UTC", ...Intl.supportedValuesOf("timeZone")];
  }
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
  ];
}

export default async function SettingsPage() {
  const { user } = await requireSession();

  const [profile, connectedProviders] = await Promise.all([
    userRepository.getById(user.id),
    userRepository.listConnectedProviders(user.id),
  ]);

  const resolvedProfile = profile ?? {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    timezone: user.timezone || "UTC",
    emailRemindersEnabled: user.emailRemindersEnabled ?? true,
  };

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Settings"
        subtitle="Account preferences, timezone, and theme"
        meta={resolvedProfile.timezone}
      />
      <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
        <SettingsSubnav />
        <SettingsPanel
          profile={resolvedProfile}
          connectedProviders={connectedProviders}
          timezoneOptions={getSupportedTimezones()}
        />
      </div>
    </div>
  );
}
