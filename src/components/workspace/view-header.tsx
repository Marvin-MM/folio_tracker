"use client";

import { Plus } from "lucide-react";
import { NotificationBell } from "@/components/shell/notification-bell";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ViewHeaderProps {
  title: string;
  subtitle?: string;
  meta?: string;
  actions?: React.ReactNode;
}

export function ViewHeader({ title, subtitle, meta, actions }: ViewHeaderProps) {
  const { openQuickCapture, notifications, timezone } = useWorkspaceChrome();

  return (
    <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {subtitle}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {meta ? (
          <span className="mono-tabular hidden text-[11px] text-muted-foreground sm:inline">
            {meta}
          </span>
        ) : null}
        {actions}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openQuickCapture}
          aria-label="Open quick capture"
          className="hidden h-7 gap-1 border-border bg-card px-2 text-xs font-normal text-foreground hover:bg-accent md:inline-flex"
        >
          <Plus className="size-3" />
          <span>Capture</span>
          <kbd className="mono-tabular ml-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
        <div className="hidden md:block">
          <NotificationBell
            initialNotifications={notifications}
            timezone={timezone}
          />
        </div>
      </div>
    </div>
  );
}

export function WorkspaceViewSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4 md:px-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-2 p-4 md:p-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="mira-row flex items-center justify-between rounded-md border border-border bg-card px-3"
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-3.5 rounded-sm" />
              <Skeleton className="h-3.5 w-48 sm:w-64" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
