"use client";

import { useState } from "react";
import { CircleOverviewView } from "@/components/habits/circle-overview-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  useHabitsCircleQuery,
  type HabitsCircleViewPayload,
} from "@/hooks/use-workspace-queries";

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
