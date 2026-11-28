"use client";

import { useState } from "react";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { HabitsWorkspaceView } from "@/components/habits/habits-workspace-view";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  useHabitsMonthQuery,
  usePrefetchWorkspaceView,
  type HabitsMonthViewPayload,
} from "@/hooks/use-workspace-queries";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

export function HabitsMonthClient({
  userId,
  initialYearMonth,
  initialModeParam,
  initialData,
  initialFetchedAtMs,
}: {
  userId: string;
  initialYearMonth: string;
  initialModeParam: ScoringMode | null;
  initialData: HabitsMonthViewPayload;
  initialFetchedAtMs: number;
}) {
  const { projects } = useWorkspaceChrome();
  const prefetch = usePrefetchWorkspaceView(userId);
  const setSelectedHabitsMonth = useWorkspaceUIStore(
    (s) => s.setSelectedHabitsMonth
  );
  const [activeMonth, setActiveMonth] = useState(initialYearMonth);

  const isInitialMonth = activeMonth === initialYearMonth;
  const query = useHabitsMonthQuery(
    userId,
    activeMonth,
    isInitialMonth ? initialData : undefined,
    isInitialMonth ? initialFetchedAtMs : undefined
  );

  const activeData = query.data ?? initialData;
  const currentMonth = activeData.workspace.todayDateKey.slice(0, 7);

  const handleSelectMonth = (nextMonth: string) => {
    const clampedMonth = nextMonth > currentMonth ? currentMonth : nextMonth;
    setActiveMonth(clampedMonth);
    setSelectedHabitsMonth(clampedMonth);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("month", clampedMonth);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  const activeCount = activeData.workspace.habits.filter(
    (h) => !h.isArchived
  ).length;
  const historicalArchivedCount =
    activeData.workspace.habits.length - activeCount;

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle="Real-calendar tracking, streaks, and honest monthly analytics"
        meta={
          activeData.workspace.hasExplicitMonthRoster
            ? `${activeData.workspace.analytics.calendar.monthLabel} · ${activeData.workspace.habits.length} tracked`
            : historicalArchivedCount > 0
              ? `${activeData.workspace.analytics.calendar.monthLabel} · ${activeCount} active · ${historicalArchivedCount} archived`
              : `${activeData.workspace.analytics.calendar.monthLabel} · ${activeCount} active`
        }
      />
      <HabitsSubnav circleBadgeCount={activeData.circleBadgeCount} />
      <div className="mx-auto w-full max-w-[1400px] min-w-0 p-4 md:p-6">
        <HabitsWorkspaceView
          workspace={activeData.workspace}
          projects={projects}
          timezone={activeData.timezone}
          initialModeOverride={initialModeParam}
          isSwitchingMonth={query.isFetching && query.isPlaceholderData}
          onSelectMonth={handleSelectMonth}
          onPrefetchMonth={prefetch.prefetchHabitsMonth}
        />
      </div>
    </div>
  );
}
