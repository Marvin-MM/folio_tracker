import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-border bg-primary text-[11px] font-semibold tracking-tight text-primary-foreground",
        className
      )}
    >
      F
    </span>
  );
}
