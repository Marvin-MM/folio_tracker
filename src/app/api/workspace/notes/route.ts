import { noteRepository } from "@/server/dal/note-repository";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";


export async function GET() {
  return withWorkspaceAuth(async ({ user }) => {
    const timezone = user.timezone || "UTC";
    const items = await noteRepository.listNotesWithReminders(user.id);

    return workspaceJson({
      items,
      timezone,
    });
  });
}
