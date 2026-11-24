"use client";

import { useEffect, useRef, useState, useTransition, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Moon,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  logHabitDayAction,
  saveDayEntryAction,
  setHabitMissReasonAction,
} from "@/actions/habits";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type { HabitLogStatus, HabitMissReason } from "@/server/db/schema";
import type { DayWorkspace } from "@/server/services/habit-service";

const MISS_REASON_LABELS: Record<HabitMissReason, string> = {
  tired: "Tired",
  work: "Work",
  travel: "Travel",
  forgot: "Forgot",
  sick: "Sick",
  low_motivation: "Low drive",
  other: "Other",
};

const SECTION_CLASS = "rounded-md border border-border bg-card px-3 py-3";
const BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 md:min-h-7";

function formatDateLabel(dateKey: string): string {
  try {
    return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateKey;
  }
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

type EntryPatch = Parameters<typeof saveDayEntryAction>[0];

export function DayPageClient({
  initialWorkspace,
}: {
  initialWorkspace: DayWorkspace;
}) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [, startTransition] = useTransition();
  const workspace = initialWorkspace;
  const [items, setItems] = useState(workspace.checklist);
  const [energy, setEnergy] = useState(workspace.dayEntry?.energy ?? 5);
  const [sleepHours, setSleepHours] = useState(
    workspace.dayEntry?.sleepHours === null ||
      workspace.dayEntry?.sleepHours === undefined
      ? ""
      : String(workspace.dayEntry.sleepHours)
  );
  const [note, setNote] = useState(workspace.dayEntry?.note ?? "");
  const [journalText, setJournalText] = useState(
    workspace.dayEntry?.journalText ?? ""
  );
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setItems(workspace.checklist);
  }, [workspace.checklist]);

  const refresh = async () => {
    await invalidate(["habits", "today"]);
    router.refresh();
  };

  const saveEntry = (patch: EntryPatch) => {
    startTransition(async () => {
      const result = await saveDayEntryAction(patch);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Day saved");
      await refresh();
    });
  };

  const toggleStatus = (
    habitId: string,
    currentStatus: HabitLogStatus | null,
    nextStatus: HabitLogStatus
  ) => {
    const resolved: HabitLogStatus | null =
      currentStatus === nextStatus ? null : nextStatus;
    setItems((previous) =>
      previous.map((item) =>
        item.habit.id === habitId
          ? {
              ...item,
              status: resolved,
              log:
                resolved && item.log
                  ? { ...item.log, status: resolved }
                  : null,
            }
          : item
      )
    );
    startTransition(async () => {
      const result = await logHabitDayAction({
        habitId,
        dateKey: workspace.dateKey,
        status: resolved,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await refresh();
    });
  };

  const saveReason = (habitId: string, reason: HabitMissReason | null) => {
    startTransition(async () => {
      const result = await setHabitMissReasonAction({
        habitId,
        dateKey: workspace.dateKey,
        reason,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await refresh();
    });
  };

  const navigateTo = (dateKey: string | null) => {
    if (dateKey) router.push(`/app/day/${dateKey}`);
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    const tag = target instanceof HTMLElement ? target.tagName : "";
    return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || isInteractiveTarget(event.target)) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    navigateTo(dx < 0 ? workspace.nextDateKey : workspace.previousDateKey);
  };

  const highlights = workspace.highlights;
  const rollups = workspace.rollups;

  return (
    <div
      className="flex flex-1 flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.key === "ArrowLeft") navigateTo(workspace.previousDateKey);
        if (event.key === "ArrowRight") navigateTo(workspace.nextDateKey);
      }}
    >
      <div className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 md:px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
            Day
          </h1>
          <span className="mono-tabular truncate text-[11px] text-muted-foreground">
            {workspace.dateKey}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => navigateTo(workspace.previousDateKey)}
            aria-label="Previous day"
            className={BUTTON_CLASS}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => navigateTo(workspace.nextDateKey)}
            disabled={!workspace.nextDateKey}
            aria-label="Next day"
            className={BUTTON_CLASS}
          >
            <ChevronRight className="size-3.5" />
          </button>
          <Link href="/app/today" className={cn(BUTTON_CLASS, "ml-1")}>
            Today
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-3 p-4 md:p-6">
        <section className={SECTION_CLASS} aria-label="Day overview">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {formatDateLabel(workspace.dateKey)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {workspace.weekdayLabel} · {workspace.monthLabel}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Swipe or use ← → to change day
            </p>
          </div>
        </section>

        <section className={SECTION_CLASS} aria-label="Day checklist">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Checklist
            </h2>
            <span className="mono-tabular text-[10px] text-muted-foreground">
              {items.length} active
            </span>
          </div>
          {items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Nothing scheduled on this day.
            </p>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => {
                const status = item.status;
                return (
                  <div
                    key={item.habit.id}
                    className="rounded border border-border bg-background px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleStatus(item.habit.id, status, "done")}
                        aria-pressed={status === "done"}
                        className={cn(
                          "inline-flex min-h-9 flex-1 items-center gap-2 text-left text-xs md:min-h-7",
                          status === "done" && "text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                            status === "done"
                              ? "border-done bg-done text-primary-foreground"
                              : "border-border bg-card text-transparent"
                          )}
                        >
                          <Flame className="size-2.5" />
                        </span>
                        <span
                          className={cn(
                            status === "done" && "line-through opacity-80",
                            status === "skipped" && "line-through opacity-60"
                          )}
                        >
                          {item.habit.title}
                        </span>
                        {!item.scheduled ? (
                          <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">
                            extra
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          toggleStatus(item.habit.id, status, "missed")
                        }
                        aria-pressed={status === "missed"}
                        className={cn(
                          "min-h-9 rounded border px-2 text-[10px] md:min-h-7",
                          status === "missed"
                            ? "border-overdue bg-overdue/15 text-overdue"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Missed
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          toggleStatus(item.habit.id, status, "skipped")
                        }
                        aria-pressed={status === "skipped"}
                        className={cn(
                          "min-h-9 rounded border px-2 text-[10px] md:min-h-7",
                          status === "skipped"
                            ? "border-foreground/40 bg-muted text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Excused
                      </button>
                    </div>
                    {workspace.flags.missReasons && status === "missed" ? (
                      <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                        <label
                          htmlFor={`reason-${item.habit.id}`}
                          className="text-[10px] text-muted-foreground"
                        >
                          Why?
                        </label>
                        <select
                          id={`reason-${item.habit.id}`}
                          value={item.log?.missReason ?? ""}
                          onChange={(event) =>
                            saveReason(
                              item.habit.id,
                              (event.target.value || null) as HabitMissReason | null
                            )
                          }
                          className="min-h-8 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                        >
                          <option value="">No reason yet</option>
                          {Object.entries(MISS_REASON_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {workspace.flags.energySleepInput ? (
          <section className={SECTION_CLASS} aria-label="Energy and sleep">
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Zap className="size-3.5" /> Energy &amp; sleep
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="day-energy">Energy</label>
                  <span className="mono-tabular">{energy}/10</span>
                </div>
                <input
                  id="day-energy"
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={energy}
                  onChange={(event) => setEnergy(Number(event.target.value))}
                  onPointerUp={() =>
                    saveEntry({ dateKey: workspace.dateKey, energy })
                  }
                  onKeyUp={() => saveEntry({ dateKey: workspace.dateKey, energy })}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="day-sleep"
                  className="flex items-center gap-1.5 text-[11px]"
                >
                  <Moon className="size-3.5" /> Sleep hours
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="day-sleep"
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={sleepHours}
                    placeholder="Optional"
                    onChange={(event) => setSleepHours(event.target.value)}
                    onBlur={() =>
                      saveEntry({
                        dateKey: workspace.dateKey,
                        sleepHours: sleepHours === "" ? null : Number(sleepHours),
                      })
                    }
                    className="min-h-9 w-full rounded border border-border bg-background px-2 text-xs md:min-h-8"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      saveEntry({
                        dateKey: workspace.dateKey,
                        energy,
                        sleepHours: sleepHours === "" ? null : Number(sleepHours),
                      })
                    }
                    className={BUTTON_CLASS}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className={SECTION_CLASS} aria-label="Day note">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Note
          </h2>
          <textarea
            aria-label="Day note"
            value={note}
            maxLength={2_000}
            rows={3}
            placeholder="Anything worth remembering about this day…"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() =>
                saveEntry({ dateKey: workspace.dateKey, note: note || null })
              }
              className={BUTTON_CLASS}
            >
              Save note
            </button>
          </div>
        </section>

        <section className={SECTION_CLASS} aria-label="Journal">
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" /> Journal
          </h2>
          <p className="mb-2 text-xs italic text-foreground">
            {workspace.journalPrompt?.text ?? "No prompt available."}
          </p>
          <textarea
            aria-label="Journal response"
            value={journalText}
            maxLength={4_000}
            rows={4}
            placeholder="Write your answer…"
            onChange={(event) => setJournalText(event.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() =>
                saveEntry({
                  dateKey: workspace.dateKey,
                  journalPromptId: workspace.journalPrompt?.id ?? null,
                  journalText: journalText || null,
                })
              }
              className={BUTTON_CLASS}
            >
              Save journal
            </button>
          </div>
        </section>

        {workspace.flags.rollups && highlights ? (
          <section className={SECTION_CLASS} aria-label="Highlights">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Highlights
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-border bg-background px-2 py-1.5">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Score vs month
                </p>
                <p className="mono-tabular text-sm font-semibold text-foreground">
                  {formatPercent(highlights.score)}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    vs {formatPercent(highlights.monthAverage)}
                    {highlights.deltaPoints === null
                      ? ""
                      : ` (${highlights.deltaPoints > 0 ? "+" : ""}${highlights.deltaPoints}pp)`}
                  </span>
                </p>
              </div>
              <div className="rounded border border-border bg-background px-2 py-1.5">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Habit rate
                </p>
                <p className="mono-tabular text-sm font-semibold text-foreground">
                  {formatPercent(rollups.habitRate.day)}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    day / {formatPercent(rollups.habitRate.month)} month
                  </span>
                </p>
              </div>
            </div>

            {highlights.streaksKept.length > 0 ? (
              <div className="mt-2">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Streaks kept
                </p>
                <ul className="mt-1 space-y-0.5">
                  {highlights.streaksKept.map((streak) => (
                    <li key={`${streak.habitId}-${streak.kind}`} className="text-[11px] text-foreground">
                      {streak.title} · {streak.streak}
                      {streak.streakUnit === "weeks" ? "w" : "d"}
                      {streak.kind === "rest-day" ? " (rest day preserved)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {highlights.misses.length > 0 ? (
              <div className="mt-2">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Misses &amp; reasons
                </p>
                <ul className="mt-1 space-y-0.5">
                  {highlights.misses.map((miss) => (
                    <li key={miss.habitId} className="text-[11px] text-foreground">
                      {miss.title} ·{" "}
                      {miss.reason ? MISS_REASON_LABELS[miss.reason] : "No reason yet"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rollups.runsThisWeek ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Runs this week: {rollups.runsThisWeek.done}
                {rollups.runsThisWeek.target === null
                  ? ""
                  : ` / ${rollups.runsThisWeek.target} target`}
              </p>
            ) : null}

            {rollups.unavailableAdapters.length > 0 ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Computed totals awaiting adapters:{" "}
                {rollups.unavailableAdapters.join(", ")}.
              </p>
            ) : null}

            {workspace.spendingModuleAvailable ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Spending: {rollups.daySpending ?? "—"} today ·{" "}
                {rollups.monthSpending ?? "—"} this month
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
