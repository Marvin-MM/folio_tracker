import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceQueryProvider } from "@/components/providers/query-provider";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getServerTimestampMs } from "@/lib/query/clock";
import {
  requireSession,
  resolveLiveUserShellStatus,
} from "@/server/dal/auth-guard";
import { ForbiddenError, UnauthorizedError } from "@/server/dal/errors";
import { notificationRepository } from "@/server/dal/notification-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

function AppShellSkeleton() {
  return (
    <div
      aria-label="Loading workspace"
      className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground md:flex-row"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-sidebar px-3 md:hidden">
        <Skeleton className="h-5 w-24" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>
      <aside className="hidden h-full w-[220px] shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:flex md:flex-col md:gap-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-8 w-full rounded-md" />
        <div className="space-y-1.5 pt-2">
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-10 w-full max-w-3xl rounded-md" />
        <Skeleton className="h-44 w-full max-w-3xl rounded-md" />
      </main>
    </div>
  );
}

async function AuthenticatedAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    const authContext = await requireSession();
    user = authContext.user;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect("/login?error=suspended");
    }
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  const [shellUser, cookieStore] = await Promise.all([
    resolveLiveUserShellStatus(user.id),
    cookies(),
  ]);

  if (shellUser.isSuspended) {
    redirect("/login?error=suspended");
  }

  const initialRailCollapsed =
    cookieStore.get("folio-rail-collapsed")?.value === "1";
  const timezone = shellUser.timezone || user.timezone || "UTC";
  const resolvedName = shellUser.name || user.name;
  const resolvedEmailReminders =
    shellUser.emailRemindersEnabled ?? user.emailRemindersEnabled ?? true;
  const initialFetchedAtMs = getServerTimestampMs();
  const [summary, initialNotifications] = await Promise.all([
    workspaceRepository.getSidebarSummary(user.id, timezone),
    notificationRepository.listRecentForUser(user.id, 20),
  ]);

  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: resolvedName,
        email: user.email,
        timezone,
        emailRemindersEnabled: resolvedEmailReminders,
        isAdmin: shellUser.isAdmin,
      }}
      summary={summary}
      initialNotifications={initialNotifications}
      initialFetchedAtMs={initialFetchedAtMs}
      initialRailCollapsed={initialRailCollapsed}
    >
      {children}
    </WorkspaceShell>
  );
}

export default function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceQueryProvider>
      <Suspense fallback={<AppShellSkeleton />}>
        <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
      </Suspense>
    </WorkspaceQueryProvider>
  );
}
