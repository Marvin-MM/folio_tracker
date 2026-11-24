import { describe, expect, it, vi } from "vitest";
import {
  makeQueryClient,
  shouldRetryWorkspaceQuery,
  WorkspaceHttpError,
} from "@/lib/query/query-client";
import {
  invalidateWorkspaceDomains,
  workspaceQueryKeys,
} from "@/lib/query/query-keys";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

describe("TanStack Query keys, retry policy, and targeted invalidation", () => {
  it("partitions every workspace query key by userId", () => {
    expect(workspaceQueryKeys.bootstrap("user-a")).toEqual([
      "workspace",
      "user-a",
      "bootstrap",
    ]);
    expect(workspaceQueryKeys.tasks("user-a", "today")).toEqual([
      "workspace",
      "user-a",
      "tasks",
      "today",
    ]);
    expect(workspaceQueryKeys.habitsMonth("user-a", "2026-11")).toEqual([
      "workspace",
      "user-a",
      "habits",
      "month",
      "2026-11",
    ]);
    expect(
      workspaceQueryKeys.friendHabits("user-a", "owner-1", "2026-11", "2026-W47")
    ).toEqual([
      "workspace",
      "user-a",
      "habits",
      "friend",
      "owner-1",
      "2026-11",
      "2026-W47",
    ]);
  });

  it("never retries 4xx client/auth errors and retries transient errors up to 2 times", () => {
    expect(
      shouldRetryWorkspaceQuery(0, new WorkspaceHttpError(401, "UNAUTHORIZED", "No"))
    ).toBe(false);
    expect(
      shouldRetryWorkspaceQuery(0, new WorkspaceHttpError(403, "FORBIDDEN", "No"))
    ).toBe(false);
    expect(
      shouldRetryWorkspaceQuery(0, new WorkspaceHttpError(404, "NOT_FOUND", "No"))
    ).toBe(false);
    expect(
      shouldRetryWorkspaceQuery(0, new WorkspaceHttpError(503, "UNAVAILABLE", "Retry"))
    ).toBe(true);
    expect(
      shouldRetryWorkspaceQuery(1, new WorkspaceHttpError(503, "UNAVAILABLE", "Retry"))
    ).toBe(true);
    expect(
      shouldRetryWorkspaceQuery(2, new WorkspaceHttpError(503, "UNAVAILABLE", "Retry"))
    ).toBe(false);
  });

  it("invalidates only targeted domains for the active tenant without touching other users or unrelated views", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    queryClient.setQueryData(workspaceQueryKeys.tasks("user-a", "inbox"), { items: [] });
    queryClient.setQueryData(workspaceQueryKeys.notes("user-a"), { items: [] });
    queryClient.setQueryData(workspaceQueryKeys.tasks("user-b", "inbox"), { items: [] });

    await invalidateWorkspaceDomains(queryClient, "user-a", ["tasks", "sidebar"]);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workspaceQueryKeys.bootstrap("user-a"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workspaceQueryKeys.tasksRoot("user-a"),
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: workspaceQueryKeys.notes("user-a"),
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: workspaceQueryKeys.tasksRoot("user-b"),
    });

    // Clearing client cache wipes every tenant entry on shared-device sign-out
    queryClient.clear();
    expect(
      queryClient.getQueryData(workspaceQueryKeys.tasks("user-a", "inbox"))
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(workspaceQueryKeys.tasks("user-b", "inbox"))
    ).toBeUndefined();
  });
});

describe("Zustand Workspace UI store", () => {
  it("updates layout prefs and resets all ephemeral session state on sign-out", () => {
    const store = useWorkspaceUIStore.getState();

    store.setRailCollapsed(true);
    store.setHabitsScoringMode("full_month");
    store.setHabitsShowArchived(true);
    store.setQuickCaptureOpen(true);
    store.setProjectActiveTab("proj-1", "notes");
    store.setSelectedHabitsMonth("2026-10");
    store.setNotesSearchQuery("invoice");

    expect(useWorkspaceUIStore.getState().railCollapsed).toBe(true);
    expect(useWorkspaceUIStore.getState().habitsScoringMode).toBe("full_month");
    expect(useWorkspaceUIStore.getState().projectActiveTabs["proj-1"]).toBe(
      "notes"
    );

    // Sign-out wipes ephemeral session UI state while preserving harmless non-PII layout prefs
    useWorkspaceUIStore.getState().resetSessionState();

    const afterReset = useWorkspaceUIStore.getState();
    expect(afterReset.quickCaptureOpen).toBe(false);
    expect(afterReset.activeDetail).toBeNull();
    expect(afterReset.projectActiveTabs).toEqual({});
    expect(afterReset.selectedHabitsMonth).toBeNull();
    expect(afterReset.notesSearchQuery).toBe("");
    expect(afterReset.railCollapsed).toBe(true);

    // Verify persist partializer excludes session fields
    const partialize = useWorkspaceUIStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const persistedSlice = partialize!(afterReset) as Record<string, unknown>;
    expect(Object.keys(persistedSlice).sort()).toEqual([
      "habitsScoringMode",
      "habitsShowArchived",
      "railCollapsed",
    ]);
  });
});
