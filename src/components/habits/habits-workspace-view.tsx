"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArchiveRestore,
  ArrowRightCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  ListChecks,
  Lock,
  LockOpen,
  Plus,
  Repeat2,
  Settings2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveHabitAction,
  carryOverHabitMonthRosterAction,
  lockHabitMonthAction,
  logHabitDayAction,
  setHabitMissReasonAction,
} from "@/actions/habits";
import { isFeatureEnabled } from "@/config/features";
import { HabitsMatrix } from "@/components/habits/habits-matrix";
import { SavedViewsControl } from "@/components/habits/saved-views-control";
import { useDetailSheet } from "@/components/shell/detail-sheet-context";
import { useWorkspaceUserId } from "@/components/shell/workspace-chrome-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceInvalidation } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type { SidebarProjectItem } from "@/server/dal/workspace-repository";
import type {
  HabitLogRecord,
  HabitLogStatus,
  HabitRecord,
} from "@/server/db/schema";
import {
  computeHabitMonthAnalytics,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
  shiftYearMonth,
  type HabitRankHighlight,
  type ScoringMode,
} from "@/server/domain/habit-analytics";
import type { MissReason } from "@/server/domain/habit-metadata";
import { filterHabitsForView } from "@/server/domain/habit-views";
import type { HabitMonthWorkspace } from "@/server/services/habit-service";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

const CreateHabitDialog = dynamic(
  () =>
    import("@/components/habits/create-habit-dialog").then(
      (mod) => mod.CreateHabitDialog
    ),
  { ssr: false }
);
const BulkImportHabitsDialog = dynamic(
  () =>
    import("@/components/habits/bulk-import-habits-dialog").then(
      (mod) => mod.BulkImportHabitsDialog
    ),
  { ssr: false }
);
const BulkImportHistoryDialog = dynamic(
  () =>
    import("@/components/habits/bulk-import-history-dialog").then(
      (mod) => mod.BulkImportHistoryDialog
    ),
  { ssr: false }
);
const ManageMonthRosterDialog = dynamic(
  () =>
    import("@/components/habits/manage-month-roster-dialog").then(
      (mod) => mod.ManageMonthRosterDialog
    ),
  { ssr: false }
);
const HabitSettingsSheet = dynamic(
  () =>
    import("@/components/habits/habit-settings-sheet").then(
      (mod) => mod.HabitSettingsSheet
    ),
  { ssr: false }
);
const MonthLockDialog = dynamic(
  () =>
    import("@/components/habits/month-lock-dialog").then(
      (mod) => mod.MonthLockDialog
    ),
  { ssr: false }
);

const HabitsAnalyticsCharts = dynamic(
  () =>
    import("@/components/habits/habits-analytics-charts").then(
      (mod) => mod.HabitsAnalyticsCharts
    ),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="Loading analytics charts"
        className="grid grid-cols-1 gap-3 lg:grid-cols-12"
      >
        <Skeleton className="h-[282px] rounded-md border border-border lg:col-span-7" />
        <Skeleton className="h-[282px] rounded-md border border-border lg:col-span-5" />
      </div>
    ),
  }
);

interface HabitsWorkspaceViewProps {
  workspace: HabitMonthWorkspace;
  projects: SidebarProjectItem[];
  timezone: string;
  initialModeOverride?: ScoringMode | null;
  isSwitchingMonth?: boolean;
  onSelectMonth?: (nextMonth: string) => void;
  onPrefetchMonth?: (yearMonth: string) => void;
}

type OptimisticLogAction = {
  habitId: string;
  userId: string;
  dateKey: string;
  status: HabitLogStatus | null;
  note?: string | null;
  preserveNote?: boolean;
};

function RankHighlightTitle({
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
                {highlight.tiedTitles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <span className={cn("mono-tabular shrink-0 text-sm font-semibold", accentClass)}>
        {Math.round(highlight.rate * 100)}%
      </span>
    </div>
  );
}

export function HabitsWorkspaceView({
  workspace,
  projects,
  timezone,
  initialModeOverride = null,
  isSwitchingMonth = false,
  onSelectMonth,
  onPrefetchMonth,
}: HabitsWorkspaceViewProps) {
  const router = useRouter();
  const { openDetail } = useDetailSheet();
  const userId = useWorkspaceUserId();
  const invalidate = useWorkspaceInvalidation(userId);
  const [, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterSession, setRosterSession] = useState(0);
  const [rosterInitialIds, setRosterInitialIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [isLockPending, startLockTransition] = useTransition();
  const showArchived = useWorkspaceUIStore((s) => s.habitsShowArchived);
  const setShowArchived = useWorkspaceUIStore((s) => s.setHabitsShowArchived);
  const storedScoringMode = useWorkspaceUIStore((s) => s.habitsScoringMode);
  const setStoredScoringMode = useWorkspaceUIStore(
    (s) => s.setHabitsScoringMode
  );
  const [modeTouched, setModeTouched] = useState(false);
  const savedViewsEnabled = isFeatureEnabled("savedViews");
  const missReasonEnabled = isFeatureEnabled("missReasonPrompt");
  const dayPageEnabled = isFeatureEnabled("dayPage");
  // Persist the user's selected view in React state (never useOptimistic, which
  // reverts as soon as the transition finishes). `workspace.savedViews` stays
  // canonical from TanStack Query invalidation.
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const savedViews = workspace.savedViews;
  const activeView = savedViewsEnabled
    ? savedViews.find(
        (view) => view.id === selectedViewId && !view.hidden
      ) ??
      savedViews.find((view) => !view.hidden) ??
      null
    : null;
  const activeViewId = activeView?.id ?? "";

  // Guarantee persisted scoring mode & archive prefs hydrate cleanly on direct SSR reloads
  useEffect(() => {
    if (!useWorkspaceUIStore.persist?.hasHydrated()) {
      void useWorkspaceUIStore.persist?.rehydrate();
    }
  }, []);

  const activeScoringMode: ScoringMode = modeTouched
    ? storedScoringMode
    : initialModeOverride ?? storedScoringMode;
  const pendingMutationCountRef = useRef(0);
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const optimisticDirty = pendingMutationCount > 0;

  const [optimisticLogsByKey, applyOptimisticLog] = useOptimistic<
    Record<string, HabitLogRecord>,
    OptimisticLogAction
  >(workspace.logsByKey, (state, action) => {
    const key = `${action.habitId}::${action.dateKey}`;
    if (action.status === null) {
      if (!(key in state)) return state;
      const next = { ...state };
      delete next[key];
      return next;
    }

    const existing = state[key];
    return {
      ...state,
      [key]: {
        id: existing?.id ?? `optimistic-${key}`,
        habitId: action.habitId,
        userId: action.userId,
        dateKey: action.dateKey,
        status: action.status,
        note: action.preserveNote
          ? existing?.note ?? null
          : action.note ?? null,
        missReason: action.preserveNote
          ? existing?.missReason ?? null
          : null,
        source: existing?.source ?? "manual",
        loggedAt: existing?.loggedAt ?? 0,
        isBackfilledLate: existing?.isBackfilledLate ?? false,
      },
    };
  });

  // Live optimistic & scoring-mode analytics so KPI cards, streaks, and Recharts respond at 0ms with zero server refetch
  const analytics = useMemo(() => {
    if (!optimisticDirty && activeScoringMode === workspace.scoringMode) {
      return workspace.analytics;
    }
    const recomputed = computeHabitMonthAnalytics({
      yearMonth: workspace.yearMonth,
      todayDateKey: workspace.todayDateKey,
      weekStartsOn: workspace.settings.weekStartsOn === 0 ? 0 : 1,
      scoringMode: activeScoringMode,
      habits: workspace.habits.map((h) => ({
        id: h.id,
        title: h.title,
        cadenceType: h.cadenceType,
        scheduledDays: parseScheduledDaysJson(h.scheduledDaysJson),
        weeklyTargetCount: h.weeklyTargetCount,
        startDate: h.startDate,
      })),
      logs: Object.values(optimisticLogsByKey),
    });

    // Streaks span across month boundaries and do not depend on scoringMode;
    // preserve authoritative multi-month streaks when only scoringMode changed.
    if (!optimisticDirty) {
      for (const [habitId, summary] of Object.entries(recomputed.byHabitId)) {
        const serverSummary = workspace.analytics.byHabitId[habitId];
        if (serverSummary) {
          summary.currentStreak = serverSummary.currentStreak;
          summary.bestStreak = serverSummary.bestStreak;
          summary.streakUnit = serverSummary.streakUnit;
        }
      }
    }

    return recomputed;
  }, [activeScoringMode, optimisticDirty, optimisticLogsByKey, workspace]);

  const savedViewContext = useMemo(() => {
    const rateByHabitId: Record<string, number | null> = {};
    const streakByHabitId: Record<string, number> = {};
    for (const [habitId, summary] of Object.entries(analytics.byHabitId)) {
      rateByHabitId[habitId] = summary.completionRate;
      streakByHabitId[habitId] = summary.currentStreak;
    }

    const missReasonByHabitId: Record<string, MissReason | null> = {};
    const todaySuffix = `::${workspace.todayDateKey}`;
    for (const [key, log] of Object.entries(optimisticLogsByKey)) {
      if (key.endsWith(todaySuffix)) {
        missReasonByHabitId[log.habitId] = log.missReason ?? null;
      }
    }

    const activeTodayIds = new Set(
      workspace.habits
        .filter((habit) =>
          isHabitScheduledOnDate(
            {
              cadenceType: habit.cadenceType,
              scheduledDays: parseScheduledDaysJson(habit.scheduledDaysJson),
              startDate: habit.startDate,
            },
            workspace.todayDateKey
          )
        )
        .map((habit) => habit.id)
    );

    return {
      rateByHabitId,
      streakByHabitId,
      missReasonByHabitId,
      activeTodayIds,
      weekday: new Date(`${workspace.todayDateKey}T12:00:00Z`).getUTCDay(),
    };
  }, [
    analytics.byHabitId,
    optimisticLogsByKey,
    workspace.habits,
    workspace.todayDateKey,
  ]);

  const matrixHabits = useMemo(
    () =>
      activeView
        ? filterHabitsForView(workspace.habits, activeView, savedViewContext)
        : workspace.habits,
    [activeView, savedViewContext, workspace.habits]
  );

  const currentMonth = workspace.todayDateKey.slice(0, 7);
  const isAtCurrentMonth = workspace.yearMonth >= currentMonth;

  const navigateMonth = (nextMonth: string) => {
    // Future months cannot be tracked until they begin
    const clampedMonth = nextMonth > currentMonth ? currentMonth : nextMonth;
    if (onSelectMonth) {
      onSelectMonth(clampedMonth);
      return;
    }
    const params = new URLSearchParams();
    params.set("month", clampedMonth);
    if (activeScoringMode !== "elapsed") {
      params.set("mode", activeScoringMode);
    }
    router.push(`/app/habits?${params.toString()}`);
  };

  const openManageMonthRoster = (presetIds?: string[]) => {
    setRosterInitialIds(presetIds ?? workspace.habits.map((h) => h.id));
    setRosterSession((n) => n + 1);
    setRosterOpen(true);
  };

  const handleCarryOverPreviousMonth = () => {
    if (!workspace.previousRosterSource) return;
    startTransition(async () => {
      const result = await carryOverHabitMonthRosterAction({
        targetYearMonth: workspace.yearMonth,
        sourceYearMonth: workspace.previousRosterSource!.yearMonth,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "sidebar"]);
      toast.success(
        `Carried over ${result.data.habitIds.length} habits from ${workspace.previousRosterSource!.monthLabel} into ${analytics.calendar.monthLabel}.`
      );
    });
  };

  const handleSelectScoringMode = (nextMode: ScoringMode) => {
    setModeTouched(true);
    setStoredScoringMode(nextMode);
  };

  const handleCycleLog = useCallback(
    (
      habit: HabitRecord,
      dateKey: string,
      nextStatus: HabitLogStatus | null
    ) => {
      pendingMutationCountRef.current += 1;
      setPendingMutationCount(pendingMutationCountRef.current);
      startTransition(async () => {
        try {
          applyOptimisticLog({
            habitId: habit.id,
            userId: habit.userId,
            dateKey,
            status: nextStatus,
            preserveNote: true,
          });

          const result = await logHabitDayAction({
            habitId: habit.id,
            dateKey,
            status: nextStatus,
            ...(missReasonEnabled ? { source: "button" as const } : {}),
          });

          if (!result.ok) {
            toast.error(result.error.message);
          } else {
            await invalidate(
              result.data.syncedTaskCount > 0
                ? ["habits", "today", "tasks", "sidebar"]
                : ["habits", "today"]
            );
          }
        } finally {
          pendingMutationCountRef.current = Math.max(
            0,
            pendingMutationCountRef.current - 1
          );
          setPendingMutationCount(pendingMutationCountRef.current);
        }
      });
    },
    [applyOptimisticLog, invalidate, missReasonEnabled]
  );

  const handleSaveCellDetail = useCallback(
    (
      habit: HabitRecord,
      dateKey: string,
      nextStatus: HabitLogStatus | null,
      nextNote: string | null
    ) => {
      pendingMutationCountRef.current += 1;
      setPendingMutationCount(pendingMutationCountRef.current);
      startTransition(async () => {
        try {
          applyOptimisticLog({
            habitId: habit.id,
            userId: habit.userId,
            dateKey,
            status: nextStatus,
            note: nextNote,
            preserveNote: false,
          });

          const result = await logHabitDayAction({
            habitId: habit.id,
            dateKey,
            status: nextStatus,
            note: nextNote,
            ...(missReasonEnabled ? { source: "button" as const } : {}),
          });

          if (!result.ok) {
            toast.error(result.error.message);
          } else {
            await invalidate(
              result.data.syncedTaskCount > 0
                ? ["habits", "today", "tasks", "sidebar"]
                : ["habits", "today"]
            );
          }
        } finally {
          pendingMutationCountRef.current = Math.max(
            0,
            pendingMutationCountRef.current - 1
          );
          setPendingMutationCount(pendingMutationCountRef.current);
        }
      });
    },
    [applyOptimisticLog, invalidate, missReasonEnabled]
  );

  const handleSetMissReason = useCallback(
    (input: { habitId: string; dateKey: string; reason: MissReason }) => {
      startTransition(async () => {
        const result = await setHabitMissReasonAction(input);
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        await invalidate(["habits", "today"]);
      });
    },
    [invalidate]
  );

  const handleRestoreArchived = (habit: HabitRecord) => {
    startTransition(async () => {
      const result = await archiveHabitAction({
        habitId: habit.id,
        isArchived: false,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "sidebar"]);
      toast.success(`Restored "${habit.title}".`);
    });
  };

  const handleLockMonth = () => {
    startLockTransition(async () => {
      const result = await lockHabitMonthAction({
        yearMonth: workspace.yearMonth,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "circle"]);
      toast.success(
        `${analytics.calendar.monthLabel} is now locked and view-only.`
      );
    });
  };

  const monthLock = workspace.monthLock;
  const isMonthLocked = monthLock.isLocked;

  const monthlyPct =
    analytics.monthlyProgress.rate !== null
      ? Math.round(analytics.monthlyProgress.rate * 100)
      : null;
  const monthlyHabitCount = Object.values(analytics.byHabitId).filter(
    (h) => h.completionRate !== null
  ).length;

  return (
    <div className="min-w-0 space-y-4">
      {createOpen ? (
        <CreateHabitDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          todayDateKey={workspace.todayDateKey}
          targetYearMonth={workspace.yearMonth}
          projects={projects}
        />
      ) : null}
      {bulkOpen ? (
        <BulkImportHabitsDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          targetYearMonth={workspace.yearMonth}
          onSwitchToHistoryImport={() => setHistoryOpen(true)}
        />
      ) : null}
      {historyOpen ? (
        <BulkImportHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          todayDateKey={workspace.todayDateKey}
        />
      ) : null}
      {rosterOpen ? (
        <ManageMonthRosterDialog
          key={`${workspace.yearMonth}-${rosterSession}`}
          open={rosterOpen}
          onOpenChange={setRosterOpen}
          yearMonth={workspace.yearMonth}
          monthLabel={analytics.calendar.monthLabel}
          allHabits={workspace.allHabits}
          initialSelectedIds={rosterInitialIds}
          previousRosterSource={workspace.previousRosterSource}
        />
      ) : null}
      {settingsOpen ? (
        <HabitSettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={workspace.settings}
          timezone={timezone}
        />
      ) : null}
      {unlockOpen ? (
        <MonthLockDialog
          open={unlockOpen}
          onOpenChange={setUnlockOpen}
          yearMonth={workspace.yearMonth}
          monthLabel={analytics.calendar.monthLabel}
          hasPin={workspace.settings.hasMonthLockPin}
          isAutoLocked={monthLock.phase === "locked_auto"}
        />
      ) : null}

      {/* Toolbar: Month Switcher, Scoring Mode Toggle, Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Month Switcher */}
          <div className="inline-flex items-center rounded-md border border-border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onMouseEnter={() =>
                onPrefetchMonth?.(shiftYearMonth(workspace.yearMonth, -1))
              }
              onFocus={() =>
                onPrefetchMonth?.(shiftYearMonth(workspace.yearMonth, -1))
              }
              onClick={() =>
                navigateMonth(shiftYearMonth(workspace.yearMonth, -1))
              }
              className="mira-icon-btn rounded-r-none text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span
              className={cn(
                "mono-tabular min-w-[126px] px-2 text-center text-xs font-semibold text-foreground transition-opacity",
                isSwitchingMonth && "opacity-50"
              )}
            >
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
              onFocus={() => {
                if (!isAtCurrentMonth) {
                  onPrefetchMonth?.(shiftYearMonth(workspace.yearMonth, 1));
                }
              }}
              onClick={() => {
                if (!isAtCurrentMonth) {
                  navigateMonth(shiftYearMonth(workspace.yearMonth, 1));
                }
              }}
              className="mira-icon-btn rounded-l-none text-muted-foreground hover:text-foreground disabled:opacity-35"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>

          {workspace.yearMonth !== currentMonth ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onMouseEnter={() => onPrefetchMonth?.(currentMonth)}
              onClick={() => navigateMonth(currentMonth)}
              className="mira-row border-border bg-card px-2.5 text-xs"
            >
              This month
            </Button>
          ) : null}

          {/* Elapsed-to-Date vs Full Month Scoring Toggle (0ms pure client recomputation) */}
          <div
            role="group"
            aria-label="Scoring denominator mode"
            className="inline-flex rounded-md border border-border bg-card p-0.5"
          >
            <button
              type="button"
              onClick={() => handleSelectScoringMode("elapsed")}
              aria-pressed={activeScoringMode === "elapsed"}
              className={cn(
                "min-h-9 rounded px-2.5 text-xs font-medium transition-colors md:min-h-6",
                activeScoringMode === "elapsed"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Elapsed-to-Date
            </button>
            <button
              type="button"
              onClick={() => handleSelectScoringMode("full_month")}
              aria-pressed={activeScoringMode === "full_month"}
              className={cn(
                "min-h-9 rounded px-2.5 text-xs font-medium transition-colors md:min-h-6",
                activeScoringMode === "full_month"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Full Month
            </button>
          </div>

          {savedViewsEnabled && savedViews.length > 0 ? (
            <SavedViewsControl
              views={savedViews}
              activeViewId={activeViewId}
              onSelect={setSelectedViewId}
            />
          ) : null}
        </div>

        {/* Right Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {workspace.allHabits.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isMonthLocked}
              title={
                isMonthLocked
                  ? "Unlock this month to edit its tracked habits"
                  : undefined
              }
              onClick={() => openManageMonthRoster()}
              className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
            >
              <ListChecks className="size-3.5 text-done" aria-hidden="true" />
              Month habits
              <span className="mono-tabular text-[10px] text-muted-foreground">
                ({workspace.habits.length})
              </span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isMonthLocked}
            title={
              isMonthLocked
                ? "Unlock this month to bulk import habits into it"
                : undefined
            }
            onClick={() => setBulkOpen(true)}
            className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
          >
            <Upload className="size-3.5" />
            Bulk Import
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
          >
            <FileSpreadsheet className="size-3.5" />
            Import History
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="mira-row gap-1.5 border-border bg-card px-2.5 text-xs"
          >
            <Settings2 className="size-3.5" />
            Settings
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isMonthLocked}
            title={
              isMonthLocked
                ? "Unlock this month to add new habits into it"
                : undefined
            }
            onClick={() => setCreateOpen(true)}
            className="mira-row gap-1.5 px-3 text-xs"
          >
            <Plus className="size-3.5" />
            New Habit
          </Button>
        </div>
      </div>

      {/* Month Lock Status Strip (closing_today / grace_open / locked / unlocked_temp / open past) */}
      {monthLock.phase !== "open" || monthLock.canLockNow ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center justify-between gap-2.5 rounded-md border px-3.5 py-2 text-xs",
            monthLock.isLocked
              ? "border-border bg-muted/45 text-foreground"
              : monthLock.phase === "unlocked_temp"
                ? "border-reminder/40 bg-reminder/10 text-foreground"
                : "border-border bg-card text-foreground"
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {monthLock.isLocked ? (
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : monthLock.phase === "unlocked_temp" ? (
              <LockOpen className="size-3.5 shrink-0 text-reminder" aria-hidden="true" />
            ) : (
              <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}

            <span className="font-medium">
              {monthLock.phase === "locked_manual"
                ? `${analytics.calendar.monthLabel} is locked (view-only)`
                : monthLock.phase === "locked_auto"
                  ? `${analytics.calendar.monthLabel} auto-locked (view-only)`
                  : monthLock.phase === "unlocked_temp"
                    ? `${analytics.calendar.monthLabel} temporarily unlocked · auto-relocks in ~${monthLock.remainingUnlockMinutes ?? 30}m`
                    : monthLock.phase === "grace_open"
                      ? `Grace window open · auto-locks in ${monthLock.graceDaysRemaining} day${monthLock.graceDaysRemaining === 1 ? "" : "s"}`
                      : monthLock.phase === "closing_today"
                        ? `${analytics.calendar.monthLabel} ends today — ready to close out`
                        : `${analytics.calendar.monthLabel} is completed and open`}
            </span>

            {monthLock.phase === "locked_auto" && monthLock.graceEndDateKey ? (
              <span className="mono-tabular text-[11px] text-muted-foreground">
                · Closed after {monthLock.graceEndDateKey}
              </span>
            ) : null}

            {monthLock.phase === "grace_open" && monthLock.graceEndDateKey ? (
              <span className="mono-tabular text-[11px] text-muted-foreground">
                · Editable through {monthLock.graceEndDateKey}
              </span>
            ) : null}

            {monthLock.hasBeenUnlocked ? (
              <Badge
                variant="outline"
                className="mono-tabular h-5 border-border bg-background px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                Unlocked {monthLock.unlockCount}×
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {monthLock.canUnlock ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setUnlockOpen(true)}
                className="h-7 gap-1.5 border-border bg-card px-2.5 text-xs"
              >
                <LockOpen className="size-3" aria-hidden="true" />
                Unlock
              </Button>
            ) : null}
            {monthLock.canLockNow ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isLockPending}
                onClick={handleLockMonth}
                className="h-7 gap-1.5 border-border bg-card px-2.5 text-xs"
              >
                <Lock className="size-3" aria-hidden="true" />
                {monthLock.phase === "unlocked_temp"
                  ? "Re-lock now"
                  : "Lock month"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 3 Compact Mira KPI Cards */}
      <section
        aria-label="Monthly habit summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {/* KPI 1: Monthly Progress */}
        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Monthly Progress
            </span>
            <span className="mono-tabular text-[11px] text-muted-foreground">
              {activeScoringMode === "elapsed" ? "Elapsed" : "Full month"}
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

        {/* KPI 2: Best Habit */}
        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Best Habit
            </span>
            <TrendingUp className="size-3.5 text-done" />
          </div>
          {analytics.bestHabit ? (
            <>
              <RankHighlightTitle
                highlight={analytics.bestHabit}
                accentClass="text-done"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Qualifying habits with ≥3 elapsed scheduled days
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                Not enough data yet
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Appears after ≥3 elapsed scheduled days.
              </p>
            </>
          )}
        </div>

        {/* KPI 3: Needs Attention */}
        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Needs Attention
            </span>
            <AlertCircle className="size-3.5 text-overdue" />
          </div>
          {analytics.needsAttention ? (
            <>
              <RankHighlightTitle
                highlight={analytics.needsAttention}
                accentClass="text-overdue"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lowest rate among qualifying active habits
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                {analytics.bestHabit ? "Evenly matched" : "No alerts yet"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {analytics.bestHabit
                  ? "All qualifying habits are currently tied."
                  : "Requires 2+ habits with ≥3 elapsed days."}
              </p>
            </>
          )}
        </div>
      </section>

      {/* Main Content: Empty State / Carry-Over Prompt OR Matrix + Analytics Charts */}
      {workspace.habits.length === 0 ? (
        workspace.previousRosterSource ? (
          <div className="rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border bg-background text-done">
              <ArrowRightCircle className="size-4" aria-hidden="true" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">
              Set up {analytics.calendar.monthLabel} habits
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {workspace.previousRosterSource.monthLabel} had{" "}
              <span className="mono-tabular font-medium text-foreground">
                {workspace.previousRosterSource.habitIds.length}
              </span>{" "}
              tracked habits. Carry them into {analytics.calendar.monthLabel} as
              is, customize the list for this month, or import historical data.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isMonthLocked}
                onClick={handleCarryOverPreviousMonth}
                className="mira-row gap-1.5 px-3.5 text-xs"
              >
                <ArrowRightCircle className="size-3.5" aria-hidden="true" />
                Carry over {workspace.previousRosterSource.habitIds.length} from{" "}
                {workspace.previousRosterSource.monthLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isMonthLocked}
                onClick={() =>
                  openManageMonthRoster(
                    workspace.previousRosterSource!.habitIds
                  )
                }
                className="mira-row gap-1.5 px-3 text-xs"
              >
                <ListChecks className="size-3.5" aria-hidden="true" />
                Customize from previous month
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isMonthLocked}
                onClick={() => setCreateOpen(true)}
                className="mira-row gap-1.5 px-3 text-xs"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New habit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                className="mira-row gap-1.5 px-3 text-xs"
              >
                <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                Import history
              </Button>
            </div>
          </div>
        ) : (
        <div className="rounded-md border border-dashed border-border bg-card px-6 py-12 text-center">
          <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border bg-background text-done">
            <Repeat2 className="size-4" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-foreground">
            Build your habit ledger
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Track daily routines, weekday cadences, or weekly targets across a
            real calendar with honest elapsed-to-date scoring and bidirectional
            task linking.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="mira-row gap-1.5 px-3.5 text-xs"
            >
              <Plus className="size-3.5" />
              Create first habit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="mira-row gap-1.5 px-3 text-xs"
            >
              <Upload className="size-3.5" />
              Bulk import CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="mira-row gap-1.5 px-3 text-xs"
            >
              <FileSpreadsheet className="size-3.5" />
              Import completion history
            </Button>
          </div>
        </div>
        )
      ) : (
        <>
          {activeView && matrixHabits.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card px-6 py-8 text-center">
              <p className="text-sm font-medium text-foreground">
                No habits match “{activeView.name}”
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick another saved view, or adjust habit metadata from the habit
                inspector.
              </p>
            </div>
          ) : (
            <HabitsMatrix
              calendar={analytics.calendar}
              todayDateKey={workspace.todayDateKey}
              habits={matrixHabits}
              logsByKey={optimisticLogsByKey}
              linkedTaskByKey={workspace.linkedTaskByKey}
              summaryByHabitId={analytics.byHabitId}
              readOnly={isMonthLocked}
              onCycleLog={handleCycleLog}
              onSaveCellDetail={handleSaveCellDetail}
              missReasonPromptEnabled={missReasonEnabled}
              onSetMissReason={handleSetMissReason}
              onOpenDay={
                dayPageEnabled
                  ? (dateKey) => router.push(`/app/day/${dateKey}`)
                  : undefined
              }
              onInspectHabit={(habit) =>
                openDetail({
                  kind: "habit",
                  data: {
                    habit,
                    summary: analytics.byHabitId[habit.id] ?? null,
                    projects,
                  },
                })
              }
            />
          )}

          <HabitsAnalyticsCharts
            monthLabel={analytics.calendar.monthLabel}
            dailySeries={analytics.dailySeries}
            weeklySeries={analytics.weeklySeries}
          />
        </>
      )}

      {/* Optional Archived Habits Drawer */}
      {workspace.archivedHabits.length > 0 ? (
        <div className="rounded-md border border-border bg-card">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            aria-expanded={showArchived}
            className="flex min-h-9 w-full items-center justify-between px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span>
              Archived habits ({workspace.archivedHabits.length})
            </span>
            <span className="text-[11px]">
              {showArchived ? "Hide" : "Show"}
            </span>
          </button>

          {showArchived ? (
            <div className="divide-y divide-border border-t border-border">
              {workspace.archivedHabits.map((habit) => (
                <div
                  key={habit.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-muted-foreground">
                      {habit.title}
                    </p>
                    <p className="mono-tabular text-[10px] text-muted-foreground">
                      Started {habit.startDate}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => handleRestoreArchived(habit)}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <ArchiveRestore className="size-3" />
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
