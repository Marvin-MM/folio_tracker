import type { Metadata } from "next";
import { TodayWorkspaceClient } from "@/components/workspace/workspace-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
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
  const initialFetchedAtMs = getServerTimestampMs();
  const [{ items, referenceUtcMs }, habitsStrip] = await Promise.all([
    taskRepository.listTodayWithReminders(user.id, timezone),
    habitService.getTodayHabitsStrip(user.id, timezone),
  ]);

  return (
    <TodayWorkspaceClient
      userId={user.id}
      initialData={{
        view: "today",
        items,
        referenceUtcMs,
        timezone,
        habitsStrip,
      }}
      initialFetchedAtMs={initialFetchedAtMs}
      initialSelectedId={params.item ?? null}
    />
  );
}
