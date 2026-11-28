"use client";

import { formatInTimeZone } from "date-fns-tz";
import { TodayHabitsStrip } from "@/components/habits/today-habits-strip";
import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import {
  useTasksViewQuery,
  type TasksViewPayload,
} from "@/hooks/use-workspace-queries";

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
