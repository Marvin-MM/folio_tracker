import type { Metadata } from "next";
import { OperationBuilderView } from "@/components/operations/operation-builder-view";
import { requireSession } from "@/server/dal/auth-guard";
import { OPERATION_DOMAINS, type OperationDomain } from "@/server/db/schema";
import { operationService } from "@/server/services/operation-service";


export const metadata: Metadata = {
  title: "New Operation",
};

interface NewOperationPageProps {
  searchParams: Promise<{ domain?: string }>;
}

export default async function NewOperationPage({
  searchParams,
}: NewOperationPageProps) {
  const [{ user }, query] = await Promise.all([requireSession(), searchParams]);
  const timezone = user.timezone || "UTC";
  const linkOptions = await operationService.getLinkOptions(user.id);

  const initialDomain: OperationDomain =
    query.domain &&
    (OPERATION_DOMAINS as readonly string[]).includes(query.domain)
      ? (query.domain as OperationDomain)
      : "general";

  return (
    <OperationBuilderView
      mode="create"
      timezone={timezone}
      initialDomain={initialDomain}
      linkOptions={linkOptions}
    />
  );
}
