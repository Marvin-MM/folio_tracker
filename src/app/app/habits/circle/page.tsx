import type { Metadata } from "next";
import { HabitsCircleClient } from "@/components/habits/habits-query-views";
import { getServerTimestampMs } from "@/lib/query/clock";
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
  const initialFetchedAtMs = getServerTimestampMs();
  const initialCycleKey = params.cycle?.trim() || null;

  const [overview, ownerReviews] = await Promise.all([
    habitMonitorService.getCircleOverview(user.id),
    habitCommentService.listOwnerReviews(user.id, initialCycleKey ?? undefined),
  ]);

  return (
    <HabitsCircleClient
      userId={user.id}
      currentUserName={user.name}
      initialCycleKey={initialCycleKey}
      initialData={{ overview, ownerReviews, timezone }}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
