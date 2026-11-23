import { Skeleton } from "@/components/ui/skeleton";

export default function HabitsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4 md:px-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-md border border-border bg-card p-3.5"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-2.5 w-36" />
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-border bg-card p-3.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
