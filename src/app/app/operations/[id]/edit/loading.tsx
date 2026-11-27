import { Skeleton } from "@/components/ui/skeleton";

export default function OperationEditLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 md:px-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
