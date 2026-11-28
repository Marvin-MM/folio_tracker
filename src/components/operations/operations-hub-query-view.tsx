"use client";

import { Suspense, useState } from "react";
import { OperationsHubView } from "@/components/operations/operations-hub-view";
import { useOperationsHubQuery } from "@/hooks/use-workspace-queries";
import type { OperationsHubPayload } from "@/server/services/operation-service";

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
    <Suspense fallback={null}>
      <OperationsHubView
        payload={data ?? initialData}
        timezone={timezone}
        includeArchived={includeArchived}
        onIncludeArchivedChange={setIncludeArchived}
      />
    </Suspense>
  );
}
