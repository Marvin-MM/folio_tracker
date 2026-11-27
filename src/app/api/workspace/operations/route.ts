import { NextRequest } from "next/server";
import { OPERATION_DOMAINS, type OperationDomain } from "@/server/db/schema";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { operationService } from "@/server/services/operation-service";


export async function GET(request: NextRequest) {
  return withWorkspaceAuth(async ({ user }) => {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("archived") === "true";
    const domainParam = searchParams.get("domain");
    const domain =
      domainParam &&
      (OPERATION_DOMAINS as readonly string[]).includes(domainParam)
        ? (domainParam as OperationDomain)
        : undefined;
    const query = searchParams.get("q") ?? undefined;

    const payload = await operationService.listOperationsHub(user.id, {
      includeArchived,
      domain,
      query,
    });

    return workspaceJson(payload);
  });
}
