"use client";

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type { ProjectMemberWithUser } from "@/server/dal/project-repository";
import type { EnrichedReminderItem } from "@/server/dal/reminder-repository";
import type { TaskWithReminders } from "@/server/dal/task-repository";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type { HabitRecord } from "@/server/db/schema";
import type { HabitRowSummary } from "@/server/domain/habit-analytics";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

export type DetailSheetItem =
  | {
      kind: "task";
      data: TaskWithReminders;
      readOnly?: boolean;
      projectMembers?: ProjectMemberWithUser[];
    }
  | {
      kind: "note";
      data: NoteWithReminders;
      readOnly?: boolean;
    }
  | { kind: "reminder"; data: EnrichedReminderItem }
  | {
      kind: "habit";
      data: {
        habit: HabitRecord;
        summary: HabitRowSummary | null;
        projects: SidebarProjectItem[];
      };
    };

export interface DetailSheetContextValue {
  activeItem: DetailSheetItem | null;
  isOpen: boolean;
  openDetail: (item: DetailSheetItem) => void;
  updateActiveDetail: (
    updater: (prev: DetailSheetItem | null) => DetailSheetItem | null
  ) => void;
  closeDetail: () => void;
}

/**
 * Keyboard Escape listener for the global right-hand Detail Sheet.
 * State itself lives in Zustand (`useWorkspaceUIStore`) so opening/editing
 * the inspector never re-renders the sidebar or main shell chrome.
 */
export function DetailSheetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const hasActiveDetail = useWorkspaceUIStore(
    (state) => state.activeDetail !== null
  );

  useEffect(() => {
    if (!hasActiveDetail) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      // Yield to nested Radix popovers, selects, menus, or dialogs
      if (
        document.querySelector(
          "[data-radix-popper-content-wrapper], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']"
        )
      ) {
        return;
      }
      useWorkspaceUIStore.getState().closeDetail();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasActiveDetail]);

  return <>{children}</>;
}

export function useDetailSheet(): DetailSheetContextValue {
  return useWorkspaceUIStore(
    useShallow((state) => ({
      activeItem: state.activeDetail,
      isOpen: state.activeDetail !== null,
      openDetail: state.openDetail,
      updateActiveDetail: state.updateActiveDetail,
      closeDetail: state.closeDetail,
    }))
  );
}
