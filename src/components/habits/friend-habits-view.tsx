"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  TrendingUp,
} from "lucide-react";
import { HabitReviewPanel } from "@/components/habits/habit-review-panel";
import { HabitsMatrix } from "@/components/habits/habits-matrix";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ScopedFriendWorkspace } from "@/server/dal/habits-social";
import {
  computeHabitMonthAnalytics,
  parseScheduledDaysJson,
  shiftYearMonth,
  type HabitRankHighlight,
  type ScoringMode,
} from "@/server/domain/habit-analytics";

const HabitsAnalyticsCharts = dynamic(
  () =>
    import("@/components/habits/habits-analytics-charts").then(
      (mod) => mod.HabitsAnalyticsCharts
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Skeleton className="h-[282px] rounded-md border border-border lg:col-span-7" />
        <Skeleton className="h-[282px] rounded-md border border-border lg:col-span-5" />
      </div>
    ),
  }
);

interface FriendHabitsViewProps {
  currentUserId: string;
  workspace: ScopedFriendWorkspace;
  initialModeOverride?: ScoringMode | null;
  onSelectMonth?: (nextMonth: string) => void;
  onSelectCycle?: (nextCycle: string) => void;
  onPrefetchMonth?: (yearMonth: string) => void;
}

function FriendRankHighlight({
  highlight,
  accentClass,
}: {
  highlight: HabitRankHighlight;
  accentClass: string;
}) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-semibold text-foreground">
          {highlight.primaryTitle}
        </span>
        {highlight.tieCount > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="mono-tabular h-4 shrink-0 cursor-default border-border px-1 text-[10px] font-medium text-muted-foreground"
              >
                +{highlight.tieCount} more
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <p className="font-medium">
                Tied at {Math.round(highlight.rate * 100)}%:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {highlight.tiedTitles.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <span
        className={cn(
          "mono-tabular shrink-0 text-sm font-semibold",
          accentClass
        )}
      >
        {Math.round(highlight.rate * 100)}%
      </span>
    </div>
  );
}

export function FriendHabitsView({
  currentUserId,
  workspace,
  initialModeOverride = null,
  onSelectMonth,
  onSelectCycle,
  onPrefetchMonth,
}: FriendHabitsViewProps) {
  const router = useRouter();
  const { owner, windowState } = workspace;
  const [scoringMode, setScoringMode] = useState<ScoringMode>(
    initialModeOverride ?? workspace.scoringMode
  );

  const analytics = useMemo(() => {
    if (scoringMode === workspace.scoringMode) {
      return workspace.analytics;
    }
    return computeHabitMonthAnalytics({
      yearMonth: workspace.yearMonth,
      todayDateKey: workspace.todayDateKey,
      weekStartsOn:
        workspace.analytics.calendar.weeks[1]?.days[0]?.dayOfWeek === 0 ? 0 : 1,
      scoringMode,
      habits: workspace.habits.map((h) => ({
        id: h.id,
        title: h.title,
        cadenceType: h.cadenceType,
        scheduledDays: parseScheduledDaysJson(h.scheduledDaysJson),
        weeklyTargetCount: h.weeklyTargetCount,
        startDate: h.startDate,
      })),
      logs: Object.values(workspace.logsByKey),
    });
  }, [scoringMode, workspace]);

  const currentMonth = workspace.todayDateKey.slice(0, 7);
  const isAtCurrentMonth = workspace.yearMonth >= currentMonth;

  const navigate = (opts: {
    month?: string;
    mode?: ScoringMode;
    cycle?: string;
  }) => {
    if (opts.mode) {
      setScoringMode(opts.mode);
      return;
    }
    if (opts.month) {
      const clamped = opts.month > currentMonth ? currentMonth : opts.month;
      if (onSelectMonth) {
        onSelectMonth(clamped);
        return;
      }
      opts = { ...opts, month: clamped };
    }
    if (opts.cycle && onSelectCycle) {
      onSelectCycle(opts.cycle);
      return;
    }
    const params = new URLSearchParams();
    const nextMonth = opts.month ?? workspace.yearMonth;
    const nextCycle = opts.cycle ?? workspace.activeCycleKey;
    params.set("month", nextMonth);
    if (scoringMode !== "elapsed") params.set("mode", scoringMode);
    if (nextCycle !== windowState.cycleKey) params.set("cycle", nextCycle);
    router.push(`/app/habits/circle/${owner.id}?${params.toString()}`);
  };

  const monthlyPct =
    analytics.monthlyProgress.rate !== null
      ? Math.round(analytics.monthlyProgress.rate * 100)
      : null;
  const monthlyHabitCount = Object.values(analytics.byHabitId).filter(
    (h) => h.completionRate !== null
  ).length;

  return (
    <div className="min-w-0 space-y-4">
      {/* Friend Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Back to Circle"
            className="mira-icon-btn shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Link href="/app/habits/circle">
              <ArrowLeft className="size-3.5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {owner.name}&apos;s Habit Ledger
              </h2>
              <Badge
                variant="outline"
                className="h-5 gap-1 border-border px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                <Eye className="size-2.5" />
                Read-only ·{" "}
                {workspace.monitor.scope === "all"
                  ? "All habits"
                  : `${workspace.habits.length} shared`}
              </Badge>
            </div>
            <p className="mono-tabular mt-0.5 text-[11px] text-muted-foreground">
              Owner timezone: {owner.timezone}
            </p>
          </div>
        </div>

        <span
          className={cn(
            "mono-tabular inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium",
            windowState.isOpen
              ? "border-done/40 bg-done/10 text-done"
              : "border-border bg-muted text-muted-foreground"
          )}
        >
          {windowState.isOpen ? null : <Lock className="size-3" />}
          {windowState.summary}
        </span>
      </div>

      {/* Month Switcher & Scoring Mode */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-md border border-border bg-card">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onMouseEnter={() =>
              onPrefetchMonth?.(shiftYearMonth(workspace.yearMonth, -1))
            }
            onClick={() =>
              navigate({ month: shiftYearMonth(workspace.yearMonth, -1) })
            }
            className="mira-icon-btn rounded-r-none text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="mono-tabular min-w-[126px] px-2 text-center text-xs font-semibold text-foreground">
            {analytics.calendar.monthLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isAtCurrentMonth}
            aria-label={
              isAtCurrentMonth
                ? "Future months unlock when they begin"
                : "Next month"
            }
            title={
              isAtCurrentMonth
                ? "Future months unlock when they begin"
                : "Next month"
            }
            onMouseEnter={() => {
              if (!isAtCurrentMonth) {
                onPrefetchMonth?.(shiftYearMonth(workspace.yearMonth, 1));
              }
            }}
            onClick={() => {
              if (!isAtCurrentMonth) {
                navigate({ month: shiftYearMonth(workspace.yearMonth, 1) });
              }
            }}
            className="mira-icon-btn rounded-l-none text-muted-foreground hover:text-foreground disabled:opacity-35"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>

        <div
          role="group"
          aria-label="Scoring denominator mode"
          className="inline-flex rounded-md border border-border bg-card p-0.5"
        >
          <button
            type="button"
            onClick={() => navigate({ mode: "elapsed" })}
            aria-pressed={scoringMode === "elapsed"}
            className={cn(
              "min-h-9 rounded px-2.5 text-xs font-medium transition-colors md:min-h-6",
              scoringMode === "elapsed"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Elapsed-to-Date
          </button>
          <button
            type="button"
            onClick={() => navigate({ mode: "full_month" })}
            aria-pressed={scoringMode === "full_month"}
            className={cn(
              "min-h-9 rounded px-2.5 text-xs font-medium transition-colors md:min-h-6",
              scoringMode === "full_month"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Full Month
          </button>
        </div>
      </div>

      {/* 3 Compact Scoped KPI Cards */}
      <section
        aria-label="Scoped habit summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Monthly Progress
            </span>
            <span className="mono-tabular text-[11px] text-muted-foreground">
              {scoringMode === "elapsed" ? "Elapsed" : "Full month"}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="mono-tabular text-xl font-semibold tracking-tight text-foreground">
              {monthlyPct !== null ? `${monthlyPct}%` : "—"}
            </span>
            <span className="mono-tabular text-xs text-muted-foreground">
              {monthlyHabitCount > 0
                ? `avg across ${monthlyHabitCount} habit${monthlyHabitCount === 1 ? "" : "s"}`
                : "No scored habits yet"}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-done transition-all"
              style={{ width: `${monthlyPct ?? 0}%` }}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Best Shared Habit
            </span>
            <TrendingUp className="size-3.5 text-done" />
          </div>
          {analytics.bestHabit ? (
            <FriendRankHighlight
              highlight={analytics.bestHabit}
              accentClass="text-done"
            />
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Needs ≥3 elapsed scheduled days.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Needs Attention
            </span>
            <AlertCircle className="size-3.5 text-overdue" />
          </div>
          {analytics.needsAttention ? (
            <FriendRankHighlight
              highlight={analytics.needsAttention}
              accentClass="text-overdue"
            />
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {analytics.bestHabit
                ? "Shared habits are evenly matched."
                : "No alerts yet."}
            </p>
          )}
        </div>
      </section>

      {/* Read-Only Matrix & Scoped Charts */}
      {workspace.habits.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card px-6 py-10 text-center text-xs text-muted-foreground">
          {owner.name} hasn&apos;t shared any active habits in this scope yet.
        </div>
      ) : (
        <>
          <HabitsMatrix
            calendar={analytics.calendar}
            todayDateKey={workspace.todayDateKey}
            habits={workspace.habits}
            logsByKey={workspace.logsByKey}
            summaryByHabitId={analytics.byHabitId}
            readOnly
          />

          <HabitsAnalyticsCharts
            monthLabel={analytics.calendar.monthLabel}
            dailySeries={analytics.dailySeries}
            weeklySeries={analytics.weeklySeries}
          />
        </>
      )}

      {/* Cycle Review Panel (Open Composer OR Locked Banner + Monochrome Reactions) */}
      <HabitReviewPanel
        ownerId={owner.id}
        ownerName={owner.name}
        ownerTimezone={owner.timezone}
        currentUserId={currentUserId}
        isOwner={false}
        windowState={windowState}
        activeCycleKey={workspace.activeCycleKey}
        availableCycleKeys={workspace.availableCycleKeys}
        onSelectCycle={(cycle) => navigate({ cycle })}
        scopedHabits={workspace.habits}
        comments={workspace.comments}
        reactions={workspace.reactions}
      />
    </div>
  );
}
