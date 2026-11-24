"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { endOfDay, startOfDay } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarCheck2,
  CalendarRange,
  Check,
  Clock,
  FileText,
  Inbox,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createNoteAction,
  toggleNotePinAction,
} from "@/actions/notes";
import {
  cancelReminderAction,
  snoozeReminderAction,
} from "@/actions/reminders";
import {
  createTaskAction,
  deleteTaskAction,
  reorderTaskAction,
  toggleTaskStatusAction,
} from "@/actions/tasks";
import { useDetailSheet } from "@/components/shell/detail-sheet-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { parseQuickCapture } from "@/lib/natural-language-capture";
import type { SnoozePreset } from "@/lib/reminder-presets";
import { cn } from "@/lib/utils";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type { EnrichedReminderItem } from "@/server/dal/reminder-repository";
import type { TaskWithReminders } from "@/server/dal/task-repository";
import type { TaskStatus } from "@/server/db/schema";

function formatShortTimestamp(ms: number | null, timezone: string): string {
  if (!ms) return "";
  try {
    return formatInTimeZone(ms, timezone, "MMM d · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d · HH:mm");
  }
}

function getDayBoundsUtcMs(
  timezone: string,
  referenceUtcMs: number
): { startOfTodayMs: number; endOfTodayMs: number } {
  try {
    const zoned = toZonedTime(new Date(referenceUtcMs), timezone);
    return {
      startOfTodayMs: fromZonedTime(startOfDay(zoned), timezone).getTime(),
      endOfTodayMs: fromZonedTime(endOfDay(zoned), timezone).getTime(),
    };
  } catch {
    const zoned = toZonedTime(new Date(referenceUtcMs), "UTC");
    return {
      startOfTodayMs: fromZonedTime(startOfDay(zoned), "UTC").getTime(),
      endOfTodayMs: fromZonedTime(endOfDay(zoned), "UTC").getTime(),
    };
  }
}

const PROJECT_PILL_DOT: Record<string, string> = {
  collab: "bg-collab",
  reminder: "bg-reminder",
  done: "bg-done",
  overdue: "bg-overdue",
};

type TaskOptimisticAction =
  | { type: "toggle_status"; taskId: string; status: TaskStatus }
  | { type: "delete"; taskId: string }
  | { type: "swap"; indexA: number; indexB: number };

export function TaskListView({
  tasks,
  timezone,
  nowMs,
  emptyTitle,
  emptyDescription,
  variant = "inbox",
  initialSelectedId = null,
}: {
  tasks: TaskWithReminders[];
  timezone: string;
  nowMs: number;
  emptyTitle: string;
  emptyDescription: string;
  variant?: "inbox" | "today" | "upcoming";
  initialSelectedId?: string | null;
}) {
  const { openDetail, activeItem, closeDetail } = useDetailSheet();
  const invalidate = useInvalidateWorkspace();
  const [quickInput, setQuickInput] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deepLinkHandledRef = useRef<string | null>(null);

  const [optimisticTasks, applyOptimistic] = useOptimistic<
    TaskWithReminders[],
    TaskOptimisticAction
  >(tasks, (state, action) => {
    if (action.type === "toggle_status") {
      return state.map((entry) =>
        entry.task.id === action.taskId
          ? {
              ...entry,
              task: {
                ...entry.task,
                status: action.status,
                completedAt: action.status === "done" ? nowMs : null,
              },
              reminders: action.status === "done" ? [] : entry.reminders,
            }
          : entry
      );
    }
    if (action.type === "delete") {
      return state.filter((entry) => entry.task.id !== action.taskId);
    }
    if (action.type === "swap") {
      const next = [...state];
      const itemA = next[action.indexA];
      const itemB = next[action.indexB];
      if (itemA && itemB) {
        next[action.indexA] = itemB;
        next[action.indexB] = itemA;
      }
      return next;
    }
    return state;
  });

  // Auto-open Detail Sheet when deep-linked via `?item=<id>`
  useEffect(() => {
    if (!initialSelectedId || deepLinkHandledRef.current === initialSelectedId) {
      return;
    }
    const found = tasks.find((t) => t.task.id === initialSelectedId);
    if (found) {
      deepLinkHandledRef.current = initialSelectedId;
      openDetail({ kind: "task", data: found });
    }
  }, [initialSelectedId, tasks, openDetail]);

  const parsedQuick = useMemo(
    () =>
      parseQuickCapture(quickInput, timezone, {
        defaultKind: "task",
        referenceNow: new Date(nowMs),
      }),
    [quickInput, timezone, nowMs]
  );

  const handleQuickAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsedQuick.cleanTitle.trim() || isPending) return;

    const titleToCreate = parsedQuick.cleanTitle;
    const remindAt = parsedQuick.remindAtUtcMs;
    setQuickInput("");

    startTransition(async () => {
      const result = await createTaskAction({
        title: titleToCreate,
        dueAt: remindAt,
        remindAt,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        setQuickInput(quickInput);
        return;
      }

      await invalidate(["tasks", "reminders", "sidebar"]);
      toast.success(
        result.data.reminder
          ? `Task added with reminder (${formatShortTimestamp(
              result.data.reminder.remindAt,
              timezone
            )})`
          : "Task added."
      );
    });
  };

  const handleToggleDone = (entry: TaskWithReminders) => {
    const nextStatus: TaskStatus =
      entry.task.status === "done" ? "todo" : "done";

    startTransition(async () => {
      applyOptimistic({
        type: "toggle_status",
        taskId: entry.task.id,
        status: nextStatus,
      });

      const result = await toggleTaskStatusAction({
        taskId: entry.task.id,
        status: nextStatus,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(
        entry.task.habitId
          ? ["tasks", "reminders", "habits", "projects", "sidebar"]
          : ["tasks", "reminders", "projects", "sidebar"]
      );
      if (nextStatus === "done" && result.data.cancelledReminderCount > 0) {
        toast.success("Completed and cancelled pending reminder.");
      }
    });
  };

  const handleDelete = (taskId: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "delete", taskId });
      if (activeItem?.kind === "task" && activeItem.data.task.id === taskId) {
        closeDetail();
      }
      const result = await deleteTaskAction({ taskId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["tasks", "reminders", "projects", "sidebar"]);
      toast.success("Task deleted.");
    });
  };

  const handleMove = (groupItems: TaskWithReminders[], index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    const current = groupItems[index];
    if (!current || targetIdx < 0 || targetIdx >= groupItems.length) return;

    const prevNeighbor =
      direction === -1
        ? groupItems[targetIdx - 1]?.task.position ?? null
        : groupItems[targetIdx]?.task.position ?? null;
    const nextNeighbor =
      direction === -1
        ? groupItems[targetIdx]?.task.position ?? null
        : groupItems[targetIdx + 1]?.task.position ?? null;

    const flatIdxA = optimisticTasks.findIndex(
      (t) => t.task.id === current.task.id
    );
    const flatIdxB = optimisticTasks.findIndex(
      (t) => t.task.id === groupItems[targetIdx]?.task.id
    );

    startTransition(async () => {
      if (flatIdxA !== -1 && flatIdxB !== -1) {
        applyOptimistic({ type: "swap", indexA: flatIdxA, indexB: flatIdxB });
      }
      const result = await reorderTaskAction({
        taskId: current.task.id,
        prevPosition: prevNeighbor,
        nextPosition: nextNeighbor,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["tasks"]);
    });
  };

  const { startOfTodayMs, endOfTodayMs } = useMemo(
    () => getDayBoundsUtcMs(timezone, nowMs),
    [timezone, nowMs]
  );

  const activeTasks = optimisticTasks.filter((t) => t.task.status !== "done");
  const completedTasks = optimisticTasks.filter((t) => t.task.status === "done");

  const groups = useMemo(() => {
    const overdue: TaskWithReminders[] = [];
    const today: TaskWithReminders[] = [];
    const upcoming: TaskWithReminders[] = [];
    const unscheduled: TaskWithReminders[] = [];

    for (const entry of activeTasks) {
      const nextRem = entry.reminders[0]?.remindAt ?? null;
      const anchor = entry.task.dueAt ?? nextRem;

      if (anchor === null) {
        unscheduled.push(entry);
      } else if (anchor < nowMs && anchor < endOfTodayMs) {
        if (anchor < startOfTodayMs || (entry.task.dueAt !== null && entry.task.dueAt < nowMs)) {
          overdue.push(entry);
        } else {
          today.push(entry);
        }
      } else if (anchor <= endOfTodayMs) {
        today.push(entry);
      } else {
        upcoming.push(entry);
      }
    }

    return [
      { key: "overdue", label: "Overdue", tone: "overdue" as const, items: overdue },
      { key: "today", label: "Today", tone: "default" as const, items: today },
      { key: "upcoming", label: "Upcoming", tone: "default" as const, items: upcoming },
      { key: "unscheduled", label: "Unscheduled", tone: "muted" as const, items: unscheduled },
    ].filter((g) => g.items.length > 0);
  }, [activeTasks, endOfTodayMs, nowMs, startOfTodayMs]);

  const EmptyIcon =
    variant === "today"
      ? CalendarCheck2
      : variant === "upcoming"
        ? CalendarRange
        : Inbox;

  const renderTaskRow = (
    entry: TaskWithReminders,
    index: number,
    groupItems: TaskWithReminders[],
    allowReorder: boolean
  ) => {
    const { task } = entry;
    const isDone = task.status === "done";
    const nextReminder = entry.reminders[0] ?? null;
    const isOverdue =
      !isDone && task.dueAt !== null && task.dueAt < nowMs;
    const isSelected =
      activeItem?.kind === "task" && activeItem.data.task.id === task.id;

    return (
      <div
        key={task.id}
        className={cn(
          "mira-row group flex items-center justify-between gap-2 px-2.5 text-xs transition-colors hover:bg-accent/60",
          isSelected && "bg-accent"
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={isDone}
            aria-label={isDone ? `Mark "${task.title}" incomplete` : `Complete "${task.title}"`}
            onClick={() => handleToggleDone(entry)}
            className="flex size-9 shrink-0 items-center justify-center rounded md:size-5"
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-[4px] border transition-colors",
                isDone
                  ? "border-done bg-done text-primary-foreground"
                  : "border-muted-foreground/50 bg-background hover:border-foreground"
              )}
            >
              {isDone ? <Check className="size-2.5 stroke-[2.5]" /> : null}
            </span>
          </button>

          <button
            type="button"
            onClick={() => openDetail({ kind: "task", data: entry })}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 py-1 text-left md:min-h-7"
          >
            <span
              className={cn(
                "truncate font-medium",
                isDone
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              )}
            >
              {task.title}
            </span>

            {entry.projectName ? (
              <span className="hidden shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    PROJECT_PILL_DOT[entry.projectColorToken ?? "collab"] ??
                      "bg-collab"
                  )}
                />
                {entry.projectName}
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {task.priority !== "none" && !isDone ? (
            <Badge
              variant="outline"
              className={cn(
                "hidden h-5 px-1.5 text-[10px] font-normal capitalize sm:inline-flex",
                task.priority === "high" && "border-overdue/40 text-overdue"
              )}
            >
              {task.priority}
            </Badge>
          ) : null}

          {nextReminder ? (
            <span
              title={`Reminder: ${formatShortTimestamp(nextReminder.remindAt, timezone)}`}
              className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/30 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder"
            >
              <Bell className="size-2.5 shrink-0" />
              {formatShortTimestamp(nextReminder.remindAt, timezone)}
            </span>
          ) : task.dueAt ? (
            <span
              className={cn(
                "mono-tabular text-[11px]",
                isOverdue ? "font-medium text-overdue" : "text-muted-foreground"
              )}
            >
              {formatShortTimestamp(task.dueAt, timezone)}
            </span>
          ) : null}

          <div className="flex items-center gap-0.5 md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            {allowReorder && groupItems.length > 1 ? (
              <>
                <button
                  type="button"
                  disabled={index === 0 || isPending}
                  onClick={() => handleMove(groupItems, index, -1)}
                  aria-label="Move task up"
                  className="flex size-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 md:size-5"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={index === groupItems.length - 1 || isPending}
                  onClick={() => handleMove(groupItems, index, 1)}
                  aria-label="Move task down"
                  className="flex size-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 md:size-5"
                >
                  <ArrowDown className="size-3" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDelete(task.id)}
              aria-label={`Delete "${task.title}"`}
              className="flex size-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-overdue md:size-5"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Inline natural-language quick-add bar */}
      <form
        onSubmit={handleQuickAdd}
        className="space-y-1.5 rounded-md border border-border bg-card p-2"
      >
        <div className="flex items-center gap-2">
          <Plus className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
          <Input
            name="inlineTaskInput"
            aria-label="Add a task"
            placeholder='Add a task… try "Pay Umeme bill tomorrow 9am"'
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!parsedQuick.cleanTitle.trim() || isPending}
            className="h-9 px-3 text-xs md:h-7 md:px-2.5"
          >
            Add
          </Button>
        </div>

        {parsedQuick.detectedPhrase && parsedQuick.remindAtUtcMs ? (
          <div className="flex items-center justify-between border-t border-border/60 px-1 pt-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded border border-reminder/35 bg-reminder/10 px-1.5 py-0.5 text-reminder">
              <Bell className="size-2.5" />
              Detected: &ldquo;{parsedQuick.detectedPhrase}&rdquo;
            </span>
            <span className="mono-tabular text-reminder">
              {formatShortTimestamp(parsedQuick.remindAtUtcMs, timezone)}
            </span>
          </div>
        ) : null}
      </form>

      {groups.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
          <EmptyIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2.5 text-xs font-medium text-foreground">
            {emptyTitle}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {emptyDescription}
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Press{" "}
            <kbd className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground">
              ⌘K
            </kbd>{" "}
            to capture your first task or note
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-wider",
                    group.tone === "overdue"
                      ? "text-overdue"
                      : "text-muted-foreground"
                  )}
                >
                  {group.label}
                </h2>
                <span className="mono-tabular text-[10px] text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {group.items.map((entry, idx) =>
                  renderTaskRow(
                    entry,
                    idx,
                    group.items,
                    variant === "inbox"
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {completedTasks.length > 0 ? (
        <section className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowCompleted((prev) => !prev)}
            className="flex items-center gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <span>Completed</span>
            <span className="mono-tabular">{completedTasks.length}</span>
            <span className="text-[10px] normal-case">
              ({showCompleted ? "hide" : "show"})
            </span>
          </button>
          {showCompleted ? (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
              {completedTasks.map((entry, idx) =>
                renderTaskRow(entry, idx, completedTasks, false)
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

type ReminderOptimisticAction =
  | { type: "snooze"; reminderId: string; remindAt: number }
  | { type: "cancel"; reminderId: string };

export function ReminderListView({
  reminders,
  timezone,
  nowMs,
}: {
  reminders: EnrichedReminderItem[];
  timezone: string;
  nowMs: number;
}) {
  const { openDetail, activeItem, closeDetail } = useDetailSheet();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const [optimisticItems, applyOptimistic] = useOptimistic<
    EnrichedReminderItem[],
    ReminderOptimisticAction
  >(reminders, (state, action) => {
    if (action.type === "cancel") {
      return state.filter((item) => item.reminder.id !== action.reminderId);
    }
    if (action.type === "snooze") {
      return state
        .map((item) =>
          item.reminder.id === action.reminderId
            ? {
                ...item,
                reminder: {
                  ...item.reminder,
                  remindAt: action.remindAt,
                  status: "scheduled" as const,
                  version: item.reminder.version + 1,
                },
              }
            : item
        )
        .sort((a, b) => a.reminder.remindAt - b.reminder.remindAt);
    }
    return state;
  });

  const handleSnooze = (item: EnrichedReminderItem, preset: SnoozePreset) => {
    const roughMs =
      preset === "15m"
        ? nowMs + 15 * 60_000
        : preset === "1h"
          ? nowMs + 60 * 60_000
          : nowMs + 24 * 60 * 60_000;

    startTransition(async () => {
      applyOptimistic({
        type: "snooze",
        reminderId: item.reminder.id,
        remindAt: roughMs,
      });

      const result = await snoozeReminderAction({
        reminderId: item.reminder.id,
        preset,
        expectedVersion: item.reminder.version,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success(
        `Snoozed to ${formatShortTimestamp(result.data.remindAt, timezone)}`
      );
    });
  };

  const handleCancel = (item: EnrichedReminderItem) => {
    startTransition(async () => {
      applyOptimistic({ type: "cancel", reminderId: item.reminder.id });
      if (
        activeItem?.kind === "reminder" &&
        activeItem.data.reminder.id === item.reminder.id
      ) {
        closeDetail();
      }

      const result = await cancelReminderAction({
        reminderId: item.reminder.id,
        expectedVersion: item.reminder.version,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success("Reminder cancelled.");
    });
  };

  if (optimisticItems.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
        <Bell className="mx-auto size-5 text-reminder" />
        <p className="mt-2.5 text-xs font-medium text-foreground">
          No active reminders
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Press ⌘K to capture a task or note with a natural-language time, or
          attach a reminder from any item&rsquo;s side inspector.
        </p>
      </div>
    );
  }

  const scheduled = optimisticItems.filter(
    (i) => i.reminder.status === "scheduled" || i.reminder.status === "snoozed"
  );
  const farHorizon = optimisticItems.filter(
    (i) => i.reminder.status === "pending_far"
  );
  const sent = optimisticItems.filter((i) => i.reminder.status === "sent");

  const sections = [
    { key: "scheduled", label: "Scheduled (≤ 14 days)", items: scheduled },
    { key: "far", label: "Horizon (> 14 days)", items: farHorizon },
    { key: "sent", label: "Recently triggered", items: sent },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.key} className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {section.label}
            </h2>
            <span className="mono-tabular text-[10px] text-muted-foreground">
              {section.items.length}
            </span>
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {section.items.map((item) => {
              const { reminder } = item;
              const isSelected =
                activeItem?.kind === "reminder" &&
                activeItem.data.reminder.id === reminder.id;

              return (
                <div
                  key={reminder.id}
                  className={cn(
                    "mira-row flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent/60",
                    isSelected && "bg-accent"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openDetail({ kind: "reminder", data: item })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Bell className="size-3.5 shrink-0 text-reminder" />
                    <span className="truncate font-medium text-foreground">
                      {item.entityTitle}
                    </span>
                    <Badge
                      variant="secondary"
                      className="h-4 px-1.5 text-[10px] font-normal capitalize"
                    >
                      {reminder.taskId ? "task" : "note"}
                    </Badge>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="mono-tabular text-[11px] font-medium text-reminder">
                      {formatShortTimestamp(reminder.remindAt, timezone)}
                    </span>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleSnooze(item, "15m")}
                        className="mono-tabular h-5 px-1.5 text-[10px]"
                      >
                        <Clock className="mr-0.5 size-2.5 text-reminder" />
                        +15m
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleSnooze(item, "1h")}
                        className="mono-tabular h-5 px-1.5 text-[10px]"
                      >
                        +1h
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleSnooze(item, "tomorrow_9am")}
                        className="hidden h-5 px-1.5 text-[10px] sm:inline-flex"
                      >
                        Tom 9 AM
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleCancel(item)}
                        aria-label="Cancel reminder"
                        className="h-5 px-1.5 text-[10px] text-overdue hover:text-overdue"
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

type NoteOptimisticAction = { type: "toggle_pin"; noteId: string };

export function NoteListView({
  notes,
  timezone,
  initialSelectedId = null,
}: {
  notes: NoteWithReminders[];
  timezone: string;
  initialSelectedId?: string | null;
}) {
  const { openDetail, activeItem } = useDetailSheet();
  const invalidate = useInvalidateWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const deepLinkHandledRef = useRef<string | null>(null);

  const [optimisticNotes, applyOptimistic] = useOptimistic<
    NoteWithReminders[],
    NoteOptimisticAction
  >(notes, (state, action) => {
    if (action.type === "toggle_pin") {
      return state.map((entry) =>
        entry.note.id === action.noteId
          ? {
              ...entry,
              note: { ...entry.note, isPinned: !entry.note.isPinned },
            }
          : entry
      );
    }
    return state;
  });

  useEffect(() => {
    if (!initialSelectedId || deepLinkHandledRef.current === initialSelectedId) {
      return;
    }
    const found = notes.find((n) => n.note.id === initialSelectedId);
    if (found) {
      deepLinkHandledRef.current = initialSelectedId;
      openDetail({ kind: "note", data: found });
    }
  }, [initialSelectedId, notes, openDetail]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const entry of optimisticNotes) {
      for (const tag of entry.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [optimisticNotes]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return optimisticNotes.filter((entry) => {
      if (activeTag && !entry.tags.includes(activeTag)) return false;
      if (q) {
        const hay =
          `${entry.note.title} ${entry.note.content} ${entry.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [optimisticNotes, searchQuery, activeTag]);

  const pinned = filtered.filter((n) => n.note.isPinned);
  const unpinned = filtered.filter((n) => !n.note.isPinned);

  const handleQuickNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = newNoteTitle.trim();
    if (!raw || isPending) return;

    const parsed = parseQuickCapture(raw, timezone, { defaultKind: "note" });
    setNewNoteTitle("");

    startTransition(async () => {
      const result = await createNoteAction({
        title: parsed.cleanTitle || raw,
        content: "",
        tags: activeTag ? [activeTag] : [],
        remindAt: parsed.remindAtUtcMs,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        setNewNoteTitle(raw);
        return;
      }

      await invalidate(["notes", "reminders", "sidebar"]);
      toast.success(
        result.data.reminder
          ? `Note created with reminder (${formatShortTimestamp(
              result.data.reminder.remindAt,
              timezone
            )})`
          : "Note created."
      );
      openDetail({
        kind: "note",
        data: {
          note: result.data.note,
          tags: activeTag ? [activeTag] : [],
          projectName: null,
          projectColorToken: null,
          reminders: result.data.reminder ? [result.data.reminder] : [],
        },
      });
    });
  };

  const handleTogglePin = (noteId: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "toggle_pin", noteId });
      const result = await toggleNotePinAction({ noteId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["notes"]);
    });
  };

  const renderNoteRow = (entry: NoteWithReminders) => {
    const { note } = entry;
    const nextReminder = entry.reminders[0] ?? null;
    const isSelected =
      activeItem?.kind === "note" && activeItem.data.note.id === note.id;

    return (
      <div
        key={note.id}
        className={cn(
          "mira-row group flex items-center justify-between gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent/60",
          isSelected && "bg-accent"
        )}
      >
        <button
          type="button"
          onClick={() => openDetail({ kind: "note", data: entry })}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left md:min-h-7"
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            {note.title}
          </span>
          {entry.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="hidden h-4 px-1.5 text-[10px] font-normal sm:inline-flex"
            >
              #{tag}
            </Badge>
          ))}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {nextReminder ? (
            <span className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/30 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
              <Bell className="size-2.5 shrink-0" />
              {formatShortTimestamp(nextReminder.remindAt, timezone)}
            </span>
          ) : null}

          <span className="mono-tabular hidden text-[11px] text-muted-foreground sm:inline">
            {formatShortTimestamp(note.updatedAt, timezone)}
          </span>

          <button
            type="button"
            onClick={() => handleTogglePin(note.id)}
            aria-label={note.isPinned ? `Unpin "${note.title}"` : `Pin "${note.title}"`}
            className={cn(
              "flex size-9 items-center justify-center rounded transition-colors hover:bg-muted md:size-6",
              note.isPinned
                ? "text-foreground"
                : "text-muted-foreground opacity-50 group-hover:opacity-100"
            )}
          >
            <Pin className="size-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Quick Note Capture + Search */}
      <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
        <form
          onSubmit={handleQuickNote}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
        >
          <Plus className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            name="quickNoteTitle"
            aria-label="New note title"
            placeholder="New note title (add a date/time to attach a reminder)…"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newNoteTitle.trim() || isPending}
            className="h-9 px-3 text-xs md:h-7 md:px-2.5"
          >
            New note
          </Button>
        </form>

        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            name="notesSearch"
            aria-label="Filter notes"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Instant Tag Filter Chips */}
      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "min-h-9 rounded border px-2.5 py-0.5 text-[11px] transition-colors md:min-h-6 md:px-2",
              activeTag === null
                ? "border-foreground bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            All notes
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setActiveTag((prev) => (prev === tag ? null : tag))
              }
              className={cn(
                "min-h-9 rounded border px-2.5 py-0.5 text-[11px] transition-colors md:min-h-6 md:px-2",
                activeTag === tag
                  ? "border-foreground bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              #{tag}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
          <FileText className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2.5 text-xs font-medium text-foreground">
            {optimisticNotes.length === 0
              ? "No notes yet"
              : "No notes match your filter"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Capture quiet reference notes or attach an optional timed reminder
            in the side inspector.
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Press{" "}
            <kbd className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground">
              ⌘K
            </kbd>{" "}
            then{" "}
            <kbd className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground">
              Tab
            </kbd>{" "}
            to capture a note from anywhere
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 ? (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pinned
                </h2>
                <span className="mono-tabular text-[10px] text-muted-foreground">
                  {pinned.length}
                </span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {pinned.map(renderNoteRow)}
              </div>
            </section>
          ) : null}

          {unpinned.length > 0 ? (
            <section className="space-y-1.5">
              {pinned.length > 0 ? (
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Notes
                  </h2>
                  <span className="mono-tabular text-[10px] text-muted-foreground">
                    {unpinned.length}
                  </span>
                </div>
              ) : null}
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {unpinned.map(renderNoteRow)}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-end text-[11px] text-muted-foreground">
        <Link
          href="/app/reminders"
          className="inline-flex min-h-9 items-center px-1 hover:text-foreground hover:underline md:min-h-6"
        >
          View all active reminders →
        </Link>
      </div>
    </div>
  );
}
