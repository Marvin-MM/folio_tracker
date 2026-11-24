"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Menu, Plus, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DetailSheet } from "@/components/shell/detail-sheet";
import { DetailSheetProvider } from "@/components/shell/detail-sheet-context";
import { LeftRail, type ShellUser } from "@/components/shell/left-rail";
import { NotificationBell } from "@/components/shell/notification-bell";
import { TimezoneSync } from "@/components/shell/timezone-sync";
import { WorkspaceChromeProvider } from "@/components/shell/workspace-chrome-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWorkspaceBootstrapQuery } from "@/hooks/use-workspace-queries";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SidebarSummary } from "@/server/dal/workspace-repository";
import type { NotificationRecord } from "@/server/db/schema";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

const QuickCaptureDialog = dynamic(
  () =>
    import("@/components/capture/quick-capture-dialog").then(
      (mod) => mod.QuickCaptureDialog
    ),
  { ssr: false }
);

interface WorkspaceShellProps {
  user: ShellUser;
  summary: SidebarSummary;
  initialNotifications: NotificationRecord[];
  initialFetchedAtMs: number;
  children: React.ReactNode;
}

/**
 * Three-Zone App Shell:
 * 1. Left Rail (220px collapsible desktop rail, persisted via Zustand; Sheet drawer on mobile)
 * 2. Main Canvas (scrollable route content preserving scroll position + Skip link + Offline banner)
 * 3. Right Slide-Over Detail Sheet (440px non-blocking interactive inspector)
 * + Lazy-loaded Global ⌘K Quick Capture dialog & Query-backed Notification Bell
 */
export function WorkspaceShell({
  user,
  summary,
  initialNotifications,
  initialFetchedAtMs,
  children,
}: WorkspaceShellProps) {
  const railCollapsed = useWorkspaceUIStore((s) => s.railCollapsed);
  const toggleRailCollapsed = useWorkspaceUIStore((s) => s.toggleRailCollapsed);
  const mobileMenuOpen = useWorkspaceUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useWorkspaceUIStore((s) => s.setMobileMenuOpen);
  const quickCaptureOpen = useWorkspaceUIStore((s) => s.quickCaptureOpen);
  const setQuickCaptureOpen = useWorkspaceUIStore((s) => s.setQuickCaptureOpen);
  const isOnline = useWorkspaceUIStore((s) => s.isOnline);
  const [quickCaptureMounted, setQuickCaptureMounted] = useState(false);

  const bootstrapQuery = useWorkspaceBootstrapQuery(
    user.id,
    {
      summary,
      notifications: initialNotifications,
      timezone: user.timezone,
      userName: user.name,
    },
    initialFetchedAtMs
  );

  const liveSummary = bootstrapQuery.data.summary;
  const liveNotifications = bootstrapQuery.data.notifications;
  const liveTimezone = bootstrapQuery.data.timezone || user.timezone;
  const liveUserName = bootstrapQuery.data.userName || user.name;

  const openQuickCapture = useCallback(() => {
    setQuickCaptureMounted(true);
    setQuickCaptureOpen(true);
  }, [setQuickCaptureOpen]);

  const handleQuickCaptureOpenChange = useCallback(
    (open: boolean) => {
      if (open) setQuickCaptureMounted(true);
      setQuickCaptureOpen(open);
    },
    [setQuickCaptureOpen]
  );

  // Global ⌘K / Ctrl+K shortcut for Quick Capture
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickCaptureMounted(true);
        useWorkspaceUIStore.getState().toggleQuickCapture();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const chromeValue = useMemo(
    () => ({
      userId: user.id,
      openQuickCapture,
      notifications: liveNotifications,
      projects: liveSummary.projects,
      timezone: liveTimezone,
    }),
    [
      user.id,
      openQuickCapture,
      liveNotifications,
      liveSummary.projects,
      liveTimezone,
    ]
  );

  return (
    <WorkspaceChromeProvider value={chromeValue}>
      <DetailSheetProvider>
        <TimezoneSync currentTimezone={liveTimezone} />
        {quickCaptureMounted || quickCaptureOpen ? (
          <QuickCaptureDialog
            open={quickCaptureOpen}
            onOpenChange={handleQuickCaptureOpenChange}
            timezone={liveTimezone}
          />
        ) : null}

        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-foreground focus:outline-none"
        >
          Skip to main content
        </a>

        <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
          {/* Mobile header with Sheet drawer trigger, Quick Capture & Bell */}
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-sidebar px-2.5 md:hidden">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="mira-icon-btn text-muted-foreground hover:text-foreground"
              >
                <Menu className="size-4" />
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-tight">
                <BrandMark />
                {APP_NAME}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openQuickCapture}
                aria-label="Quick capture"
                className="mira-icon-btn text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-4" />
              </Button>
              <NotificationBell
                initialNotifications={liveNotifications}
                timezone={liveTimezone}
              />
              <ThemeToggle compact />
            </div>
          </header>

          {/* Mobile Left Rail Sheet */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetContent
              side="left"
              className="w-[240px] border-r border-sidebar-border bg-sidebar p-0"
            >
              <SheetTitle className="sr-only">{APP_NAME} navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Workspace smart views, projects, and account controls.
              </SheetDescription>
              <LeftRail
                user={{ ...user, name: liveUserName, timezone: liveTimezone }}
                summary={liveSummary}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {/* Zone 1: Desktop Left Rail (220px expanded / 52px collapsed) */}
          <aside
            aria-label="Primary sidebar"
            className={cn(
              "hidden h-full shrink-0 border-r border-sidebar-border transition-[width] duration-150 md:block",
              railCollapsed ? "w-[52px]" : "w-[220px]"
            )}
          >
            <LeftRail
              user={{ ...user, name: liveUserName, timezone: liveTimezone }}
              summary={liveSummary}
              collapsed={railCollapsed}
              onToggleCollapse={toggleRailCollapsed}
            />
          </aside>

          {/* Zone 2: Main Canvas */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background outline-none"
          >
            {!isOnline ? (
              <div
                role="status"
                aria-live="polite"
                className="flex shrink-0 items-center justify-center gap-2 border-b border-reminder/35 bg-reminder/10 px-4 py-1.5 text-xs text-foreground"
              >
                <WifiOff className="size-3.5 shrink-0 text-reminder" />
                <span>
                  You&rsquo;re offline. Cached views remain readable; changes
                  will save once connection returns.
                </span>
              </div>
            ) : null}
            {children}
          </main>

          {/* Zone 3: Right Slide-Over Detail Sheet (440px) */}
          <DetailSheet timezone={liveTimezone} />
        </div>
      </DetailSheetProvider>
    </WorkspaceChromeProvider>
  );
}
