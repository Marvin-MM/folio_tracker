import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationDetailQueryView } from "@/components/operations/operation-detail-query-view";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { operationService } from "@/server/services/operation-service";

export const metadata: Metadata = {
  title: "Operation",
};

interface OperationDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}

export default async function OperationDetailPage({
  params,
  searchParams,
}: OperationDetailPageProps) {
  const [{ user }, { id }, query] = await Promise.all([
    requireSession(),
    params,
    searchParams,
  ]);
  const timezone = user.timezone || "UTC";
  const initialFetchedAtMs = getServerTimestampMs();

  let detail;
  try {
    detail = await operationService.getOperationDetail(user.id, id);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <OperationDetailQueryView
      userId={user.id}
      operationId={id}
      timezone={timezone}
      autoOpenStartDialog={query.action === "start"}
      initialData={detail}
      initialDataUpdatedAt={initialFetchedAtMs}
    />
  );
}
