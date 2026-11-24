import type { Metadata } from "next";
import { GroupsOverviewView } from "@/components/habits/groups-overview-view";
import { HabitsSubnav } from "@/components/habits/habits-subnav";
import { ViewHeader } from "@/components/workspace/view-header";
import { requireSession } from "@/server/dal/auth-guard";
import { habitMonitorService } from "@/server/services/habit-monitor-service";
import { habitGroupService } from "@/server/services/habit-group-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accountability Groups",
};

export default async function HabitsGroupsPage() {
  const { user } = await requireSession();
  const [groups, circleBadgeCount] = await Promise.all([
    habitGroupService.listGroups(user.id),
    habitMonitorService.getCircleBadgeCount(user.id),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Habits"
        subtitle="Group accountability, weekly reviews, and streak nudges"
        meta={`${groups.length} ${groups.length === 1 ? "group" : "groups"}`}
      />
      <HabitsSubnav circleBadgeCount={circleBadgeCount} />
      <div className="mx-auto w-full max-w-4xl min-w-0 p-4 md:p-6">
        <GroupsOverviewView groups={groups} />
      </div>
    </div>
  );
}
