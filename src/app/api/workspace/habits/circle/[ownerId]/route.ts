import type { NextRequest } from "next/server";
import { habitMonitorReadDal } from "@/server/dal/habits-social";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { habitMonitorService } from "@/server/services/habit-monitor-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ownerId: string }> }
) {
  return withWorkspaceAuth(async ({ user }) => {
    const { ownerId } = await context.params;
    const month = request.nextUrl.searchParams.get("month") ?? undefined;
    const cycle = request.nextUrl.searchParams.get("cycle") ?? undefined;
    const modeParam = request.nextUrl.searchParams.get("mode");
    const scoringMode: ScoringMode =
      modeParam === "full_month" ? "full_month" : "elapsed";

    const [circleBadgeCount, workspace] = await Promise.all([
      habitMonitorService.getCircleBadgeCount(user.id),
      habitMonitorReadDal.getScopedFriendWorkspace({
        viewerUserId: user.id,
        ownerId,
        yearMonth: month,
        scoringMode,
        selectedCycleKey: cycle,
      }),
    ]);

    return workspaceJson({
      workspace,
      circleBadgeCount,
    });
  });
}
