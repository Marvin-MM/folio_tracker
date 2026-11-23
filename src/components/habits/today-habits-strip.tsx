"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Flame,
  Minus,
  Repeat2,
} from "lucide-react";
import { toast } from "sonner";
import { logHabitDayAction } from "@/actions/habits";
import { cn } from "@/lib/utils";
import type { HabitLogStatus } from "@/server/db/schema";
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
  const [, startTransition] = useTransition();

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
              loggedAt: 0,
              isBackfilledLate: false,
            },
      };
    })
  );

  const visibleItems = optimisticItems.filter(
    (item) => item.scheduledToday || item.log !== null
  );

  if (visibleItems.length === 0) {
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
      });

      if (!result.ok) {
        toast.error(result.error.message);
      }
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

        <Link
          href="/app/habits"
          className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Matrix →
        </Link>
      </div>

      {expanded ? (
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
                    "ml-0.5 flex size-6 items-center justify-center rounded border transition-colors md:size-5",
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
      ) : null}
    </section>
  );
}
