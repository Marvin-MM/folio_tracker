import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { DetailSheetItem } from "@/components/shell/detail-sheet-context";
import type { ScoringMode } from "@/server/domain/habit-analytics";

export type ProjectTabKey = "tasks" | "notes" | "activity";

const ssrNoopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

interface PersistedWorkspaceUIPrefs {
  railCollapsed: boolean;
  habitsScoringMode: ScoringMode;
  habitsShowArchived: boolean;
}

export interface WorkspaceUIState extends PersistedWorkspaceUIPrefs {
  mobileMenuOpen: boolean;
  quickCaptureOpen: boolean;
  activeDetail: DetailSheetItem | null;
  selectedHabitsMonth: string | null;
  projectActiveTabs: Record<string, ProjectTabKey>;
  notesSearchQuery: string;
  isOnline: boolean;

  setRailCollapsed: (collapsed: boolean) => void;
  toggleRailCollapsed: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  setQuickCaptureOpen: (open: boolean) => void;
  toggleQuickCapture: () => void;
  openDetail: (item: DetailSheetItem) => void;
  updateActiveDetail: (
    updater: (prev: DetailSheetItem | null) => DetailSheetItem | null
  ) => void;
  closeDetail: () => void;
  setHabitsScoringMode: (mode: ScoringMode) => void;
  setHabitsShowArchived: (show: boolean) => void;
  setSelectedHabitsMonth: (yearMonth: string | null) => void;
  setProjectActiveTab: (projectId: string, tab: ProjectTabKey) => void;
  setNotesSearchQuery: (query: string) => void;
  setIsOnline: (online: boolean) => void;
  resetSessionState: () => void;
}

const EPHEMERAL_INITIAL_STATE = {
  mobileMenuOpen: false,
  quickCaptureOpen: false,
  activeDetail: null as DetailSheetItem | null,
  selectedHabitsMonth: null as string | null,
  projectActiveTabs: {} as Record<string, ProjectTabKey>,
  notesSearchQuery: "",
};

/**
 * Global client-only UI store (Zustand v5).
 *
 * SECURITY INVARIANT:
 * - Persists ONLY harmless, non-PII layout preferences (`railCollapsed`,
 *   `habitsScoringMode`, `habitsShowArchived`) to `localStorage`.
 * - Server data NEVER lives in this store (owned strictly by TanStack Query).
 * - `resetSessionState()` clears all ephemeral session UI state on sign-out.
 */
const RAIL_COOKIE_NAME = "folio-rail-collapsed";

function writeRailCollapsedCookie(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${RAIL_COOKIE_NAME}=${collapsed ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // Ignore cookie write failures in restricted contexts
  }
}

export const useWorkspaceUIStore = create<WorkspaceUIState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      habitsScoringMode: "elapsed",
      habitsShowArchived: false,
      ...EPHEMERAL_INITIAL_STATE,
      isOnline: true,

      setRailCollapsed: (railCollapsed) => {
        writeRailCollapsedCookie(railCollapsed);
        set({ railCollapsed });
      },
      toggleRailCollapsed: () =>
        set((state) => {
          const next = !state.railCollapsed;
          writeRailCollapsedCookie(next);
          return { railCollapsed: next };
        }),
      setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
      setQuickCaptureOpen: (quickCaptureOpen) => set({ quickCaptureOpen }),
      toggleQuickCapture: () =>
        set((state) => ({ quickCaptureOpen: !state.quickCaptureOpen })),
      openDetail: (activeDetail) => set({ activeDetail }),
      updateActiveDetail: (updater) =>
        set((state) => ({ activeDetail: updater(state.activeDetail) })),
      closeDetail: () => set({ activeDetail: null }),
      setHabitsScoringMode: (habitsScoringMode) => set({ habitsScoringMode }),
      setHabitsShowArchived: (habitsShowArchived) =>
        set({ habitsShowArchived }),
      setSelectedHabitsMonth: (selectedHabitsMonth) =>
        set({ selectedHabitsMonth }),
      setProjectActiveTab: (projectId, tab) =>
        set((state) => ({
          projectActiveTabs: {
            ...state.projectActiveTabs,
            [projectId]: tab,
          },
        })),
      setNotesSearchQuery: (notesSearchQuery) => set({ notesSearchQuery }),
      setIsOnline: (isOnline) => set({ isOnline }),
      resetSessionState: () =>
        set({
          ...EPHEMERAL_INITIAL_STATE,
        }),
    }),
    {
      name: "folio-ui-prefs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : ssrNoopStorage
      ),
      skipHydration: true,
      partialize: (state): PersistedWorkspaceUIPrefs => ({
        railCollapsed: state.railCollapsed,
        habitsScoringMode: state.habitsScoringMode,
        habitsShowArchived: state.habitsShowArchived,
      }),
    }
  )
);
