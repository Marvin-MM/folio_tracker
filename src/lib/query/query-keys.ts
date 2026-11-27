import type { QueryClient } from "@tanstack/react-query";

export type TaskSmartView = "inbox" | "today" | "upcoming";

export type WorkspaceInvalidationDomain =
  | "tasks"
  | "today"
  | "notes"
  | "reminders"
  | "projects"
  | "habits"
  | "circle"
  | "operations"
  | "notifications"
  | "sidebar"
  | "admin"
  | "all";

/**
 * User-scoped TanStack Query key factory.
 *
 * SECURITY INVARIANT:
 * Every workspace query key MUST include `userId` so cache entries are
 * structurally partitioned by tenant and cleared cleanly on sign-out.
 */
export const workspaceQueryKeys = {
  all: ["workspace"] as const,
  userRoot: (userId: string) => ["workspace", userId] as const,
  bootstrap: (userId: string) => ["workspace", userId, "bootstrap"] as const,
  tasksRoot: (userId: string) => ["workspace", userId, "tasks"] as const,
  tasks: (userId: string, view: TaskSmartView) =>
    ["workspace", userId, "tasks", view] as const,
  notes: (userId: string) => ["workspace", userId, "notes"] as const,
  reminders: (userId: string) => ["workspace", userId, "reminders"] as const,
  projectsRoot: (userId: string) => ["workspace", userId, "projects"] as const,
  project: (userId: string, projectId: string) =>
    ["workspace", userId, "projects", projectId] as const,
  habitsRoot: (userId: string) => ["workspace", userId, "habits"] as const,
  habitsMonth: (userId: string, yearMonth: string) =>
    ["workspace", userId, "habits", "month", yearMonth] as const,
  habitsCircleRoot: (userId: string) =>
    ["workspace", userId, "habits", "circle"] as const,
  habitsCircle: (userId: string, cycleKey: string | null) =>
    ["workspace", userId, "habits", "circle", cycleKey ?? "current"] as const,
  friendHabitsRoot: (userId: string, ownerId?: string) =>
    ownerId
      ? (["workspace", userId, "habits", "friend", ownerId] as const)
      : (["workspace", userId, "habits", "friend"] as const),
  friendHabits: (
    userId: string,
    ownerId: string,
    yearMonth: string | null,
    cycleKey: string | null
  ) =>
    [
      "workspace",
      userId,
      "habits",
      "friend",
      ownerId,
      yearMonth ?? "current",
      cycleKey ?? "current",
    ] as const,
  adminRoot: (userId: string) => ["workspace", userId, "admin"] as const,
  adminOverview: (userId: string, filterKey: string) =>
    ["workspace", userId, "admin", "overview", filterKey] as const,
  adminSummary: (userId: string) =>
    ["workspace", userId, "admin", "summary"] as const,
  adminUsers: (userId: string, filterKey: string) =>
    ["workspace", userId, "admin", "users", filterKey] as const,
  adminTimeline: (userId: string, category: string) =>
    ["workspace", userId, "admin", "timeline", category] as const,
  operationsRoot: (userId: string) =>
    ["workspace", userId, "operations"] as const,
  operationsHub: (userId: string, filterKey = "default") =>
    ["workspace", userId, "operations", "hub", filterKey] as const,
  operationDetail: (userId: string, operationId: string) =>
    ["workspace", userId, "operations", "detail", operationId] as const,
  operationRun: (userId: string, runId: string) =>
    ["workspace", userId, "operations", "run", runId] as const,
};

/**
 * Targeted cache invalidation helper so mutations refresh ONLY affected
 * domain queries without triggering redundant layout/unrelated view refetches.
 */
export async function invalidateWorkspaceDomains(
  queryClient: QueryClient,
  userId: string,
  domains: readonly WorkspaceInvalidationDomain[],
  options?: { projectId?: string; ownerId?: string }
): Promise<void> {
  if (!userId) return;

  const uniqueDomains = new Set(domains);
  if (uniqueDomains.has("all")) {
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.userRoot(userId),
    });
    return;
  }

  const invalidations: Array<Promise<void>> = [];

  if (uniqueDomains.has("sidebar") || uniqueDomains.has("notifications")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.bootstrap(userId),
      })
    );
  }

  if (uniqueDomains.has("tasks")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.tasksRoot(userId),
      })
    );
  } else if (uniqueDomains.has("today")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.tasks(userId, "today"),
      })
    );
  }

  if (uniqueDomains.has("notes")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.notes(userId),
      })
    );
  }

  if (uniqueDomains.has("reminders")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.reminders(userId),
      })
    );
  }

  if (uniqueDomains.has("projects")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: options?.projectId
          ? workspaceQueryKeys.project(userId, options.projectId)
          : workspaceQueryKeys.projectsRoot(userId),
      })
    );
  }

  if (uniqueDomains.has("habits")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.habitsRoot(userId),
      })
    );
  }

  if (uniqueDomains.has("circle")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.habitsCircleRoot(userId),
      })
    );
    if (options?.ownerId) {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.friendHabitsRoot(
            userId,
            options.ownerId
          ),
        })
      );
    } else {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.friendHabitsRoot(userId),
        })
      );
    }
  }

  if (uniqueDomains.has("operations")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.operationsRoot(userId),
      })
    );
  }

  if (uniqueDomains.has("admin")) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.adminRoot(userId),
      })
    );
  }

  await Promise.all(invalidations);
}
