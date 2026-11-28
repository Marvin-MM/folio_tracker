import type { Metadata } from "next";
import { HabitsMonthClient } from "@/components/habits/habits-month-client";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { habitMonitorService } from "@/server/services/habit-monitor-service";
import { habitService } from "@/server/services/habit-service";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Habits",
};

interface HabitsPageProps {
  searchParams: Promise<{ month?: string; mode?: string }>;
}

export default async function HabitsPage({ searchParams }: HabitsPageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const initialFetchedAtMs = getServerTimestampMs();
  const initialModeParam: ScoringMode | null =
    params.mode === "full_month"
      ? "full_month"
      : params.mode === "elapsed"
        ? "elapsed"
        : null;

  // Eliminates duplicate getSidebarSummary() call — projects are served from AppShellLayout's bootstrap query
  const [workspace, circleBadgeCount] = await Promise.all([
    habitService.getMonthWorkspace(user.id, timezone, {
      yearMonth: params.month,
      scoringMode: initialModeParam ?? "elapsed",
    }),
    habitMonitorService.getCircleBadgeCount(user.id),
  ]);

  return (
    <HabitsMonthClient
      userId={user.id}
      initialYearMonth={workspace.yearMonth}
      initialModeParam={initialModeParam}
      initialData={{ workspace, circleBadgeCount, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
