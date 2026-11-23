"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateHabitSettingsAction } from "@/actions/habits";
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
import type {
  HabitCommentMode,
  HabitTrackerSettingsRecord,
} from "@/server/db/schema";

interface HabitSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: HabitTrackerSettingsRecord;
  timezone: string;
}

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
  const [defaultIntervalOpenHours, setDefaultIntervalOpenHours] = useState(
    String(settings.defaultIntervalOpenHours)
  );
  const [allowReactionsWhenLocked, setAllowReactionsWhenLocked] = useState(
    settings.allowReactionsWhenLocked
  );
  const [isPending, startTransition] = useTransition();

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
      setDefaultIntervalOpenHours(String(settings.defaultIntervalOpenHours));
      setAllowReactionsWhenLocked(settings.allowReactionsWhenLocked);
    }
    onOpenChange(nextOpen);
  };

  const handleSave = () => {
    startTransition(async () => {
      const intervalDaysNum =
        defaultCommentMode === "interval_days"
          ? Math.max(1, Math.min(30, Number(defaultIntervalDays) || 5))
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
        defaultIntervalOpenHours: openHoursNum,
        allowReactionsWhenLocked,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

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
                  <Label className="text-[11px] text-muted-foreground">
                    Opens
                  </Label>
                  <Select
                    value={String(defaultWindowStartDay)}
                    onValueChange={(v) => setDefaultWindowStartDay(Number(v))}
                  >
                    <SelectTrigger className="mira-row bg-background text-xs">
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
                    value={defaultWindowStartTime}
                    onChange={(e) => setDefaultWindowStartTime(e.target.value)}
                    className="mono-tabular mira-row bg-background text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Closes
                  </Label>
                  <Select
                    value={String(defaultWindowEndDay)}
                    onValueChange={(v) => setDefaultWindowEndDay(Number(v))}
                  >
                    <SelectTrigger className="mira-row bg-background text-xs">
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
                    value={defaultWindowEndTime}
                    onChange={(e) => setDefaultWindowEndTime(e.target.value)}
                    className="mono-tabular mira-row bg-background text-xs"
                  />
                </div>
              </div>
            ) : null}

            {defaultCommentMode === "interval_days" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label
                    htmlFor="settings-interval-days"
                    className="text-[11px] text-muted-foreground"
                  >
                    Every N days
                  </Label>
                  <Input
                    id="settings-interval-days"
                    type="number"
                    min={1}
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
