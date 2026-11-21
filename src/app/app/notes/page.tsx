import type { Metadata } from "next";
import { ViewHeader } from "@/components/workspace/view-header";
import { NoteListView } from "@/components/workspace/workspace-lists";
import { requireSession } from "@/server/dal/auth-guard";
import { noteRepository } from "@/server/dal/note-repository";

export const metadata: Metadata = {
  title: "Notes",
};

interface NotesPageProps {
  searchParams: Promise<{ item?: string }>;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const noteItems = await noteRepository.listNotesWithReminders(user.id);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Notes"
        subtitle="Quiet markdown notes with optional timed reminders"
        meta={`${noteItems.length} ${noteItems.length === 1 ? "note" : "notes"}`}
      />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <NoteListView
          notes={noteItems}
          timezone={timezone}
          initialSelectedId={params.item ?? null}
        />
      </div>
    </div>
  );
}
