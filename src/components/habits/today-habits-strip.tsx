"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Flame,
  Minus,
  Repeat2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { logHabitDayAction } from "@/actions/habits";
import { isFeatureEnabled } from "@/config/features";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type { HabitLogStatus } from "@/server/db/schema";
import {
  BUILT_IN_VIEWS,
  filterHabitsForView,
  type HabitSavedView,
} from "@/server/domain/habit-views";
import type { TodayHabitStripItem } from "@/server/services/habit-service";

interface TodayHabitsStripProps {
  todayDateKey: string;
  initialItems: TodayHabitStripItem[];
}

export function TodayHabitsStrip({
  todayDateKey,
  initialItems,
}: TodayHabitsStripProps) {
  const [expanded, setExpanded] = useState(true);
  const [lowEnergyOnly, setLowEnergyOnly] = useState(false);
  const invalidate = useInvalidateWorkspace();
  const [, startTransition] = useTransition();
  const missReasonEnabled = isFeatureEnabled("missReasonPrompt");

  const lowEnergyView = useMemo<HabitSavedView | null>(() => {
    if (!isFeatureEnabled("savedViews")) return null;
    const seed = BUILT_IN_VIEWS.find((view) => view.slug === "low-energy-day");
    if (!seed) return null;
    return {
      id: `builtin:low-energy-day`,
      name: seed.name,
      kind: seed.kind,
      builtIn: true,
      hidden: false,
      order: 0,
      filter: seed.filter,
      groupBy: seed.groupBy,
      sortBy: seed.sortBy,
      updatedAt: 0,
    };
  }, []);

  const [optimisticItems, applyOptimistic] = useOptimistic<
    TodayHabitStripItem[],
    { habitId: string; status: HabitLogStatus | null }
  >(initialItems, (state, action) =>
    state.map((item) => {
      if (item.habit.id !== action.habitId) return item;
      if (action.status === null) {
        return { ...item, log: null };
      }
      return {
        ...item,
        log: item.log
          ? { ...item.log, status: action.status }
          : {
              id: `optimistic-${action.habitId}`,
              habitId: action.habitId,
              userId: item.habit.userId,
              dateKey: todayDateKey,
              status: action.status,
              note: null,
              missReason: null,
              source: "manual",
              loggedAt: 0,
              isBackfilledLate: false,
            },
      };
    })
  );

  const baseVisibleItems = optimisticItems.filter(
    (item) => item.scheduledToday || item.log !== null
  );
  const lowEnergyIds =
    lowEnergyView && lowEnergyOnly
      ? new Set(
          filterHabitsForView(
            baseVisibleItems.map((item) => item.habit),
            lowEnergyView
          ).map((habit) => habit.id)
        )
      : null;
  const visibleItems = lowEnergyIds
    ? baseVisibleItems.filter((item) => lowEnergyIds.has(item.habit.id))
    : baseVisibleItems;

  if (baseVisibleItems.length === 0) {
    return null;
  }

  const doneCount = visibleItems.filter((i) => i.log?.status === "done").length;
  const skippedCount = visibleItems.filter(
    (i) => i.log?.status === "skipped"
  ).length;
  const targetCount = Math.max(0, visibleItems.length - skippedCount);

  const handleToggleStatus = (
    item: TodayHabitStripItem,
    nextStatus: HabitLogStatus
  ) => {
    const resolved: HabitLogStatus | null =
      item.log?.status === nextStatus ? null : nextStatus;

    startTransition(async () => {
      applyOptimistic({ habitId: item.habit.id, status: resolved });
      const result = await logHabitDayAction({
        habitId: item.habit.id,
        dateKey: todayDateKey,
        status: resolved,
        ...(missReasonEnabled ? { source: "button" as const } : {}),
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "tasks", "sidebar"]);
    });
  };

  return (
    <section
      aria-label="Today's habits check-in"
      className="mb-4 rounded-md border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="inline-flex min-h-9 items-center gap-1.5 text-left text-xs font-medium text-foreground md:min-h-7"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <Repeat2 className="size-3.5 text-done" />
          <span>Today&apos;s Habits</span>
          <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {doneCount}/{targetCount}
          </span>
        </button>

        <div className="flex items-center gap-1">
          {lowEnergyView ? (
            <button
              type="button"
              onClick={() => setLowEnergyOnly((value) => !value)}
              aria-pressed={lowEnergyOnly}
              title="Show only low-energy habits"
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors md:min-h-7",
                lowEnergyOnly
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="size-3" />
              Low-energy day
            </button>
          ) : null}
          <Link
            href="/app/habits"
            className="inline-flex min-h-9 items-center px-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline md:min-h-6"
          >
            Matrix →
          </Link>
        </div>
      </div>

      {expanded ? (
        visibleItems.length === 0 ? (
          <p className="border-t border-border px-3 py-2.5 text-[11px] text-muted-foreground">
            No low-energy habits scheduled today. Tap “Low-energy day” again to
            show everything.
          </p>
        ) : (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2.5">
          {visibleItems.map((item) => {
            const status = item.log?.status ?? null;
            const isDone = status === "done";
            const isSkipped = status === "skipped";

            return (
              <div
                key={item.habit.id}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors md:min-h-7",
                  isDone
                    ? "border-done/45 bg-done/10 text-foreground"
                    : isSkipped
                      ? "border-border bg-muted/60 text-muted-foreground"
                      : "border-border bg-background text-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleToggleStatus(item, "done")}
                  aria-label={
                    isDone
                      ? `Unmark ${item.habit.title} done`
                      : `Mark ${item.habit.title} done`
                  }
                  aria-pressed={isDone}
                  className="inline-flex min-h-9 items-center gap-1.5 py-1 md:min-h-7"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                      isDone
                        ? "border-done bg-done text-primary-foreground"
                        : "border-border bg-card text-transparent"
                    )}
                  >
                    <Check className="size-2.5 stroke-[2.5]" />
                  </span>
                  <span
                    className={cn(
                      "max-w-[180px] truncate",
                      isDone && "line-through opacity-80",
                      isSkipped && "line-through opacity-65"
                    )}
                  >
                    {item.habit.title}
                  </span>
                </button>

                {item.currentStreak > 0 ? (
                  <span className="mono-tabular inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Flame className="size-2.5 text-reminder" />
                    {item.currentStreak}
                    {item.streakUnit === "weeks" ? "w" : "d"}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => handleToggleStatus(item, "skipped")}
                  aria-label={
                    isSkipped
                      ? `Clear skip for ${item.habit.title}`
                      : `Skip ${item.habit.title} today`
                  }
                  title={isSkipped ? "Skipped (click to clear)" : "Skip today"}
                  aria-pressed={isSkipped}
                  className={cn(
                    "ml-0.5 flex size-9 items-center justify-center rounded border transition-colors md:size-5",
                    isSkipped
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Minus className="size-2.5" />
                </button>
              </div>
            );
          })}
        </div>
        )
      ) : null}
    </section>
  );
}
