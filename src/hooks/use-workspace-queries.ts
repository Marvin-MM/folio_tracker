"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { fetchWorkspaceJson } from "@/lib/query/query-client";
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
import type { AdminOverviewPayload } from "@/server/services/admin-service";

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

export function useWorkspaceBootstrapQuery(
  userId: string,
  initialData: WorkspaceBootstrapPayload,
  initialDataUpdatedAt: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.bootstrap(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<WorkspaceBootstrapPayload>(
        "/api/workspace/bootstrap",
        signal
      ),
    initialData,
    initialDataUpdatedAt,
  });
}

export function useTasksViewQuery(
  userId: string,
  view: TaskSmartView,
  initialData: TasksViewPayload,
  initialDataUpdatedAt: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.tasks(userId, view),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<TasksViewPayload>(
        `/api/workspace/tasks?view=${encodeURIComponent(view)}`,
        signal
      ),
    initialData,
    initialDataUpdatedAt,
  });
}

export function useNotesViewQuery(
  userId: string,
  initialData: NotesViewPayload,
  initialDataUpdatedAt: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.notes(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<NotesViewPayload>("/api/workspace/notes", signal),
    initialData,
    initialDataUpdatedAt,
  });
}

export function useRemindersViewQuery(
  userId: string,
  initialData: RemindersViewPayload,
  initialDataUpdatedAt: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.reminders(userId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<RemindersViewPayload>(
        "/api/workspace/reminders",
        signal
      ),
    initialData,
    initialDataUpdatedAt,
  });
}

export function useProjectWorkspaceQuery(
  userId: string,
  projectId: string,
  initialData: ProjectViewPayload,
  initialDataUpdatedAt: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.project(userId, projectId),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<ProjectViewPayload>(
        `/api/workspace/projects/${encodeURIComponent(projectId)}`,
        signal
      ),
    initialData,
    initialDataUpdatedAt,
  });
}

export function useHabitsMonthQuery(
  userId: string,
  yearMonth: string,
  initialData?: HabitsMonthViewPayload,
  initialDataUpdatedAt?: number
) {
  return useQuery({
    queryKey: workspaceQueryKeys.habitsMonth(userId, yearMonth),
    queryFn: ({ signal }) =>
      fetchWorkspaceJson<HabitsMonthViewPayload>(
        `/api/workspace/habits?month=${encodeURIComponent(yearMonth)}`,
        signal
      ),
    ...(initialData ? { initialData, initialDataUpdatedAt } : {}),
  });
}

export function useHabitsCircleQuery(
  userId: string,
  cycleKey: string | null,
  initialData?: HabitsCircleViewPayload,
  initialDataUpdatedAt?: number
) {
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
    ...(initialData ? { initialData, initialDataUpdatedAt } : {}),
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
    ...(initialData ? { initialData, initialDataUpdatedAt } : {}),
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
  const { userId } = useWorkspaceChrome();
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
    ...(initialData ? { initialData, initialDataUpdatedAt } : {}),
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
      });
    },
    [queryClient, userId]
  );

  const prefetchNotes = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.notes(userId),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<NotesViewPayload>("/api/workspace/notes", signal),
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
      });
    },
    [queryClient, userId]
  );

  const prefetchAdminOverview = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: workspaceQueryKeys.adminOverview(userId, "default"),
      queryFn: ({ signal }) =>
        fetchWorkspaceJson<AdminOverviewPayload>("/api/admin/overview", signal),
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
    prefetchAdminOverview,
  };
}
