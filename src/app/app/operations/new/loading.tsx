import { Skeleton } from "@/components/ui/skeleton";

export default function NewOperationLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
