import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { projectService } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  return withWorkspaceAuth(async ({ user }) => {
    const { projectId } = await context.params;
    const workspace = await projectService.getProjectWorkspace(
      projectId,
      user.id
    );

    return workspaceJson({
      workspace,
      timezone: user.timezone || "UTC",
    });
  });
}
