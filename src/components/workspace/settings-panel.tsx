"use client";

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { deleteAccountAction } from "@/actions/account";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import {
  hardNavigateAfterSignOut,
  performSecureSignOut,
} from "@/lib/client-sign-out";
import type { UserPreferencesRecord } from "@/server/dal/user-repository";
import { MAX_USER_BIO_LENGTH } from "@/server/domain/operations";

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
  const invalidate = useInvalidateWorkspace();
  const { theme, setTheme } = useTheme();
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [name, setName] = useState(profile.name);
  const [savedHandle, setSavedHandle] = useState(profile.handle ?? null);
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [timezone, setTimezone] = useState(profile.timezone);
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(
    profile.emailRemindersEnabled
  );
  const [isPending, startTransition] = useTransition();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

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
        handle: handle.trim() || null,
        bio: bio.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setSavedHandle(result.data.handle ?? null);
      await invalidate(["all"]);
      toast.success("Preferences saved.");
    });
  };

  const handleDeleteDialogChange = (open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      setConfirmEmail("");
      setDeleteError(null);
    }
  };

  const handleDeleteAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDeleteError(null);

    startDeleteTransition(async () => {
      const result = await deleteAccountAction({ confirmEmail });
      if (!result.ok) {
        setDeleteError(result.error.message);
        return;
      }

      try {
        await performSecureSignOut({ revokePushOnServer: false });
      } catch {
        // Account & sessions are already cascaded server-side
      }

      toast.success("Your account has been permanently deleted.");
      hardNavigateAfterSignOut("/login");
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
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="mira-row bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="settings-handle" className="text-xs">
                  Public creator handle (optional)
                </Label>
                {savedHandle ? (
                  <Link
                    href={`/u/${savedHandle}`}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-reminder hover:underline"
                  >
                    /u/{savedHandle}
                    <ArrowUpRight className="size-3" />
                  </Link>
                ) : null}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                  @
                </span>
                <Input
                  id="settings-handle"
                  name="handle"
                  autoComplete="username"
                  placeholder="your_handle"
                  value={handle}
                  onChange={(event) =>
                    setHandle(event.target.value.replace(/^@+/, ""))
                  }
                  maxLength={30}
                  className="mira-row bg-background pl-6 font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                3–30 lowercase letters, numbers, hyphens, or underscores. Enables
                your public profile page at <code className="font-mono">/u/handle</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="settings-bio" className="text-xs">
                  Creator bio (optional)
                </Label>
                <span className="mono-tabular text-[10px] text-muted-foreground">
                  {bio.length}/{MAX_USER_BIO_LENGTH}
                </span>
              </div>
              <Textarea
                id="settings-bio"
                name="bio"
                rows={2}
                maxLength={MAX_USER_BIO_LENGTH}
                placeholder="Share what kind of playbooks, recipes, or guides you publish…"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                className="bg-background text-xs"
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
                  type="email"
                  autoComplete="email"
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
                  <SelectValue placeholder="Select timezone">
                    {timezone}
                  </SelectValue>
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

      <Card className="border-overdue/30 bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-overdue">
            <AlertTriangle className="size-3.5" />
            Danger zone
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Permanently delete your account, personal tasks, notes, reminders,
            and push subscriptions. Shared projects where you are the sole owner
            with other members must be transferred or deleted first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog
            open={deleteDialogOpen}
            onOpenChange={handleDeleteDialogChange}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mira-row gap-1.5 px-3 text-xs"
              >
                <Trash2 className="size-3.5" />
                Delete account
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle className="text-sm font-semibold text-foreground">
                  Delete account permanently
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  This action cannot be undone. Type{" "}
                  <span className="mono-tabular font-medium text-foreground">
                    {profile.email}
                  </span>{" "}
                  below to confirm permanent deletion.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleDeleteAccount} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="delete-confirm-email" className="text-xs">
                    Confirm email address
                  </Label>
                  <Input
                    id="delete-confirm-email"
                    name="confirmEmail"
                    type="email"
                    autoComplete="off"
                    placeholder={profile.email}
                    value={confirmEmail}
                    onChange={(event) => setConfirmEmail(event.target.value)}
                    required
                    className="mira-row bg-background text-xs"
                  />
                </div>

                {deleteError ? (
                  <p className="rounded-md border border-overdue/30 bg-overdue/10 px-2.5 py-2 text-xs text-overdue">
                    {deleteError}
                  </p>
                ) : null}

                <DialogFooter className="gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteDialogChange(false)}
                    disabled={isDeleting}
                    className="mira-row text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    disabled={
                      isDeleting ||
                      confirmEmail.trim().toLowerCase() !==
                        profile.email.trim().toLowerCase()
                    }
                    className="mira-row text-xs"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      "Delete permanently"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
