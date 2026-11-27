import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationRunnerQueryView } from "@/components/operations/operations-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { operationRunService } from "@/server/services/operation-run-service";


interface OperationRunPageProps {
  params: Promise<{ runId: string }>;
}

export async function generateMetadata({
  params,
}: OperationRunPageProps): Promise<Metadata> {
  try {
    const [{ user }, { runId }] = await Promise.all([requireSession(), params]);
    const detail = await operationRunService.getRunDetail(user.id, runId);
    return { title: detail.run.title };
  } catch {
    return { title: "Operation Run" };
  }
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
