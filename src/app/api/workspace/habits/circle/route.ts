import type { NextRequest } from "next/server";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";
import { habitCommentService } from "@/server/services/habit-comment-service";
import { habitMonitorService } from "@/server/services/habit-monitor-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withWorkspaceAuth(async ({ user }) => {
    const timezone = user.timezone || "UTC";
    const cycle = request.nextUrl.searchParams.get("cycle") ?? undefined;

    const [overview, ownerReviews] = await Promise.all([
      habitMonitorService.getCircleOverview(user.id),
      habitCommentService.listOwnerReviews(user.id, cycle),
    ]);

    return workspaceJson({
      overview,
      ownerReviews,
      timezone,
    });
  });
}
