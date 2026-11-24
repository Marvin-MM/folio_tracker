import type { Metadata } from "next";
import { InboxWorkspaceClient } from "@/components/workspace/workspace-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { taskRepository } from "@/server/dal/task-repository";

export const dynamic = "force-dynamic";

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
  const initialFetchedAtMs = getServerTimestampMs();
  const { items, referenceUtcMs } =
    await taskRepository.listInboxWithReminders(user.id);

  return (
    <InboxWorkspaceClient
      userId={user.id}
      initialData={{ view: "inbox", items, referenceUtcMs, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
      initialSelectedId={params.item ?? null}
    />
  );
}
