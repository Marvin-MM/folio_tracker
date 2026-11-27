import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { operationShareService } from "@/server/services/operation-share-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return withWorkspaceAuth(async ({ user }) => {
    const payload = await operationShareService.getShareDashboard(user.id, id);
    return workspaceJson(payload);
  });
}
