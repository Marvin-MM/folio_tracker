import type { Metadata } from "next";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { HabitsWorkspaceView } from "@/components/habits/habits-workspace-view";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { workspaceRepository } from "@/server/dal/workspace-repository";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { habitMonitorService } from "@/server/services/habit-monitor-service";
import { habitService } from "@/server/services/habit-service";

export const dynamic = "force-dynamic";

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
  const scoringMode: ScoringMode =
    params.mode === "full_month" ? "full_month" : "elapsed";

  const [workspace, sidebarSummary, circleBadgeCount] = await Promise.all([
    habitService.getMonthWorkspace(user.id, timezone, {
      yearMonth: params.month,
      scoringMode,
    }),
    workspaceRepository.getSidebarSummary(user.id, timezone),
    habitMonitorService.getCircleBadgeCount(user.id),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle="Real-calendar tracking, streaks, and honest monthly analytics"
        meta={`${workspace.analytics.calendar.monthLabel} · ${workspace.habits.length} active`}
      />
      <HabitsSubnav circleBadgeCount={circleBadgeCount} />
      <div className="mx-auto w-full max-w-[1400px] min-w-0 p-4 md:p-6">
        <HabitsWorkspaceView
          workspace={workspace}
          projects={sidebarSummary.projects}
          timezone={timezone}
        />
      </div>
    </div>
  );
}
