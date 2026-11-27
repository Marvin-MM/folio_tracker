"use client";

import { useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Flag, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { resolveOperationStepFlagAction } from "@/actions/operations";
import { Button } from "@/components/ui/button";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import type { OperationStepFlagWithReporter } from "@/server/dal/operations-social";
import type { OperationStep } from "@/server/domain/operations";

interface OperationFlagsPanelProps {
  operationId: string;
  openFlags: OperationStepFlagWithReporter[];
  steps: OperationStep[];
}

export function OperationFlagsPanel({
  operationId,
  openFlags,
  steps,
}: OperationFlagsPanelProps) {
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  if (openFlags.length === 0) return null;

  const stepIndexByKey = new Map<string, { num: number; title: string }>();
  steps.forEach((step, idx) => {
    stepIndexByKey.set(step.key, { num: idx + 1, title: step.title });
  });

  const handleResolve = (flagId: string) => {
    startTransition(async () => {
      const result = await resolveOperationStepFlagAction({
        operationId,
        flagId,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success("Step flag resolved.");
    });
  };

  return (
    <section
      data-testid="open-step-flags-panel"
      className="space-y-3 rounded-lg border border-overdue/40 bg-overdue/5 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-overdue">
          <Flag className="size-3.5" />
          Open Step Flags ({openFlags.length})
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Visible to Owners &amp; Collaborators
        </span>
      </div>

      <div className="space-y-2">
        {openFlags.map((entry) => {
          const stepInfo = stepIndexByKey.get(entry.flag.stepKey);
          return (
            <div
              key={entry.flag.id}
              className="flex flex-col justify-between gap-2.5 rounded-md border border-border bg-card p-3 text-xs sm:flex-row sm:items-start"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                    v{entry.flag.versionNumber}
                  </span>
                  <span className="font-medium text-foreground">
                    {stepInfo
                      ? `Step ${stepInfo.num}: ${stepInfo.title}`
                      : `Step ${entry.flag.stepKey}`}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    · Reported by{" "}
                    {entry.reporterHandle
                      ? `@${entry.reporterHandle}`
                      : entry.reporterName}
                  </span>
                </div>
                <p className="leading-relaxed text-foreground/90">
                  {entry.flag.message}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-[11px] md:h-7"
                >
                  <Link
                    href={`/app/operations/${operationId}/edit#step-${encodeURIComponent(entry.flag.stepKey)}`}
                  >
                    <Pencil className="size-3" />
                    Edit step
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleResolve(entry.flag.id)}
                  className="h-8 gap-1 border-done/40 px-2.5 text-[11px] text-done hover:bg-done/10 hover:text-done md:h-7"
                >
                  {isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  Resolve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
