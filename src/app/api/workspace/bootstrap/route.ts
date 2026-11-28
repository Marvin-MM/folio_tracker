import { resolveLiveUserShellStatus } from "@/server/dal/auth-guard";
import { ForbiddenError } from "@/server/dal/errors";
import { notificationRepository } from "@/server/dal/notification-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";

export async function GET() {
  return withWorkspaceAuth(async ({ user }) => {
    const shellStatus = await resolveLiveUserShellStatus(user.id);

    if (shellStatus.isSuspended) {
      throw new ForbiddenError("This account has been suspended.");
    }

    const timezone = shellStatus.timezone || user.timezone || "UTC";
    const userName = shellStatus.name || user.name;
    const [summary, notifications] = await Promise.all([
      workspaceRepository.getSidebarSummary(user.id, timezone),
      notificationRepository.listRecentForUser(user.id, 20),
    ]);

    return workspaceJson({
      summary,
      notifications,
      timezone,
      userName,
      isAdmin: shellStatus.isAdmin,
    });
  });
}
