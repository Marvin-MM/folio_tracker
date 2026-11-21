"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Menu, Plus } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { QuickCaptureDialog } from "@/components/capture/quick-capture-dialog";
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
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SidebarSummary } from "@/server/dal/workspace-repository";
import type { NotificationRecord } from "@/server/db/schema";

interface WorkspaceShellProps {
  user: ShellUser;
  summary: SidebarSummary;
  initialNotifications: NotificationRecord[];
  children: React.ReactNode;
}

/**
 * Three-Zone App Shell:
 * 1. Left Rail (220px collapsible desktop rail, Sheet drawer on mobile)
 * 2. Main Canvas (scrollable route content preserving scroll position)
 * 3. Right Slide-Over Detail Sheet (440px non-blocking interactive inspector)
 * + Global ⌘K Quick Capture dialog & In-App Notification Bell
 */
export function WorkspaceShell({
  user,
  summary,
  initialNotifications,
  children,
}: WorkspaceShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  const openQuickCapture = useCallback(() => {
    setQuickCaptureOpen(true);
  }, []);

  // Global ⌘K / Ctrl+K shortcut for Quick Capture
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickCaptureOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const chromeValue = useMemo(
    () => ({
      openQuickCapture,
      notifications: initialNotifications,
      timezone: user.timezone,
    }),
    [openQuickCapture, initialNotifications, user.timezone]
  );

  return (
    <WorkspaceChromeProvider value={chromeValue}>
      <DetailSheetProvider>
        <TimezoneSync currentTimezone={user.timezone} />
        <QuickCaptureDialog
          open={quickCaptureOpen}
          onOpenChange={setQuickCaptureOpen}
          timezone={user.timezone}
        />

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
                initialNotifications={initialNotifications}
                timezone={user.timezone}
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
                user={user}
                summary={summary}
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
              user={user}
              summary={summary}
              collapsed={railCollapsed}
              onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
            />
          </aside>

          {/* Zone 2: Main Canvas */}
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
            {children}
          </main>

          {/* Zone 3: Right Slide-Over Detail Sheet (440px) */}
          <DetailSheet timezone={user.timezone} />
        </div>
      </DetailSheetProvider>
    </WorkspaceChromeProvider>
  );
}
