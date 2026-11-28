import type { Metadata } from "next";
import { UpcomingWorkspaceClient } from "@/components/workspace/upcoming-workspace-client";
import { getServerTimestampMs } from "@/lib/query/clock";
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
  const initialFetchedAtMs = getServerTimestampMs();
  const { items, referenceUtcMs } =
    await taskRepository.listUpcomingWithReminders(user.id, timezone);

  return (
    <UpcomingWorkspaceClient
      userId={user.id}
      initialData={{ view: "upcoming", items, referenceUtcMs, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
      initialSelectedId={params.item ?? null}
    />
  );
}
