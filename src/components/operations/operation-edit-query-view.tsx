"use client";

import { OperationBuilderView } from "@/components/operations/operation-builder-view";
import { useOperationDetailQuery } from "@/hooks/use-workspace-queries";
import type { OperationDetailPayload } from "@/server/services/operation-service";

export function OperationEditQueryView({
  userId,
  operationId,
  timezone,
  initialData,
  initialDataUpdatedAt,
}: {
  userId: string;
  operationId: string;
  timezone: string;
  initialData: OperationDetailPayload;
  initialDataUpdatedAt: number;
}) {
  const { data } = useOperationDetailQuery(
    userId,
    operationId,
    initialData,
    initialDataUpdatedAt
  );
  const resolved = data ?? initialData;

  return (
    <OperationBuilderView
      mode="edit"
      timezone={timezone}
      detail={resolved}
      linkOptions={resolved.linkOptions}
    />
  );
}
