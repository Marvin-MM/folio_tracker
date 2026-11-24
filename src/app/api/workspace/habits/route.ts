import type { NextRequest } from "next/server";
import type { ScoringMode } from "@/server/domain/habit-analytics";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { habitMonitorService } from "@/server/services/habit-monitor-service";
import { habitService } from "@/server/services/habit-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withWorkspaceAuth(async ({ user }) => {
    const timezone = user.timezone || "UTC";
    const month = request.nextUrl.searchParams.get("month") ?? undefined;
    const modeParam = request.nextUrl.searchParams.get("mode");
    const scoringMode: ScoringMode =
      modeParam === "full_month" ? "full_month" : "elapsed";

    const [workspace, circleBadgeCount] = await Promise.all([
      habitService.getMonthWorkspace(user.id, timezone, {
        yearMonth: month,
        scoringMode,
      }),
      habitMonitorService.getCircleBadgeCount(user.id),
    ]);

    return workspaceJson({
      workspace,
      circleBadgeCount,
      timezone,
    });
  });
}
