"use client";

import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import {
  useTasksViewQuery,
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
