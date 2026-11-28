"use client";

import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import {
  useTasksViewQuery,
  type TasksViewPayload,
} from "@/hooks/use-workspace-queries";

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
