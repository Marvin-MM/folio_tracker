import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationDetailQueryView } from "@/components/operations/operations-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { operationService } from "@/server/services/operation-service";


interface OperationDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}

export async function generateMetadata({
  params,
}: OperationDetailPageProps): Promise<Metadata> {
  try {
    const [{ user }, { id }] = await Promise.all([requireSession(), params]);
    const detail = await operationService.getOperationDetail(user.id, id);
    return { title: detail.operation.title };
  } catch {
    return { title: "Operation" };
  }
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
