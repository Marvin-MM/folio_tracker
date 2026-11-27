import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { operationRunService } from "@/server/services/operation-run-service";


export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const { runId } = await context.params;
  return withWorkspaceAuth(async ({ user }) => {
    const payload = await operationRunService.getRunDetail(user.id, runId);
    return workspaceJson(payload);
  });
}
