import type { Metadata } from "next";
import { RemindersWorkspaceClient } from "@/components/workspace/reminders-workspace-client";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { reminderRepository } from "@/server/dal/reminder-repository";


export const metadata: Metadata = {
  title: "Reminders",
};

export default async function RemindersPage() {
  const { user } = await requireSession();
  const timezone = user.timezone || "UTC";
  const initialFetchedAtMs = getServerTimestampMs();
  const items = await reminderRepository.listActiveForUserWithEntities(user.id);
  const referenceUtcMs =
    items.reduce((acc, row) => Math.max(acc, row.reminder.updatedAt), 0) || 1;

  return (
    <RemindersWorkspaceClient
      userId={user.id}
      initialData={{ items, referenceUtcMs, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
