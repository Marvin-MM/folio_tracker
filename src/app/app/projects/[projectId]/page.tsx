import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspaceView } from "@/components/projects/project-workspace-view";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { projectService } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project",
};

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; item?: string }>;
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
    <ProjectWorkspaceView
      workspace={workspace}
      timezone={user.timezone || "UTC"}
      initialTab={initialTab}
      initialSelectedId={query.item ?? null}
    />
  );
}
