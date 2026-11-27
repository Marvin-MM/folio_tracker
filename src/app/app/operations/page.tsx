import type { Metadata } from "next";
import { OperationsHubQueryView } from "@/components/operations/operations-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { operationService } from "@/server/services/operation-service";


export const metadata: Metadata = {
  title: "Operations",
};

export default async function OperationsHubPage() {
  const { user } = await requireSession();
  const timezone = user.timezone || "UTC";
  const initialFetchedAtMs = getServerTimestampMs();
  const initialData = await operationService.listOperationsHub(user.id);

  return (
    <OperationsHubQueryView
      userId={user.id}
      timezone={timezone}
      initialData={initialData}
      initialDataUpdatedAt={initialFetchedAtMs}
    />
  );
}
