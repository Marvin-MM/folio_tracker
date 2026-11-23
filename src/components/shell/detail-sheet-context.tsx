"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import type { ProjectMemberWithUser } from "@/server/dal/project-repository";
import type { EnrichedReminderItem } from "@/server/dal/reminder-repository";
import type { TaskWithReminders } from "@/server/dal/task-repository";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type { HabitRecord } from "@/server/db/schema";
import type { HabitRowSummary } from "@/server/domain/habit-analytics";

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

interface DetailSheetContextValue {
  activeItem: DetailSheetItem | null;
  isOpen: boolean;
  openDetail: (item: DetailSheetItem) => void;
  updateActiveDetail: (
    updater: (prev: DetailSheetItem | null) => DetailSheetItem | null
  ) => void;
  closeDetail: () => void;
}

const DetailSheetContext = createContext<DetailSheetContextValue | null>(null);

export function DetailSheetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeItem, setActiveItem] = useState<DetailSheetItem | null>(null);

  const openDetail = useCallback((item: DetailSheetItem) => {
    setActiveItem(item);
  }, []);

  const updateActiveDetail = useCallback(
    (updater: (prev: DetailSheetItem | null) => DetailSheetItem | null) => {
      setActiveItem((prev) => updater(prev));
    },
    []
  );

  const closeDetail = useCallback(() => {
    setActiveItem(null);
  }, []);

  useEffect(() => {
    if (!activeItem) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveItem(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItem]);

  const value = useMemo<DetailSheetContextValue>(
    () => ({
      activeItem,
      isOpen: activeItem !== null,
      openDetail,
      updateActiveDetail,
      closeDetail,
    }),
    [activeItem, openDetail, updateActiveDetail, closeDetail]
  );

  return (
    <DetailSheetContext.Provider value={value}>
      {children}
    </DetailSheetContext.Provider>
  );
}

export function useDetailSheet(): DetailSheetContextValue {
  const context = useContext(DetailSheetContext);
  if (!context) {
    throw new Error("useDetailSheet must be used inside DetailSheetProvider.");
  }
  return context;
}
