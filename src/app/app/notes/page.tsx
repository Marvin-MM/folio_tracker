import type { Metadata } from "next";
import { NotesWorkspaceClient } from "@/components/workspace/workspace-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
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
  const initialFetchedAtMs = getServerTimestampMs();
  const items = await noteRepository.listNotesWithReminders(user.id);

  return (
    <NotesWorkspaceClient
      userId={user.id}
      initialData={{ items, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
      initialSelectedId={params.item ?? null}
    />
  );
}
