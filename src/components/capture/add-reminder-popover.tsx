"use client";

import { useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { BellPlus, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { attachReminderAction } from "@/actions/reminders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import {
  computeQuickReminderPresetUtcMs,
  zonedWallClockToUtcMs,
  type QuickReminderPreset,
} from "@/lib/reminder-presets";
import type { ReminderEntityType, ReminderRecord } from "@/server/db/schema";

interface AddReminderPopoverProps {
  entityType: ReminderEntityType;
  entityId: string;
  timezone: string;
  onAttached?: (reminder: ReminderRecord) => void;
  triggerLabel?: string;
}

function computeDefaultTomorrowDate(timezone: string): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  try {
    return formatInTimeZone(tomorrow, timezone, "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(tomorrow, "UTC", "yyyy-MM-dd");
  }
}

export function AddReminderPopover({
  entityType,
  entityId,
  timezone,
  onAttached,
  triggerLabel = "Add reminder",
}: AddReminderPopoverProps) {
  const [open, setOpen] = useState(false);
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !customDate) {
      setCustomDate(computeDefaultTomorrowDate(timezone));
    }
    setOpen(nextOpen);
  };

  const scheduleAt = (remindAtUtcMs: number) => {
    startTransition(async () => {
      const result = await attachReminderAction({
        entityType,
        entityId,
        remindAt: remindAtUtcMs,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setOpen(false);
      onAttached?.(result.data);
      const formatted = formatInTimeZone(
        result.data.remindAt,
        timezone,
        "MMM d · HH:mm"
      );
      toast.success(`Reminder set for ${formatted}`);
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
    });
  };

  const handlePreset = (preset: QuickReminderPreset) => {
    const targetMs = computeQuickReminderPresetUtcMs(preset, timezone);
    scheduleAt(targetMs);
  };

  const handleCustomSubmit = () => {
    const utcMs = zonedWallClockToUtcMs(customDate, customTime, timezone);
    if (!utcMs) {
      toast.error("Please select a valid date and time.");
      return;
    }
    scheduleAt(utcMs);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mira-row gap-1.5 border-border bg-background text-xs text-foreground hover:border-reminder/50 hover:text-reminder"
        >
          <BellPlus className="size-3.5 text-reminder" />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Schedule reminder"
        className="w-64 space-y-2.5 border-border bg-popover p-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">
            Schedule reminder
          </span>
          <span className="mono-tabular text-[10px] text-muted-foreground">
            {timezone}
          </span>
        </div>

        <div className="space-y-1">
          {(
            [
              { key: "later_today", label: "Later today" },
              { key: "tomorrow_9am", label: "Tomorrow 9:00 AM" },
              { key: "next_week", label: "Next week (Mon 9:00 AM)" },
            ] as const
          ).map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handlePreset(preset.key)}
              className="mira-row w-full justify-start gap-2 px-2 text-xs font-normal text-foreground hover:bg-accent"
            >
              <CalendarClock className="size-3.5 text-reminder" />
              <span>{preset.label}</span>
            </Button>
          ))}
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            Custom date &amp; time
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <Label htmlFor="custom-rem-date" className="text-[10px]">
                Date
              </Label>
              <Input
                id="custom-rem-date"
                name="customReminderDate"
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="mono-tabular h-7 bg-background px-2 text-[11px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="custom-rem-time" className="text-[10px]">
                Time
              </Label>
              <Input
                id="custom-rem-time"
                name="customReminderTime"
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="mono-tabular h-7 bg-background px-2 text-[11px]"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleCustomSubmit}
            className="mira-row w-full text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Scheduling…
              </>
            ) : (
              "Set custom reminder"
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
