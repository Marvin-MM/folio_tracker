import { Skeleton } from "@/components/ui/skeleton";

export default function OperationDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 md:px-6">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-12" />
        </div>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-border bg-card p-4"
          >
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
