import type { Metadata } from "next";
import { ViewHeader } from "@/components/workspace/view-header";
import { ReminderListView } from "@/components/workspace/workspace-lists";
import { requireSession } from "@/server/dal/auth-guard";
import { reminderRepository } from "@/server/dal/reminder-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reminders",
};

export default async function RemindersPage() {
  const { user } = await requireSession();
  const timezone = user.timezone || "UTC";
  const items = await reminderRepository.listActiveForUserWithEntities(user.id);
  const referenceUtcMs =
    items.reduce((acc, row) => Math.max(acc, row.reminder.updatedAt), 0) || 1;

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Reminders"
        subtitle="Hybrid 14-day durable schedule across tasks and notes"
        meta={`${items.length} tracked · ${timezone}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <ReminderListView
          reminders={items}
          timezone={timezone}
          nowMs={referenceUtcMs}
        />
      </div>
    </div>
  );
}
