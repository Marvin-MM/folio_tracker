import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationRunnerQueryView } from "@/components/operations/operation-runner-query-view";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { operationRunService } from "@/server/services/operation-run-service";

export const metadata: Metadata = {
  title: "Operation Run",
};

interface OperationRunPageProps {
  params: Promise<{ runId: string }>;
}

export default async function OperationRunPage({
  params,
}: OperationRunPageProps) {
  const [{ user }, { runId }] = await Promise.all([requireSession(), params]);
  const timezone = user.timezone || "UTC";
  const initialFetchedAtMs = getServerTimestampMs();

  let detail;
  try {
    detail = await operationRunService.getRunDetail(user.id, runId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <OperationRunnerQueryView
      userId={user.id}
      runId={runId}
      timezone={timezone}
      initialData={detail}
      initialDataUpdatedAt={initialFetchedAtMs}
    />
  );
}
