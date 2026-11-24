import { notificationRepository } from "@/server/dal/notification-repository";
import { userRepository } from "@/server/dal/user-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return withWorkspaceAuth(async ({ user }) => {
    const profile = await userRepository.getById(user.id);
    const timezone = profile?.timezone || user.timezone || "UTC";
    const userName = profile?.name || user.name;
    const [summary, notifications] = await Promise.all([
      workspaceRepository.getSidebarSummary(user.id, timezone),
      notificationRepository.listRecentForUser(user.id, 20),
    ]);

    return workspaceJson({
      summary,
      notifications,
      timezone,
      userName,
    });
  });
}
