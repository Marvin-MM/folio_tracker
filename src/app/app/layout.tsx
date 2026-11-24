import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspaceQueryProvider } from "@/components/providers/query-provider";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireSession } from "@/server/dal/auth-guard";
import { UnauthorizedError } from "@/server/dal/errors";
import { notificationRepository } from "@/server/dal/notification-repository";
import { userRepository } from "@/server/dal/user-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user;
  try {
    const authContext = await requireSession();
    user = authContext.user;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  const profile = await userRepository.getById(user.id);
  const timezone = profile?.timezone || user.timezone || "UTC";
  const resolvedName = profile?.name || user.name;
  const resolvedEmailReminders =
    profile?.emailRemindersEnabled ?? user.emailRemindersEnabled ?? true;
  const initialFetchedAtMs = getServerTimestampMs();
  const [summary, initialNotifications] = await Promise.all([
    workspaceRepository.getSidebarSummary(user.id, timezone),
    notificationRepository.listRecentForUser(user.id, 20),
  ]);

  return (
    <WorkspaceQueryProvider>
      <WorkspaceShell
        user={{
          id: user.id,
          name: resolvedName,
          email: user.email,
          timezone,
          emailRemindersEnabled: resolvedEmailReminders,
        }}
        summary={summary}
        initialNotifications={initialNotifications}
        initialFetchedAtMs={initialFetchedAtMs}
      >
        {children}
      </WorkspaceShell>
    </WorkspaceQueryProvider>
  );
}
