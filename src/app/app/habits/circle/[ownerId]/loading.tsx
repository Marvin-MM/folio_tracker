import { Skeleton } from "@/components/ui/skeleton";

export default function FriendHabitsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4 md:px-6">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
        <Skeleton className="h-16 w-full rounded-md" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
        <Skeleton className="h-56 w-full rounded-md" />
      </div>
    </div>
  );
}
