import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { GroupWorkspaceView } from "@/components/habits/group-workspace-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { habitRepository } from "@/server/dal/habits";
import { habitGroupService } from "@/server/services/habit-group-service";
import { habitMonitorService } from "@/server/services/habit-monitor-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accountability Group",
};

interface GroupWorkspacePageProps {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}

export default async function GroupWorkspacePage({
  params,
  searchParams,
}: GroupWorkspacePageProps) {
  const [{ user }, routeParams, query] = await Promise.all([
    requireSession(),
    params,
    searchParams,
  ]);

  const circleBadgeCount = await habitMonitorService.getCircleBadgeCount(
    user.id
  );
  const workspaceResult = await habitGroupService
    .getWorkspace(user.id, routeParams.groupId, query.cycle)
    .then((workspace) => ({ ok: true as const, workspace }))
    .catch((error: unknown) => {
      if (error instanceof ForbiddenError || error instanceof NotFoundError) {
        return { ok: false as const, message: error.message };
      }
      throw error;
    });

  if (!workspaceResult.ok) {
    return (
      <div className="flex flex-1 flex-col">
        <ViewHeader title="Habits" subtitle="Accountability Groups" />
        <HabitsSubnav circleBadgeCount={circleBadgeCount} />
        <div className="mx-auto w-full max-w-lg p-6">
          <div className="space-y-3 rounded-md border border-border bg-card p-6 text-center">
            <ShieldAlert className="mx-auto size-5 text-overdue" />
            <h2 className="text-sm font-semibold text-foreground">
              Group unavailable
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {workspaceResult.message}
            </p>
            <Button asChild variant="outline" size="sm" className="mira-row text-xs">
              <Link href="/app/habits/groups">Back to groups</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { workspace } = workspaceResult;
  const habits = await habitRepository.listHabitsForUser(user.id);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle={`${workspace.group.name} · Member-only workspace`}
        meta={`${workspace.members.length} members · ${workspace.sharedHabits.length} shared`}
      />
      <HabitsSubnav circleBadgeCount={circleBadgeCount} />
      <div className="mx-auto w-full max-w-[1200px] min-w-0 p-4 md:p-6">
        <GroupWorkspaceView
          workspace={workspace}
          myHabits={habits.map((habit) => ({
            id: habit.id,
            title: habit.title,
          }))}
          currentUserId={user.id}
        />
      </div>
    </div>
  );
}
