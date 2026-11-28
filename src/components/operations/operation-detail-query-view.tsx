"use client";

import { OperationDetailView } from "@/components/operations/operation-detail-view";
import { useOperationDetailQuery } from "@/hooks/use-workspace-queries";
import type { OperationDetailPayload } from "@/server/services/operation-service";

export function OperationDetailQueryView({
  userId,
  operationId,
  timezone,
  autoOpenStartDialog,
  initialData,
  initialDataUpdatedAt,
}: {
  userId: string;
  operationId: string;
  timezone: string;
  autoOpenStartDialog?: boolean;
  initialData: OperationDetailPayload;
  initialDataUpdatedAt: number;
}) {
  const { data } = useOperationDetailQuery(
    userId,
    operationId,
    initialData,
    initialDataUpdatedAt
  );

  return (
    <OperationDetailView
      detail={data ?? initialData}
      userId={userId}
      timezone={timezone}
      autoOpenStartDialog={autoOpenStartDialog}
    />
  );
}
