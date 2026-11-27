import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { operationService } from "@/server/services/operation-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return withWorkspaceAuth(async ({ user }) => {
    const payload = await operationService.getOperationDetail(user.id, id);
    return workspaceJson(payload);
  });
}
