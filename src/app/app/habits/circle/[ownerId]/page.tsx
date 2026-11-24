import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { FriendHabitsClient } from "@/components/habits/habits-query-views";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/workspace/view-header";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { habitMonitorReadDal } from "@/server/dal/habits-social";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { habitMonitorService } from "@/server/services/habit-monitor-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Friend Habit Ledger",
};

interface FriendHabitsPageProps {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ month?: string; mode?: string; cycle?: string }>;
}

export default async function FriendHabitsPage({
  params,
  searchParams,
}: FriendHabitsPageProps) {
  const [{ user }, routeParams, query] = await Promise.all([
    requireSession(),
    params,
    searchParams,
  ]);

  const initialFetchedAtMs = getServerTimestampMs();
  const initialModeParam: ScoringMode | null =
    query.mode === "full_month"
      ? "full_month"
      : query.mode === "elapsed"
        ? "elapsed"
        : null;
  const initialCycleKey = query.cycle?.trim() || null;

  const [circleBadgeCount, workspaceResult] = await Promise.all([
    habitMonitorService.getCircleBadgeCount(user.id),
    habitMonitorReadDal
      .getScopedFriendWorkspace({
        viewerUserId: user.id,
        ownerId: routeParams.ownerId,
        yearMonth: query.month,
        scoringMode: initialModeParam ?? "elapsed",
        selectedCycleKey: initialCycleKey ?? undefined,
      })
      .then((data) => ({ ok: true as const, data }))
      .catch((error: unknown) => {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) {
          return { ok: false as const, message: error.message };
        }
        throw error;
      }),
  ]);

  if (!workspaceResult.ok) {
    return (
      <div className="flex flex-1 flex-col">
        <ViewHeader title="Habits" subtitle="Accountability Circle" />
        <HabitsSubnav circleBadgeCount={circleBadgeCount} />
        <div className="mx-auto w-full max-w-lg p-6">
          <div className="space-y-3 rounded-md border border-border bg-card p-6 text-center">
            <ShieldAlert className="mx-auto size-5 text-overdue" />
            <h2 className="text-sm font-semibold text-foreground">
              Monitor access unavailable
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {workspaceResult.message}
            </p>
            <div className="pt-1">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="mira-row text-xs"
              >
                <Link href="/app/habits/circle">
                  Back to Accountability Circle
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const workspace = workspaceResult.data;

  return (
    <FriendHabitsClient
      userId={user.id}
      ownerId={routeParams.ownerId}
      initialYearMonth={workspace.yearMonth}
      initialCycleKey={initialCycleKey}
      initialModeParam={initialModeParam}
      initialData={{ workspace, circleBadgeCount }}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
