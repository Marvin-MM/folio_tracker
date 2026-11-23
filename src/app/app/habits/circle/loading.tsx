import { Skeleton } from "@/components/ui/skeleton";

export default function HabitsCircleLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4 md:px-6">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-28 w-full rounded-md" />
          <Skeleton className="h-28 w-full rounded-md" />
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    </div>
  );
}
