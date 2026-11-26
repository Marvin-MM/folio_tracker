"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { formatInTimeZone } from "date-fns-tz";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  FolderKanban,
  HeartPulse,
  Loader2,
  LogOut,
  RefreshCw,
  Repeat2,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminReconcileOutboxAction,
  adminRevokeUserSessionsAction,
  adminSweepExpiredAction,
  adminSyncRolesAction,
  adminToggleUserSuspensionAction,
} from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ActivityTimeline,
  type ActivityTimelineItem,
} from "@/components/workspace/activity-timeline";
import { ViewHeader } from "@/components/workspace/view-header";
import {
  useAdminSummaryQuery,
  useAdminTimelineQuery,
  useAdminUsersQuery,
  usePrefetchWorkspaceView,
  useWorkspaceInvalidation,
} from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type {
  AdminUserDirectoryItem,
  PlatformTimelineCategory,
} from "@/server/dal/admin-repository";
import type {
  AdminOverviewSummaryPayload,
  HealthProbeStatus,
} from "@/server/services/admin-service";

const AdminAnalyticsCharts = dynamic(
  () =>
    import("@/components/admin/admin-analytics-charts").then(
      (mod) => mod.AdminAnalyticsCharts
    ),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="Loading admin analytics charts"
        className="grid grid-cols-1 gap-3 lg:grid-cols-12"
      >
        <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-7" />
        <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-5" />
      </div>
    ),
  }
);

type AdminPortalTab = "overview" | "health" | "users" | "timeline";

interface AdminPortalViewProps {
  currentUserId: string;
  timezone: string;
  initialData?: AdminOverviewSummaryPayload;
  initialFetchedAtMs?: number;
}

const STATUS_BADGE_CLASSES: Record<HealthProbeStatus, string> = {
  healthy: "border-done/40 bg-done/10 text-done",
  fallback: "border-reminder/40 bg-reminder/10 text-reminder",
  degraded: "border-overdue/40 bg-overdue/10 text-overdue",
};

const STATUS_LABEL: Record<HealthProbeStatus, string> = {
  healthy: "Healthy",
  fallback: "Fallback",
  degraded: "Degraded",
};

function formatDateShort(ms: number, timezone: string): string {
  try {
    return formatInTimeZone(ms, timezone, "MMM d, yyyy");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d, yyyy");
  }
}

export function AdminPortalView({
  currentUserId,
  timezone,
  initialData,
  initialFetchedAtMs,
}: AdminPortalViewProps) {
  const invalidate = useWorkspaceInvalidation(currentUserId);
  const prefetch = usePrefetchWorkspaceView(currentUserId);
  const [activeTab, setActiveTab] = useState<AdminPortalTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "suspended" | "unverified"
  >("all");
  const [timelineCategory, setTimelineCategory] =
    useState<PlatformTimelineCategory>("all");
  const [page, setPage] = useState(1);
  const [confirmSuspendUser, setConfirmSuspendUser] =
    useState<AdminUserDirectoryItem | null>(null);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const summaryQuery = useAdminSummaryQuery(
    currentUserId,
    initialData,
    initialFetchedAtMs
  );

  const usersQuery = useAdminUsersQuery(
    currentUserId,
    {
      query: searchQuery.trim() || undefined,
      roleFilter,
      statusFilter,
      page,
    },
    activeTab === "users"
  );

  const timelineQuery = useAdminTimelineQuery(
    currentUserId,
    timelineCategory,
    activeTab === "timeline"
  );

  const summaryData = summaryQuery.data ?? initialData ?? null;
  const kpis = summaryData?.kpis ?? null;
  const dailySeries = summaryData?.dailySeries ?? [];
  const health = summaryData?.health ?? null;
  const usersPage = usersQuery.data?.usersPage ?? null;
  const timeline = useMemo(
    () => timelineQuery.data?.timeline ?? [],
    [timelineQuery.data]
  );
  const isAnyFetching =
    summaryQuery.isFetching ||
    (activeTab === "users" && usersQuery.isFetching) ||
    (activeTab === "timeline" && timelineQuery.isFetching);

  const totalPages = usersPage
    ? Math.max(1, Math.ceil(usersPage.total / Math.max(1, usersPage.pageSize)))
    : 1;

  const taskCompletionPct =
    kpis && kpis.workspace.tasksTotal > 0
      ? Math.round(
          (kpis.workspace.tasksCompleted / kpis.workspace.tasksTotal) * 100
        )
      : 0;

  const verifiedPct =
    kpis && kpis.users.total > 0
      ? Math.round((kpis.users.verified / kpis.users.total) * 100)
      : 0;

  const backfillPct =
    kpis && kpis.habits.logs7d > 0
      ? Math.round((kpis.habits.lateBackfills7d / kpis.habits.logs7d) * 100)
      : 0;

  const handleRefresh = () => {
    void summaryQuery.refetch();
    if (activeTab === "users") void usersQuery.refetch();
    if (activeTab === "timeline") void timelineQuery.refetch();
  };

  const handleReconcileOutbox = () => {
    startTransition(async () => {
      const res = await adminReconcileOutboxAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["admin"]);
      toast.success(
        `Outbox reconciliation completed (${res.data.reconciledCount} reminder(s) queued).`
      );
    });
  };

  const handleSweepExpired = () => {
    startTransition(async () => {
      const res = await adminSweepExpiredAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["admin"]);
      const totalCleaned =
        res.data.expiredProjectInvitations +
        res.data.expiredHabitRequests +
        res.data.prunedSessions +
        res.data.prunedVerifications;
      toast.success(`Swept ${totalCleaned} expired record(s).`);
    });
  };

  const handleSyncRoles = () => {
    startTransition(async () => {
      const res = await adminSyncRolesAction();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["admin", "sidebar"]);
      toast.success(
        `ADMIN_EMAILS synced (${res.data.promotedEmails.length} promoted, ${res.data.demotedEmails.length} demoted, ${res.data.activeAdminCount} active).`
      );
    });
  };

  const handleRevokeSessions = (target: AdminUserDirectoryItem) => {
    startTransition(async () => {
      const res = await adminRevokeUserSessionsAction({ userId: target.id });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["admin"]);
      toast.success(
        `Revoked ${res.data.revokedSessions} session(s) for ${res.data.targetEmail}.`
      );
    });
  };

  const handleToggleSuspension = (
    target: AdminUserDirectoryItem,
    suspended: boolean
  ) => {
    startTransition(async () => {
      const res = await adminToggleUserSuspensionAction({
        userId: target.id,
        suspended,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setSuspendDialogOpen(false);
      await invalidate(["admin"]);
      toast.success(
        suspended
          ? `Suspended ${res.data.email} (${res.data.revokedSessions} session(s) revoked).`
          : `Restored ${res.data.email}.`
      );
    });
  };

  const timelineItems = useMemo<ActivityTimelineItem[]>(() => {
    return timeline.map((ev) => {
      const icon =
        ev.category === "audit" ? (
          <Shield className="size-3" />
        ) : ev.category === "project" ? (
          <FolderKanban className="size-3" />
        ) : ev.category === "user" ? (
          <UserPlus className="size-3" />
        ) : (
          <Bell className="size-3" />
        );

      return {
        id: ev.id,
        category: ev.category,
        tone: ev.tone,
        icon,
        title: ev.title,
        detail: ev.detail,
        actorName: ev.actorName,
        badgeLabel: ev.badgeLabel,
        createdAtMs: ev.createdAtMs,
      };
    });
  }, [timeline]);

  const timelineFilterOptions = useMemo(
    () => [
      { value: "all", label: "All activity" },
      { value: "audit", label: "Admin Audit" },
      { value: "project", label: "Projects" },
      { value: "user", label: "Signups" },
      { value: "reminder", label: "Deliveries" },
    ],
    []
  );

  return (
    <div className="flex flex-1 flex-col">
      <ViewHeader
        title="Admin Portal"
        subtitle="Platform KPIs, live subsystem health, env-synced access, and operational audit timeline"
        meta={
          summaryData && kpis
            ? `${kpis.users.admins} admin${kpis.users.admins === 1 ? "" : "s"} · ${summaryData.configuredAdminCount} env allowlisted`
            : "Loading platform metrics…"
        }
        actions={
          <div className="flex items-center gap-1.5">
            {health ? (
              <Badge
                variant="outline"
                className={cn(
                  "mono-tabular h-6 px-2 text-[10px] font-medium",
                  STATUS_BADGE_CLASSES[health.overallStatus]
                )}
              >
                {STATUS_LABEL[health.overallStatus]}
              </Badge>
            ) : (
              <Skeleton className="h-6 w-16 rounded" />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isAnyFetching}
              onClick={handleRefresh}
              className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
            >
              <RefreshCw
                className={cn("size-3", isAnyFetching && "animate-spin")}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Admin Portal Sub-Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Admin portal sections"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background px-4 [scrollbar-width:none] md:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {(
          [
            { id: "overview", label: "Overview", icon: Activity },
            { id: "health", label: "Health & Ops", icon: HeartPulse },
            {
              id: "users",
              label: "Users",
              icon: Users,
              badge: kpis?.users.total,
            },
            {
              id: "timeline",
              label: "Activity Timeline",
              icon: ShieldCheck,
              badge: timelineQuery.data ? timeline.length : undefined,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`admin-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`admin-panel-${tab.id}`}
              onMouseEnter={() => {
                if (tab.id === "users") prefetch.prefetchAdminUsers();
                if (tab.id === "timeline") prefetch.prefetchAdminTimeline();
              }}
              onFocus={() => {
                if (tab.id === "users") prefetch.prefetchAdminUsers();
                if (tab.id === "timeline") prefetch.prefetchAdminTimeline();
              }}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors md:min-h-9",
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span>{tab.label}</span>
              {"badge" in tab && typeof tab.badge === "number" ? (
                <span className="mono-tabular rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 space-y-5 p-4 md:p-6">
        {/* TAB 1: OVERVIEW & ANALYTICS */}
        {activeTab === "overview" ? (
          <div
            role="tabpanel"
            id="admin-panel-overview"
            aria-labelledby="admin-tab-overview"
            className="space-y-4"
          >
            {!kpis ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="space-y-2.5 rounded-md border border-border bg-card p-3.5"
                    >
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-7 w-16" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                  <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-7" />
                  <Skeleton className="h-[290px] rounded-md border border-border lg:col-span-5" />
                </div>
              </div>
            ) : (
            <>
            {/* 4 Executive KPI Cards */}
            <section
              aria-label="Platform executive metrics"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="rounded-md border border-border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Users &amp; Sessions
                  </span>
                  <Users className="size-3.5 text-collab" aria-hidden="true" />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="mono-tabular text-2xl font-semibold tracking-tight text-foreground">
                    {kpis.users.total}
                  </span>
                  <span className="mono-tabular text-xs font-medium text-done">
                    +{kpis.users.new7d} (7d)
                  </span>
                </div>
                <p className="mono-tabular mt-1.5 text-[11px] text-muted-foreground">
                  {verifiedPct}% verified · {kpis.users.activeSessions} active
                  sessions · {kpis.users.suspended} suspended
                </p>
              </div>

              <div className="rounded-md border border-border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Tasks &amp; Notes
                  </span>
                  <CheckCircle2
                    className="size-3.5 text-done"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="mono-tabular text-2xl font-semibold tracking-tight text-foreground">
                    {kpis.workspace.tasksTotal}
                  </span>
                  <span className="mono-tabular text-xs text-muted-foreground">
                    {taskCompletionPct}% done
                  </span>
                </div>
                <p className="mono-tabular mt-1.5 text-[11px] text-muted-foreground">
                  {kpis.workspace.tasksCompleted7d} completed (7d) ·{" "}
                  {kpis.workspace.notesTotal} notes ({kpis.workspace.notesPinned}{" "}
                  pinned)
                </p>
              </div>

              <div className="rounded-md border border-border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Habits &amp; Circle
                  </span>
                  <Repeat2 className="size-3.5 text-done" aria-hidden="true" />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="mono-tabular text-2xl font-semibold tracking-tight text-foreground">
                    {kpis.habits.activeHabits}
                  </span>
                  <span className="mono-tabular text-xs text-muted-foreground">
                    {kpis.habits.logs7d} logs (7d)
                  </span>
                </div>
                <p className="mono-tabular mt-1.5 text-[11px] text-muted-foreground">
                  {kpis.habits.activeCirclePairs} circle pairs · {backfillPct}%
                  late backfills · {kpis.habits.cycleCommentsTotal} reviews
                </p>
              </div>

              <div className="rounded-md border border-border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Delivery &amp; Projects
                  </span>
                  <Bell
                    className="size-3.5 text-reminder"
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="mono-tabular text-2xl font-semibold tracking-tight text-foreground">
                    {kpis.delivery.remindersScheduled +
                      kpis.delivery.remindersPendingFar}
                  </span>
                  <span
                    className={cn(
                      "mono-tabular text-xs font-medium",
                      kpis.delivery.undispatchedOutboxBacklog > 0
                        ? "text-overdue"
                        : "text-done"
                    )}
                  >
                    {kpis.delivery.undispatchedOutboxBacklog} backlog
                  </span>
                </div>
                <p className="mono-tabular mt-1.5 text-[11px] text-muted-foreground">
                  {kpis.delivery.remindersSent7d} sent (7d) ·{" "}
                  {kpis.delivery.pushSubscriptions} push devices ·{" "}
                  {kpis.workspace.sharedProjects}/{kpis.workspace.projectsTotal}{" "}
                  shared projects
                </p>
              </div>
            </section>

            {/* Lazy-Loaded Recharts Platform Analytics */}
            <AdminAnalyticsCharts
              dailySeries={dailySeries}
              delivery={kpis.delivery}
            />

            {/* Domain Adoption & Privacy Guardrail Strip */}
            <section
              aria-label="Platform adoption breakdown"
              className="grid grid-cols-1 gap-3 md:grid-cols-3"
            >
              <div className="space-y-2 rounded-md border border-border bg-card p-3.5">
                <h3 className="text-xs font-semibold text-foreground">
                  Authentication Mix
                </h3>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Google OAuth</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.adoption.googleAccounts}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Email &amp; Password</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.adoption.credentialAccounts}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <dt className="text-muted-foreground">New users (30d)</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.users.new30d}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-card p-3.5">
                <h3 className="text-xs font-semibold text-foreground">
                  Habit Cadence Distribution
                </h3>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Daily habits</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.adoption.cadenceDaily}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Specific weekdays</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.adoption.cadenceSpecificDays}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <dt className="text-muted-foreground">Weekly target</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.adoption.cadenceWeeklyTarget}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-card p-3.5">
                <h3 className="text-xs font-semibold text-foreground">
                  Collaboration &amp; Invites
                </h3>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Pending project invites</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.workspace.pendingProjectInvites}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Pending circle requests</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.habits.pendingMonitorRequests}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <dt className="text-muted-foreground">Unread notifications</dt>
                    <dd className="mono-tabular font-medium text-foreground">
                      {kpis.delivery.unreadNotifications}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
            </>
            )}
          </div>
        ) : null}

        {/* TAB 2: LIVE SYSTEM HEALTH & AUDITED OPERATIONS */}
        {activeTab === "health" ? (
          <div
            role="tabpanel"
            id="admin-panel-health"
            aria-labelledby="admin-tab-health"
            className="space-y-4"
          >
            {!health || !kpis || !summaryData ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Skeleton
                    key={idx}
                    className="h-[146px] rounded-md border border-border"
                  />
                ))}
              </div>
            ) : (
            <>
            <section
              aria-label="Subsystem health diagnostics"
              className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
            >
              {health.subsystems.map((sub) => (
                <div
                  key={sub.key}
                  className="flex flex-col justify-between gap-3 rounded-md border border-border bg-card p-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Database
                          className="size-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {sub.label}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "mono-tabular h-5 px-1.5 text-[10px] font-medium",
                          STATUS_BADGE_CLASSES[sub.status]
                        )}
                      >
                        {STATUS_LABEL[sub.status]}
                        {sub.latencyMs !== null ? ` · ${sub.latencyMs}ms` : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{sub.summary}</p>
                  </div>

                  <dl className="space-y-1 border-t border-border pt-2.5 text-[11px]">
                    {sub.details.map((d) => (
                      <div
                        key={d.label}
                        className="flex items-center justify-between gap-2"
                      >
                        <dt className="text-muted-foreground">{d.label}</dt>
                        <dd className="mono-tabular text-right font-medium text-foreground">
                          {d.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>

            {/* Audited Operational Actions */}
            <section
              aria-label="Operational maintenance actions"
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Wrench className="size-3.5 text-muted-foreground" />
                    Audited Operational Actions
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Every operator action runs inside safe database boundaries
                    and appends an immutable record to the Audit Timeline.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-3.5">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      Reconcile Reminder Outbox
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Dispatch up to 200 scheduled reminders waiting over 60s
                      with{" "}
                      <code className="font-mono text-[10px] text-foreground">
                        dispatched_at = NULL
                      </code>
                      . Current backlog:{" "}
                      <span className="mono-tabular font-medium text-foreground">
                        {kpis.delivery.undispatchedOutboxBacklog}
                      </span>
                      .
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={handleReconcileOutbox}
                    className="mira-row w-full gap-1.5 text-xs"
                  >
                    {isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Bell className="size-3 text-reminder" />
                    )}
                    Reconcile outbox now
                  </Button>
                </div>

                <div className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-3.5">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      Sweep Expired Invites &amp; Sessions
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Mark overdue pending project/circle invites as expired and
                      prune expired sessions &amp; verification tokens.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={handleSweepExpired}
                    className="mira-row w-full gap-1.5 text-xs"
                  >
                    {isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3 text-muted-foreground" />
                    )}
                    Sweep expired records
                  </Button>
                </div>

                <div className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-3.5">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      Re-Sync ADMIN_EMAILS Allowlist
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Promote verified allowlisted emails and demote any removed
                      admins immediately. Currently{" "}
                      <span className="mono-tabular font-medium text-foreground">
                        {summaryData.configuredAdminCount}
                      </span>{" "}
                      allowlisted.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={handleSyncRoles}
                    className="mira-row w-full gap-1.5 text-xs"
                  >
                    {isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3 text-collab" />
                    )}
                    Sync admin roles
                  </Button>
                </div>
              </div>
            </section>
            </>
            )}
          </div>
        ) : null}

        {/* TAB 3: USERS DIRECTORY & ACCESS CONTROLS */}
        {activeTab === "users" ? (
          <div
            role="tabpanel"
            id="admin-panel-users"
            aria-labelledby="admin-tab-users"
            className="space-y-3"
          >
            {/* Filter Controls */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_150px]">
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5">
                <Search
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="admin-user-search"
                  name="adminUserSearch"
                  aria-label="Search users by name or email"
                  placeholder="Search users by name or email…"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="mira-row border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label="Clear user search"
                    onClick={() => {
                      setSearchQuery("");
                      setPage(1);
                    }}
                    className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>

              <Select
                name="adminRoleFilter"
                value={roleFilter}
                onValueChange={(val) => {
                  setRoleFilter(val as "all" | "admin" | "user");
                  setPage(1);
                }}
              >
                <SelectTrigger
                  id="admin-role-filter"
                  aria-label="Filter users by role"
                  className="mira-row w-full bg-card text-xs"
                >
                  <SelectValue>
                    {roleFilter === "all"
                      ? "All roles"
                      : roleFilter === "admin"
                        ? "Admins"
                        : "Members"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All roles
                  </SelectItem>
                  <SelectItem value="admin" className="text-xs">
                    Admins
                  </SelectItem>
                  <SelectItem value="user" className="text-xs">
                    Members
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                name="adminStatusFilter"
                value={statusFilter}
                onValueChange={(val) => {
                  setStatusFilter(
                    val as "all" | "active" | "suspended" | "unverified"
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger
                  id="admin-status-filter"
                  aria-label="Filter users by status"
                  className="mira-row w-full bg-card text-xs"
                >
                  <SelectValue>
                    {statusFilter === "all"
                      ? "All statuses"
                      : statusFilter === "active"
                        ? "Active"
                        : statusFilter === "suspended"
                          ? "Suspended"
                          : "Unverified"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All statuses
                  </SelectItem>
                  <SelectItem value="active" className="text-xs">
                    Active
                  </SelectItem>
                  <SelectItem value="suspended" className="text-xs">
                    Suspended
                  </SelectItem>
                  <SelectItem value="unverified" className="text-xs">
                    Unverified
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Responsive User Cards / Rows */}
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
              {!usersPage ? (
                <div className="space-y-2.5 p-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-14 w-full rounded" />
                  ))}
                </div>
              ) : usersPage.items.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                  No users match the current filter.
                </div>
              ) : (
                usersPage.items.map((u) => {
                  const isSelf = u.id === currentUserId;
                  const canSuspend = !isSelf && u.role !== "admin";
                  return (
                    <div
                      key={u.id}
                      className="flex flex-col gap-3 px-4 py-3 text-xs md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-semibold text-foreground">
                            {u.name}
                          </span>
                          {u.role === "admin" ? (
                            <Badge
                              variant="outline"
                              className="h-4 border-collab/40 bg-collab/10 px-1.5 text-[10px] font-medium text-collab"
                            >
                              Admin
                            </Badge>
                          ) : null}
                          {isSelf ? (
                            <Badge
                              variant="secondary"
                              className="h-4 px-1.5 text-[10px] font-normal"
                            >
                              You
                            </Badge>
                          ) : null}
                          {u.isSuspended ? (
                            <Badge
                              variant="outline"
                              className="h-4 border-overdue/40 bg-overdue/10 px-1.5 text-[10px] font-medium text-overdue"
                            >
                              Suspended
                            </Badge>
                          ) : u.emailVerified ? (
                            <Badge
                              variant="outline"
                              className="h-4 border-done/40 bg-done/10 px-1.5 text-[10px] font-normal text-done"
                            >
                              Verified
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="h-4 border-reminder/40 bg-reminder/10 px-1.5 text-[10px] font-normal text-reminder"
                            >
                              Unverified
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {u.email} · Joined{" "}
                          <span className="mono-tabular">
                            {formatDateShort(u.createdAtMs, timezone)}
                          </span>{" "}
                          · {u.timezone}
                        </p>
                        <p className="mono-tabular text-[10px] text-muted-foreground">
                          {u.tasksCount} tasks · {u.notesCount} notes ·{" "}
                          {u.habitsCount} habits · {u.projectsCount} projects ·{" "}
                          {u.activeSessions} session
                          {u.activeSessions === 1 ? "" : "s"}
                          {u.providers.length > 0
                            ? ` · ${u.providers.join(", ")}`
                            : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            isPending || isSelf || u.activeSessions === 0
                          }
                          onClick={() => handleRevokeSessions(u)}
                          className="mira-row gap-1 px-2.5 text-xs"
                        >
                          <LogOut className="size-3" aria-hidden="true" />
                          Revoke sessions
                        </Button>

                        {u.isSuspended ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending || isSelf}
                            onClick={() => handleToggleSuspension(u, false)}
                            className="mira-row gap-1 border-done/40 px-2.5 text-xs text-done hover:text-done"
                          >
                            <UserCheck className="size-3" aria-hidden="true" />
                            Restore
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isPending || !canSuspend}
                            onClick={() => {
                              setConfirmSuspendUser(u);
                              setSuspendDialogOpen(true);
                            }}
                            className="mira-row gap-1 px-2.5 text-xs text-overdue hover:text-overdue"
                          >
                            <ShieldAlert
                              className="size-3"
                              aria-hidden="true"
                            />
                            Suspend
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {usersPage && totalPages > 1 ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="mono-tabular">
                  Page {usersPage.page} of {totalPages} ({usersPage.total} total)
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={usersPage.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="mira-row px-2.5 text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={usersPage.page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="mira-row px-2.5 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* TAB 4: PLATFORM & AUDIT ACTIVITY TIMELINE */}
        {activeTab === "timeline" ? (
          <div
            role="tabpanel"
            id="admin-panel-timeline"
            aria-labelledby="admin-tab-timeline"
          >
            {timelineQuery.isLoading && !timelineQuery.data ? (
              <div className="space-y-2.5 rounded-md border border-border bg-card p-4">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-12 w-full rounded" />
                ))}
              </div>
            ) : (
              <ActivityTimeline
                items={timelineItems}
                timezone={timezone}
                referenceUtcMs={
                  timelineQuery.data?.generatedAtMs ??
                  summaryData?.generatedAtMs ??
                  0
                }
                filters={timelineFilterOptions}
                activeFilter={timelineCategory}
                onFilterChange={(val) =>
                  setTimelineCategory(val as PlatformTimelineCategory)
                }
                emptyTitle="No platform activity recorded yet"
                emptyDescription="Admin audits, signups, project milestones, and reminder deliveries appear chronologically here."
                ariaLabel="Platform and admin audit timeline"
              />
            )}
          </div>
        ) : null}
      </div>

      {/* Suspension Confirmation Dialog */}
      <Dialog
        open={suspendDialogOpen && confirmSuspendUser !== null}
        onOpenChange={(open) => setSuspendDialogOpen(open)}
      >
        <DialogContent className="border-border bg-card sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm font-semibold text-overdue">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Suspend user account?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Suspending{" "}
              <span className="font-medium text-foreground">
                {confirmSuspendUser?.email}
              </span>{" "}
              immediately revokes all active sessions and blocks workspace
              access until restored by an administrator.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setSuspendDialogOpen(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending || !confirmSuspendUser}
              onClick={() => {
                if (confirmSuspendUser) {
                  handleToggleSuspension(confirmSuspendUser, true);
                }
              }}
              className="mira-row text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Suspending…
                </>
              ) : (
                "Confirm suspend"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
