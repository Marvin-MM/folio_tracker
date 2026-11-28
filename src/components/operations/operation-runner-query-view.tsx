"use client";

import { OperationRunnerView } from "@/components/operations/operation-runner-view";
import { useOperationRunQuery } from "@/hooks/use-workspace-queries";
import type { OperationRunDetailPayload } from "@/server/services/operation-run-service";

export function OperationRunnerQueryView({
  userId,
  runId,
  timezone,
  initialData,
  initialDataUpdatedAt,
}: {
  userId: string;
  runId: string;
  timezone: string;
  initialData: OperationRunDetailPayload;
  initialDataUpdatedAt: number;
}) {
  const { data } = useOperationRunQuery(
    userId,
    runId,
    initialData,
    initialDataUpdatedAt
  );

  return (
    <OperationRunnerView
      detail={data ?? initialData}
      userId={userId}
      timezone={timezone}
    />
  );
}
