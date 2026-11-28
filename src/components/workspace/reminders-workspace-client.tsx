"use client";

import { ViewHeader } from "@/components/workspace/view-header";
import { ReminderListView } from "@/components/workspace/workspace-lists";
import {
  useRemindersViewQuery,
  type RemindersViewPayload,
} from "@/hooks/use-workspace-queries";

export function RemindersWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
}: {
  userId: string;
  initialData: RemindersViewPayload;
  initialFetchedAtMs: number;
}) {
  const { data } = useRemindersViewQuery(
    userId,
    initialData,
    initialFetchedAtMs
  );

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Reminders"
        subtitle="Hybrid 14-day durable schedule across tasks and notes"
        meta={`${data.items.length} tracked · ${data.timezone}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <ReminderListView
          reminders={data.items}
          timezone={data.timezone}
          nowMs={data.referenceUtcMs}
        />
      </div>
    </div>
  );
}
