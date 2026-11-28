"use client";

import { useState } from "react";
import { FriendHabitsView } from "@/components/habits/friend-habits-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  useFriendHabitsQuery,
  usePrefetchWorkspaceView,
  type FriendHabitsViewPayload,
} from "@/hooks/use-workspace-queries";
import type { ScoringMode } from "@/server/domain/habit-analytics";

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
