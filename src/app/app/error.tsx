"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 rounded-md border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-overdue">
          <AlertTriangle className="size-4" />
          <h2 className="text-sm font-semibold text-foreground">
            Unable to load workspace view
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          A temporary error occurred while loading this view.
          {error.digest ? (
            <span className="mono-tabular ml-1">({error.digest})</span>
          ) : null}
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={reset}
            className="mira-row gap-1.5 text-xs"
          >
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mira-row text-xs"
          >
            <Link href="/app/inbox">Back to Inbox</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
