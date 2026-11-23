"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { updateMonitorConfigAction } from "@/actions/habits-social";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { MonitorWithUser } from "@/server/dal/habits-social";
import type {
  HabitCommentMode,
  HabitMonitorScope,
  HabitRecord,
  HabitTrackerSettingsRecord,
} from "@/server/db/schema";

interface MonitorPolicySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorWithUser | null;
  globalSettings: HabitTrackerSettingsRecord;
  habits: HabitRecord[];
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

function MonitorPolicyForm({
  monitor,
  globalSettings,
  habits,
  onClose,
}: {
  monitor: MonitorWithUser;
  globalSettings: HabitTrackerSettingsRecord;
  habits: HabitRecord[];
  onClose: () => void;
}) {
  const [scope, setScope] = useState<HabitMonitorScope>(monitor.scope);
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>(
    monitor.selectedHabitIds
  );
  const [useCustomPolicy, setUseCustomPolicy] = useState(
    monitor.useCustomPolicy
  );
  const [customMode, setCustomMode] = useState<HabitCommentMode>(
    monitor.customCommentMode ?? globalSettings.defaultCommentMode
  );
  const [startDay, setStartDay] = useState(
    monitor.customWindowStartDay ?? globalSettings.defaultWindowStartDay
  );
  const [startTime, setStartTime] = useState(
    monitor.customWindowStartTime ?? globalSettings.defaultWindowStartTime
  );
  const [endDay, setEndDay] = useState(
    monitor.customWindowEndDay ?? globalSettings.defaultWindowEndDay
  );
  const [endTime, setEndTime] = useState(
    monitor.customWindowEndTime ?? globalSettings.defaultWindowEndTime
  );
  const [intervalDays, setIntervalDays] = useState(
    String(
      monitor.customIntervalDays ?? globalSettings.defaultIntervalDays ?? 4
    )
  );
  const [intervalAnchorDate, setIntervalAnchorDate] = useState(
    monitor.customIntervalAnchorDate ??
      globalSettings.defaultIntervalAnchorDate ??
      "2026-11-01"
  );
  const [intervalOpenHours, setIntervalOpenHours] = useState(
    String(
      monitor.customIntervalOpenHours ?? globalSettings.defaultIntervalOpenHours
    )
  );
  const [allowReactions, setAllowReactions] = useState(
    monitor.customAllowReactionsWhenLocked ??
      globalSettings.allowReactionsWhenLocked
  );
  const [isPending, startTransition] = useTransition();

  const toggleHabit = (habitId: string) => {
    setSelectedHabitIds((prev) =>
      prev.includes(habitId)
        ? prev.filter((id) => id !== habitId)
        : [...prev, habitId]
    );
  };

  const handleSave = () => {
    if (scope === "selected" && selectedHabitIds.length === 0) {
      toast.error("Select at least one habit for selected scope.");
      return;
    }

    startTransition(async () => {
      const result = await updateMonitorConfigAction({
        monitorId: monitor.id,
        scope,
        selectedHabitIds: scope === "selected" ? selectedHabitIds : [],
        customPolicy: useCustomPolicy
          ? {
              useCustomPolicy: true,
              customCommentMode: customMode,
              customWindowStartDay:
                customMode === "weekly_window" ? startDay : null,
              customWindowStartTime:
                customMode === "weekly_window" ? startTime : null,
              customWindowEndDay:
                customMode === "weekly_window" ? endDay : null,
              customWindowEndTime:
                customMode === "weekly_window" ? endTime : null,
              customIntervalDays:
                customMode === "interval_days"
                  ? Math.max(2, Math.min(30, Number(intervalDays) || 4))
                  : null,
              customIntervalAnchorDate:
                customMode === "interval_days"
                  ? intervalAnchorDate || null
                  : null,
              customIntervalOpenHours:
                customMode === "interval_days"
                  ? Math.max(1, Math.min(168, Number(intervalOpenHours) || 24))
                  : null,
              customAllowReactionsWhenLocked: allowReactions,
            }
          : { useCustomPolicy: false },
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(`Updated policy for ${monitor.monitorName}.`);
      onClose();
    });
  };

  return (
    <div className="space-y-5 overflow-y-auto p-4">
      {/* Scope */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-foreground">
          Shared habit scope
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { value: "all" as const, label: "All Active Habits" },
              { value: "selected" as const, label: "Selected Only" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setScope(opt.value)}
              className={cn(
                "mira-row rounded-md border px-2.5 text-xs font-medium transition-colors",
                scope === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {scope === "selected" ? (
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border bg-background p-2.5">
            {habits.map((h) => (
              <label
                key={h.id}
                className="flex min-h-8 cursor-pointer items-center gap-2 text-xs md:min-h-6"
              >
                <Checkbox
                  checked={selectedHabitIds.includes(h.id)}
                  onCheckedChange={() => toggleHabit(h.id)}
                />
                <span className="truncate">{h.title}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <Separator />

      {/* Per-Monitor Commenting Policy Override */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <Label htmlFor="override-switch" className="text-xs font-medium">
              Override global commenting policy
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Customize when {monitor.monitorName} can post review comments.
            </p>
          </div>
          <Switch
            id="override-switch"
            checked={useCustomPolicy}
            onCheckedChange={setUseCustomPolicy}
          />
        </div>

        {useCustomPolicy ? (
          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="space-y-1">
              <Label htmlFor="override-mode" className="text-[11px] text-muted-foreground">
                Cadence mode
              </Label>
              <Select
                value={customMode}
                onValueChange={(v) => setCustomMode(v as HabitCommentMode)}
              >
                <SelectTrigger id="override-mode" className="mira-row bg-card text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly_window" className="text-xs">
                    Weekly review window
                  </SelectItem>
                  <SelectItem value="interval_days" className="text-xs">
                    Every N days
                  </SelectItem>
                  <SelectItem value="anytime" className="text-xs">
                    Open anytime
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {customMode === "weekly_window" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Opens
                  </span>
                  <Select
                    value={String(startDay)}
                    onValueChange={(v) => setStartDay(Number(v))}
                  >
                    <SelectTrigger className="mira-row bg-card text-xs">
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
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mono-tabular mira-row bg-card text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Closes
                  </span>
                  <Select
                    value={String(endDay)}
                    onValueChange={(v) => setEndDay(Number(v))}
                  >
                    <SelectTrigger className="mira-row bg-card text-xs">
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
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mono-tabular mira-row bg-card text-xs"
                  />
                </div>
              </div>
            ) : null}

            {customMode === "interval_days" ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="override-interval-days" className="text-[11px] text-muted-foreground">
                      Every N days (2–30)
                    </Label>
                    <Input
                      id="override-interval-days"
                      type="number"
                      min={2}
                      max={30}
                      value={intervalDays}
                      onChange={(e) => setIntervalDays(e.target.value)}
                      className="mono-tabular mira-row bg-card text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="override-open-hours" className="text-[11px] text-muted-foreground">
                      Open for (hours)
                    </Label>
                    <Input
                      id="override-open-hours"
                      type="number"
                      min={1}
                      max={168}
                      value={intervalOpenHours}
                      onChange={(e) => setIntervalOpenHours(e.target.value)}
                      className="mono-tabular mira-row bg-card text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="override-anchor-date" className="text-[11px] text-muted-foreground">
                    Cycle anchor date
                  </Label>
                  <Input
                    id="override-anchor-date"
                    type="date"
                    value={intervalAnchorDate}
                    onChange={(e) => setIntervalAnchorDate(e.target.value)}
                    className="mono-tabular mira-row bg-card text-xs"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">
                Allow quiet reactions when locked
              </span>
              <Switch
                checked={allowReactions}
                onCheckedChange={setAllowReactions}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setUseCustomPolicy(false)}
              className="mira-row gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Reset to Global Policy
            </Button>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
            Currently inheriting your global Habit Settings dynamically. Any
            changes to Global Settings apply immediately.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
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
            "Save monitor policy"
          )}
        </Button>
      </div>
    </div>
  );
}

export function MonitorPolicySheet({
  open,
  onOpenChange,
  monitor,
  globalSettings,
  habits,
}: MonitorPolicySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-l border-border bg-card p-0 data-[side=right]:sm:max-w-[430px]"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-sm font-semibold">
            Configure Monitor · {monitor?.monitorName ?? ""}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Adjust shared habits and per-monitor commenting cadence override.
          </SheetDescription>
        </SheetHeader>

        {monitor ? (
          <MonitorPolicyForm
            key={`${monitor.id}-${monitor.updatedAt}`}
            monitor={monitor}
            globalSettings={globalSettings}
            habits={habits}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
