"use client";

import { formatInTimeZone } from "date-fns-tz";
import { TodayHabitsStrip } from "@/components/habits/today-habits-strip";
import { ProjectWorkspaceView } from "@/components/projects/project-workspace-view";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  NoteListView,
  ReminderListView,
  TaskListView,
} from "@/components/workspace/workspace-lists";
import {
  useNotesViewQuery,
  useProjectWorkspaceQuery,
  useRemindersViewQuery,
  useTasksViewQuery,
  type NotesViewPayload,
  type ProjectViewPayload,
  type RemindersViewPayload,
  type TasksViewPayload,
} from "@/hooks/use-workspace-queries";

export function InboxWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
  initialSelectedId,
}: {
  userId: string;
  initialData: TasksViewPayload;
  initialFetchedAtMs: number;
  initialSelectedId: string | null;
}) {
  const { data } = useTasksViewQuery(
    userId,
    "inbox",
    initialData,
    initialFetchedAtMs
  );
  const activeCount = data.items.filter((t) => t.task.status !== "done").length;

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Inbox"
        subtitle="Personal tasks not yet assigned to a project"
        meta={`${activeCount} active`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <TaskListView
          tasks={data.items}
          timezone={data.timezone}
          nowMs={data.referenceUtcMs}
          variant="inbox"
          initialSelectedId={initialSelectedId}
          emptyTitle="Your inbox is clear"
          emptyDescription="Capture tasks inline above or press ⌘K with natural-language dates like 'Pay Umeme bill tomorrow 9am'."
        />
      </div>
    </div>
  );
}

export function TodayWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
  initialSelectedId,
}: {
  userId: string;
  initialData: TasksViewPayload;
  initialFetchedAtMs: number;
  initialSelectedId: string | null;
}) {
  const { data } = useTasksViewQuery(
    userId,
    "today",
    initialData,
    initialFetchedAtMs
  );

  let formattedToday = "";
  try {
    formattedToday = formatInTimeZone(
      data.referenceUtcMs,
      data.timezone,
      "EEE, MMM d"
    );
  } catch {
    formattedToday = formatInTimeZone(
      data.referenceUtcMs,
      "UTC",
      "EEE, MMM d"
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Today"
        subtitle="Overdue, due today, and tasks with reminders today"
        meta={`${formattedToday} · ${data.items.length}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        {data.habitsStrip ? (
          <TodayHabitsStrip
            todayDateKey={data.habitsStrip.todayDateKey}
            initialItems={data.habitsStrip.items}
          />
        ) : null}
        <TaskListView
          tasks={data.items}
          timezone={data.timezone}
          nowMs={data.referenceUtcMs}
          variant="today"
          initialSelectedId={initialSelectedId}
          emptyTitle="Nothing due today"
          emptyDescription="Tasks due today, overdue items, or tasks with timed reminders today will collect here."
        />
      </div>
    </div>
  );
}

export function UpcomingWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
  initialSelectedId,
}: {
  userId: string;
  initialData: TasksViewPayload;
  initialFetchedAtMs: number;
  initialSelectedId: string | null;
}) {
  const { data } = useTasksViewQuery(
    userId,
    "upcoming",
    initialData,
    initialFetchedAtMs
  );

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Upcoming"
        subtitle="Future scheduled tasks and reminders"
        meta={`${data.items.length} scheduled`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <TaskListView
          tasks={data.items}
          timezone={data.timezone}
          nowMs={data.referenceUtcMs}
          variant="upcoming"
          initialSelectedId={initialSelectedId}
          emptyTitle="Nothing scheduled ahead"
          emptyDescription="Tasks with future due dates or timed reminders beyond today will appear here chronologically."
        />
      </div>
    </div>
  );
}

export function NotesWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
  initialSelectedId,
}: {
  userId: string;
  initialData: NotesViewPayload;
  initialFetchedAtMs: number;
  initialSelectedId: string | null;
}) {
  const { data } = useNotesViewQuery(userId, initialData, initialFetchedAtMs);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Notes"
        subtitle="Quiet markdown notes with optional timed reminders"
        meta={`${data.items.length} ${data.items.length === 1 ? "note" : "notes"}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <NoteListView
          notes={data.items}
          timezone={data.timezone}
          initialSelectedId={initialSelectedId}
        />
      </div>
    </div>
  );
}

export function RemindersWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
}: {
  userId: string;
  initialData: RemindersViewPayload;
  initialFetchedAtMs: number;
}) {
  const { data } = useRemindersViewQuery(
    userId,
    initialData,
    initialFetchedAtMs
  );

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Reminders"
        subtitle="Hybrid 14-day durable schedule across tasks and notes"
        meta={`${data.items.length} tracked · ${data.timezone}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <ReminderListView
          reminders={data.items}
          timezone={data.timezone}
          nowMs={data.referenceUtcMs}
        />
      </div>
    </div>
  );
}

export function ProjectWorkspaceClient({
  userId,
  projectId,
  initialData,
  initialFetchedAtMs,
  initialTab,
  initialSelectedId,
}: {
  userId: string;
  projectId: string;
  initialData: ProjectViewPayload;
  initialFetchedAtMs: number;
  initialTab: "tasks" | "notes" | "activity";
  initialSelectedId: string | null;
}) {
  const { data } = useProjectWorkspaceQuery(
    userId,
    projectId,
    initialData,
    initialFetchedAtMs
  );

  return (
    <ProjectWorkspaceView
      workspace={data.workspace}
      timezone={data.timezone}
      initialTab={initialTab}
      initialSelectedId={initialSelectedId}
    />
  );
}
