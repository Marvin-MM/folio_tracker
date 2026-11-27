"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Repeat2, Users, UsersRound } from "lucide-react";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { usePrefetchWorkspaceView } from "@/hooks/use-workspace-queries";
import { getCurrentYearMonthForTimezone } from "@/lib/query/clock";
import { cn } from "@/lib/utils";

interface HabitsSubnavProps {
  circleBadgeCount?: number;
}

export function HabitsSubnav({ circleBadgeCount = 0 }: HabitsSubnavProps) {
  const pathname = usePathname();
  const { userId, timezone } = useWorkspaceChrome();
  const prefetch = usePrefetchWorkspaceView(userId);
  const isCircle = pathname.startsWith("/app/habits/circle");
  const isGroups = pathname.startsWith("/app/habits/groups");

  const handlePrefetchTracker = () => {
    prefetch.prefetchHabitsMonth(getCurrentYearMonthForTimezone(timezone));
  };

  return (
    <nav
      aria-label="Habits workspace navigation"
      className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-4 md:px-6"
    >
      <Link
        href="/app/habits"
        onMouseEnter={handlePrefetchTracker}
        onFocus={handlePrefetchTracker}
        aria-current={!isCircle && !isGroups ? "page" : undefined}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors md:min-h-9",
          !isCircle && !isGroups
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        <Repeat2 className="size-3.5" />
        <span>My Tracker</span>
      </Link>

      <Link
        href="/app/habits/circle"
        onMouseEnter={() => prefetch.prefetchHabitsCircle(null)}
        onFocus={() => prefetch.prefetchHabitsCircle(null)}
        aria-current={isCircle ? "page" : undefined}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors md:min-h-9",
          isCircle
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        <Users className="size-3.5" />
        <span>Circle</span>
        {circleBadgeCount > 0 ? (
          <span
            title="Pending monitor requests and open friend review windows"
            aria-label={`${circleBadgeCount} pending monitor requests or open review windows`}
            className="mono-tabular rounded border border-collab/35 bg-collab/10 px-1.5 py-0.5 text-[10px] font-medium text-collab"
          >
            {circleBadgeCount}
          </span>
        ) : null}
      </Link>

      <Link
        href="/app/habits/groups"
        aria-current={isGroups ? "page" : undefined}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors md:min-h-9",
          isGroups
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        <UsersRound className="size-3.5" />
        <span>Groups</span>
      </Link>
    </nav>
  );
}
