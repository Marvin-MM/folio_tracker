import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspaceClient } from "@/components/workspace/workspace-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { projectService } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; item?: string }>;
}

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  try {
    const [{ user }, { projectId }] = await Promise.all([
      requireSession(),
      params,
    ]);
    const workspace = await projectService.getProjectWorkspace(
      projectId,
      user.id
    );
    return {
      title: workspace.project.name,
    };
  } catch {
    return {
      title: "Project",
    };
  }
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const [{ user }, { projectId }, query] = await Promise.all([
    requireSession(),
    params,
    searchParams,
  ]);

  const initialFetchedAtMs = getServerTimestampMs();
  let workspace;
  try {
    workspace = await projectService.getProjectWorkspace(projectId, user.id);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const initialTab =
    query.tab === "notes" || query.tab === "activity" ? query.tab : "tasks";

  return (
    <ProjectWorkspaceClient
      userId={user.id}
      projectId={projectId}
      initialData={{ workspace, timezone: user.timezone || "UTC" }}
      initialFetchedAtMs={initialFetchedAtMs}
      initialTab={initialTab}
      initialSelectedId={query.item ?? null}
    />
  );
}
