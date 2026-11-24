"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import {
  Archive,
  Bell,
  Calendar,
  CheckSquare,
  Clock,
  ExternalLink,
  FileText,
  Flame,
  Loader2,
  Pin,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveHabitAction,
  deleteHabitAction,
  promoteTaskToHabitAction,
  updateHabitAction,
} from "@/actions/habits";
import { isFeatureEnabled } from "@/config/features";
import { deleteNoteAction, updateNoteAction } from "@/actions/notes";
import { cancelReminderAction, snoozeReminderAction } from "@/actions/reminders";
import { deleteTaskAction, updateTaskAction } from "@/actions/tasks";
import { AddReminderPopover } from "@/components/capture/add-reminder-popover";
import {
  useDetailSheet,
  type DetailSheetItem,
} from "@/components/shell/detail-sheet-context";
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
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import {
  zonedWallClockToUtcMs,
  type SnoozePreset,
} from "@/lib/reminder-presets";
import { cn } from "@/lib/utils";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type { ProjectMemberWithUser } from "@/server/dal/project-repository";
import type { EnrichedReminderItem } from "@/server/dal/reminder-repository";
import type { TaskWithReminders } from "@/server/dal/task-repository";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type {
  HabitCadenceType,
  HabitRecord,
  ReminderRecord,
  TaskPriority,
  TaskStatus,
} from "@/server/db/schema";
import {
  parseScheduledDaysJson,
  type HabitRowSummary,
} from "@/server/domain/habit-analytics";
import {
  ENERGY_NEEDS,
  PLACES,
  parseTagsJson,
  type EnergyNeed,
  type Place,
} from "@/server/domain/habit-metadata";

interface DetailSheetProps {
  timezone: string;
}

function formatUtcMs(ms: number | null | undefined, timezone: string): string {
  if (!ms) return "—";
  try {
    return formatInTimeZone(ms, timezone, "MMM d, yyyy · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d, yyyy · HH:mm");
  }
}

function toLocalDateInput(ms: number | null, timezone: string): string {
  if (!ms) return "";
  try {
    return formatInTimeZone(ms, timezone, "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(ms, "UTC", "yyyy-MM-dd");
  }
}

function toLocalTimeInput(ms: number | null, timezone: string): string {
  if (!ms) return "09:00";
  try {
    return formatInTimeZone(ms, timezone, "HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "HH:mm");
  }
}

function AttachedRemindersSection({
  reminders,
  timezone,
  onUpdated,
  onCancelled,
}: {
  reminders: ReminderRecord[];
  timezone: string;
  onUpdated: (updated: ReminderRecord) => void;
  onCancelled: (reminderId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();

  const handleSnooze = (reminder: ReminderRecord, preset: SnoozePreset) => {
    startTransition(async () => {
      const result = await snoozeReminderAction({
        reminderId: reminder.id,
        preset,
        expectedVersion: reminder.version,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onUpdated(result.data);
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success(
        `Snoozed to ${formatUtcMs(result.data.remindAt, timezone)}`
      );
    });
  };

  const handleCancel = (reminder: ReminderRecord) => {
    startTransition(async () => {
      const result = await cancelReminderAction({
        reminderId: reminder.id,
        expectedVersion: reminder.version,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onCancelled(reminder.id);
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success("Reminder cancelled.");
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Reminders ({reminders.length})
        </span>
      </div>

      {reminders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          No timed reminders attached. Use &ldquo;Add reminder&rdquo; above to
          schedule one.
        </p>
      ) : (
        <div className="space-y-1.5">
          {reminders.map((rem) => (
            <div
              key={rem.id}
              className="space-y-1.5 rounded-md border border-reminder/30 bg-reminder/5 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="mono-tabular flex items-center gap-1.5 text-[11px] font-medium text-reminder">
                  <Bell className="size-3 shrink-0" />
                  {formatUtcMs(rem.remindAt, timezone)}
                </span>
                <Badge
                  variant="outline"
                  className="h-4 border-reminder/30 px-1 text-[9px] font-normal capitalize text-reminder"
                >
                  {rem.status === "pending_far" ? "> 14d horizon" : rem.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleSnooze(rem, "15m")}
                    className="mono-tabular h-5 px-1.5 text-[10px]"
                  >
                    +15m
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleSnooze(rem, "1h")}
                    className="mono-tabular h-5 px-1.5 text-[10px]"
                  >
                    +1h
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleSnooze(rem, "tomorrow_9am")}
                    className="h-5 px-1.5 text-[10px]"
                  >
                    Tom 9 AM
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isPending}
                  onClick={() => handleCancel(rem)}
                  className="h-5 px-1.5 text-[10px] text-overdue hover:text-overdue"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskInspectorForm({
  item,
  timezone,
  readOnly = false,
  projectMembers,
  onSync,
  onClose,
}: {
  item: TaskWithReminders;
  timezone: string;
  readOnly?: boolean;
  projectMembers?: ProjectMemberWithUser[];
  onSync: (next: TaskWithReminders) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.task.title);
  const invalidate = useInvalidateWorkspace();
  const [description, setDescription] = useState(item.task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(item.task.status);
  const [priority, setPriority] = useState<TaskPriority>(item.task.priority);
  const [assigneeId, setAssigneeId] = useState<string>(
    item.task.assigneeId ?? "unassigned"
  );
  const [dueDate, setDueDate] = useState(
    toLocalDateInput(item.task.dueAt, timezone)
  );
  const [dueTime, setDueTime] = useState(
    toLocalTimeInput(item.task.dueAt, timezone)
  );
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (readOnly) return;
    const dueAt = dueDate
      ? zonedWallClockToUtcMs(dueDate, dueTime || "09:00", timezone)
      : null;

    startTransition(async () => {
      const result = await updateTaskAction({
        taskId: item.task.id,
        title,
        description: description.trim() || null,
        status,
        priority,
        dueAt,
        ...(projectMembers
          ? { assigneeId: assigneeId === "unassigned" ? null : assigneeId }
          : {}),
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      onSync({
        ...item,
        task: result.data,
        reminders:
          status === "done" || status === "archived" ? [] : item.reminders,
      });
      await invalidate(
        item.task.habitId
          ? ["tasks", "reminders", "projects", "habits", "sidebar"]
          : ["tasks", "reminders", "projects", "sidebar"]
      );
      toast.success("Task updated.");
    });
  };

  const handleDelete = () => {
    if (readOnly) return;
    startTransition(async () => {
      const result = await deleteTaskAction({ taskId: item.task.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["tasks", "reminders", "projects", "sidebar"]);
      toast.success("Task deleted.");
      onClose();
    });
  };

  const handlePromoteToHabit = () => {
    if (readOnly || item.task.habitId) return;
    startTransition(async () => {
      const result = await promoteTaskToHabitAction({
        taskId: item.task.id,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onSync({
        ...item,
        task: result.data.task,
      });
      await invalidate(["tasks", "habits", "projects", "sidebar"]);
      toast.success(`"${result.data.habit.title}" is now tracked as a habit.`);
    });
  };

  return (
    <div className="space-y-4">
      {readOnly ? (
        <p className="rounded-md border border-collab/35 bg-collab/10 px-2.5 py-1.5 text-[11px] text-foreground">
          Read-only viewer mode. You can still attach private reminders above.
        </p>
      ) : null}

      {/* Habit link / Track as Habit bar */}
      {item.task.habitId ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-done/35 bg-done/10 px-2.5 py-1.5 text-[11px]">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-done">
            <Repeat2 className="size-3.5 shrink-0" />
            <span className="truncate">
              Linked habit{item.task.habitDateKey ? ` · ${item.task.habitDateKey}` : ""}
            </span>
          </span>
          <Link
            href="/app/habits"
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
          >
            Open Habits
            <ExternalLink className="size-2.5" />
          </Link>
        </div>
      ) : !readOnly ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            Repeating routine?
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={isPending}
            onClick={handlePromoteToHabit}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Repeat2 className="size-3 text-done" />
            Track as Habit
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="inspector-task-title" className="text-[11px] text-muted-foreground">
          Title
        </Label>
        <Input
          id="inspector-task-title"
          name="taskTitle"
          disabled={readOnly}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mira-row bg-background text-xs font-medium"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <Label htmlFor="inspector-task-status" className="text-[11px] text-muted-foreground">
            Status
          </Label>
          <Select
            name="taskStatus"
            disabled={readOnly}
            value={status}
            onValueChange={(val) => setStatus(val as TaskStatus)}
          >
            <SelectTrigger id="inspector-task-status" className="mira-row bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo" className="text-xs">To do</SelectItem>
              <SelectItem value="in_progress" className="text-xs">In progress</SelectItem>
              <SelectItem value="done" className="text-xs">Done</SelectItem>
              <SelectItem value="archived" className="text-xs">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inspector-task-priority" className="text-[11px] text-muted-foreground">
            Priority
          </Label>
          <Select
            name="taskPriority"
            disabled={readOnly}
            value={priority}
            onValueChange={(val) => setPriority(val as TaskPriority)}
          >
            <SelectTrigger id="inspector-task-priority" className="mira-row bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">None</SelectItem>
              <SelectItem value="low" className="text-xs">Low</SelectItem>
              <SelectItem value="medium" className="text-xs">Medium</SelectItem>
              <SelectItem value="high" className="text-xs">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {projectMembers && projectMembers.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="inspector-task-assignee" className="text-[11px] text-muted-foreground">
            Assignee
          </Label>
          <Select
            name="taskAssignee"
            disabled={readOnly}
            value={assigneeId}
            onValueChange={setAssigneeId}
          >
            <SelectTrigger id="inspector-task-assignee" className="mira-row bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned" className="text-xs">
                Unassigned
              </SelectItem>
              {projectMembers.map((m) => (
                <SelectItem key={m.userId} value={m.userId} className="text-xs">
                  {m.name} ({m.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="inspector-task-due-date" className="text-[11px] text-muted-foreground">
            Due date &amp; time ({timezone})
          </Label>
          {dueDate && !readOnly ? (
            <button
              type="button"
              onClick={() => setDueDate("")}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            id="inspector-task-due-date"
            name="taskDueDate"
            type="date"
            disabled={readOnly}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mono-tabular mira-row bg-background text-xs"
          />
          <Input
            id="inspector-task-due-time"
            name="taskDueTime"
            type="time"
            value={dueTime}
            disabled={readOnly || !dueDate}
            onChange={(e) => setDueTime(e.target.value)}
            className="mono-tabular mira-row bg-background text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inspector-task-desc" className="text-[11px] text-muted-foreground">
          Description
        </Label>
        <Textarea
          id="inspector-task-desc"
          name="taskDescription"
          rows={4}
          disabled={readOnly}
          placeholder="Add context, links, or next steps…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-background text-xs leading-relaxed"
        />
      </div>

      {!readOnly ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
            className="mira-row gap-1.5 text-xs text-overdue hover:text-overdue"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || !title.trim()}
            onClick={handleSave}
            className="mira-row px-4 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Saving…
              </>
            ) : (
              "Save task"
            )}
          </Button>
        </div>
      ) : null}

      <Separator />

      <AttachedRemindersSection
        reminders={item.reminders}
        timezone={timezone}
        onUpdated={(updated) =>
          onSync({
            ...item,
            reminders: item.reminders.map((r) =>
              r.id === updated.id ? updated : r
            ),
          })
        }
        onCancelled={(reminderId) =>
          onSync({
            ...item,
            reminders: item.reminders.filter((r) => r.id !== reminderId),
          })
        }
      />

      <Separator />

      <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Created</dt>
        <dd className="mono-tabular text-muted-foreground">
          {formatUtcMs(item.task.createdAt, timezone)}
        </dd>
        <dt className="text-muted-foreground">Updated</dt>
        <dd className="mono-tabular text-muted-foreground">
          {formatUtcMs(item.task.updatedAt, timezone)}
        </dd>
      </dl>
    </div>
  );
}

function NoteInspectorForm({
  item,
  timezone,
  readOnly = false,
  onSync,
  onClose,
}: {
  item: NoteWithReminders;
  timezone: string;
  readOnly?: boolean;
  onSync: (next: NoteWithReminders) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.note.title);
  const invalidate = useInvalidateWorkspace();
  const [content, setContent] = useState(item.note.content);
  const [tags, setTags] = useState<string[]>(item.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [isPinned, setIsPinned] = useState(item.note.isPinned);
  const [mode, setMode] = useState<"write" | "preview">(
    readOnly ? "preview" : "write"
  );
  const [isPending, startTransition] = useTransition();

  const handleAddTag = () => {
    if (readOnly) return;
    const clean = tagDraft.trim().toLowerCase().replace(/^#+/, "");
    if (!clean) return;
    if (!tags.includes(clean)) {
      setTags((prev) => [...prev, clean].slice(0, 12));
    }
    setTagDraft("");
  };

  const handleSave = () => {
    if (readOnly) return;
    startTransition(async () => {
      const result = await updateNoteAction({
        noteId: item.note.id,
        title,
        content,
        tags,
        isPinned,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      onSync({
        ...item,
        note: result.data,
        tags,
      });
      await invalidate(["notes", "projects", "sidebar"]);
      toast.success("Note saved.");
    });
  };

  const handleDelete = () => {
    if (readOnly) return;
    startTransition(async () => {
      const result = await deleteNoteAction({ noteId: item.note.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["notes", "reminders", "projects", "sidebar"]);
      toast.success("Note deleted.");
      onClose();
    });
  };

  return (
    <div className="space-y-4">
      {readOnly ? (
        <p className="rounded-md border border-collab/35 bg-collab/10 px-2.5 py-1.5 text-[11px] text-foreground">
          Read-only viewer mode. You can still attach private reminders above.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          id="inspector-note-title"
          name="noteTitle"
          aria-label="Note title"
          disabled={readOnly}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mira-row flex-1 bg-background text-xs font-semibold"
        />
        {!readOnly ? (
          <Button
            type="button"
            variant={isPinned ? "default" : "outline"}
            size="icon"
            onClick={() => setIsPinned((prev) => !prev)}
            aria-label={isPinned ? "Unpin note" : "Pin note"}
            title={isPinned ? "Pinned" : "Pin note"}
            className="mira-icon-btn shrink-0"
          >
            <Pin className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {/* Tag Chips Editor */}
      <div className="space-y-1.5">
        <Label htmlFor="inspector-note-tag" className="text-[11px] text-muted-foreground">
          Tags
        </Label>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1 px-1.5 py-0.5 text-[11px] font-normal"
            >
              #{tag}
              {!readOnly ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() =>
                    setTags((prev) => prev.filter((t) => t !== tag))
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-2.5" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
        {!readOnly ? (
          <div className="flex gap-1.5">
            <Input
              id="inspector-note-tag"
              name="noteTagDraft"
              placeholder="Add tag + Enter"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="h-7 flex-1 bg-background text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddTag}
              className="h-7 px-2.5 text-xs"
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      {/* Markdown Write / Preview */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="inspector-note-content" className="text-[11px] text-muted-foreground">
            Markdown content
          </Label>
          {!readOnly ? (
            <div className="inline-flex rounded border border-border bg-background p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setMode("write")}
                className={
                  mode === "write"
                    ? "rounded bg-primary px-1.5 py-0.5 text-primary-foreground"
                    : "px-1.5 py-0.5 text-muted-foreground"
                }
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={
                  mode === "preview"
                    ? "rounded bg-primary px-1.5 py-0.5 text-primary-foreground"
                    : "px-1.5 py-0.5 text-muted-foreground"
                }
              >
                Preview
              </button>
            </div>
          ) : null}
        </div>

        {mode === "write" && !readOnly ? (
          <Textarea
            id="inspector-note-content"
            name="noteContent"
            rows={9}
            placeholder="Write markdown notes, checklists, or snippets…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="bg-background font-mono text-xs leading-relaxed"
          />
        ) : (
          <div className="min-h-[180px] space-y-1.5 rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
            {content.trim() ? (
              content.split("\n").map((line, i) => {
                if (line.startsWith("### ")) {
                  return (
                    <h4 key={i} className="pt-1 text-xs font-semibold">
                      {line.slice(4)}
                    </h4>
                  );
                }
                if (line.startsWith("## ")) {
                  return (
                    <h3 key={i} className="pt-1 text-sm font-semibold">
                      {line.slice(3)}
                    </h3>
                  );
                }
                if (line.startsWith("# ")) {
                  return (
                    <h2 key={i} className="pt-1 text-base font-semibold">
                      {line.slice(2)}
                    </h2>
                  );
                }
                if (line.startsWith("- ") || line.startsWith("* ")) {
                  return (
                    <p key={i} className="pl-3">
                      • {line.slice(2)}
                    </p>
                  );
                }
                return (
                  <p key={i} className="whitespace-pre-wrap">
                    {line || "\u00A0"}
                  </p>
                );
              })
            ) : (
              <p className="text-muted-foreground">Empty note.</p>
            )}
          </div>
        )}
      </div>

      {!readOnly ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
            className="mira-row gap-1.5 text-xs text-overdue hover:text-overdue"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || !title.trim()}
            onClick={handleSave}
            className="mira-row px-4 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Saving…
              </>
            ) : (
              "Save note"
            )}
          </Button>
        </div>
      ) : null}

      <Separator />

      <AttachedRemindersSection
        reminders={item.reminders}
        timezone={timezone}
        onUpdated={(updated) =>
          onSync({
            ...item,
            reminders: item.reminders.map((r) =>
              r.id === updated.id ? updated : r
            ),
          })
        }
        onCancelled={(reminderId) =>
          onSync({
            ...item,
            reminders: item.reminders.filter((r) => r.id !== reminderId),
          })
        }
      />

      <Separator />

      <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Updated</dt>
        <dd className="mono-tabular text-muted-foreground">
          {formatUtcMs(item.note.updatedAt, timezone)}
        </dd>
      </dl>
    </div>
  );
}

function ReminderInspectorBody({
  item,
  timezone,
  onSync,
  onClose,
}: {
  item: EnrichedReminderItem;
  timezone: string;
  onSync: (next: EnrichedReminderItem) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();
  const { reminder } = item;

  const handleSnooze = (preset: SnoozePreset) => {
    startTransition(async () => {
      const result = await snoozeReminderAction({
        reminderId: reminder.id,
        preset,
        expectedVersion: reminder.version,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onSync({ ...item, reminder: result.data });
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success(
        `Snoozed to ${formatUtcMs(result.data.remindAt, timezone)}`
      );
    });
  };

  const handleCancel = () => {
    startTransition(async () => {
      const result = await cancelReminderAction({
        reminderId: reminder.id,
        expectedVersion: reminder.version,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["reminders", "tasks", "notes", "projects", "sidebar"]);
      toast.success("Reminder cancelled.");
      onClose();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="gap-1 border-reminder/40 text-[11px] font-normal text-reminder"
        >
          <Bell className="size-3" />
          {reminder.taskId ? "task" : "note"} reminder
        </Badge>
        <Badge variant="secondary" className="text-[11px] font-normal capitalize">
          {reminder.status.replace("_", " ")}
        </Badge>
      </div>

      <h2 className="text-sm font-semibold text-foreground">
        {item.entityTitle}
      </h2>

      <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-xs">
        <dt className="text-muted-foreground">Scheduled</dt>
        <dd className="mono-tabular flex items-center gap-1.5 text-reminder">
          <Calendar className="size-3" />
          {formatUtcMs(reminder.remindAt, timezone)}
        </dd>
        <dt className="text-muted-foreground">Timezone</dt>
        <dd className="mono-tabular text-muted-foreground">
          {timezone}
        </dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd className="mono-tabular text-muted-foreground">
          v{reminder.version}
        </dd>
      </dl>

      <Separator />

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Quick snooze
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { key: "15m", label: "+15m" },
              { key: "1h", label: "+1h" },
              { key: "tomorrow_9am", label: "Tomorrow 9 AM" },
            ] as const
          ).map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => handleSnooze(preset.key)}
              className="mira-row gap-1 text-xs"
            >
              <Clock className="size-3 text-reminder" />
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={handleCancel}
          className="mira-row text-xs text-overdue hover:text-overdue"
        >
          Cancel reminder
        </Button>
        <Button asChild variant="outline" size="sm" className="mira-row gap-1.5 text-xs">
          <Link href={item.deepLink}>
            Open linked {reminder.taskId ? "task" : "note"}
            <ExternalLink className="size-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

const WEEKDAY_PICKER = [
  { day: 1, short: "Mon", letter: "M" },
  { day: 2, short: "Tue", letter: "T" },
  { day: 3, short: "Wed", letter: "W" },
  { day: 4, short: "Thu", letter: "T" },
  { day: 5, short: "Fri", letter: "F" },
  { day: 6, short: "Sat", letter: "S" },
  { day: 0, short: "Sun", letter: "S" },
] as const;

function HabitInspectorForm({
  habit,
  summary,
  projects,
  timezone,
  onSync,
  onClose,
}: {
  habit: HabitRecord;
  summary: HabitRowSummary | null;
  projects: SidebarProjectItem[];
  timezone: string;
  onSync: (nextHabit: HabitRecord) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(habit.title);
  const invalidate = useInvalidateWorkspace();
  const [category, setCategory] = useState(habit.category ?? "");
  const [description, setDescription] = useState(habit.description ?? "");
  const [cadenceType, setCadenceType] = useState<HabitCadenceType>(
    habit.cadenceType
  );
  const [scheduledDays, setScheduledDays] = useState<number[]>(() => {
    const parsed = parseScheduledDaysJson(habit.scheduledDaysJson);
    return parsed.length > 0 ? parsed : [1, 2, 3, 4, 5];
  });
  const [weeklyTargetCount, setWeeklyTargetCount] = useState<number>(
    habit.weeklyTargetCount ?? 4
  );
  const [startDate, setStartDate] = useState(habit.startDate);
  const [preferredTime, setPreferredTime] = useState(habit.preferredTime ?? "");
  const metadataEnabled = isFeatureEnabled("habitMetadata");
  const [energyNeed, setEnergyNeed] = useState<EnergyNeed>(
    habit.energyNeed ?? "medium"
  );
  const [place, setPlace] = useState<Place>(habit.place ?? "anywhere");
  const [tagsDraft, setTagsDraft] = useState(
    parseTagsJson(habit.tagsJson).join(", ")
  );
  const [linkedProjectId, setLinkedProjectId] = useState(
    habit.linkedProjectId ?? "none"
  );
  const [autoSyncDailyTask, setAutoSyncDailyTask] = useState(
    habit.autoSyncDailyTask
  );
  const [isPending, startTransition] = useTransition();

  const editableProjects = projects.filter(
    (p) => p.role === "owner" || p.role === "editor"
  );

  const toggleWeekday = (day: number) => {
    setScheduledDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const handleSave = () => {
    if (!title.trim() || isPending) return;
    startTransition(async () => {
      const result = await updateHabitAction({
        habitId: habit.id,
        title: title.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        cadenceType,
        scheduledDays: cadenceType === "specific_days" ? scheduledDays : [],
        weeklyTargetCount:
          cadenceType === "weekly_target" ? weeklyTargetCount : null,
        startDate,
        preferredTime: preferredTime.trim() || null,
        ...(metadataEnabled
          ? {
              energyNeed,
              place,
              tags: tagsDraft
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : {}),
        linkedProjectId: linkedProjectId === "none" ? null : linkedProjectId,
        autoSyncDailyTask,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      onSync(result.data);
      await invalidate(["habits", "today", "tasks", "circle", "sidebar"]);
      toast.success("Habit updated.");
    });
  };

  const handleArchiveToggle = () => {
    startTransition(async () => {
      const result = await archiveHabitAction({
        habitId: habit.id,
        isArchived: !habit.isArchived,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "circle", "sidebar"]);
      toast.success(
        result.data.isArchived ? "Habit archived." : "Habit restored."
      );
      onClose();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteHabitAction({ habitId: habit.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "tasks", "circle", "sidebar"]);
      toast.success("Habit deleted.");
      onClose();
    });
  };

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-background p-2.5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Streak
            </p>
            <p className="mono-tabular mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <Flame className="size-3 text-reminder" />
              {summary.currentStreak}
              {summary.streakUnit === "weeks" ? "w" : "d"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Best
            </p>
            <p className="mono-tabular mt-0.5 text-xs font-semibold text-foreground">
              {summary.bestStreak}
              {summary.streakUnit === "weeks" ? "w" : "d"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Month
            </p>
            <p className="mono-tabular mt-0.5 text-xs font-semibold text-done">
              {summary.completionRate !== null
                ? `${Math.round(summary.completionRate * 100)}%`
                : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label
          htmlFor="inspector-habit-title"
          className="text-[11px] text-muted-foreground"
        >
          Title
        </Label>
        <Input
          id="inspector-habit-title"
          name="habitTitle"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mira-row bg-background text-xs font-medium"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <Label
            htmlFor="inspector-habit-category"
            className="text-[11px] text-muted-foreground"
          >
            Category
          </Label>
          <Input
            id="inspector-habit-category"
            name="habitCategory"
            maxLength={48}
            placeholder="Health, Craft, Focus…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mira-row bg-background text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="inspector-habit-start"
            className="text-[11px] text-muted-foreground"
          >
            Start date
          </Label>
          <Input
            id="inspector-habit-start"
            name="habitStartDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mono-tabular mira-row bg-background text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="inspector-habit-cadence"
          className="text-[11px] text-muted-foreground"
        >
          Cadence
        </Label>
        <Select
          name="habitCadence"
          value={cadenceType}
          onValueChange={(val) => setCadenceType(val as HabitCadenceType)}
        >
          <SelectTrigger
            id="inspector-habit-cadence"
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
          <span className="text-[11px] text-muted-foreground">
            Scheduled weekdays
          </span>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_PICKER.map((item) => {
              const active = scheduledDays.includes(item.day);
              return (
                <button
                  key={item.day}
                  type="button"
                  aria-label={item.short}
                  aria-pressed={active}
                  onClick={() => toggleWeekday(item.day)}
                  className={cn(
                    "mira-row rounded border text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.letter}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {cadenceType === "weekly_target" ? (
        <div className="space-y-1.5">
          <span className="text-[11px] text-muted-foreground">
            Target completions per week
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
          <div className="flex items-center justify-between">
            <Label
              htmlFor="inspector-habit-time"
              className="text-[11px] text-muted-foreground"
            >
              Nudge time
            </Label>
            {preferredTime ? (
              <button
                type="button"
                onClick={() => setPreferredTime("")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
          <Input
            id="inspector-habit-time"
            name="habitPreferredTime"
            type="time"
            value={preferredTime}
            onChange={(e) => setPreferredTime(e.target.value)}
            className="mono-tabular mira-row bg-background text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="inspector-habit-project"
            className="text-[11px] text-muted-foreground"
          >
            Linked project
          </Label>
          <Select
            name="habitProject"
            value={linkedProjectId}
            onValueChange={setLinkedProjectId}
          >
            <SelectTrigger
              id="inspector-habit-project"
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

      {metadataEnabled ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Low-energy planning
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label
                htmlFor="inspector-habit-energy"
                className="text-[11px] text-muted-foreground"
              >
                Energy need
              </Label>
              <Select
                value={energyNeed}
                onValueChange={(value) => setEnergyNeed(value as EnergyNeed)}
              >
                <SelectTrigger
                  id="inspector-habit-energy"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENERGY_NEEDS.map((value) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="inspector-habit-place"
                className="text-[11px] text-muted-foreground"
              >
                Place
              </Label>
              <Select
                value={place}
                onValueChange={(value) => setPlace(value as Place)}
              >
                <SelectTrigger
                  id="inspector-habit-place"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLACES.map((value) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="inspector-habit-tags"
              className="text-[11px] text-muted-foreground"
            >
              Tags (comma separated)
            </Label>
            <Input
              id="inspector-habit-tags"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="core, morning"
              className="mira-row bg-background text-xs"
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
        <div className="space-y-0.5 pr-3">
          <Label
            htmlFor="inspector-habit-autosync"
            className="text-xs font-medium text-foreground"
          >
            Auto-sync daily task
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Keep linked tasks synchronized with this habit&apos;s check-ins.
          </p>
        </div>
        <Switch
          id="inspector-habit-autosync"
          checked={autoSyncDailyTask}
          onCheckedChange={setAutoSyncDailyTask}
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="inspector-habit-desc"
          className="text-[11px] text-muted-foreground"
        >
          Notes / cue
        </Label>
        <Textarea
          id="inspector-habit-desc"
          name="habitDescription"
          rows={3}
          placeholder="What triggers this habit or defines done?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-background text-xs leading-relaxed"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleArchiveToggle}
            className="mira-row gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Archive className="size-3.5" />
            {habit.isArchived ? "Restore" : "Archive"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
            className="mira-row gap-1 text-xs text-overdue hover:text-overdue"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>

        <Button
          type="button"
          size="sm"
          disabled={isPending || !title.trim()}
          onClick={handleSave}
          className="mira-row px-4 text-xs"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 size-3 animate-spin" />
              Saving…
            </>
          ) : (
            "Save habit"
          )}
        </Button>
      </div>

      <Separator />

      <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Created</dt>
        <dd className="mono-tabular text-muted-foreground">
          {formatUtcMs(habit.createdAt, timezone)}
        </dd>
        <dt className="text-muted-foreground">Updated</dt>
        <dd className="mono-tabular text-muted-foreground">
          {formatUtcMs(habit.updatedAt, timezone)}
        </dd>
      </dl>
    </div>
  );
}

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function subscribeDesktopViewport(callback: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getDesktopViewportSnapshot(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function getServerDesktopViewportSnapshot(): boolean {
  return true;
}

/**
 * Zone 3: Reusable non-blocking 440px right slide-over detail sheet.
 * Supports full interactive editing for Tasks, Notes, and Reminders,
 * including the header "Add reminder" popover.
 */
export function DetailSheet({ timezone }: DetailSheetProps) {
  const { activeItem, isOpen, updateActiveDetail, closeDetail } =
    useDetailSheet();
  const isDesktop = useSyncExternalStore(
    subscribeDesktopViewport,
    getDesktopViewportSnapshot,
    getServerDesktopViewportSnapshot
  );

  if (!isOpen || !activeItem) {
    return null;
  }

  const headerMeta =
    activeItem.kind === "task"
      ? {
          icon: CheckSquare,
          label: "Task",
          entityType: "task" as const,
          entityId: activeItem.data.task.id,
        }
      : activeItem.kind === "note"
        ? {
            icon: FileText,
            label: "Note",
            entityType: "note" as const,
            entityId: activeItem.data.note.id,
          }
        : activeItem.kind === "habit"
          ? {
              icon: Repeat2,
              label: "Habit",
              entityType: null,
              entityId: null,
            }
          : {
              icon: Bell,
              label: "Reminder",
              entityType: null,
              entityId: null,
            };

  const HeaderIcon = headerMeta.icon;

  const renderContent = (item: DetailSheetItem) => {
    if (item.kind === "task") {
      return (
        <TaskInspectorForm
          key={`${item.data.task.id}-${item.data.task.updatedAt}-${item.data.reminders.length}`}
          item={item.data}
          timezone={timezone}
          readOnly={item.readOnly}
          projectMembers={item.projectMembers}
          onSync={(next) =>
            updateActiveDetail(() => ({
              kind: "task",
              data: next,
              readOnly: item.readOnly,
              projectMembers: item.projectMembers,
            }))
          }
          onClose={closeDetail}
        />
      );
    }

    if (item.kind === "note") {
      return (
        <NoteInspectorForm
          key={`${item.data.note.id}-${item.data.note.updatedAt}-${item.data.reminders.length}`}
          item={item.data}
          timezone={timezone}
          readOnly={item.readOnly}
          onSync={(next) =>
            updateActiveDetail(() => ({
              kind: "note",
              data: next,
              readOnly: item.readOnly,
            }))
          }
          onClose={closeDetail}
        />
      );
    }

    if (item.kind === "habit") {
      return (
        <HabitInspectorForm
          key={`${item.data.habit.id}-${item.data.habit.updatedAt}`}
          habit={item.data.habit}
          summary={item.data.summary}
          projects={item.data.projects}
          timezone={timezone}
          onSync={(nextHabit) =>
            updateActiveDetail(() => ({
              kind: "habit",
              data: { ...item.data, habit: nextHabit },
            }))
          }
          onClose={closeDetail}
        />
      );
    }

    return (
      <ReminderInspectorBody
        key={`${item.data.reminder.id}-${item.data.reminder.version}`}
        item={item.data}
        timezone={timezone}
        onSync={(next) =>
          updateActiveDetail(() => ({ kind: "reminder", data: next }))
        }
        onClose={closeDetail}
      />
    );
  };

  const headerActions =
    headerMeta.entityType && headerMeta.entityId ? (
      <AddReminderPopover
        entityType={headerMeta.entityType}
        entityId={headerMeta.entityId}
        timezone={timezone}
        onAttached={(createdReminder) => {
          updateActiveDetail((prev) => {
            if (!prev) return prev;
            if (prev.kind === "task") {
              return {
                ...prev,
                data: {
                  ...prev.data,
                  reminders: [...prev.data.reminders, createdReminder].sort(
                    (a, b) => a.remindAt - b.remindAt
                  ),
                },
              };
            }
            if (prev.kind === "note") {
              return {
                ...prev,
                data: {
                  ...prev.data,
                  reminders: [...prev.data.reminders, createdReminder].sort(
                    (a, b) => a.remindAt - b.remindAt
                  ),
                },
              };
            }
            return prev;
          });
        }}
      />
    ) : null;

  if (isDesktop) {
    return (
      <aside
        aria-label="Item detail inspector"
        className="flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-card"
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <HeaderIcon className="size-3.5" />
            {headerMeta.label} Inspector
          </span>
          <div className="flex items-center gap-1.5">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeDetail}
              aria-label="Close detail sheet"
              className="mira-icon-btn text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {renderContent(activeItem)}
        </div>
      </aside>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeDetail()}>
      <SheetContent
        side="right"
        className="w-full border-l border-border bg-card p-0 data-[side=right]:sm:max-w-[440px]"
      >
        <SheetHeader className="flex-row items-center justify-between border-b border-border px-4 py-2.5 pr-12 text-left">
          <div>
            <SheetTitle className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <HeaderIcon className="size-3.5" />
              {headerMeta.label} Inspector
            </SheetTitle>
            <SheetDescription className="sr-only">
              Inspect and edit selected workspace item details.
            </SheetDescription>
          </div>
          {headerActions}
        </SheetHeader>
        <div className="overflow-y-auto p-4">{renderContent(activeItem)}</div>
      </SheetContent>
    </Sheet>
  );
}
