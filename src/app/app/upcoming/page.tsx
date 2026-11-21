import type { Metadata } from "next";
import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import { requireSession } from "@/server/dal/auth-guard";
import { taskRepository } from "@/server/dal/task-repository";

export const metadata: Metadata = {
  title: "Upcoming",
};

interface UpcomingPageProps {
  searchParams: Promise<{ item?: string }>;
}

export default async function UpcomingPage({
  searchParams,
}: UpcomingPageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const { items: tasks, referenceUtcMs } =
    await taskRepository.listUpcomingWithReminders(user.id, timezone);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Upcoming"
        subtitle="Future scheduled tasks and reminders"
        meta={`${tasks.length} scheduled`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <TaskListView
          tasks={tasks}
          timezone={timezone}
          nowMs={referenceUtcMs}
          variant="upcoming"
          initialSelectedId={params.item ?? null}
          emptyTitle="Nothing scheduled ahead"
          emptyDescription="Tasks with future due dates or timed reminders beyond today will appear here chronologically."
        />
      </div>
    </div>
  );
}
