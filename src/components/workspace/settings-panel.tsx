"use client";

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { updateUserPreferencesAction } from "@/actions/user-preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UserPreferencesRecord } from "@/server/dal/user-repository";

interface SettingsPanelProps {
  profile: UserPreferencesRecord;
  connectedProviders: string[];
  timezoneOptions: string[];
}

const emptySubscribe = () => () => {};

export function SettingsPanel({
  profile,
  connectedProviders,
  timezoneOptions,
}: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(
    profile.emailRemindersEnabled
  );
  const [isPending, startTransition] = useTransition();

  const handleUseBrowserTimezone = () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) {
      setTimezone(detected);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateUserPreferencesAction({
        name,
        timezone,
        emailRemindersEnabled,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Preferences saved.");
    });
  };

  const allTimezones = timezoneOptions.includes(timezone)
    ? timezoneOptions
    : [timezone, ...timezoneOptions];

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            Profile &amp; Timezone
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Your IANA timezone ensures reminders and Today views align with your
            local clock.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="settings-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="settings-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="mira-row bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-email" className="text-xs">
                Email address
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="settings-email"
                  name="email"
                  value={profile.email}
                  disabled
                  className="mira-row bg-muted/40 text-muted-foreground"
                />
                <Badge
                  variant="outline"
                  className={
                    profile.emailVerified
                      ? "shrink-0 border-done/40 text-[11px] font-normal text-done"
                      : "shrink-0 border-reminder/40 text-[11px] font-normal text-reminder"
                  }
                >
                  {profile.emailVerified ? "Verified" : "Unverified"}
                </Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="settings-timezone" className="text-xs">
                  IANA Timezone
                </Label>
                <button
                  type="button"
                  onClick={handleUseBrowserTimezone}
                  className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Detect browser timezone
                </button>
              </div>
              <Select
                name="timezone"
                value={timezone}
                onValueChange={setTimezone}
              >
                <SelectTrigger
                  id="settings-timezone"
                  className="mira-row mono-tabular w-full bg-background text-xs"
                >
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {allTimezones.map((tz) => (
                    <SelectItem
                      key={tz}
                      value={tz}
                      className="mono-tabular text-xs"
                    >
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2.5">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="settings-email-reminders" className="text-xs">
                  Email reminders
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Receive timed reminder digests and urgent notifications via
                  email.
                </p>
              </div>
              <Switch
                id="settings-email-reminders"
                name="emailRemindersEnabled"
                checked={emailRemindersEnabled}
                onCheckedChange={setEmailRemindersEnabled}
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                className="mira-row px-4"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Appearance</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Switch between Warm Paper (Light) and Carbon Ink (Dark).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "light", label: "Warm Paper" },
                { value: "dark", label: "Carbon Ink" },
                { value: "system", label: "System" },
              ] as const
            ).map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={
                  isMounted && theme === option.value ? "default" : "outline"
                }
                size="sm"
                onClick={() => setTheme(option.value)}
                className="mira-row text-xs"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            Sign-in methods
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Providers currently linked to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {connectedProviders.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No linked providers found.
            </span>
          ) : (
            connectedProviders.map((provider) => (
              <Badge
                key={provider}
                variant="secondary"
                className="text-xs font-normal capitalize"
              >
                {provider === "credential" ? "Email & Password" : provider}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
