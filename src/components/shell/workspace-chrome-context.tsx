"use client";

import { createContext, useContext, useMemo } from "react";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type { NotificationRecord } from "@/server/db/schema";

interface WorkspaceActionsContextValue {
  userId: string;
  openQuickCapture: () => void;
}

interface WorkspaceDataContextValue {
  notifications: NotificationRecord[];
  projects: SidebarProjectItem[];
  timezone: string;
}

export interface WorkspaceChromeContextValue
  extends WorkspaceActionsContextValue,
    WorkspaceDataContextValue {}

const WorkspaceActionsContext =
  createContext<WorkspaceActionsContextValue | null>(null);

const WorkspaceDataContext = createContext<WorkspaceDataContextValue | null>(
  null
);

export function WorkspaceChromeProvider({
  actionsValue,
  dataValue,
  children,
}: {
  actionsValue: WorkspaceActionsContextValue;
  dataValue: WorkspaceDataContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceActionsContext.Provider value={actionsValue}>
      <WorkspaceDataContext.Provider value={dataValue}>
        {children}
      </WorkspaceDataContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

/**
 * Stable identity & shell action selector (`userId`, `openQuickCapture`).
 * NEVER triggers consumer re-renders when notifications or sidebar projects update.
 */
export function useWorkspaceActions(): WorkspaceActionsContextValue {
  const ctx = useContext(WorkspaceActionsContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceActions must be used inside WorkspaceChromeProvider."
    );
  }
  return ctx;
}

export function useWorkspaceUserId(): string {
  return useWorkspaceActions().userId;
}

export function useWorkspaceChrome(): WorkspaceChromeContextValue {
  const actions = useWorkspaceActions();
  const data = useContext(WorkspaceDataContext);
  if (!data) {
    throw new Error(
      "useWorkspaceChrome must be used inside WorkspaceChromeProvider."
    );
  }
  return useMemo(() => ({ ...actions, ...data }), [actions, data]);
}
