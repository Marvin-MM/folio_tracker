import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationEditQueryView } from "@/components/operations/operations-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { operationService } from "@/server/services/operation-service";


interface OperationEditPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: OperationEditPageProps): Promise<Metadata> {
  try {
    const [{ user }, { id }] = await Promise.all([requireSession(), params]);
    const detail = await operationService.getOperationDetail(user.id, id);
    if (!detail.access.capabilities.canEditSteps) {
      return { title: "Edit Operation" };
    }
    return { title: `Edit · ${detail.operation.title}` };
  } catch {
    return { title: "Edit Operation" };
  }
}

export default async function OperationEditPage({
  params,
}: OperationEditPageProps) {
  const [{ user }, { id }] = await Promise.all([requireSession(), params]);
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

  if (!detail.access.capabilities.canEditSteps) {
    notFound();
  }

  return (
    <OperationEditQueryView
      userId={user.id}
      operationId={id}
      timezone={timezone}
      initialData={detail}
      initialDataUpdatedAt={initialFetchedAtMs}
    />
  );
}
