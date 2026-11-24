"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createHabitAction } from "@/actions/habits";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { cn } from "@/lib/utils";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type { HabitCadenceType } from "@/server/db/schema";

interface CreateHabitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayDateKey: string;
  targetYearMonth?: string;
  projects: SidebarProjectItem[];
}

const WEEKDAYS = [
  { day: 1, label: "Mon", letter: "M" },
  { day: 2, label: "Tue", letter: "T" },
  { day: 3, label: "Wed", letter: "W" },
  { day: 4, label: "Thu", letter: "T" },
  { day: 5, label: "Fri", letter: "F" },
  { day: 6, label: "Sat", letter: "S" },
  { day: 0, label: "Sun", letter: "S" },
] as const;

export function CreateHabitDialog({
  open,
  onOpenChange,
  todayDateKey,
  targetYearMonth,
  projects,
}: CreateHabitDialogProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [cadenceType, setCadenceType] = useState<HabitCadenceType>("daily");
  const [scheduledDays, setScheduledDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeklyTargetCount, setWeeklyTargetCount] = useState(4);
  const [startDate, setStartDate] = useState(todayDateKey);
  const [preferredTime, setPreferredTime] = useState("");
  const [linkedProjectId, setLinkedProjectId] = useState("none");
  const [autoSyncDailyTask, setAutoSyncDailyTask] = useState(false);
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();

  const editableProjects = projects.filter(
    (p) => p.role === "owner" || p.role === "editor"
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("");
      setCategory("");
      setDescription("");
      setCadenceType("daily");
      setScheduledDays([1, 2, 3, 4, 5]);
      setWeeklyTargetCount(4);
      setStartDate(todayDateKey);
      setPreferredTime("");
      setLinkedProjectId("none");
      setAutoSyncDailyTask(false);
    }
    onOpenChange(nextOpen);
  };

  const toggleDay = (day: number) => {
    setScheduledDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || isPending) return;

    startTransition(async () => {
      const result = await createHabitAction({
        title: title.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        cadenceType,
        scheduledDays: cadenceType === "specific_days" ? scheduledDays : [],
        weeklyTargetCount:
          cadenceType === "weekly_target" ? weeklyTargetCount : null,
        startDate,
        targetYearMonth,
        preferredTime: preferredTime.trim() || null,
        linkedProjectId: linkedProjectId === "none" ? null : linkedProjectId,
        autoSyncDailyTask,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(["habits", "today", "tasks", "sidebar", "admin"]);
      toast.success(`Habit "${result.data.title}" added.`);
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New habit</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Track a recurring routine with real-calendar scoring starting on your
            chosen date.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-habit-title" className="text-xs">
              Habit title
            </Label>
            <Input
              id="new-habit-title"
              name="habitTitle"
              autoFocus
              required
              maxLength={120}
              placeholder="Morning deep work (60m)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mira-row bg-background text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label htmlFor="new-habit-category" className="text-xs">
                Category (optional)
              </Label>
              <Input
                id="new-habit-category"
                name="habitCategory"
                maxLength={48}
                placeholder="Health, Craft, Study…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mira-row bg-background text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-habit-start" className="text-xs">
                Start date
              </Label>
              <Input
                id="new-habit-start"
                name="habitStartDate"
                type="date"
                required
                max={todayDateKey}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mono-tabular mira-row bg-background text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-habit-cadence" className="text-xs">
              Cadence
            </Label>
            <Select
              name="habitCadence"
              value={cadenceType}
              onValueChange={(v) => setCadenceType(v as HabitCadenceType)}
            >
              <SelectTrigger
                id="new-habit-cadence"
                className="mira-row bg-background text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily" className="text-xs">
                  Daily (every day)
                </SelectItem>
                <SelectItem value="specific_days" className="text-xs">
                  Specific weekdays
                </SelectItem>
                <SelectItem value="weekly_target" className="text-xs">
                  Weekly target (N× per week)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cadenceType === "specific_days" ? (
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Active weekdays
              </span>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w) => {
                  const active = scheduledDays.includes(w.day);
                  return (
                    <button
                      key={w.day}
                      type="button"
                      aria-label={w.label}
                      aria-pressed={active}
                      onClick={() => toggleDay(w.day)}
                      className={cn(
                        "mira-row rounded border text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {w.letter}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {cadenceType === "weekly_target" ? (
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Target days per week
              </span>
              <div className="grid grid-cols-7 gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={weeklyTargetCount === n}
                    onClick={() => setWeeklyTargetCount(n)}
                    className={cn(
                      "mono-tabular mira-row rounded border text-xs font-medium transition-colors",
                      weeklyTargetCount === n
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label htmlFor="new-habit-time" className="text-xs">
                Preferred nudge time
              </Label>
              <Input
                id="new-habit-time"
                name="habitPreferredTime"
                type="time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="mono-tabular mira-row bg-background text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-habit-project" className="text-xs">
                Link to project
              </Label>
              <Select
                name="habitProject"
                value={linkedProjectId}
                onValueChange={setLinkedProjectId}
              >
                <SelectTrigger
                  id="new-habit-project"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    Personal (none)
                  </SelectItem>
                  {editableProjects.map((project) => (
                    <SelectItem
                      key={project.id}
                      value={project.id}
                      className="text-xs"
                    >
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
            <div className="space-y-0.5 pr-3">
              <Label
                htmlFor="new-habit-autosync"
                className="text-xs font-medium"
              >
                Auto-sync daily task
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Seed a Today task linked bidirectionally with this habit.
              </p>
            </div>
            <Switch
              id="new-habit-autosync"
              checked={autoSyncDailyTask}
              onCheckedChange={setAutoSyncDailyTask}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-habit-desc" className="text-xs">
              Cue or note (optional)
            </Label>
            <Textarea
              id="new-habit-desc"
              name="habitDescription"
              rows={2}
              placeholder="After morning coffee, write 300 words before checking messages…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim() || isPending}
              className="mira-row px-4 text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add habit"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
