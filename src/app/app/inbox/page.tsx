import type { Metadata } from "next";
import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import { requireSession } from "@/server/dal/auth-guard";
import { taskRepository } from "@/server/dal/task-repository";

export const metadata: Metadata = {
  title: "Inbox",
};

interface InboxPageProps {
  searchParams: Promise<{ item?: string }>;
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const { items: tasks, referenceUtcMs } =
    await taskRepository.listInboxWithReminders(user.id);

  const activeCount = tasks.filter((t) => t.task.status !== "done").length;

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Inbox"
        subtitle="Personal tasks not yet assigned to a project"
        meta={`${activeCount} active`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <TaskListView
          tasks={tasks}
          timezone={timezone}
          nowMs={referenceUtcMs}
          variant="inbox"
          initialSelectedId={params.item ?? null}
          emptyTitle="Your inbox is clear"
          emptyDescription="Capture tasks inline above or press ⌘K with natural-language dates like 'Pay Umeme bill tomorrow 9am'."
        />
      </div>
    </div>
  );
}
