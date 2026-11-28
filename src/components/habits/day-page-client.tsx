"use client";

import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type TouchEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Lock,
  Moon,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  logHabitDayAction,
  saveDayEntryAction,
  setHabitMissReasonAction,
} from "@/actions/habits";
import { ViewHeader } from "@/components/workspace/view-header";
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

const SECTION_CLASS = "rounded-md border border-border bg-card px-3.5 py-3";
const BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:min-h-7";

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

/** Returns `undefined` for invalid input so callers never save NaN. */
function parseSleepHours(raw: string): number | null | undefined {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 24) return undefined;
  return value;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[role='dialog'], [data-slot='dialog-content']")) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
    target.tagName
  );
}

type EntryPatch = Parameters<typeof saveDayEntryAction>[0];

export function DayPageClient({
  initialWorkspace,
}: {
  initialWorkspace: DayWorkspace;
}) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();
  const workspace = initialWorkspace;
  const yearMonth = workspace.dateKey.slice(0, 7);
  const isMonthLocked = workspace.monthLock.isLocked;

  // Checklist status is optimistic for the duration of the server action.
  // Server props are the source of truth; no effect copies them into state.
  const [items, applyOptimisticStatus] = useOptimistic(
    workspace.checklist,
    (
      current,
      action: { habitId: string; status: HabitLogStatus | null }
    ) =>
      current.map((item) =>
        item.habit.id === action.habitId
          ? {
              ...item,
              status: action.status,
              log:
                action.status && item.log
                  ? { ...item.log, status: action.status }
                  : null,
            }
          : item
      )
  );

  const initialEnergy = workspace.dayEntry?.energy ?? null;
  const initialSleep = workspace.dayEntry?.sleepHours ?? null;
  const initialNote = workspace.dayEntry?.note ?? "";
  const initialJournal = workspace.dayEntry?.journalText ?? "";

  const [energy, setEnergy] = useState<number | null>(initialEnergy);
  const [sleepHours, setSleepHours] = useState(
    initialSleep === null ? "" : String(initialSleep)
  );
  const [note, setNote] = useState(initialNote);
  const [journalText, setJournalText] = useState(initialJournal);

  // Saved-baseline state enforces lazy writes: blurring or tapping an unchanged
  // field never inserts an empty habit_day_entries row or fires a phantom toast.
  const [savedBaseline, setSavedBaseline] = useState({
    energy: initialEnergy,
    sleepHours: initialSleep,
    note: initialNote.trim(),
    journalText: initialJournal.trim(),
  });
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const navigateTo = useCallback(
    (dateKey: string | null) => {
      if (dateKey) router.push(`/app/day/${dateKey}`);
    },
    [router]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateTo(workspace.previousDateKey);
      } else if (event.key === "ArrowRight" && workspace.nextDateKey) {
        event.preventDefault();
        navigateTo(workspace.nextDateKey);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateTo, workspace.previousDateKey, workspace.nextDateKey]);

  const saveEntry = (patch: EntryPatch, onSaved?: () => void) => {
    startTransition(async () => {
      const result = await saveDayEntryAction(patch);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onSaved?.();
      toast.success("Day saved");
      await invalidate(["habits"]);
      router.refresh();
    });
  };

  const commitEnergy = (value: number | null) => {
    if (value === savedBaseline.energy) return;
    saveEntry({ dateKey: workspace.dateKey, energy: value }, () => {
      setSavedBaseline((prev) => ({ ...prev, energy: value }));
    });
  };

  const commitSleep = () => {
    const parsed = parseSleepHours(sleepHours);
    if (parsed === undefined) {
      toast.error("Sleep hours must be between 0 and 24.");
      return;
    }
    if (parsed === savedBaseline.sleepHours) return;
    saveEntry({ dateKey: workspace.dateKey, sleepHours: parsed }, () => {
      setSavedBaseline((prev) => ({ ...prev, sleepHours: parsed }));
    });
  };

  const commitNote = () => {
    const normalized = note.trim();
    if (normalized === savedBaseline.note) return;
    saveEntry(
      { dateKey: workspace.dateKey, note: normalized || null },
      () => {
        setSavedBaseline((prev) => ({ ...prev, note: normalized }));
      }
    );
  };

  const commitJournal = () => {
    const normalized = journalText.trim();
    if (normalized === savedBaseline.journalText) return;
    saveEntry(
      {
        dateKey: workspace.dateKey,
        journalPromptId: workspace.journalPrompt?.id ?? null,
        journalText: normalized || null,
      },
      () => {
        setSavedBaseline((prev) => ({ ...prev, journalText: normalized }));
      }
    );
  };

  const toggleStatus = (
    habitId: string,
    currentStatus: HabitLogStatus | null,
    nextStatus: HabitLogStatus
  ) => {
    if (isMonthLocked) return;
    const resolved: HabitLogStatus | null =
      currentStatus === nextStatus ? null : nextStatus;
    startTransition(async () => {
      applyOptimisticStatus({ habitId, status: resolved });
      const result = await logHabitDayAction({
        habitId,
        dateKey: workspace.dateKey,
        status: resolved,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(
        result.data.syncedTaskCount > 0
          ? ["habits", "today", "tasks", "sidebar"]
          : ["habits", "today"]
      );
      router.refresh();
    });
  };

  const saveReason = (habitId: string, reason: HabitMissReason | null) => {
    if (isMonthLocked) return;
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
      await invalidate(["habits", "today"]);
      router.refresh();
    });
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

  const parsedSleep = parseSleepHours(sleepHours);
  const sleepDirty =
    parsedSleep === undefined || parsedSleep !== savedBaseline.sleepHours;
  const noteDirty = note.trim() !== savedBaseline.note;
  const journalDirty = journalText.trim() !== savedBaseline.journalText;

  const highlights = workspace.highlights;
  const rollups = workspace.rollups;

  return (
    <div
      className="flex flex-1 flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <ViewHeader
        title="Day"
        subtitle={formatDateLabel(workspace.dateKey)}
        meta={workspace.dateKey}
        actions={
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => navigateTo(workspace.previousDateKey)}
              aria-label="Previous day"
              title="Previous day (←)"
              className={BUTTON_CLASS}
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => navigateTo(workspace.nextDateKey)}
              disabled={!workspace.nextDateKey}
              aria-label="Next day"
              title="Next day (→)"
              className={BUTTON_CLASS}
            >
              <ChevronRight className="size-3.5" />
            </button>
            <Link href="/app/today" className={cn(BUTTON_CLASS, "ml-0.5")}>
              Today
            </Link>
            <Link
              href={`/app/habits?month=${yearMonth}`}
              className={cn(BUTTON_CLASS, "hidden sm:inline-flex")}
            >
              Matrix
            </Link>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-3 p-4 md:p-6">
        <section className={SECTION_CLASS} aria-label="Day overview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {formatDateLabel(workspace.dateKey)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {workspace.weekdayLabel} · {workspace.monthLabel}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Swipe or press ← → to move between days
            </p>
          </div>
        </section>

        <section className={SECTION_CLASS} aria-label="Day checklist">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Checklist
            </h2>
            <span className="mono-tabular text-[10px] text-muted-foreground">
              {items.length} active
            </span>
          </div>

          {isMonthLocked ? (
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3 shrink-0" />
                {workspace.monthLabel} is{" "}
                {workspace.monthLock.phase === "locked_manual"
                  ? "manually locked"
                  : "auto-locked"}
                . Unlock it on the matrix to edit habit marks.
              </span>
              <Link
                href={`/app/habits?month=${yearMonth}`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Open matrix →
              </Link>
            </div>
          ) : null}

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
                        disabled={isMonthLocked || isPending}
                        onClick={() => toggleStatus(item.habit.id, status, "done")}
                        aria-pressed={status === "done"}
                        className={cn(
                          "inline-flex min-h-9 flex-1 items-center gap-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 md:min-h-7",
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
                        disabled={isMonthLocked || isPending}
                        onClick={() =>
                          toggleStatus(item.habit.id, status, "missed")
                        }
                        aria-pressed={status === "missed"}
                        className={cn(
                          "min-h-9 rounded border px-2 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:min-h-7",
                          status === "missed"
                            ? "border-overdue bg-overdue/15 text-overdue"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Missed
                      </button>
                      <button
                        type="button"
                        disabled={isMonthLocked || isPending}
                        onClick={() =>
                          toggleStatus(item.habit.id, status, "skipped")
                        }
                        aria-pressed={status === "skipped"}
                        className={cn(
                          "min-h-9 rounded border px-2 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:min-h-7",
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
                          name={`reason-${item.habit.id}`}
                          disabled={isMonthLocked || isPending}
                          value={item.log?.missReason ?? ""}
                          onChange={(event) =>
                            saveReason(
                              item.habit.id,
                              (event.target.value || null) as HabitMissReason | null
                            )
                          }
                          className="min-h-9 rounded border border-border bg-background px-1.5 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:min-h-7"
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
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <label htmlFor="day-energy">Energy</label>
                  <div className="flex items-center gap-1.5">
                    <span className="mono-tabular">
                      {energy === null ? "—" : `${energy}/10`}
                    </span>
                    {energy !== null ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setEnergy(null);
                          commitEnergy(null);
                        }}
                        aria-label="Clear energy"
                        title="Clear energy"
                        className="inline-flex size-9 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 md:size-6"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <input
                  id="day-energy"
                  name="day-energy"
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={energy ?? 5}
                  onChange={(event) => setEnergy(Number(event.target.value))}
                  onPointerUp={() => {
                    if (energy !== null) {
                      commitEnergy(energy);
                    }
                  }}
                  onKeyUp={() => {
                    if (energy !== null) {
                      commitEnergy(energy);
                    }
                  }}
                  className="h-9 w-full cursor-pointer accent-primary md:h-5"
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
                    name="day-sleep"
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={sleepHours}
                    placeholder="Optional"
                    onChange={(event) => setSleepHours(event.target.value)}
                    onBlur={commitSleep}
                    className="min-h-9 w-full rounded border border-border bg-background px-2 text-xs md:min-h-7"
                  />
                  <button
                    type="button"
                    disabled={isPending || !sleepDirty}
                    onClick={commitSleep}
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
          <label
            htmlFor="day-note"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Note
          </label>
          <textarea
            id="day-note"
            name="day-note"
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
              disabled={isPending || !noteDirty}
              onClick={commitNote}
              className={BUTTON_CLASS}
            >
              Save note
            </button>
          </div>
        </section>

        <section className={SECTION_CLASS} aria-label="Journal">
          <label
            htmlFor="day-journal"
            className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Sparkles className="size-3.5" /> Journal
          </label>
          <p className="mb-2 text-xs italic text-foreground">
            {workspace.journalPrompt?.text ?? "No prompt available."}
          </p>
          <textarea
            id="day-journal"
            name="day-journal"
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
              disabled={isPending || !journalDirty}
              onClick={commitJournal}
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
              <div className="rounded border border-border bg-background px-2.5 py-2">
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
              <div className="rounded border border-border bg-background px-2.5 py-2">
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
              <div className="mt-2.5">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Streaks kept
                </p>
                <ul className="mt-1 space-y-0.5">
                  {highlights.streaksKept.map((streak) => (
                    <li
                      key={`${streak.habitId}-${streak.kind}`}
                      className="text-[11px] text-foreground"
                    >
                      {streak.title} · {streak.streak}
                      {streak.streakUnit === "weeks" ? "w" : "d"}
                      {streak.kind === "rest-day" ? " (rest day preserved)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {highlights.misses.length > 0 ? (
              <div className="mt-2.5">
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
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                Runs this week: {rollups.runsThisWeek.done}
                {rollups.runsThisWeek.target === null
                  ? ""
                  : ` / ${rollups.runsThisWeek.target} target`}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
