"use client";

import { ProjectWorkspaceView } from "@/components/projects/project-workspace-view";
import {
  useProjectWorkspaceQuery,
  type ProjectViewPayload,
} from "@/hooks/use-workspace-queries";

export function ProjectWorkspaceClient({
  userId,
  projectId,
  initialData,
  initialFetchedAtMs,
  initialTab,
  initialSelectedId,
}: {
  userId: string;
  projectId: string;
  initialData: ProjectViewPayload;
  initialFetchedAtMs: number;
  initialTab: "tasks" | "notes" | "activity";
  initialSelectedId: string | null;
}) {
  const { data } = useProjectWorkspaceQuery(
    userId,
    projectId,
    initialData,
    initialFetchedAtMs
  );

  return (
    <ProjectWorkspaceView
      workspace={data.workspace}
      timezone={data.timezone}
      initialTab={initialTab}
      initialSelectedId={initialSelectedId}
    />
  );
}
