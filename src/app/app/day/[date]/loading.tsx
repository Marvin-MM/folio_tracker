import { Skeleton } from "@/components/ui/skeleton";

export default function DayPageLoading() {
  return (
    <div className="flex flex-1 flex-col" aria-label="Loading day ledger">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="hidden h-3.5 w-36 xl:block" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4 md:p-6">
        <div className="rounded-md border border-border bg-card p-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-1.5 h-3 w-28" />
        </div>
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
        <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
