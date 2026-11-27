import { Skeleton } from "@/components/ui/skeleton";

export default function GroupWorkspaceLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4 md:px-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="mx-auto grid w-full max-w-[1200px] gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Skeleton className="h-72 w-full rounded-md" />
          <Skeleton className="h-40 w-full rounded-md" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-md" />
          <Skeleton className="h-44 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
