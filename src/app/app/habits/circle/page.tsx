import type { Metadata } from "next";
import { CircleOverviewView } from "@/components/habits/circle-overview-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { habitCommentService } from "@/server/services/habit-comment-service";
import { habitMonitorService } from "@/server/services/habit-monitor-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accountability Circle",
};

interface CirclePageProps {
  searchParams: Promise<{ cycle?: string }>;
}

export default async function HabitsCirclePage({
  searchParams,
}: CirclePageProps) {
  const [{ user }, params] = await Promise.all([
    requireSession(),
    searchParams,
  ]);

  const timezone = user.timezone || "UTC";
  const [overview, ownerReviews] = await Promise.all([
    habitMonitorService.getCircleOverview(user.id),
    habitCommentService.listOwnerReviews(user.id, params.cycle),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle="Accountability Circle, commenting cadence, and cycle reviews"
        meta={`${overview.monitoringOthers.length} following · ${overview.myMonitors.length} monitors`}
      />
      <HabitsSubnav circleBadgeCount={overview.badgeCount} />
      <div className="mx-auto w-full max-w-4xl min-w-0 p-4 md:p-6">
        <CircleOverviewView
          currentUserId={user.id}
          currentUserName={user.name}
          timezone={timezone}
          overview={overview}
          ownerReviews={ownerReviews}
        />
      </div>
    </div>
  );
}
