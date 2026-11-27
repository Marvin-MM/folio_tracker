import { Skeleton } from "@/components/ui/skeleton";

export default function OperationRunLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 md:px-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-2 w-full" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  );
}
