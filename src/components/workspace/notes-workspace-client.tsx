"use client";

import { ViewHeader } from "@/components/workspace/view-header";
import { NoteListView } from "@/components/workspace/workspace-lists";
import {
  useNotesViewQuery,
  type NotesViewPayload,
} from "@/hooks/use-workspace-queries";

export function NotesWorkspaceClient({
  userId,
  initialData,
  initialFetchedAtMs,
  initialSelectedId,
}: {
  userId: string;
  initialData: NotesViewPayload;
  initialFetchedAtMs: number;
  initialSelectedId: string | null;
}) {
  const { data } = useNotesViewQuery(userId, initialData, initialFetchedAtMs);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Notes"
        subtitle="Quiet markdown notes with optional timed reminders"
        meta={`${data.items.length} ${data.items.length === 1 ? "note" : "notes"}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <NoteListView
          notes={data.items}
          timezone={data.timezone}
          initialSelectedId={initialSelectedId}
        />
      </div>
    </div>
  );
}
