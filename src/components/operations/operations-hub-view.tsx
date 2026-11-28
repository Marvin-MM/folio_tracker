"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  Clock,
  Compass,
  Eye,
  FolderKanban,
  GitFork,
  Globe,
  Link2,
  Lock,
  Mail,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Search,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  abandonOperationRunAction,
  acceptInAppOperationInviteAction,
  archiveOperationAction,
  declineOperationInviteAction,
} from "@/actions/operations";
import { ExploreDirectoryView } from "@/components/operations/explore-directory-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import { OPERATION_DOMAINS, type OperationDomain } from "@/server/db/schema";
import { getOperationDomainPreset } from "@/server/domain/operations";
import type { OperationsHubPayload } from "@/server/services/operation-service";

interface OperationsHubViewProps {
  payload: OperationsHubPayload;
  timezone: string;
  includeArchived: boolean;
  onIncludeArchivedChange: (next: boolean) => void;
}

type HubTab = "operations" | "runs" | "shared" | "explore";

function parseInitialTab(raw: string | null): HubTab {
  if (raw === "runs" || raw === "shared" || raw === "explore") return raw;
  return "operations";
}

function formatShortDate(ms: number, timezone: string): string {
  try {
    return formatInTimeZone(ms, timezone, "MMM d · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d · HH:mm");
  }
}

export function OperationsHubView({
  payload,
  timezone,
  includeArchived,
  onIncludeArchivedChange,
}: OperationsHubViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<HubTab>(() =>
    parseInitialTab(searchParams.get("tab"))
  );
  const [selectedDomain, setSelectedDomain] = useState<OperationDomain | "all">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const handleTabChange = (tab: HubTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "operations") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    router.replace(qs ? `/app/operations?${qs}` : "/app/operations", {
      scroll: false,
    });
  };

  const filteredOperations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return payload.operations.filter((item) => {
      if (selectedDomain !== "all" && item.operation.domain !== selectedDomain) {
        return false;
      }
      if (!q) return true;
      return (
        item.operation.title.toLowerCase().includes(q) ||
        item.operation.summary.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q))
      );
    });
  }, [payload.operations, selectedDomain, searchQuery]);

  const sharedBadgeCount =
    payload.sharedWithMe.length + payload.pendingInvitations.length;

  const handleToggleArchive = (operationId: string, nextArchived: boolean) => {
    startTransition(async () => {
      const result = await archiveOperationAction({
        operationId,
        isArchived: nextArchived,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations", "sidebar"]);
      toast.success(
        nextArchived ? "Operation archived." : "Operation restored."
      );
    });
  };

  const handleAbandonRun = (runId: string) => {
    startTransition(async () => {
      const result = await abandonOperationRunAction({ runId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success("Run marked abandoned.");
    });
  };

  const handleAcceptInvite = (invitationId: string) => {
    startTransition(async () => {
      const result = await acceptInAppOperationInviteAction({ invitationId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations", "notifications", "sidebar"]);
      toast.success("Invitation accepted.");
    });
  };

  const handleDeclineInvite = (invitationId: string) => {
    startTransition(async () => {
      const result = await declineOperationInviteAction({ invitationId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations", "notifications"]);
      toast.success("Invitation declined.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="size-4 text-reminder" />
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              Operations
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Universal blueprints, playbooks, recipes, and guided execution runs
            — versioned, collaborative, and ready offline.
          </p>
        </div>

        <Button
          asChild
          size="sm"
          className="h-9 gap-1.5 px-3 text-xs md:h-8"
        >
          <Link href="/app/operations/new">
            <Plus className="size-3.5" />
            New Operation
          </Link>
        </Button>
      </div>

      {/* 4-Tab Operations Hub */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div
          role="tablist"
          aria-label="Operations views"
          className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border border-border bg-muted/60 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "operations"}
            onClick={() => handleTabChange("operations")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors md:h-7",
              activeTab === "operations"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>My Operations</span>
            <span className="mono-tabular text-[11px] text-muted-foreground">
              {payload.operations.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "runs"}
            onClick={() => handleTabChange("runs")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors md:h-7",
              activeTab === "runs"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>Active Runs</span>
            <span
              className={cn(
                "mono-tabular rounded px-1 text-[11px]",
                payload.activeRuns.length > 0
                  ? "bg-reminder/15 text-reminder"
                  : "text-muted-foreground"
              )}
            >
              {payload.activeRuns.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "shared"}
            onClick={() => handleTabChange("shared")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors md:h-7",
              activeTab === "shared"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="size-3" />
            <span>Shared With Me</span>
            <span
              className={cn(
                "mono-tabular rounded px-1 text-[11px]",
                payload.pendingInvitations.length > 0
                  ? "bg-reminder/15 text-reminder"
                  : "text-muted-foreground"
              )}
            >
              {sharedBadgeCount}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "explore"}
            onClick={() => handleTabChange("explore")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors md:h-7",
              activeTab === "explore"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Compass className="size-3" />
            <span>Explore</span>
            <span className="mono-tabular text-[11px] text-muted-foreground">
              {payload.exploreOperations.length}
            </span>
          </button>
        </div>

        {activeTab === "operations" ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={includeArchived}
              onCheckedChange={onIncludeArchivedChange}
              aria-label="Show archived operations"
            />
            <span>Show archived</span>
          </label>
        ) : activeTab === "explore" ? (
          <Link
            href="/explore"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Open public directory
            <ArrowUpRight className="size-3" />
          </Link>
        ) : null}
      </div>

      {/* TAB 1: My Operations */}
      {activeTab === "operations" ? (
        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="operations-filter"
                name="q"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title, summary, or #tag…"
                aria-label="Filter operations"
                className="h-9 bg-card pl-8 text-xs md:h-8"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedDomain("all")}
                className={cn(
                  "h-8 rounded-md border px-2.5 text-xs transition-colors md:h-7",
                  selectedDomain === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                All domains
              </button>
              {OPERATION_DOMAINS.map((domain) => {
                const preset = getOperationDomainPreset(domain);
                const selected = selectedDomain === domain;
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => setSelectedDomain(domain)}
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-xs transition-colors md:h-7",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {preset.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredOperations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-5 py-10 text-center">
              <BookOpenCheck className="mx-auto size-7 text-muted-foreground/70" />
              <h2 className="mt-3 text-sm font-medium text-foreground">
                {payload.operations.length === 0
                  ? "Create your first Operation Blueprint"
                  : "No operations match these filters"}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {payload.operations.length === 0
                  ? "Capture any repeatable process — from a sourdough recipe or swim drill to a zero-downtime server deploy — with dynamic variables, step timers, and version history."
                  : "Try clearing your search or choosing another domain."}
              </p>

              {payload.operations.length === 0 ? (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {(
                    [
                      "cooking",
                      "tech",
                      "fitness",
                      "diy",
                      "business",
                      "study",
                    ] as const
                  ).map((domain) => {
                    const preset = getOperationDomainPreset(domain);
                    return (
                      <Button
                        key={domain}
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs md:h-7"
                      >
                        <Link href={`/app/operations/new?domain=${domain}`}>
                          + {preset.label}
                        </Link>
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredOperations.map((item) => {
                const { operation } = item;
                const preset = getOperationDomainPreset(operation.domain);
                return (
                  <article
                    key={operation.id}
                    className={cn(
                      "flex flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-foreground/25",
                      operation.isArchived && "opacity-70"
                    )}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px] font-medium",
                              preset.badgeClassName
                            )}
                          >
                            {preset.shortLabel}
                          </Badge>
                          <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            v{operation.currentVersion}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {operation.visibility === "public" ? (
                              <Globe className="size-2.5 text-done" />
                            ) : operation.visibility === "unlisted" ? (
                              <Link2 className="size-2.5 text-collab" />
                            ) : (
                              <Lock className="size-2.5" />
                            )}
                            <span className="capitalize">
                              {operation.visibility}
                            </span>
                          </span>
                          {item.staleness.isStale ? (
                            <span className="inline-flex items-center gap-1 rounded border border-overdue/40 bg-overdue/10 px-1.5 py-0.5 text-[10px] font-medium text-overdue">
                              <AlertTriangle className="size-2.5" />
                              Review due
                            </span>
                          ) : null}
                          {operation.isArchived ? (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              Archived
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {operation.forkCount > 0 ? (
                            <span className="mono-tabular inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <GitFork className="size-2.5" />
                              {operation.forkCount}
                            </span>
                          ) : null}
                          {item.activeRunsCount > 0 ? (
                            <span className="mono-tabular rounded border border-reminder/35 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
                              {item.activeRunsCount} active
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <Link
                          href={`/app/operations/${operation.id}`}
                          className="text-sm font-semibold tracking-tight text-foreground hover:text-reminder"
                        >
                          {operation.title}
                        </Link>
                        {operation.summary ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {operation.summary}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="mono-tabular">
                          {item.stepCount}{" "}
                          {item.stepCount === 1 ? "step" : "steps"}
                        </span>
                        {operation.estimatedMinutes ? (
                          <span className="mono-tabular inline-flex items-center gap-1">
                            <Clock className="size-3" />
                            {operation.estimatedMinutes}m
                          </span>
                        ) : null}
                        {operation.difficulty ? (
                          <span className="capitalize">
                            {operation.difficulty}
                          </span>
                        ) : null}
                        {item.projectName ? (
                          <span className="truncate text-collab">
                            {item.projectName}
                          </span>
                        ) : null}
                        {item.linkedHabitTitle ? (
                          <span className="inline-flex items-center gap-1 text-done">
                            <Repeat2 className="size-3" />
                            <span className="max-w-[140px] truncate">
                              {item.linkedHabitTitle}
                            </span>
                          </span>
                        ) : null}
                      </div>

                      {item.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                      <span className="mono-tabular text-[10px] text-muted-foreground">
                        Updated {formatShortDate(operation.updatedAt, timezone)}
                      </span>

                      <div className="flex items-center gap-1">
                        <Button
                          asChild
                          size="sm"
                          className="h-9 gap-1 px-2.5 text-xs md:h-7"
                        >
                          <Link
                            href={`/app/operations/${operation.id}?action=start`}
                          >
                            <Play className="size-3" />
                            Start Run
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1 px-2 text-xs md:h-7"
                        >
                          <Link href={`/app/operations/${operation.id}/edit`}>
                            <Pencil className="size-3" />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            handleToggleArchive(
                              operation.id,
                              !operation.isArchived
                            )
                          }
                          aria-label={
                            operation.isArchived
                              ? `Restore ${operation.title}`
                              : `Archive ${operation.title}`
                          }
                          className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground md:h-7"
                        >
                          {operation.isArchived ? (
                            <ArchiveRestore className="size-3.5" />
                          ) : (
                            <Archive className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === "runs" ? (
        /* TAB 2: Active Runs */
        <div className="space-y-6">
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              In Progress ({payload.activeRuns.length})
            </h2>
            {payload.activeRuns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-5 py-8 text-center">
                <p className="text-xs font-medium text-foreground">
                  No active runs right now
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open any Operation Blueprint and press Start Run to execute it
                  step by step.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {payload.activeRuns.map((entry) => {
                  const preset = getOperationDomainPreset(
                    entry.operationDomain
                  );
                  const completedUnits = entry.doneSteps + entry.skippedSteps;
                  const pct =
                    entry.totalSteps > 0
                      ? Math.round((completedUnits / entry.totalSteps) * 100)
                      : 0;
                  return (
                    <div
                      key={entry.run.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3.5 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px]",
                              preset.badgeClassName
                            )}
                          >
                            {preset.shortLabel}
                          </Badge>
                          <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            v{entry.versionNumber} pinned
                          </span>
                          {entry.blockedSteps > 0 ? (
                            <span className="mono-tabular rounded border border-overdue/40 bg-overdue/10 px-1.5 py-0.5 text-[10px] font-medium text-overdue">
                              {entry.blockedSteps} blocked
                            </span>
                          ) : null}
                        </div>

                        <p className="truncate text-sm font-medium text-foreground">
                          {entry.run.title}
                        </p>

                        <div className="flex items-center gap-3">
                          <div className="h-1.5 max-w-[180px] flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-reminder transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="mono-tabular text-[11px] text-muted-foreground">
                            {completedUnits}/{entry.totalSteps} steps · Started{" "}
                            {formatShortDate(entry.run.startedAt, timezone)}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          asChild
                          size="sm"
                          className="h-9 gap-1.5 px-3 text-xs md:h-7"
                        >
                          <Link href={`/app/operations/runs/${entry.run.id}`}>
                            <Play className="size-3" />
                            Resume
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleAbandonRun(entry.run.id)}
                          aria-label={`Abandon ${entry.run.title}`}
                          className="h-9 px-2 text-xs text-muted-foreground hover:text-overdue md:h-7"
                        >
                          <XCircle className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {payload.recentRuns.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent History ({payload.recentRuns.length})
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {payload.recentRuns.map((entry) => (
                  <div
                    key={entry.run.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                            entry.run.status === "completed"
                              ? "border-done/35 bg-done/10 text-done"
                              : "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          {entry.run.status}
                        </span>
                        <span className="mono-tabular text-[10px] text-muted-foreground">
                          v{entry.versionNumber}
                        </span>
                        <span className="truncate font-medium text-foreground">
                          {entry.run.title}
                        </span>
                      </div>
                      <p className="mono-tabular text-[11px] text-muted-foreground">
                        {entry.doneSteps}/{entry.totalSteps} done ·{" "}
                        {formatShortDate(
                          entry.run.completedAt ?? entry.run.updatedAt,
                          timezone
                        )}
                      </p>
                    </div>

                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1 px-2.5 text-xs md:h-7"
                    >
                      <Link href={`/app/operations/runs/${entry.run.id}`}>
                        <Eye className="size-3" />
                        View
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : activeTab === "shared" ? (
        /* TAB 3: Shared With Me + Pending In-App Invitations */
        <div className="space-y-6">
          {payload.pendingInvitations.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-reminder">
                <Mail className="size-3.5" />
                Pending Invitations ({payload.pendingInvitations.length})
              </h2>

              <div className="space-y-2">
                {payload.pendingInvitations.map((item) => {
                  const preset = getOperationDomainPreset(item.operationDomain);
                  return (
                    <div
                      key={item.invitation.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-reminder/40 bg-reminder/5 p-3.5 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px]",
                              preset.badgeClassName
                            )}
                          >
                            {preset.shortLabel}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="h-5 border-collab/40 px-1.5 text-[10px] capitalize text-collab"
                          >
                            {item.invitation.role}
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          {item.operationTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Invited by{" "}
                          <span className="font-medium text-foreground">
                            {item.inviterName}
                          </span>
                          {item.inviterHandle ? ` (@${item.inviterHandle})` : ""}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleAcceptInvite(item.invitation.id)}
                          className="h-9 gap-1 px-3 text-xs md:h-7"
                        >
                          <Check className="size-3.5" />
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            handleDeclineInvite(item.invitation.id)
                          }
                          className="h-9 gap-1 px-2.5 text-xs text-muted-foreground hover:text-overdue md:h-7"
                        >
                          <X className="size-3.5" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Shared Operations ({payload.sharedWithMe.length})
            </h2>

            {payload.sharedWithMe.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-5 py-10 text-center">
                <Users className="mx-auto size-7 text-muted-foreground/70" />
                <h3 className="mt-3 text-sm font-medium text-foreground">
                  Nothing shared with you yet
                </h3>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  When teammates invite you to private operations or share a
                  blueprint with your Shared Project team, it will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {payload.sharedWithMe.map((item) => {
                  const preset = getOperationDomainPreset(
                    item.operation.domain
                  );
                  return (
                    <article
                      key={item.operation.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-foreground/25"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px]",
                              preset.badgeClassName
                            )}
                          >
                            {preset.shortLabel}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px] capitalize",
                              item.role === "collaborator"
                                ? "border-collab/40 bg-collab/10 text-collab"
                                : "border-border text-muted-foreground"
                            )}
                          >
                            {item.role}
                          </Badge>
                          {item.accessSource === "project_inherited" ? (
                            <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <FolderKanban className="size-2.5 text-collab" />
                              Project Team
                            </span>
                          ) : null}
                        </div>

                        <div>
                          <Link
                            href={`/app/operations/${item.operation.id}`}
                            className="text-sm font-semibold tracking-tight text-foreground hover:text-reminder"
                          >
                            {item.operation.title}
                          </Link>
                          {item.operation.summary ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {item.operation.summary}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>
                            By{" "}
                            <strong className="font-medium text-foreground">
                              {item.ownerName}
                            </strong>
                            {item.ownerHandle ? ` (@${item.ownerHandle})` : ""}
                          </span>
                          <span className="mono-tabular">
                            v{item.operation.currentVersion} · {item.stepCount}{" "}
                            {item.stepCount === 1 ? "step" : "steps"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 border-t border-border/70 pt-2.5">
                        <Button
                          asChild
                          size="sm"
                          className="h-9 gap-1 px-2.5 text-xs md:h-7"
                        >
                          <Link
                            href={`/app/operations/${item.operation.id}?action=start`}
                          >
                            <Play className="size-3" />
                            Start Run
                          </Link>
                        </Button>
                        {item.role === "collaborator" ? (
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-9 gap-1 px-2.5 text-xs md:h-7"
                          >
                            <Link
                              href={`/app/operations/${item.operation.id}/edit`}
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* TAB 4: Public Explore Directory */
        <ExploreDirectoryView
          operations={payload.exploreOperations}
          embedded
        />
      )}
    </div>
  );
}
