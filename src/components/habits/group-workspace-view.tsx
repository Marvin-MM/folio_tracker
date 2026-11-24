"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Share2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  addGroupMemberAction,
  leaveHabitGroupAction,
  removeGroupMemberAction,
  setGroupMemberRoleAction,
  shareGroupHabitAction,
  unshareGroupHabitAction,
} from "@/actions/habit-groups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GroupWorkspace } from "@/server/services/habit-group-service";

interface GroupWorkspaceViewProps {
  workspace: GroupWorkspace;
  myHabits: Array<{ id: string; title: string }>;
  currentUserId: string;
}

export function GroupWorkspaceView({
  workspace,
  myHabits,
  currentUserId,
}: GroupWorkspaceViewProps) {
  const { group, members, sharedHabits, metrics } = workspace;
  const [memberEmail, setMemberEmail] = useState("");
  const [shareHabitId, setShareHabitId] = useState("");
  const [isPending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    successMessage: string,
    onSuccess?: () => void
  ) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      onSuccess?.();
    });
  };

  const sharedIds = new Set(sharedHabits.map((habit) => habit.habitId));
  const shareable = myHabits.filter((habit) => !sharedIds.has(habit.id));
  const isOwner = group.ownerId === currentUserId;

  return (
    <div className="space-y-4">
      <Link
        href="/app/habits/groups"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All groups
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Shared progress</CardTitle>
              <CardDescription>
                Aggregates only — raw daily logs stay private to their owner.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {metrics.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No habits have been shared with this group yet.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Habit</th>
                      <th className="pb-2 font-medium">Owner</th>
                      <th className="pb-2 font-medium">Week</th>
                      <th className="pb-2 font-medium">Streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr
                        key={metric.habitId}
                        className="border-t border-border/60"
                      >
                        <td className="py-2 pr-3 font-medium">{metric.title}</td>
                        <td className="py-2 pr-3">{metric.ownerName}</td>
                        <td className="py-2 pr-3">
                          {metric.completionPct === null
                            ? "—"
                            : `${metric.completionPct}%`}
                        </td>
                        <td className="py-2">
                          {metric.currentStreak} {metric.streakUnit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Members ({members.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="capitalize">
                      {member.role}
                    </Badge>
                    {workspace.canManageMembers &&
                    member.userId !== currentUserId &&
                    member.role !== "owner" ? (
                      <>
                        {isOwner ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[10px]"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () =>
                                  setGroupMemberRoleAction({
                                    groupId: group.id,
                                    userId: member.userId,
                                    role:
                                      member.role === "admin"
                                        ? "member"
                                        : "admin",
                                  }),
                                "Role updated."
                              )
                            }
                          >
                            {member.role === "admin" ? "Member" : "Admin"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () =>
                                removeGroupMemberAction({
                                  groupId: group.id,
                                  userId: member.userId,
                                }),
                              "Member removed."
                            )
                          }
                          aria-label={`Remove ${member.name}`}
                        >
                          <UserMinus className="size-3" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}

              {workspace.canManageMembers ? (
                <div className="flex gap-1.5 pt-1">
                  <Input
                    value={memberEmail}
                    onChange={(event) => setMemberEmail(event.target.value)}
                    placeholder="partner@example.com"
                    type="email"
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !memberEmail.trim()}
                    onClick={() =>
                      run(
                        () =>
                          addGroupMemberAction({
                            groupId: group.id,
                            email: memberEmail,
                          }),
                        "Member added.",
                        () => setMemberEmail("")
                      )
                    }
                  >
                    Add
                  </Button>
                </div>
              ) : null}
              {!isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => leaveHabitGroupAction({ groupId: group.id }),
                      "You left the group."
                    )
                  }
                >
                  Leave group
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Share2 className="size-4" />
                Shared habits
              </CardTitle>
              <CardDescription>
                You can only share habits you own. Remove sharing any time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sharedHabits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing shared yet.
                </p>
              ) : (
                sharedHabits.map((habit) => (
                  <div
                    key={habit.habitId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{habit.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {habit.ownerName}
                      </p>
                    </div>
                    {habit.ownerId === currentUserId || isOwner ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px]"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () =>
                              unshareGroupHabitAction({
                                groupId: group.id,
                                habitId: habit.habitId,
                              }),
                            "Habit unshared."
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))
              )}

              {shareable.length > 0 ? (
                <div className="flex gap-1.5 pt-1">
                  <Select value={shareHabitId} onValueChange={setShareHabitId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a habit" />
                    </SelectTrigger>
                    <SelectContent>
                      {shareable.map((habit) => (
                        <SelectItem key={habit.id} value={habit.id}>
                          {habit.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !shareHabitId}
                    onClick={() =>
                      run(
                        () =>
                          shareGroupHabitAction({
                            groupId: group.id,
                            habitId: shareHabitId,
                          }),
                        "Habit shared with the group.",
                        () => setShareHabitId("")
                      )
                    }
                  >
                    Share
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
