"use client";

import { useState } from "react";
import { CircleOverviewView } from "@/components/habits/circle-overview-view";
import { FriendHabitsView } from "@/components/habits/friend-habits-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { HabitsWorkspaceView } from "@/components/habits/habits-workspace-view";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  useFriendHabitsQuery,
  useHabitsCircleQuery,
  useHabitsMonthQuery,
  usePrefetchWorkspaceView,
  type FriendHabitsViewPayload,
  type HabitsCircleViewPayload,
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
          isSwitchingMonth={query.isFetching && !query.data}
          onSelectMonth={handleSelectMonth}
          onPrefetchMonth={prefetch.prefetchHabitsMonth}
        />
      </div>
    </div>
  );
}

export function HabitsCircleClient({
  userId,
  currentUserName,
  initialCycleKey,
  initialData,
  initialFetchedAtMs,
}: {
  userId: string;
  currentUserName: string;
  initialCycleKey: string | null;
  initialData: HabitsCircleViewPayload;
  initialFetchedAtMs: number;
}) {
  const [activeCycle, setActiveCycle] = useState<string | null>(initialCycleKey);
  const isInitialCycle = activeCycle === initialCycleKey;
  const query = useHabitsCircleQuery(
    userId,
    activeCycle,
    isInitialCycle ? initialData : undefined,
    isInitialCycle ? initialFetchedAtMs : undefined
  );

  const activeData = query.data ?? initialData;

  const handleSelectCycle = (nextCycle: string) => {
    setActiveCycle(nextCycle);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("cycle", nextCycle);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle="Accountability Circle, commenting cadence, and cycle reviews"
        meta={`${activeData.overview.monitoringOthers.length} following · ${activeData.overview.myMonitors.length} monitors`}
      />
      <HabitsSubnav circleBadgeCount={activeData.overview.badgeCount} />
      <div className="mx-auto w-full max-w-4xl min-w-0 p-4 md:p-6">
        <CircleOverviewView
          currentUserId={userId}
          currentUserName={currentUserName}
          timezone={activeData.timezone}
          overview={activeData.overview}
          ownerReviews={activeData.ownerReviews}
          onSelectCycle={handleSelectCycle}
        />
      </div>
    </div>
  );
}

export function FriendHabitsClient({
  userId,
  ownerId,
  initialYearMonth,
  initialCycleKey,
  initialModeParam,
  initialData,
  initialFetchedAtMs,
}: {
  userId: string;
  ownerId: string;
  initialYearMonth: string;
  initialCycleKey: string | null;
  initialModeParam: ScoringMode | null;
  initialData: FriendHabitsViewPayload;
  initialFetchedAtMs: number;
}) {
  const prefetch = usePrefetchWorkspaceView(userId);
  const [activeMonth, setActiveMonth] = useState(initialYearMonth);
  const [activeCycle, setActiveCycle] = useState<string | null>(initialCycleKey);

  const isInitialKey =
    activeMonth === initialYearMonth && activeCycle === initialCycleKey;

  const query = useFriendHabitsQuery(
    userId,
    ownerId,
    activeMonth,
    activeCycle,
    isInitialKey ? initialData : undefined,
    isInitialKey ? initialFetchedAtMs : undefined
  );

  const activeData = query.data ?? initialData;
  const workspace = activeData.workspace;

  const handleSelectMonth = (nextMonth: string) => {
    setActiveMonth(nextMonth);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("month", nextMonth);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  const handleSelectCycle = (nextCycle: string) => {
    setActiveCycle(nextCycle);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("cycle", nextCycle);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle={`Monitoring ${workspace.owner.name} (Read-only)`}
        meta={`${workspace.analytics.calendar.monthLabel} · ${workspace.habits.length} shared`}
      />
      <HabitsSubnav circleBadgeCount={activeData.circleBadgeCount} />
      <div className="mx-auto w-full max-w-[1400px] min-w-0 p-4 md:p-6">
        <FriendHabitsView
          currentUserId={userId}
          workspace={workspace}
          initialModeOverride={initialModeParam}
          onSelectMonth={handleSelectMonth}
          onSelectCycle={handleSelectCycle}
          onPrefetchMonth={(month) =>
            prefetch.prefetchFriendHabits(ownerId, month, activeCycle)
          }
        />
      </div>
    </div>
  );
}
