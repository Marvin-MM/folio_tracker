import { Skeleton } from "@/components/ui/skeleton";

export default function AdminPortalLoading() {
  return (
    <div
      aria-label="Loading Admin Portal"
      className="flex flex-1 flex-col"
    >
      {/* Header Skeleton */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-72 max-w-[68vw]" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-16 rounded" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </div>

      {/* Tab Bar Skeleton */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2 md:px-6">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-28" />
      </div>

      {/* Body Skeleton */}
      <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="space-y-2.5 rounded-md border border-border bg-card p-3.5"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-44" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-7" />
          <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-5" />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Skeleton
              key={idx}
              className="h-[118px] rounded-md border border-border"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
