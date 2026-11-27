import type { NextRequest } from "next/server";
import { taskRepository } from "@/server/dal/task-repository";
import {
  withWorkspaceAuth,
  workspaceErrorJson,
  workspaceJson,
} from "@/server/http/workspace-api";
import { habitService } from "@/server/services/habit-service";


export async function GET(request: NextRequest) {
  return withWorkspaceAuth(async ({ user }) => {
    const view = request.nextUrl.searchParams.get("view") ?? "inbox";
    const timezone = user.timezone || "UTC";

    if (view === "inbox") {
      const { items, referenceUtcMs } =
        await taskRepository.listInboxWithReminders(user.id);
      return workspaceJson({
        view: "inbox" as const,
        items,
        referenceUtcMs,
        timezone,
      });
    }

    if (view === "today") {
      const [{ items, referenceUtcMs }, habitsStrip] = await Promise.all([
        taskRepository.listTodayWithReminders(user.id, timezone),
        habitService.getTodayHabitsStrip(user.id, timezone),
      ]);
      return workspaceJson({
        view: "today" as const,
        items,
        referenceUtcMs,
        timezone,
        habitsStrip,
      });
    }

    if (view === "upcoming") {
      const { items, referenceUtcMs } =
        await taskRepository.listUpcomingWithReminders(user.id, timezone);
      return workspaceJson({
        view: "upcoming" as const,
        items,
        referenceUtcMs,
        timezone,
      });
    }

    return workspaceErrorJson(
      "VALIDATION_ERROR",
      "Invalid tasks view parameter. Expected inbox, today, or upcoming.",
      400
    );
  });
}
