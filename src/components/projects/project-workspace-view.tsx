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
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  Activity,
  Bell,
  Check,
  CheckSquare,
  Eye,
  FileText,
  Pin,
  Plus,
  Search,
  Settings2,
  Share2,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createNoteAction, toggleNotePinAction } from "@/actions/notes";
import {
  deleteProjectAction,
  updateProjectAction,
} from "@/actions/projects";
import {
  createTaskAction,
  deleteTaskAction,
  toggleTaskStatusAction,
} from "@/actions/tasks";
import { ProjectShareDialog } from "@/components/projects/project-share-dialog";
import { useDetailSheet } from "@/components/shell/detail-sheet-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { ViewHeader } from "@/components/workspace/view-header";
import { parseQuickCapture } from "@/lib/natural-language-capture";
import { cn } from "@/lib/utils";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type {
  ProjectActivityWithActor,
  ProjectTaskWithMeta,
} from "@/server/dal/project-repository";
import type { TaskStatus } from "@/server/db/schema";
import type { ProjectWorkspaceData } from "@/server/services/project-service";

interface ProjectWorkspaceViewProps {
  workspace: ProjectWorkspaceData;
  timezone: string;
  initialTab?: "tasks" | "notes" | "activity";
  initialSelectedId?: string | null;
}

const DOT_CLASS: Record<string, string> = {
  collab: "bg-collab",
  reminder: "bg-reminder",
  done: "bg-done",
  overdue: "bg-overdue",
};

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatShort(ms: number | null, timezone: string): string {
  if (!ms) return "";
  try {
    return formatInTimeZone(ms, timezone, "MMM d · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d · HH:mm");
  }
}

function describeActivity(item: ProjectActivityWithActor): string {
  const actor = item.actorName ?? "Someone";
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(item.activity.metadataJson) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const title = typeof meta.title === "string" ? ` "${meta.title}"` : "";

  switch (item.activity.action) {
    case "project.created":
      return `${actor} created this project`;
    case "project.updated":
      return `${actor} updated project details`;
    case "project.archived":
      return `${actor} archived this project`;
    case "task.created":
      return `${actor} added task${title}`;
    case "task.completed":
      return `${actor} completed task${title}`;
    case "task.reopened":
      return `${actor} reopened task${title}`;
    case "task.assigned":
      return `${actor} updated assignment on task${title}`;
    case "task.updated":
      return `${actor} updated task${title}`;
    case "task.deleted":
      return `${actor} deleted task${title}`;
    case "note.created":
      return `${actor} created note${title}`;
    case "note.updated":
      return `${actor} edited note${title}`;
    case "note.deleted":
      return `${actor} deleted note${title}`;
    case "member.invited":
      return `${actor} invited ${typeof meta.recipient === "string" ? meta.recipient : "a collaborator"} as ${typeof meta.role === "string" ? meta.role : "member"}`;
    case "invite.revoked":
      return `${actor} revoked invitation for ${typeof meta.recipient === "string" ? meta.recipient : "a collaborator"}`;
    case "member.joined":
      return `${actor} joined the project as ${typeof meta.role === "string" ? meta.role : "member"}`;
    case "member.role_updated":
      return `${actor} changed a member role to ${typeof meta.nextRole === "string" ? meta.nextRole : "updated"}`;
    case "member.removed":
      return `${actor} removed a member from the project`;
    default:
      return `${actor} performed ${item.activity.action}`;
  }
}

export function ProjectWorkspaceView({
  workspace,
  timezone,
  initialTab = "tasks",
  initialSelectedId = null,
}: ProjectWorkspaceViewProps) {
  const router = useRouter();
  const { openDetail, activeItem, closeDetail } = useDetailSheet();
  const { project, viewerRole, members, pendingInvitations, activities, referenceUtcMs } =
    workspace;

  const canMutate = viewerRole === "owner" || viewerRole === "editor";
  const isOwner = viewerRole === "owner";

  const [activeTab, setActiveTab] = useState<"tasks" | "notes" | "activity">(
    initialTab
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "done" | "all">(
    "active"
  );
  const [taskInput, setTaskInput] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<string>("unassigned");

  const [noteInput, setNoteInput] = useState("");
  const [noteSearch, setNoteSearch] = useState("");

  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? "");

  const [isPending, startTransition] = useTransition();
  const deepLinkRef = useRef<string | null>(null);

  const [optimisticTasks, applyTaskOptimistic] = useOptimistic<
    ProjectTaskWithMeta[],
    | { type: "toggle"; taskId: string; status: TaskStatus }
    | { type: "delete"; taskId: string }
  >(workspace.tasks, (state, action) => {
    if (action.type === "toggle") {
      return state.map((entry) =>
        entry.task.id === action.taskId
          ? {
              ...entry,
              task: {
                ...entry.task,
                status: action.status,
                completedAt: action.status === "done" ? referenceUtcMs : null,
              },
            }
          : entry
      );
    }
    return state.filter((entry) => entry.task.id !== action.taskId);
  });

  const [optimisticNotes, applyNoteOptimistic] = useOptimistic<
    NoteWithReminders[],
    { type: "pin"; noteId: string }
  >(workspace.notes, (state, action) =>
    state.map((entry) =>
      entry.note.id === action.noteId
        ? { ...entry, note: { ...entry.note, isPinned: !entry.note.isPinned } }
        : entry
    )
  );

  useEffect(() => {
    if (!initialSelectedId || deepLinkRef.current === initialSelectedId) return;
    const foundTask = workspace.tasks.find(
      (t) => t.task.id === initialSelectedId
    );
    if (foundTask) {
      deepLinkRef.current = initialSelectedId;
      openDetail({
        kind: "task",
        data: foundTask,
        readOnly: !canMutate,
        projectMembers: members,
      });
      return;
    }
    const foundNote = workspace.notes.find(
      (n) => n.note.id === initialSelectedId
    );
    if (foundNote) {
      deepLinkRef.current = initialSelectedId;
      openDetail({
        kind: "note",
        data: foundNote,
        readOnly: !canMutate,
      });
    }
  }, [initialSelectedId, workspace.tasks, workspace.notes, openDetail, canMutate, members]);

  const parsedTaskQuick = useMemo(
    () =>
      parseQuickCapture(taskInput, timezone, {
        defaultKind: "task",
        referenceNow: new Date(referenceUtcMs),
      }),
    [taskInput, timezone, referenceUtcMs]
  );

  const filteredTasks = useMemo(() => {
    return optimisticTasks.filter((entry) => {
      if (statusFilter === "active" && entry.task.status === "done") {
        return false;
      }
      if (statusFilter === "done" && entry.task.status !== "done") {
        return false;
      }
      if (assigneeFilter === "unassigned" && entry.task.assigneeId !== null) {
        return false;
      }
      if (
        assigneeFilter !== "all" &&
        assigneeFilter !== "unassigned" &&
        entry.task.assigneeId !== assigneeFilter
      ) {
        return false;
      }
      return true;
    });
  }, [optimisticTasks, statusFilter, assigneeFilter]);

  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    if (!q) return optimisticNotes;
    return optimisticNotes.filter((entry) =>
      `${entry.note.title} ${entry.note.content} ${entry.tags.join(" ")}`
        .toLowerCase()
        .includes(q)
    );
  }, [optimisticNotes, noteSearch]);

  const handleCreateTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canMutate || !parsedTaskQuick.cleanTitle.trim() || isPending) return;

    const title = parsedTaskQuick.cleanTitle;
    const remindAt = parsedTaskQuick.remindAtUtcMs;
    const assigneeId = taskAssignee === "unassigned" ? null : taskAssignee;
    setTaskInput("");

    startTransition(async () => {
      const res = await createTaskAction({
        title,
        projectId: project.id,
        assigneeId,
        dueAt: remindAt,
        remindAt,
      });

      if (!res.ok) {
        toast.error(res.error.message);
        setTaskInput(taskInput);
        return;
      }
      toast.success("Project task added.");
    });
  };

  const handleToggleTask = (entry: ProjectTaskWithMeta) => {
    if (!canMutate) return;
    const nextStatus: TaskStatus =
      entry.task.status === "done" ? "todo" : "done";

    startTransition(async () => {
      applyTaskOptimistic({
        type: "toggle",
        taskId: entry.task.id,
        status: nextStatus,
      });
      const res = await toggleTaskStatusAction({
        taskId: entry.task.id,
        status: nextStatus,
      });
      if (!res.ok) {
        toast.error(res.error.message);
      }
    });
  };

  const handleDeleteTask = (taskId: string) => {
    if (!canMutate) return;
    startTransition(async () => {
      applyTaskOptimistic({ type: "delete", taskId });
      if (activeItem?.kind === "task" && activeItem.data.task.id === taskId) {
        closeDetail();
      }
      const res = await deleteTaskAction({ taskId });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Task deleted.");
    });
  };

  const handleCreateNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canMutate || !noteInput.trim() || isPending) return;

    const raw = noteInput.trim();
    const parsed = parseQuickCapture(raw, timezone, { defaultKind: "note" });
    setNoteInput("");

    startTransition(async () => {
      const res = await createNoteAction({
        title: parsed.cleanTitle || raw,
        projectId: project.id,
        remindAt: parsed.remindAtUtcMs,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        setNoteInput(raw);
        return;
      }
      toast.success("Project note created.");
      openDetail({
        kind: "note",
        data: {
          note: res.data.note,
          tags: [],
          projectName: project.name,
          projectColorToken: project.colorToken,
          reminders: res.data.reminder ? [res.data.reminder] : [],
        },
        readOnly: false,
      });
    });
  };

  const handlePinNote = (noteId: string) => {
    if (!canMutate) return;
    startTransition(async () => {
      applyNoteOptimistic({ type: "pin", noteId });
      const res = await toggleNotePinAction({ noteId });
      if (!res.ok) toast.error(res.error.message);
    });
  };

  const handleSaveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOwner) return;
    startTransition(async () => {
      const res = await updateProjectAction({
        projectId: project.id,
        name: editName,
        description: editDesc.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Project settings saved.");
      setSettingsOpen(false);
    });
  };

  const handleDeleteProject = () => {
    if (!isOwner) return;
    startTransition(async () => {
      const res = await deleteProjectAction({ projectId: project.id });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Project deleted.");
      setSettingsOpen(false);
      router.push("/app/inbox");
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title={project.name}
        subtitle={project.description ?? undefined}
        actions={
          <div className="flex items-center gap-1.5">
            {/* Stacked Member Avatars */}
            <div className="hidden items-center -space-x-1.5 sm:flex">
              {members.slice(0, 4).map((m) => (
                <Avatar
                  key={m.userId}
                  title={`${m.name} (${m.role})`}
                  className="size-6 border border-background"
                >
                  <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {members.length > 4 ? (
                <span className="mono-tabular inline-flex size-6 items-center justify-center rounded-full border border-border bg-card text-[9px] text-muted-foreground">
                  +{members.length - 4}
                </span>
              ) : null}
            </div>

            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px] font-normal capitalize",
                members.length > 1
                  ? "border-collab/40 bg-collab/10 text-collab"
                  : "border-border text-muted-foreground"
              )}
            >
              {viewerRole}
            </Badge>

            {isOwner ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShareOpen(true)}
                  className="mira-row h-7 gap-1 border-collab/40 bg-collab/10 px-2 text-xs text-collab hover:bg-collab/20"
                >
                  <Share2 className="size-3" />
                  <span>Share</span>
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Project settings"
                  className="mira-icon-btn text-muted-foreground hover:text-foreground"
                >
                  <Settings2 className="size-3.5" />
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        {/* Viewer Read-Only Notice */}
        {viewerRole === "viewer" ? (
          <div className="flex items-center gap-2 rounded-md border border-collab/35 bg-collab/10 px-3 py-2 text-xs text-foreground">
            <Eye className="size-3.5 shrink-0 text-collab" />
            <span>
              <strong>Viewer access:</strong> Project tasks and notes are
              read-only, and you can still attach private personal reminders in
              the side inspector.
            </span>
          </div>
        ) : null}

        {/* Project Tabs: Tasks | Notes | Activity */}
        <div
          role="tablist"
          aria-label="Project sections"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
        >
          <div className="flex items-center gap-1">
            {(
              [
                {
                  key: "tasks",
                  label: "Tasks",
                  icon: CheckSquare,
                  count: optimisticTasks.length,
                },
                {
                  key: "notes",
                  label: "Notes",
                  icon: FileText,
                  count: optimisticNotes.length,
                },
                {
                  key: "activity",
                  label: "Activity",
                  icon: Activity,
                  count: activities.length,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "mira-row inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                    selected
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  <span>{tab.label}</span>
                  <span className="mono-tabular text-[10px] text-muted-foreground">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                DOT_CLASS[project.colorToken] ?? "bg-collab"
              )}
            />
            <span className="mono-tabular">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>
        </div>

        {/* TAB 1: TASKS */}
        {activeTab === "tasks" ? (
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {(
                  [
                    { value: "active", label: "Active" },
                    { value: "done", label: "Completed" },
                    { value: "all", label: "All" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px] transition-colors",
                      statusFilter === opt.value
                        ? "border-foreground bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <UserCircle2 className="size-3.5 text-muted-foreground" />
                <Select
                  value={assigneeFilter}
                  onValueChange={setAssigneeFilter}
                >
                  <SelectTrigger
                    aria-label="Filter by assignee"
                    className="h-7 w-40 bg-card text-xs"
                  >
                    <SelectValue placeholder="All assignees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All assignees
                    </SelectItem>
                    <SelectItem value="unassigned" className="text-xs">
                      Unassigned
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem
                        key={m.userId}
                        value={m.userId}
                        className="text-xs"
                      >
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Inline Project Task Capture (Owner / Editor) */}
            {canMutate ? (
              <form
                onSubmit={handleCreateTask}
                className="space-y-1.5 rounded-md border border-border bg-card p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Plus className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    name="projectTaskInput"
                    aria-label="Add project task"
                    placeholder='Add project task… e.g. "Ship release notes tomorrow 10am"'
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    className="h-7 min-w-[200px] flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                  />
                  <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                    <SelectTrigger
                      aria-label="Task assignee"
                      className="h-7 w-36 bg-background text-xs"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned" className="text-xs">
                        Unassigned
                      </SelectItem>
                      {members.map((m) => (
                        <SelectItem
                          key={m.userId}
                          value={m.userId}
                          className="text-xs"
                        >
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!parsedTaskQuick.cleanTitle.trim() || isPending}
                    className="h-7 px-3 text-xs"
                  >
                    Add
                  </Button>
                </div>

                {parsedTaskQuick.detectedPhrase &&
                parsedTaskQuick.remindAtUtcMs ? (
                  <div className="flex items-center justify-between border-t border-border/60 px-1 pt-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded border border-reminder/35 bg-reminder/10 px-1.5 py-0.5 text-reminder">
                      <Bell className="size-2.5" />
                      {parsedTaskQuick.detectedPhrase}
                    </span>
                    <span className="mono-tabular text-reminder">
                      {formatShort(parsedTaskQuick.remindAtUtcMs, timezone)}
                    </span>
                  </div>
                ) : null}
              </form>
            ) : null}

            {/* Task Rows */}
            {filteredTasks.length === 0 ? (
              <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
                <CheckSquare className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2.5 text-xs font-medium text-foreground">
                  No tasks match this view
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  {canMutate
                    ? "Add a shared task above or adjust the assignee/status filters."
                    : "Tasks created by project editors will appear here."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {filteredTasks.map((entry) => {
                  const { task } = entry;
                  const isDone = task.status === "done";
                  const nextRem = entry.reminders[0] ?? null;
                  const isSelected =
                    activeItem?.kind === "task" &&
                    activeItem.data.task.id === task.id;

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "mira-row group flex items-center justify-between gap-2 px-2.5 text-xs transition-colors hover:bg-accent/60",
                        isSelected && "bg-accent"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isDone}
                          disabled={!canMutate}
                          aria-label={
                            isDone
                              ? `Reopen "${task.title}"`
                              : `Complete "${task.title}"`
                          }
                          onClick={() => handleToggleTask(entry)}
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            isDone
                              ? "border-done bg-done text-primary-foreground"
                              : "border-muted-foreground/50 bg-background hover:border-foreground"
                          )}
                        >
                          {isDone ? (
                            <Check className="size-2.5 stroke-[2.5]" />
                          ) : null}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            openDetail({
                              kind: "task",
                              data: entry,
                              readOnly: !canMutate,
                              projectMembers: members,
                            })
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
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
                        </button>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {entry.assigneeName ? (
                          <Badge
                            variant="outline"
                            className="hidden h-5 border-collab/35 bg-collab/10 px-1.5 text-[10px] font-normal text-collab sm:inline-flex"
                          >
                            {entry.assigneeName}
                          </Badge>
                        ) : null}

                        {nextRem ? (
                          <span className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/30 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
                            <Bell className="size-2.5" />
                            {formatShort(nextRem.remindAt, timezone)}
                          </span>
                        ) : task.dueAt ? (
                          <span className="mono-tabular text-[11px] text-muted-foreground">
                            {formatShort(task.dueAt, timezone)}
                          </span>
                        ) : null}

                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            aria-label={`Delete "${task.title}"`}
                            className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-overdue group-focus-within:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* TAB 2: NOTES */}
        {activeTab === "notes" ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
              {canMutate ? (
                <form
                  onSubmit={handleCreateNote}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    name="projectNoteTitle"
                    aria-label="New project note"
                    placeholder="New shared note title…"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!noteInput.trim() || isPending}
                    className="h-7 px-2.5 text-xs"
                  >
                    New note
                  </Button>
                </form>
              ) : (
                <div className="flex items-center text-xs text-muted-foreground">
                  Shared project notes (read-only)
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <Input
                  name="projectNotesSearch"
                  aria-label="Filter project notes"
                  placeholder="Search notes…"
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
                {noteSearch ? (
                  <button
                    type="button"
                    onClick={() => setNoteSearch("")}
                    aria-label="Clear note search"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            </div>

            {filteredNotes.length === 0 ? (
              <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
                <FileText className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2.5 text-xs font-medium text-foreground">
                  No shared notes yet
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Capture specs, meeting recaps, or decisions for this project.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                {filteredNotes.map((entry) => {
                  const nextRem = entry.reminders[0] ?? null;
                  const isSelected =
                    activeItem?.kind === "note" &&
                    activeItem.data.note.id === entry.note.id;

                  return (
                    <div
                      key={entry.note.id}
                      className={cn(
                        "mira-row group flex items-center justify-between gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent/60",
                        isSelected && "bg-accent"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openDetail({
                            kind: "note",
                            data: entry,
                            readOnly: !canMutate,
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">
                          {entry.note.title}
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-2">
                        {nextRem ? (
                          <span className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/30 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
                            <Bell className="size-2.5" />
                            {formatShort(nextRem.remindAt, timezone)}
                          </span>
                        ) : null}
                        <span className="mono-tabular hidden text-[11px] text-muted-foreground sm:inline">
                          {formatShort(entry.note.updatedAt, timezone)}
                        </span>
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => handlePinNote(entry.note.id)}
                            aria-label={
                              entry.note.isPinned ? "Unpin note" : "Pin note"
                            }
                            className={cn(
                              "flex size-6 items-center justify-center rounded hover:bg-muted",
                              entry.note.isPinned
                                ? "text-foreground"
                                : "text-muted-foreground opacity-50 group-hover:opacity-100"
                            )}
                          >
                            <Pin className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* TAB 3: ACTIVITY FEED */}
        {activeTab === "activity" ? (
          activities.length === 0 ? (
            <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
              <Activity className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2.5 text-xs font-medium text-foreground">
                No project activity recorded yet
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
              {activities.map((entry) => (
                <div
                  key={entry.activity.id}
                  className="mira-row flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar className="size-5 shrink-0 border border-border">
                      <AvatarFallback className="bg-muted text-[9px]">
                        {initials(entry.actorName)}
                      </AvatarFallback>
                    </Avatar>
                    <p className="truncate text-foreground">
                      {describeActivity(entry)}
                    </p>
                  </div>
                  <span className="mono-tabular shrink-0 text-[10px] text-muted-foreground">
                    {formatShort(entry.activity.createdAt, timezone)}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>

      {/* Share / Invite Dialog (Owner Only) */}
      {isOwner ? (
        <ProjectShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={project.id}
          projectName={project.name}
          members={members}
          pendingInvitations={pendingInvitations}
          timezone={timezone}
        />
      ) : null}

      {/* Project Settings Dialog (Owner Only) */}
      {isOwner ? (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="border-border bg-card sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">
                Project settings
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Manage project metadata or permanently delete this workspace.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveSettings} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-proj-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="edit-proj-name"
                  name="editProjectName"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mira-row bg-background text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-proj-desc" className="text-xs">
                  Description
                </Label>
                <Textarea
                  id="edit-proj-desc"
                  name="editProjectDescription"
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="bg-background text-xs"
                />
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={handleDeleteProject}
                  className="mira-row text-xs text-overdue hover:text-overdue"
                >
                  Delete project
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!editName.trim() || isPending}
                  className="mira-row px-4 text-xs"
                >
                  Save changes
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
