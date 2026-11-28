"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  removeHabitMonthLockPinAction,
  setHabitMonthLockPinAction,
  updateHabitSettingsAction,
} from "@/actions/habits";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { HabitCommentMode } from "@/server/db/schema";
import type { ClientHabitTrackerSettings } from "@/server/domain/habit-month-lock";

interface HabitSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ClientHabitTrackerSettings;
  timezone: string;
}

const GRACE_DAY_OPTIONS = [
  { value: 0, label: "Immediate (end of month)" },
  { value: 1, label: "1 day into new month" },
  { value: 2, label: "2 days into new month" },
  { value: 3, label: "3 days (Recommended)" },
  { value: 5, label: "5 days into new month" },
  { value: 7, label: "7 days into new month" },
  { value: 14, label: "14 days into new month" },
] as const;

const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export function HabitSettingsSheet({
  open,
  onOpenChange,
  settings,
  timezone,
}: HabitSettingsSheetProps) {
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(
    settings.weekStartsOn === 0 ? 0 : 1
  );
  const [eveningCheckinTime, setEveningCheckinTime] = useState(
    settings.eveningCheckinTime ?? ""
  );
  const [defaultCommentMode, setDefaultCommentMode] =
    useState<HabitCommentMode>(settings.defaultCommentMode);
  const [defaultWindowStartDay, setDefaultWindowStartDay] = useState(
    settings.defaultWindowStartDay
  );
  const [defaultWindowStartTime, setDefaultWindowStartTime] = useState(
    settings.defaultWindowStartTime
  );
  const [defaultWindowEndDay, setDefaultWindowEndDay] = useState(
    settings.defaultWindowEndDay
  );
  const [defaultWindowEndTime, setDefaultWindowEndTime] = useState(
    settings.defaultWindowEndTime
  );
  const [defaultIntervalDays, setDefaultIntervalDays] = useState(
    settings.defaultIntervalDays ? String(settings.defaultIntervalDays) : "5"
  );
  const [defaultIntervalAnchorDate, setDefaultIntervalAnchorDate] = useState(
    settings.defaultIntervalAnchorDate ?? "2026-11-01"
  );
  const [defaultIntervalOpenHours, setDefaultIntervalOpenHours] = useState(
    String(settings.defaultIntervalOpenHours)
  );
  const [allowReactionsWhenLocked, setAllowReactionsWhenLocked] = useState(
    settings.allowReactionsWhenLocked
  );
  const [monthLockEnabled, setMonthLockEnabled] = useState(
    settings.monthLockEnabled
  );
  const [monthLockGraceDays, setMonthLockGraceDays] = useState(
    settings.monthLockGraceDays
  );
  const [pinPanelMode, setPinPanelMode] = useState<
    "closed" | "set" | "remove"
  >("closed");
  const [currentPin, setCurrentPin] = useState("");
  const [policyConfirmPin, setPolicyConfirmPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isPinPending, startPinTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();

  const requiresPinToWeakenedLockPolicy =
    settings.hasMonthLockPin &&
    ((settings.monthLockEnabled && !monthLockEnabled) ||
      monthLockGraceDays > settings.monthLockGraceDays);

  const resetPinForm = () => {
    setPinPanelMode("closed");
    setCurrentPin("");
    setPolicyConfirmPin("");
    setNewPin("");
    setConfirmPin("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setWeekStartsOn(settings.weekStartsOn === 0 ? 0 : 1);
      setEveningCheckinTime(settings.eveningCheckinTime ?? "");
      setDefaultCommentMode(settings.defaultCommentMode);
      setDefaultWindowStartDay(settings.defaultWindowStartDay);
      setDefaultWindowStartTime(settings.defaultWindowStartTime);
      setDefaultWindowEndDay(settings.defaultWindowEndDay);
      setDefaultWindowEndTime(settings.defaultWindowEndTime);
      setDefaultIntervalDays(
        settings.defaultIntervalDays ? String(settings.defaultIntervalDays) : "5"
      );
      setDefaultIntervalAnchorDate(
        settings.defaultIntervalAnchorDate ?? "2026-11-01"
      );
      setDefaultIntervalOpenHours(String(settings.defaultIntervalOpenHours));
      setAllowReactionsWhenLocked(settings.allowReactionsWhenLocked);
      setMonthLockEnabled(settings.monthLockEnabled);
      setMonthLockGraceDays(settings.monthLockGraceDays);
      resetPinForm();
    }
    onOpenChange(nextOpen);
  };

  const handleSavePin = () => {
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error("Accountability PIN must be 4 to 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PIN confirmation does not match.");
      return;
    }
    if (settings.hasMonthLockPin && !/^\d{4,6}$/.test(currentPin)) {
      toast.error("Enter your current PIN to change it.");
      return;
    }

    startPinTransition(async () => {
      const res = await setHabitMonthLockPinAction({
        ...(settings.hasMonthLockPin ? { currentPin } : {}),
        newPin,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["habits", "circle"]);
      toast.success(
        settings.hasMonthLockPin
          ? "Accountability PIN updated."
          : "Accountability PIN enabled."
      );
      resetPinForm();
    });
  };

  const handleRemovePin = () => {
    if (!/^\d{4,6}$/.test(currentPin)) {
      toast.error("Enter your current PIN to remove it.");
      return;
    }
    startPinTransition(async () => {
      const res = await removeHabitMonthLockPinAction({ currentPin });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["habits", "circle"]);
      toast.success("Accountability PIN removed.");
      resetPinForm();
    });
  };

  const handleSave = () => {
    if (
      requiresPinToWeakenedLockPolicy &&
      !/^\d{4,6}$/.test(policyConfirmPin)
    ) {
      toast.error(
        "Enter your current 4–6 digit Accountability PIN to relax month locking."
      );
      return;
    }

    startTransition(async () => {
      const intervalDaysNum =
        defaultCommentMode === "interval_days"
          ? Math.max(2, Math.min(30, Number(defaultIntervalDays) || 5))
          : null;
      const openHoursNum = Math.max(
        1,
        Math.min(168, Number(defaultIntervalOpenHours) || 24)
      );

      const result = await updateHabitSettingsAction({
        weekStartsOn,
        eveningCheckinTime: eveningCheckinTime.trim() || null,
        defaultCommentMode,
        defaultWindowStartDay,
        defaultWindowStartTime,
        defaultWindowEndDay,
        defaultWindowEndTime,
        defaultIntervalDays: intervalDaysNum,
        defaultIntervalAnchorDate:
          defaultCommentMode === "interval_days"
            ? defaultIntervalAnchorDate.trim() || null
            : null,
        defaultIntervalOpenHours: openHoursNum,
        allowReactionsWhenLocked,
        monthLockEnabled,
        monthLockGraceDays,
        ...(requiresPinToWeakenedLockPolicy
          ? { currentPin: policyConfirmPin }
          : {}),
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(["habits", "circle"]);
      toast.success("Habit tracker settings saved.");
      onOpenChange(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-l border-border bg-card p-0 data-[side=right]:sm:max-w-[420px]"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-sm font-semibold">
            Habit Tracker Settings
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Calendar alignment, daily check-in nudges ({timezone}), and review
            window defaults.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-y-auto p-4">
          {/* Calendar Week Alignment */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">
              Calendar week starts on
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { value: 1 as const, label: "Monday (Mon–Sun)" },
                  { value: 0 as const, label: "Sunday (Sun–Sat)" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWeekStartsOn(opt.value)}
                  className={cn(
                    "mira-row rounded-md border px-2.5 text-xs font-medium transition-colors",
                    weekStartsOn === opt.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Evening Check-in Nudge */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="settings-evening-time" className="text-xs">
                Evening check-in nudge
              </Label>
              {eveningCheckinTime ? (
                <button
                  type="button"
                  onClick={() => setEveningCheckinTime("")}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Disable
                </button>
              ) : null}
            </div>
            <Input
              id="settings-evening-time"
              type="time"
              value={eveningCheckinTime}
              onChange={(e) => setEveningCheckinTime(e.target.value)}
              className="mono-tabular mira-row bg-background text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Sends one reminder at this local time if any scheduled habits are
              still unlogged today.
            </p>
          </div>

          <Separator />

          {/* Dynamic Month Locking & Accountability PIN */}
          <div className="space-y-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Month locking &amp; consistency
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Lock finished months automatically after a short grace window so
                past records stay honest and view-only.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <div className="space-y-0.5 pr-3">
                <Label
                  htmlFor="settings-month-lock-enabled"
                  className="text-xs font-medium"
                >
                  Auto-lock completed months
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Manual locking remains available at month-end anytime.
                </p>
              </div>
              <Switch
                id="settings-month-lock-enabled"
                checked={monthLockEnabled}
                onCheckedChange={setMonthLockEnabled}
              />
            </div>

            {monthLockEnabled ? (
              <div className="space-y-1.5">
                <Label htmlFor="settings-month-lock-grace" className="text-xs">
                  Grace window before auto-lock
                </Label>
                <Select
                  value={String(monthLockGraceDays)}
                  onValueChange={(val) => setMonthLockGraceDays(Number(val))}
                >
                  <SelectTrigger
                    id="settings-month-lock-grace"
                    className="mira-row bg-background text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRACE_DAY_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={String(opt.value)}
                        className="text-xs"
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {monthLockGraceDays === 0
                    ? "Previous months lock automatically on day 1 of the new month."
                    : `Previous months stay editable through day ${monthLockGraceDays} of the new month, then auto-lock on day ${monthLockGraceDays + 1}.`}
                </p>
              </div>
            ) : null}

            {requiresPinToWeakenedLockPolicy ? (
              <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Label
                  htmlFor="settings-policy-confirm-pin"
                  className="text-xs font-medium text-foreground"
                >
                  Confirm Accountability PIN to relax month lock
                </Label>
                <Input
                  id="settings-policy-confirm-pin"
                  type="password"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter current 4–6 digit PIN"
                  value={policyConfirmPin}
                  onChange={(e) =>
                    setPolicyConfirmPin(
                      e.target.value.replace(/\D/g, "").slice(0, 6)
                    )
                  }
                  className="mono-tabular mira-row bg-background text-xs tracking-widest"
                />
                <p className="text-[11px] text-muted-foreground">
                  Disabling auto-lock or extending the grace window requires
                  your current PIN.
                </p>
              </div>
            ) : null}

            {/* Optional 4-6 Digit Accountability PIN */}
            <div className="space-y-2.5 rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <KeyRound
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium text-foreground">
                    Accountability PIN
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 px-1.5 text-[10px] font-medium",
                    settings.hasMonthLockPin
                      ? "border-done/40 bg-done/10 text-done"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {settings.hasMonthLockPin ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-2.5" aria-hidden="true" />
                      PIN set
                    </span>
                  ) : (
                    "Optional"
                  )}
                </Badge>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Require a 4–6 digit PIN to temporarily unlock a locked month
                (30-minute edit window).
              </p>

              {pinPanelMode === "closed" ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setPinPanelMode("set")}
                    className="h-7 px-2.5 text-xs"
                  >
                    {settings.hasMonthLockPin ? "Change PIN" : "Set PIN"}
                  </Button>
                  {settings.hasMonthLockPin ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setPinPanelMode("remove")}
                      className="h-7 px-2.5 text-xs text-overdue hover:text-overdue"
                    >
                      Remove PIN
                    </Button>
                  ) : null}
                </div>
              ) : pinPanelMode === "set" ? (
                <div className="space-y-2 border-t border-border pt-2.5">
                  {settings.hasMonthLockPin ? (
                    <div className="space-y-1">
                      <Label
                        htmlFor="settings-pin-current"
                        className="text-[11px] text-muted-foreground"
                      >
                        Current PIN
                      </Label>
                      <Input
                        id="settings-pin-current"
                        type="password"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="4–6 digits"
                        value={currentPin}
                        onChange={(e) =>
                          setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className="mono-tabular mira-row bg-card text-xs tracking-widest"
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor="settings-pin-new"
                        className="text-[11px] text-muted-foreground"
                      >
                        New PIN (4–6 digits)
                      </Label>
                      <Input
                        id="settings-pin-new"
                        type="password"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="••••"
                        value={newPin}
                        onChange={(e) =>
                          setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className="mono-tabular mira-row bg-card text-xs tracking-widest"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="settings-pin-confirm"
                        className="text-[11px] text-muted-foreground"
                      >
                        Confirm PIN
                      </Label>
                      <Input
                        id="settings-pin-confirm"
                        type="password"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="••••"
                        value={confirmPin}
                        onChange={(e) =>
                          setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className="mono-tabular mira-row bg-card text-xs tracking-widest"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPinPending}
                      onClick={resetPinForm}
                      className="h-7 px-2 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      disabled={isPinPending || newPin.length < 4}
                      onClick={handleSavePin}
                      className="h-7 px-3 text-xs"
                    >
                      {isPinPending ? "Saving…" : "Save PIN"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 border-t border-border pt-2.5">
                  <div className="space-y-1">
                    <Label
                      htmlFor="settings-pin-remove-current"
                      className="text-[11px] text-muted-foreground"
                    >
                      Enter current PIN to remove
                    </Label>
                    <Input
                      id="settings-pin-remove-current"
                      type="password"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="4–6 digits"
                      value={currentPin}
                      onChange={(e) =>
                        setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      className="mono-tabular mira-row bg-card text-xs tracking-widest"
                    />
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPinPending}
                      onClick={resetPinForm}
                      className="h-7 px-2 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      disabled={isPinPending || currentPin.length < 4}
                      onClick={handleRemovePin}
                      className="h-7 px-3 text-xs"
                    >
                      {isPinPending ? "Removing…" : "Remove PIN"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Comment Window Defaults (ready for Phase B sharing) */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                Default accountability comment window
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Default review window applied when sharing your tracker.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-comment-mode" className="text-xs">
                Window mode
              </Label>
              <Select
                value={defaultCommentMode}
                onValueChange={(val) =>
                  setDefaultCommentMode(val as HabitCommentMode)
                }
              >
                <SelectTrigger
                  id="settings-comment-mode"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly_window" className="text-xs">
                    Weekly review window (e.g. Sat–Sun)
                  </SelectItem>
                  <SelectItem value="interval_days" className="text-xs">
                    Every N days interval
                  </SelectItem>
                  <SelectItem value="anytime" className="text-xs">
                    Open anytime
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {defaultCommentMode === "weekly_window" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="settings-window-open-day"
                    className="text-[11px] text-muted-foreground"
                  >
                    Opens
                  </Label>
                  <Select
                    value={String(defaultWindowStartDay)}
                    onValueChange={(v) => setDefaultWindowStartDay(Number(v))}
                  >
                    <SelectTrigger
                      id="settings-window-open-day"
                      className="mira-row bg-background text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((d) => (
                        <SelectItem
                          key={d.value}
                          value={String(d.value)}
                          className="text-xs"
                        >
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="time"
                    aria-label="Window open time"
                    value={defaultWindowStartTime}
                    onChange={(e) => setDefaultWindowStartTime(e.target.value)}
                    className="mono-tabular mira-row bg-background text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="settings-window-close-day"
                    className="text-[11px] text-muted-foreground"
                  >
                    Closes
                  </Label>
                  <Select
                    value={String(defaultWindowEndDay)}
                    onValueChange={(v) => setDefaultWindowEndDay(Number(v))}
                  >
                    <SelectTrigger
                      id="settings-window-close-day"
                      className="mira-row bg-background text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((d) => (
                        <SelectItem
                          key={d.value}
                          value={String(d.value)}
                          className="text-xs"
                        >
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="time"
                    aria-label="Window close time"
                    value={defaultWindowEndTime}
                    onChange={(e) => setDefaultWindowEndTime(e.target.value)}
                    className="mono-tabular mira-row bg-background text-xs"
                  />
                </div>
              </div>
            ) : null}

            {defaultCommentMode === "interval_days" ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label
                      htmlFor="settings-interval-days"
                      className="text-[11px] text-muted-foreground"
                    >
                      Every N days (2–30)
                    </Label>
                    <Input
                      id="settings-interval-days"
                      type="number"
                      min={2}
                      max={30}
                      value={defaultIntervalDays}
                      onChange={(e) => setDefaultIntervalDays(e.target.value)}
                      className="mono-tabular mira-row bg-background text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="settings-open-hours"
                      className="text-[11px] text-muted-foreground"
                    >
                      Open for (hours)
                    </Label>
                    <Input
                      id="settings-open-hours"
                      type="number"
                      min={1}
                      max={168}
                      value={defaultIntervalOpenHours}
                      onChange={(e) =>
                        setDefaultIntervalOpenHours(e.target.value)
                      }
                      className="mono-tabular mira-row bg-background text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="settings-interval-anchor"
                    className="text-[11px] text-muted-foreground"
                  >
                    Cycle anchor date
                  </Label>
                  <Input
                    id="settings-interval-anchor"
                    type="date"
                    value={defaultIntervalAnchorDate}
                    onChange={(e) =>
                      setDefaultIntervalAnchorDate(e.target.value)
                    }
                    className="mono-tabular mira-row bg-background text-xs"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <div className="space-y-0.5 pr-3">
                <Label
                  htmlFor="settings-reactions-locked"
                  className="text-xs font-medium"
                >
                  Allow reactions when window is closed
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Let partners leave quick reactions even outside comment hours.
                </p>
              </div>
              <Switch
                id="settings-reactions-locked"
                checked={allowReactionsWhenLocked}
                onCheckedChange={setAllowReactionsWhenLocked}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={handleSave}
              className="mira-row px-4 text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save settings"
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
