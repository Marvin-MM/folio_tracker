"use client";

import { useCallback, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWorkspaceUserId } from "@/components/shell/workspace-chrome-context";
import {
  fetchWorkspaceJson,
  WORKSPACE_STALE_TIME_MS,
} from "@/lib/query/query-client";
import {
  invalidateWorkspaceDomains,
  workspaceQueryKeys,
  type TaskSmartView,
  type WorkspaceInvalidationDomain,
} from "@/lib/query/query-keys";
import type { ScopedFriendWorkspace } from "@/server/dal/habits-social";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type { EnrichedReminderItem } from "@/server/dal/reminder-repository";
import type { TaskWithReminders } from "@/server/dal/task-repository";
import type { SidebarSummary } from "@/server/dal/workspace-repository";
import type { NotificationRecord } from "@/server/db/schema";
import type { OwnerReviewsData } from "@/server/services/habit-comment-service";
import type { CircleOverviewData } from "@/server/services/habit-monitor-service";
import type {
  HabitMonthWorkspace,
  TodayHabitsStripData,
} from "@/server/services/habit-service";
import type { ProjectWorkspaceData } from "@/server/services/project-service";
import type {
  OperationDetailPayload,
  OperationsHubPayload,
} from "@/server/services/operation-service";
import type { OperationShareDashboardPayload } from "@/server/services/operation-share-service";
import type { OperationRunDetailPayload } from "@/server/services/operation-run-service";
import type {
  AdminOverviewPayload,
  AdminOverviewSummaryPayload,
  AdminTimelineSectionPayload,
  AdminUsersSectionPayload,
} from "@/server/services/admin-service";

export interface WorkspaceBootstrapPayload {
  summary: SidebarSummary;
  notifications: NotificationRecord[];
  timezone: string;
  userName?: string;
  isAdmin?: boolean;
}

export interface TasksViewPayload {
  view: TaskSmartView;
  items: TaskWithReminders[];
  referenceUtcMs: number;
  timezone: string;
  habitsStrip?: TodayHabitsStripData;
}

export interface NotesViewPayload {
  items: NoteWithReminders[];
  timezone: string;
}

export interface RemindersViewPayload {
  items: EnrichedReminderItem[];
  referenceUtcMs: number;
  timezone: string;
}

export interface ProjectViewPayload {
  workspace: ProjectWorkspaceData;
  timezone: string;
}

export interface HabitsMonthViewPayload {
  workspace: HabitMonthWorkspace;
  circleBadgeCount: number;
  timezone: string;
}

export interface HabitsCircleViewPayload {
  overview: CircleOverviewData;
  ownerReviews: OwnerReviewsData;
  timezone: string;
}

export interface FriendHabitsViewPayload {
  workspace: ScopedFriendWorkspace;
  circleBadgeCount: number;
}

/**
 * Anchors SSR `initialData` to the client's local clock captured once on mount,
 * eliminating client-vs-server clock skew refetch storms or stuck caches.
 */
function useClientInitialDataUpdatedAt(
  hasInitialData: boolean,
  _serverFetchedAtMs?: number
): number | undefined {
  void _serverFetchedAtMs;
  const [clientMountMs] = useState(() => Date.now());
  return hasInitialData ? clientMountMs : undefined;
}

export function useWorkspaceBootstrapQuery(
  userId: string,
  initialData: WorkspaceBootstrapPayload,
  initialDataUpdatedAt: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    true,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.bootstrap(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<WorkspaceBootstrapPayload>(
        "/api/workspace/bootstrap",
        signal
      ),
    initialData,
    initialDataUpdatedAt: clientUpdatedAt,
  });
}

export function useTasksViewQuery(
  userId: string,
  view: TaskSmartView,
  initialData: TasksViewPayload,
  initialDataUpdatedAt: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    true,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.tasks(userId, view),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<TasksViewPayload>(
        `/api/workspace/tasks?view=${encodeURIComponent(view)}`,
        signal
      ),
    initialData,
    initialDataUpdatedAt: clientUpdatedAt,
  });
}

export function useNotesViewQuery(
  userId: string,
  initialData: NotesViewPayload,
  initialDataUpdatedAt: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    true,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.notes(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<NotesViewPayload>("/api/workspace/notes", signal),
    initialData,
    initialDataUpdatedAt: clientUpdatedAt,
  });
}

export function useRemindersViewQuery(
  userId: string,
  initialData: RemindersViewPayload,
  initialDataUpdatedAt: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    true,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.reminders(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<RemindersViewPayload>(
        "/api/workspace/reminders",
        signal
      ),
    initialData,
    initialDataUpdatedAt: clientUpdatedAt,
  });
}

export function useProjectWorkspaceQuery(
  userId: string,
  projectId: string,
  initialData: ProjectViewPayload,
  initialDataUpdatedAt: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    true,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.project(userId, projectId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<ProjectViewPayload>(
        `/api/workspace/projects/${encodeURIComponent(projectId)}`,
        signal
      ),
    initialData,
    initialDataUpdatedAt: clientUpdatedAt,
  });
}

export function useHabitsMonthQuery(
  userId: string,
  yearMonth: string,
  initialData?: HabitsMonthViewPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.habitsMonth(userId, yearMonth),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<HabitsMonthViewPayload>(
        `/api/workspace/habits?month=${encodeURIComponent(yearMonth)}`,
        signal
      ),
    placeholderData: keepPreviousData,
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useHabitsCircleQuery(
  userId: string,
  cycleKey: string | null,
  initialData?: HabitsCircleViewPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.habitsCircle(userId, cycleKey),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (cycleKey) params.set("cycle", cycleKey);
      const qs = params.toString();
      return fetchWorkspaceJson<HabitsCircleViewPayload>(
        `/api/workspace/habits/circle${qs ? `?${qs}` : ""}`,
        signal
      );
    },
    placeholderData: keepPreviousData,
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useFriendHabitsQuery(
  userId: string,
  ownerId: string,
  yearMonth: string,
  cycleKey: string | null,
  initialData?: FriendHabitsViewPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.friendHabits(
      userId,
      ownerId,
      yearMonth,
      cycleKey
    ),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      params.set("month", yearMonth);
      if (cycleKey) params.set("cycle", cycleKey);
      return fetchWorkspaceJson<FriendHabitsViewPayload>(
        `/api/workspace/habits/circle/${encodeURIComponent(ownerId)}?${params.toString()}`,
        signal
      );
    },
    placeholderData: keepPreviousData,
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useWorkspaceInvalidation(userId: string) {
  const queryClient = useQueryClient();

  return useCallback(
    (
      domains: readonly WorkspaceInvalidationDomain[],
      options?: { projectId?: string; ownerId?: string }
    ) => {
      return invalidateWorkspaceDomains(queryClient, userId, domains, options);
    },
    [queryClient, userId]
  );
}

export function useInvalidateWorkspace() {
  const userId = useWorkspaceUserId();
  return useWorkspaceInvalidation(userId);
}

/**
 * Intent-driven prefetch helper for LeftRail, HabitsSubnav, and month arrows
 * so hovering/focusing a link warms the TanStack Query cache before click.
 */
export function useAdminOverviewQuery(
  userId: string,
  params: {
    query?: string;
    roleFilter?: string;
    statusFilter?: string;
    timelineCategory?: string;
    page?: number;
  },
  initialData?: AdminOverviewPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.roleFilter && params.roleFilter !== "all") {
    search.set("role", params.roleFilter);
  }
  if (params.statusFilter && params.statusFilter !== "all") {
    search.set("status", params.statusFilter);
  }
  if (params.timelineCategory && params.timelineCategory !== "all") {
    search.set("timelineCategory", params.timelineCategory);
  }
  if (params.page && params.page > 1) {
    search.set("page", String(params.page));
  }
  const filterKey = search.toString() || "default";
  const endpoint = search.toString()
    ? `/api/admin/overview?${search.toString()}`
    : "/api/admin/overview";

  return useQuery({
    queryKey: workspaceQueryKeys.adminOverview(userId, filterKey),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<AdminOverviewPayload>(endpoint, signal),
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useAdminSummaryQuery(
  userId: string,
  initialData?: AdminOverviewSummaryPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.adminSummary(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<AdminOverviewSummaryPayload>(
        "/api/admin/overview?section=overview",
        signal
      ),
    staleTime: WORKSPACE_STALE_TIME_MS,
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useAdminUsersQuery(
  userId: string,
  params: {
    query?: string;
    roleFilter?: string;
    statusFilter?: string;
    page?: number;
  },
  enabled = true
) {
  const search = new URLSearchParams();
  search.set("section", "users");
  if (params.query) search.set("q", params.query);
  if (params.roleFilter && params.roleFilter !== "all") {
    search.set("role", params.roleFilter);
  }
  if (params.statusFilter && params.statusFilter !== "all") {
    search.set("status", params.statusFilter);
  }
  if (params.page && params.page > 1) {
    search.set("page", String(params.page));
  }
  const filterKey = search.toString();

  return useQuery({
    queryKey: workspaceQueryKeys.adminUsers(userId, filterKey),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<AdminUsersSectionPayload>(
        `/api/admin/overview?${filterKey}`,
        signal
      ),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAdminTimelineQuery(
  userId: string,
  timelineCategory: string,
  enabled = true
) {
  const search = new URLSearchParams();
  search.set("section", "timeline");
  if (timelineCategory && timelineCategory !== "all") {
    search.set("timelineCategory", timelineCategory);
  }

  return useQuery({
    queryKey: workspaceQueryKeys.adminTimeline(
      userId,
      timelineCategory || "all"
    ),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<AdminTimelineSectionPayload>(
        `/api/admin/overview?${search.toString()}`,
        signal
      ),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useOperationsHubQuery(
  userId: string,
  params: { includeArchived?: boolean; domain?: string; query?: string } = {},
  initialData?: OperationsHubPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  const search = new URLSearchParams();
  if (params.includeArchived) search.set("archived", "true");
  if (params.domain && params.domain !== "all") search.set("domain", params.domain);
  if (params.query?.trim()) search.set("q", params.query.trim());
  const filterKey = search.toString() || "default";
  const endpoint = search.toString()
    ? `/api/workspace/operations?${search.toString()}`
    : "/api/workspace/operations";

  return useQuery({
    queryKey: workspaceQueryKeys.operationsHub(userId, filterKey),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<OperationsHubPayload>(endpoint, signal),
    placeholderData: keepPreviousData,
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useOperationDetailQuery(
  userId: string,
  operationId: string,
  initialData?: OperationDetailPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.operationDetail(userId, operationId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<OperationDetailPayload>(
        `/api/workspace/operations/${encodeURIComponent(operationId)}`,
        signal
      ),
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function useOperationShareQuery(
  userId: string,
  operationId: string,
  enabled = true
) {
  return useQuery({
    queryKey: workspaceQueryKeys.operationShare(userId, operationId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<OperationShareDashboardPayload>(
        `/api/workspace/operations/${encodeURIComponent(operationId)}/share`,
        signal
      ),
    enabled: Boolean(userId && operationId && enabled),
  });
}

export function useOperationRunQuery(
  userId: string,
  runId: string,
  initialData?: OperationRunDetailPayload,
  initialDataUpdatedAt?: number
) {
  const clientUpdatedAt = useClientInitialDataUpdatedAt(
    initialData !== undefined,
    initialDataUpdatedAt
  );
  return useQuery({
    queryKey: workspaceQueryKeys.operationRun(userId, runId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<OperationRunDetailPayload>(
        `/api/workspace/operations/runs/${encodeURIComponent(runId)}`,
        signal
      ),
    ...(initialData
      ? { initialData, initialDataUpdatedAt: clientUpdatedAt }
      : {}),
  });
}

export function usePrefetchWorkspaceView(userId: string) {
  const queryClient = useQueryClient();

  const prefetchTasks = useCallback(
    (view: TaskSmartView) => {
      void queryClient.prefetchQuery({
        queryKey: workspaceQueryKeys.tasks(userId, view),
        queryFn: ({ signal }) =>
          fetchWorkspaceJson<TasksViewPayload>(
            `/api/workspace/tasks?view=${encodeURIComponent(view)}`,
            signal
          ),
        staleTime: WORKSPACE_STALE_TIME_MS,
      });
    },
    [queryClient, userId]
  );

  const prefetchNotes = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.notes(userId),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<NotesViewPayload>("/api/workspace/notes", signal),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  const prefetchReminders = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.reminders(userId),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<RemindersViewPayload>(
          "/api/workspace/reminders",
          signal
        ),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  const prefetchProject = useCallback(
    (projectId: string) => {
      void queryClient.prefetchQuery({
        queryKey: workspaceQueryKeys.project(userId, projectId),
        queryFn: ({ signal }) =>
          fetchWorkspaceJson<ProjectViewPayload>(
            `/api/workspace/projects/${encodeURIComponent(projectId)}`,
            signal
          ),
        staleTime: WORKSPACE_STALE_TIME_MS,
      });
    },
    [queryClient, userId]
  );

  const prefetchHabitsMonth = useCallback(
    (yearMonth: string) => {
      void queryClient.prefetchQuery({
        queryKey: workspaceQueryKeys.habitsMonth(userId, yearMonth),
        queryFn: ({ signal }) =>
          fetchWorkspaceJson<HabitsMonthViewPayload>(
            `/api/workspace/habits?month=${encodeURIComponent(yearMonth)}`,
            signal
          ),
        staleTime: WORKSPACE_STALE_TIME_MS,
      });
    },
    [queryClient, userId]
  );

  const prefetchHabitsCircle = useCallback(
    (cycleKey: string | null = null) => {
      void queryClient.prefetchQuery({
        queryKey: workspaceQueryKeys.habitsCircle(userId, cycleKey),
        queryFn: ({ signal }) =>
          fetchWorkspaceJson<HabitsCircleViewPayload>(
            cycleKey
              ? `/api/workspace/habits/circle?cycle=${encodeURIComponent(cycleKey)}`
              : "/api/workspace/habits/circle",
            signal
          ),
        staleTime: WORKSPACE_STALE_TIME_MS,
      });
    },
    [queryClient, userId]
  );

  const prefetchFriendHabits = useCallback(
    (ownerId: string, yearMonth: string, cycleKey: string | null = null) => {
      void queryClient.prefetchQuery({
        queryKey: workspaceQueryKeys.friendHabits(
          userId,
          ownerId,
          yearMonth,
          cycleKey
        ),
        queryFn: ({ signal }) => {
          const params = new URLSearchParams();
          params.set("month", yearMonth);
          if (cycleKey) params.set("cycle", cycleKey);
          return fetchWorkspaceJson<FriendHabitsViewPayload>(
            `/api/workspace/habits/circle/${encodeURIComponent(ownerId)}?${params.toString()}`,
            signal
          );
        },
        staleTime: WORKSPACE_STALE_TIME_MS,
      });
    },
    [queryClient, userId]
  );

  const prefetchAdminOverview = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.adminSummary(userId),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<AdminOverviewSummaryPayload>(
          "/api/admin/overview?section=overview",
          signal
        ),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  const prefetchAdminUsers = useCallback(() => {
    const filterKey = "section=users";
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.adminUsers(userId, filterKey),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<AdminUsersSectionPayload>(
          "/api/admin/overview?section=users",
          signal
        ),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  const prefetchAdminTimeline = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.adminTimeline(userId, "all"),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<AdminTimelineSectionPayload>(
          "/api/admin/overview?section=timeline",
          signal
        ),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  const prefetchOperationsHub = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.operationsHub(userId, "default"),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<OperationsHubPayload>(
          "/api/workspace/operations",
          signal
        ),
      staleTime: WORKSPACE_STALE_TIME_MS,
    });
  }, [queryClient, userId]);

  return {
    prefetchTasks,
    prefetchNotes,
    prefetchReminders,
    prefetchProject,
    prefetchHabitsMonth,
    prefetchHabitsCircle,
    prefetchFriendHabits,
    prefetchOperationsHub,
    prefetchAdminOverview,
    prefetchAdminUsers,
    prefetchAdminTimeline,
  };
}
