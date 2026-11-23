"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Flame,
  Lock,
  Settings2,
  ShieldOff,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  acceptMonitorRequestAction,
  declineMonitorRequestAction,
  revokeMonitorAction,
  revokeMonitorRequestAction,
} from "@/actions/habits-social";
import { HabitReviewPanel } from "@/components/habits/habit-review-panel";
import { HabitSettingsSheet } from "@/components/habits/habit-settings-sheet";
import { InviteMonitorDialog } from "@/components/habits/invite-monitor-dialog";
import { MonitorPolicySheet } from "@/components/habits/monitor-policy-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MonitorWithUser } from "@/server/dal/habits-social";
import type { OwnerReviewsData } from "@/server/services/habit-comment-service";
import type { CircleOverviewData } from "@/server/services/habit-monitor-service";

interface CircleOverviewViewProps {
  currentUserId: string;
  currentUserName: string;
  timezone: string;
  overview: CircleOverviewData;
  ownerReviews: OwnerReviewsData;
}

export function CircleOverviewView({
  currentUserId,
  currentUserName,
  timezone,
  overview,
  ownerReviews,
}: CircleOverviewViewProps) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<MonitorWithUser | null>(
    null
  );
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAcceptRequest = (requestId: string) => {
    startTransition(async () => {
      const result = await acceptMonitorRequestAction({ requestId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Monitor request accepted.");
    });
  };

  const handleDeclineRequest = (requestId: string) => {
    startTransition(async () => {
      const result = await declineMonitorRequestAction({ requestId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Request declined.");
    });
  };

  const handleRevokePending = (requestId: string) => {
    startTransition(async () => {
      const result = await revokeMonitorRequestAction({ requestId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Invitation cancelled.");
    });
  };

  const handleRevokeMonitor = (monitorId: string) => {
    startTransition(async () => {
      const result = await revokeMonitorAction({ monitorId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setConfirmRevokeId(null);
      toast.success("Monitor access revoked immediately.");
    });
  };

  return (
    <div className="min-w-0 space-y-5">
      <InviteMonitorDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        collaborators={overview.knownCollaborators}
        habits={overview.myHabits}
      />
      <HabitSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={overview.globalSettings}
        timezone={timezone}
      />
      <MonitorPolicySheet
        open={editingMonitor !== null}
        onOpenChange={(open) => !open && setEditingMonitor(null)}
        monitor={editingMonitor}
        globalSettings={overview.globalSettings}
        habits={overview.myHabits}
      />

      {/* Pending Incoming Requests Banner */}
      {overview.incomingRequests.length > 0 ? (
        <section
          aria-label="Pending monitor requests"
          className="space-y-2 rounded-md border border-collab/40 bg-collab/5 p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-collab">
              Pending Monitor Requests ({overview.incomingRequests.length})
            </span>
          </div>

          <div className="space-y-2">
            {overview.incomingRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {req.ownerName}{" "}
                    <span className="font-normal text-muted-foreground">
                      invited you to monitor{" "}
                      {req.scope === "all"
                        ? "all their habits"
                        : "selected habits"}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {req.ownerEmail}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleDeclineRequest(req.id)}
                    className="mira-row gap-1 px-2.5 text-xs"
                  >
                    <X className="size-3" />
                    Decline
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleAcceptRequest(req.id)}
                    className="mira-row gap-1 px-3 text-xs"
                  >
                    <Check className="size-3" />
                    Accept
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Top Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Accountability Circle
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Follow friends&apos; read-only ledgers and control exactly when
            monitors can review yours.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
          >
            <Settings2 className="size-3.5" />
            Global Policy
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setInviteOpen(true)}
            className="mira-row gap-1.5 px-3 text-xs"
          >
            <UserPlus className="size-3.5" />
            Invite Monitor
          </Button>
        </div>
      </div>

      {/* Section 1: Monitoring Others */}
      <section aria-label="Monitoring others" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">
            Monitoring Others ({overview.monitoringOthers.length})
          </h3>
        </div>

        {overview.monitoringOthers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card px-5 py-7 text-center">
            <Users className="mx-auto size-4 text-muted-foreground" />
            <p className="mt-2 text-xs font-medium text-foreground">
              Not monitoring anyone yet
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              When a friend invites you to their Accountability Circle, their
              tracker will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {overview.monitoringOthers.map((friend) => (
              <Link
                key={friend.monitorId}
                href={`/app/habits/circle/${friend.ownerId}`}
                className="group flex flex-col justify-between gap-3 rounded-md border border-border bg-card p-3.5 transition-colors hover:border-foreground/35"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {friend.ownerName}
                    </p>
                    <p className="mono-tabular mt-0.5 text-[11px] text-muted-foreground">
                      {friend.sharedHabitCount} shared habit
                      {friend.sharedHabitCount === 1 ? "" : "s"} ·{" "}
                      {friend.ownerTimezone}
                    </p>
                  </div>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="mono-tabular font-semibold text-foreground">
                      {friend.cycleCompletionPct !== null
                        ? `${friend.cycleCompletionPct}%`
                        : "—"}
                    </span>
                    <span className="mono-tabular inline-flex items-center gap-0.5 text-muted-foreground">
                      <Flame className="size-3 text-reminder" />
                      {friend.topActiveStreak}
                      {friend.topStreakUnit === "weeks" ? "w" : "d"}
                    </span>
                  </div>

                  <span
                    className={cn(
                      "mono-tabular inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium",
                      friend.windowState.isOpen
                        ? "border-done/40 bg-done/10 text-done"
                        : "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    {friend.windowState.isOpen ? null : (
                      <Lock className="size-2.5" />
                    )}
                    {friend.windowState.summary}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: My Monitors & Policy Controls */}
      <section aria-label="My monitors" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">
            My Monitors ({overview.myMonitors.length})
          </h3>
        </div>

        <div className="rounded-md border border-border bg-card">
          {overview.myMonitors.length === 0 ? (
            <div className="px-5 py-7 text-center">
              <p className="text-xs font-medium text-foreground">
                No active monitors yet
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Invite a collaborator or friend to review your habit progress on
                your schedule.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {overview.myMonitors.map((entry) => {
                const { monitor, policyBadge, windowState } = entry;
                const isConfirming = confirmRevokeId === monitor.id;

                return (
                  <div
                    key={monitor.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {monitor.monitorName}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-4 border-border px-1.5 text-[10px] font-normal text-muted-foreground"
                        >
                          {monitor.scope === "all"
                            ? "All Habits"
                            : `${monitor.selectedHabitIds.length} Selected`}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-4 px-1.5 text-[10px] font-normal",
                            monitor.useCustomPolicy
                              ? "border-collab/40 bg-collab/10 text-collab"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          {policyBadge}
                        </Badge>
                      </div>
                      <p className="mono-tabular text-[11px] text-muted-foreground">
                        {monitor.monitorEmail} · {windowState.summary}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setEditingMonitor(monitor)}
                        className="mira-row gap-1.5 px-2.5 text-xs"
                      >
                        <SlidersHorizontal className="size-3" />
                        Configure Override
                      </Button>

                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isPending}
                            onClick={() => handleRevokeMonitor(monitor.id)}
                            className="mira-row px-2.5 text-xs"
                          >
                            Confirm Revoke
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmRevokeId(null)}
                            className="mira-row px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() => setConfirmRevokeId(monitor.id)}
                          className="mira-row gap-1 px-2 text-xs text-overdue hover:text-overdue"
                        >
                          <ShieldOff className="size-3" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Outgoing Pending Invitations */}
          {overview.outgoingRequests.length > 0 ? (
            <div className="border-t border-border bg-background/50 px-3.5 py-2.5">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending outgoing invitations ({overview.outgoingRequests.length})
              </p>
              <div className="space-y-1.5">
                {overview.outgoingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-foreground">
                        {req.targetEmail}
                      </span>
                      <Badge
                        variant="outline"
                        className="h-4 border-border px-1.5 text-[10px] font-normal text-muted-foreground"
                      >
                        {req.scope === "all" ? "All Habits" : "Selected"}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleRevokePending(req.id)}
                      className="mira-row px-2 text-[11px] text-overdue hover:text-overdue"
                    >
                      Cancel invite
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Section 3: Feedback Received on My Habits (Owner can always reply) */}
      <HabitReviewPanel
        ownerId={currentUserId}
        ownerName={currentUserName}
        ownerTimezone={timezone}
        currentUserId={currentUserId}
        isOwner
        windowState={null}
        activeCycleKey={ownerReviews.activeCycleKey}
        availableCycleKeys={ownerReviews.availableCycleKeys}
        onSelectCycle={(nextCycle) =>
          router.push(
            `/app/habits/circle?cycle=${encodeURIComponent(nextCycle)}`
          )
        }
        scopedHabits={overview.myHabits}
        comments={ownerReviews.comments}
        reactions={ownerReviews.reactions}
      />
    </div>
  );
}
