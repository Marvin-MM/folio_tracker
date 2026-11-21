"use client";

import { createContext, useContext } from "react";
import type { NotificationRecord } from "@/server/db/schema";

interface WorkspaceChromeContextValue {
  openQuickCapture: () => void;
  notifications: NotificationRecord[];
  timezone: string;
}

const WorkspaceChromeContext =
  createContext<WorkspaceChromeContextValue | null>(null);

export function WorkspaceChromeProvider({
  value,
  children,
}: {
  value: WorkspaceChromeContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceChromeContext.Provider value={value}>
      {children}
    </WorkspaceChromeContext.Provider>
  );
}

export function useWorkspaceChrome(): WorkspaceChromeContextValue {
  const ctx = useContext(WorkspaceChromeContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceChrome must be used inside WorkspaceChromeProvider."
    );
  }
  return ctx;
}
