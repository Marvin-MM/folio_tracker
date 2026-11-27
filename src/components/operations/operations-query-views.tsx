"use client";

import { useState } from "react";
import { OperationBuilderView } from "@/components/operations/operation-builder-view";
import { OperationDetailView } from "@/components/operations/operation-detail-view";
import { OperationRunnerView } from "@/components/operations/operation-runner-view";
import { OperationsHubView } from "@/components/operations/operations-hub-view";
import {
  useOperationDetailQuery,
  useOperationRunQuery,
  useOperationsHubQuery,
} from "@/hooks/use-workspace-queries";
import type { OperationRunDetailPayload } from "@/server/services/operation-run-service";
import type {
  OperationDetailPayload,
  OperationsHubPayload,
} from "@/server/services/operation-service";

export function OperationsHubQueryView({
  userId,
  timezone,
  initialData,
  initialDataUpdatedAt,
}: {
  userId: string;
  timezone: string;
  initialData: OperationsHubPayload;
  initialDataUpdatedAt: number;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data } = useOperationsHubQuery(
    userId,
    { includeArchived },
    includeArchived ? undefined : initialData,
    includeArchived ? undefined : initialDataUpdatedAt
  );

  return (
    <OperationsHubView
      payload={data ?? initialData}
      timezone={timezone}
      includeArchived={includeArchived}
      onIncludeArchivedChange={setIncludeArchived}
    />
  );
}

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
      timezone={timezone}
      autoOpenStartDialog={autoOpenStartDialog}
    />
  );
}

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
