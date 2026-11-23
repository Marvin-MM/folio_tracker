"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  inviteCollaboratorMonitorAction,
  inviteMonitorByEmailAction,
} from "@/actions/habits-social";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { KnownCollaborator } from "@/server/dal/habits-social";
import type {
  HabitCommentMode,
  HabitMonitorScope,
  HabitRecord,
} from "@/server/db/schema";

interface InviteMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaborators: KnownCollaborator[];
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

export function InviteMonitorDialog({
  open,
  onOpenChange,
  collaborators,
  habits,
}: InviteMonitorDialogProps) {
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<HabitMonitorScope>("all");
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [useCustomPolicy, setUseCustomPolicy] = useState(false);
  const [customMode, setCustomMode] =
    useState<HabitCommentMode>("weekly_window");
  const [startDay, setStartDay] = useState(6);
  const [startTime, setStartTime] = useState("00:00");
  const [endDay, setEndDay] = useState(0);
  const [endTime, setEndTime] = useState("23:59");
  const [intervalDays, setIntervalDays] = useState("4");
  const [intervalAnchorDate, setIntervalAnchorDate] = useState("2026-11-01");
  const [intervalOpenHours, setIntervalOpenHours] = useState("24");
  const [allowReactions, setAllowReactions] = useState(true);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEmail("");
      setScope("all");
      setSelectedHabitIds([]);
      setUseCustomPolicy(false);
      setCustomMode("weekly_window");
      setStartDay(6);
      setStartTime("00:00");
      setEndDay(0);
      setEndTime("23:59");
      setIntervalDays("4");
      setIntervalAnchorDate("2026-11-01");
      setIntervalOpenHours("24");
      setAllowReactions(true);
    }
    onOpenChange(nextOpen);
  };

  const toggleHabit = (habitId: string) => {
    setSelectedHabitIds((prev) =>
      prev.includes(habitId)
        ? prev.filter((id) => id !== habitId)
        : [...prev, habitId]
    );
  };

  const buildCustomPolicyPayload = () => {
    if (!useCustomPolicy) return { useCustomPolicy: false };
    return {
      useCustomPolicy: true,
      customCommentMode: customMode,
      customWindowStartDay: customMode === "weekly_window" ? startDay : null,
      customWindowStartTime: customMode === "weekly_window" ? startTime : null,
      customWindowEndDay: customMode === "weekly_window" ? endDay : null,
      customWindowEndTime: customMode === "weekly_window" ? endTime : null,
      customIntervalDays:
        customMode === "interval_days"
          ? Math.max(2, Math.min(30, Number(intervalDays) || 4))
          : null,
      customIntervalAnchorDate:
        customMode === "interval_days" ? intervalAnchorDate || null : null,
      customIntervalOpenHours:
        customMode === "interval_days"
          ? Math.max(1, Math.min(168, Number(intervalOpenHours) || 24))
          : null,
      customAllowReactionsWhenLocked: allowReactions,
    };
  };

  const handleQuickPick = (collaborator: KnownCollaborator) => {
    if (scope === "selected" && selectedHabitIds.length === 0) {
      toast.error("Select at least one habit to share first.");
      return;
    }
    startTransition(async () => {
      const result = await inviteCollaboratorMonitorAction({
        targetUserId: collaborator.userId,
        scope,
        selectedHabitIds: scope === "selected" ? selectedHabitIds : [],
        customPolicy: buildCustomPolicyPayload(),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(result.data.message);
      handleOpenChange(false);
    });
  };

  const handleEmailSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || isPending) return;
    if (scope === "selected" && selectedHabitIds.length === 0) {
      toast.error("Select at least one habit to share first.");
      return;
    }

    startTransition(async () => {
      const result = await inviteMonitorByEmailAction({
        email: email.trim(),
        scope,
        selectedHabitIds: scope === "selected" ? selectedHabitIds : [],
        customPolicy: buildCustomPolicyPayload(),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(result.data.message);
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-border bg-card sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Invite Accountability Monitor
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Share a read-only view of your habits and control exactly when they
            can post review feedback.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scope Picker */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">
              Visibility scope
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { value: "all" as const, label: "All Active Habits" },
                  { value: "selected" as const, label: "Selected Habits Only" },
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
              <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-md border border-border bg-background p-2.5">
                {habits.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Create at least one active habit before sharing selected
                    items.
                  </p>
                ) : (
                  habits.map((h) => {
                    const checked = selectedHabitIds.includes(h.id);
                    return (
                      <label
                        key={h.id}
                        className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-foreground md:min-h-6"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleHabit(h.id)}
                        />
                        <span className="truncate">{h.title}</span>
                      </label>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          {/* Optional Per-Monitor Policy Override */}
          <div className="space-y-2.5 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <Label
                  htmlFor="invite-custom-policy"
                  className="text-xs font-medium"
                >
                  Custom review cadence for this monitor
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Leave off to inherit your global Habit Settings dynamically.
                </p>
              </div>
              <Switch
                id="invite-custom-policy"
                checked={useCustomPolicy}
                onCheckedChange={setUseCustomPolicy}
              />
            </div>

            {useCustomPolicy ? (
              <div className="space-y-2.5 border-t border-border pt-2.5">
                <Select
                  value={customMode}
                  onValueChange={(v) => setCustomMode(v as HabitCommentMode)}
                >
                  <SelectTrigger className="mira-row bg-card text-xs">
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
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Every N days
                      </span>
                      <Input
                        type="number"
                        min={2}
                        max={30}
                        value={intervalDays}
                        onChange={(e) => setIntervalDays(e.target.value)}
                        className="mono-tabular mira-row bg-card text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Open (hrs)
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={168}
                        value={intervalOpenHours}
                        onChange={(e) => setIntervalOpenHours(e.target.value)}
                        className="mono-tabular mira-row bg-card text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Anchor
                      </span>
                      <Input
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
                    Allow quiet reactions while locked
                  </span>
                  <Switch
                    checked={allowReactions}
                    onCheckedChange={setAllowReactions}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Path A — Quick-Pick Collaborators */}
          {collaborators.length > 0 ? (
            <div className="space-y-2">
              <span className="text-xs font-medium text-foreground">
                Quick-pick project collaborators
              </span>
              <div className="divide-y divide-border rounded-md border border-border bg-background">
                {collaborators.map((person) => (
                  <div
                    key={person.userId}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">
                        {person.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {person.email}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleQuickPick(person)}
                      className="mira-row shrink-0 gap-1 px-2.5 text-xs"
                    >
                      <UserPlus className="size-3" />
                      Send Request
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <Separator />

          {/* Path B — Invite by Email (Anti-Enumeration) */}
          <form onSubmit={handleEmailSubmit} className="space-y-2.5">
            <Label htmlFor="invite-monitor-email" className="text-xs">
              Invite by email
            </Label>
            <div className="flex gap-2">
              <Input
                id="invite-monitor-email"
                name="monitorEmail"
                type="email"
                required
                placeholder="friend@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mira-row flex-1 bg-background text-xs"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!email.trim() || isPending}
                className="mira-row shrink-0 gap-1.5 px-3.5 text-xs"
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Mail className="size-3.5" />
                )}
                Send Invite
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Existing Folio members receive an instant in-app request; new
              friends receive a single-use email link valid for 7 days.
            </p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
