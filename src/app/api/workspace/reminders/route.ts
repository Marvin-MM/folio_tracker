import { reminderRepository } from "@/server/dal/reminder-repository";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return withWorkspaceAuth(async ({ user }) => {
    const timezone = user.timezone || "UTC";
    const items = await reminderRepository.listActiveForUserWithEntities(
      user.id
    );
    const referenceUtcMs =
      items.reduce((acc, row) => Math.max(acc, row.reminder.updatedAt), 0) ||
      Date.now();

    return workspaceJson({
      items,
      referenceUtcMs,
      timezone,
    });
  });
}
