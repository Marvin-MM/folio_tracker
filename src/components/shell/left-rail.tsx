"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderKanban,
  Inbox,
  LogOut,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { useWorkspaceChrome } from "@/components/shell/workspace-chrome-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  SidebarProjectItem,
  SidebarSummary,
} from "@/server/dal/workspace-repository";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  timezone: string;
  emailRemindersEnabled: boolean;
}

interface LeftRailProps {
  user: ShellUser;
  summary: SidebarSummary;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${second}`.toUpperCase();
}

const PROJECT_DOT_CLASS: Record<string, string> = {
  collab: "bg-collab",
  reminder: "bg-reminder",
  done: "bg-done",
  overdue: "bg-overdue",
};

export function LeftRail({
  user,
  summary,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: LeftRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { openQuickCapture } = useWorkspaceChrome();
  const [signingOut, setSigningOut] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const smartViews = [
    {
      href: "/app/inbox",
      label: "Inbox",
      icon: Inbox,
      count: summary.inboxCount,
    },
    {
      href: "/app/today",
      label: "Today",
      icon: CalendarCheck2,
      count: summary.todayCount,
    },
    {
      href: "/app/upcoming",
      label: "Upcoming",
      icon: CalendarRange,
      count: summary.upcomingCount,
    },
    {
      href: "/app/reminders",
      label: "Reminders",
      icon: Bell,
      count: summary.remindersCount,
    },
    {
      href: "/app/notes",
      label: "Notes",
      icon: FileText,
      count: summary.notesCount,
    },
  ] as const;

  const personalProjects = summary.projects.filter((p) => p.memberCount <= 1);
  const sharedProjects = summary.projects.filter((p) => p.memberCount > 1);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const renderProjectLink = (project: SidebarProjectItem, isShared: boolean) => {
    const href = `/app/projects/${project.id}`;
    const isActive = pathname === href || pathname.startsWith(`${href}/`);

    const link = (
      <Link
        key={project.id}
        href={href}
        onClick={onNavigate}
        aria-label={collapsed ? project.name : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "mira-row flex items-center rounded-md px-2 text-xs transition-colors",
          collapsed ? "justify-center px-0" : "justify-between gap-2",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              PROJECT_DOT_CLASS[project.colorToken] ?? "bg-collab"
            )}
          />
          {collapsed ? (
            <span className="sr-only">{project.name}</span>
          ) : (
            <span className="truncate text-sidebar-foreground">
              {project.name}
            </span>
          )}
        </span>

        {!collapsed && isShared ? (
          <span
            title={`${project.memberCount} members`}
            className="mono-tabular inline-flex shrink-0 items-center gap-0.5 rounded border border-collab/35 bg-collab/10 px-1 py-0.5 text-[10px] font-medium text-collab"
          >
            <Users className="size-2.5" />
            {project.memberCount}
          </span>
        ) : null}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={project.id}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {project.name}
            {isShared ? ` (${project.memberCount} members)` : ""}
          </TooltipContent>
        </Tooltip>
      );
    }

    return link;
  };

  return (
    <>
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
      />

      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        {/* Brand header & desktop collapse toggle */}
        <div
          className={cn(
            "flex h-11 shrink-0 items-center border-b border-sidebar-border px-2.5",
            collapsed ? "justify-center" : "justify-between"
          )}
        >
          {!collapsed ? (
            <Link
              href="/app/inbox"
              onClick={onNavigate}
              className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold tracking-tight text-sidebar-foreground"
            >
              <BrandMark />
              <span className="truncate">{APP_NAME}</span>
            </Link>
          ) : null}

          {onToggleCollapse ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="mira-icon-btn text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <ChevronsRight className="size-3.5" />
              ) : (
                <ChevronsLeft className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>

        {/* Quick Capture Trigger */}
        <div className="px-2 pt-2">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    onNavigate?.();
                    openQuickCapture();
                  }}
                  aria-label="Quick capture"
                  className="mira-icon-btn mx-auto flex border-border bg-background text-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Quick capture (⌘K)
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onNavigate?.();
                openQuickCapture();
              }}
              className="mira-row w-full justify-between border-border bg-background px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <Plus className="size-3.5" />
                Quick capture
              </span>
              <kbd className="mono-tabular rounded border border-border bg-card px-1 py-0.5 text-[10px] text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
          )}
        </div>

        {/* Primary Smart Views & Projects */}
        <nav
          aria-label="Workspace views"
          className="flex-1 overflow-y-auto px-2 py-2.5"
        >
          <div className="space-y-0.5">
            {smartViews.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              const linkEl = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "mira-row group flex items-center rounded-md px-2 text-xs transition-colors",
                    collapsed ? "justify-center px-0" : "justify-between gap-2",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        item.href === "/app/reminders" && isActive
                          ? "text-reminder"
                          : ""
                      )}
                    />
                    {collapsed ? (
                      <span className="sr-only">{item.label}</span>
                    ) : (
                      <span className="truncate">{item.label}</span>
                    )}
                  </span>
                  {!collapsed ? (
                    <span className="mono-tabular text-[11px] text-muted-foreground">
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {item.label} ({item.count})
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return linkEl;
            })}
          </div>

          <Separator className="my-3 bg-sidebar-border" />

          {/* Personal Projects */}
          <div className="space-y-1">
            {!collapsed ? (
              <div className="flex items-center justify-between px-2 py-0.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Personal Projects
                </span>
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(true)}
                  aria-label="New project"
                  title="New project"
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setCreateProjectOpen(true)}
                    aria-label="New project"
                    className="mira-row flex w-full items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <FolderKanban className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  New project
                </TooltipContent>
              </Tooltip>
            )}

            {personalProjects.length === 0 ? (
              !collapsed && sharedProjects.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(true)}
                  className="w-full rounded-md border border-dashed border-sidebar-border px-2.5 py-2 text-left text-[11px] leading-relaxed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <p className="font-medium text-foreground/85">
                    + Create your first project
                  </p>
                  <p className="mt-0.5">
                    Organize tasks &amp; notes privately or invite teammates.
                  </p>
                </button>
              ) : null
            ) : (
              <div className="space-y-0.5">
                {personalProjects.map((p) => renderProjectLink(p, false))}
              </div>
            )}
          </div>

          {/* Shared Projects */}
          {sharedProjects.length > 0 ? (
            <div className="mt-3 space-y-1">
              {!collapsed ? (
                <div className="flex items-center justify-between px-2 py-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-collab">
                    Shared Projects
                  </span>
                  <span className="mono-tabular text-[10px] text-collab">
                    {sharedProjects.length}
                  </span>
                </div>
              ) : null}
              <div className="space-y-0.5">
                {sharedProjects.map((p) => renderProjectLink(p, true))}
              </div>
            </div>
          ) : null}
        </nav>

        {/* Footer: Theme Toggle & User Profile Menu */}
        <div className="shrink-0 space-y-1 border-t border-sidebar-border p-2">
          <div className={cn(collapsed && "flex justify-center")}>
            <ThemeToggle compact={collapsed} />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  "mira-row w-full text-xs font-normal hover:bg-sidebar-accent",
                  collapsed
                    ? "justify-center px-0"
                    : "justify-start gap-2 px-2"
                )}
                aria-label="Open account menu"
              >
                <Avatar className="size-5 shrink-0 border border-border">
                  <AvatarFallback className="bg-muted text-[10px] font-medium text-foreground">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                {!collapsed ? (
                  <span className="min-w-0 flex-1 truncate text-left text-xs text-sidebar-foreground">
                    {user.name}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align={collapsed ? "start" : "end"}
              side="top"
              className="w-56 border-border bg-popover"
            >
              <DropdownMenuLabel className="space-y-0.5 font-normal">
                <p className="truncate text-xs font-medium text-foreground">
                  {user.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {user.email}
                </p>
                <p className="mono-tabular truncate text-[10px] text-muted-foreground">
                  TZ · {user.timezone}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="text-xs">
                <Link href="/app/settings" onClick={onNavigate}>
                  <Settings className="mr-2 size-3.5" />
                  General settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="text-xs">
                <Link href="/app/settings/notifications" onClick={onNavigate}>
                  <Bell className="mr-2 size-3.5" />
                  Notifications &amp; Push
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-xs text-overdue focus:text-overdue"
              >
                <LogOut className="mr-2 size-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}
