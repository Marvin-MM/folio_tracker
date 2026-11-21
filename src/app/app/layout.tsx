import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { requireSession } from "@/server/dal/auth-guard";
import { UnauthorizedError } from "@/server/dal/errors";
import { notificationRepository } from "@/server/dal/notification-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";

export const dynamic = "force-dynamic";

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

  const timezone = user.timezone || "UTC";
  const [summary, initialNotifications] = await Promise.all([
    workspaceRepository.getSidebarSummary(user.id, timezone),
    notificationRepository.listRecentForUser(user.id, 20),
  ]);

  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        timezone,
        emailRemindersEnabled: user.emailRemindersEnabled ?? true,
      }}
      summary={summary}
      initialNotifications={initialNotifications}
    >
      {children}
    </WorkspaceShell>
  );
}
