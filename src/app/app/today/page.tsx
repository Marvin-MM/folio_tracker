import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { TodayHabitsStrip } from "@/components/habits/today-habits-strip";
import { ViewHeader } from "@/components/workspace/view-header";
import { TaskListView } from "@/components/workspace/workspace-lists";
import { requireSession } from "@/server/dal/auth-guard";
import { taskRepository } from "@/server/dal/task-repository";
import { habitService } from "@/server/services/habit-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Today",
};

interface TodayPageProps {
  searchParams: Promise<{ item?: string }>;
}

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const [{ items: tasks, referenceUtcMs }, habitsStrip] = await Promise.all([
    taskRepository.listTodayWithReminders(user.id, timezone),
    habitService.getTodayHabitsStrip(user.id, timezone),
  ]);

  let formattedToday = "";
  try {
    formattedToday = formatInTimeZone(referenceUtcMs, timezone, "EEE, MMM d");
  } catch {
    formattedToday = formatInTimeZone(referenceUtcMs, "UTC", "EEE, MMM d");
  }

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Today"
        subtitle="Overdue, due today, and tasks with reminders today"
        meta={`${formattedToday} · ${tasks.length}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <TodayHabitsStrip
          todayDateKey={habitsStrip.todayDateKey}
          initialItems={habitsStrip.items}
        />
        <TaskListView
          tasks={tasks}
          timezone={timezone}
          nowMs={referenceUtcMs}
          variant="today"
          initialSelectedId={params.item ?? null}
          emptyTitle="Nothing due today"
          emptyDescription="Tasks due today, overdue items, or tasks with timed reminders today will collect here."
        />
      </div>
    </div>
  );
}
