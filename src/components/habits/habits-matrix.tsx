"use client";

import { useState } from "react";
import {
  Check,
  Clock,
  Flame,
  Link2,
  Minus,
  Repeat2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LinkedHabitTaskSummary } from "@/server/dal/habits";
import type {
  HabitLogRecord,
  HabitLogStatus,
  HabitRecord,
} from "@/server/db/schema";
import {
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
  type HabitRowSummary,
  type MonthCalendar,
} from "@/server/domain/habit-analytics";

interface HabitsMatrixProps {
  calendar: MonthCalendar;
  todayDateKey: string;
  habits: HabitRecord[];
  logsByKey: Record<string, HabitLogRecord>;
  linkedTaskByKey?: Record<string, LinkedHabitTaskSummary>;
  summaryByHabitId: Record<string, HabitRowSummary>;
  readOnly?: boolean;
  onCycleLog?: (
    habit: HabitRecord,
    dateKey: string,
    nextStatus: HabitLogStatus | null
  ) => void;
  onSaveCellDetail?: (
    habit: HabitRecord,
    dateKey: string,
    status: HabitLogStatus | null,
    note: string | null
  ) => void;
  onInspectHabit?: (habit: HabitRecord) => void;
}

const WEEKDAY_TINY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function nextCycleStatus(
  current: HabitLogStatus | null
): HabitLogStatus | null {
  if (current === null) return "done";
  if (current === "done") return "missed";
  if (current === "missed") return "skipped";
  return null;
}

function formatCadenceTag(habit: HabitRecord): string {
  if (habit.cadenceType === "daily") return "Daily";
  if (habit.cadenceType === "weekly_target") {
    return `${habit.weeklyTargetCount ?? 3}×/wk`;
  }
  const days = parseScheduledDaysJson(habit.scheduledDaysJson);
  if (
    days.length === 5 &&
    days.join(",") === "1,2,3,4,5"
  ) {
    return "Mon–Fri";
  }
  if (days.length === 2 && days.join(",") === "0,6") {
    return "Wknd";
  }
  return days.map((d) => WEEKDAY_TINY[d] ?? "").join(" ");
}

function CellNotePopoverBody({
  habit,
  dateKey,
  initialStatus,
  initialNote,
  isBackfilledLate,
  linkedTask,
  onSave,
  onClose,
}: {
  habit: HabitRecord;
  dateKey: string;
  initialStatus: HabitLogStatus | null;
  initialNote: string;
  isBackfilledLate: boolean;
  linkedTask: LinkedHabitTaskSummary | null;
  onSave: (status: HabitLogStatus | null, note: string | null) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<HabitLogStatus | null>(
    initialStatus ?? "done"
  );
  const [note, setNote] = useState(initialNote);

  const handleSave = () => {
    onSave(status, note.trim() || null);
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="truncate text-xs font-semibold text-foreground">
          {habit.title}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="mono-tabular">{dateKey}</span>
          {isBackfilledLate ? (
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
              <Clock className="size-2.5" />
              Backfilled &gt;48h
            </span>
          ) : null}
          {linkedTask ? (
            <span className="inline-flex items-center gap-1 rounded border border-done/35 bg-done/10 px-1 py-0.5 text-[10px] text-done">
              <Link2 className="size-2.5" />
              Task synced
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {(
          [
            {
              value: "done" as const,
              label: "Done",
              activeClass: "border-done bg-done/15 text-done",
            },
            {
              value: "missed" as const,
              label: "Missed",
              activeClass: "border-overdue bg-overdue/15 text-overdue",
            },
            {
              value: "skipped" as const,
              label: "Skip",
              activeClass: "border-foreground/40 bg-muted text-foreground",
            },
            {
              value: null,
              label: "Clear",
              activeClass: "border-foreground/40 bg-accent text-foreground",
            },
          ] as const
        ).map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setStatus(opt.value)}
            className={cn(
              "mira-row rounded border px-1.5 text-[11px] font-medium transition-colors",
              status === opt.value
                ? opt.activeClass
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {status !== null ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <label htmlFor="cell-micro-note">Micro-note</label>
            <span className="mono-tabular text-[10px]">
              {note.length}/280
            </span>
          </div>
          <Textarea
            id="cell-micro-note"
            rows={3}
            maxLength={280}
            placeholder="Quick context (e.g., 5km tempo run, skipped while traveling)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="bg-background text-xs leading-relaxed"
          />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Clearing removes this day&apos;s log and note.
        </p>
      )}

      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClose}
          className="h-7 px-2 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="xs"
          onClick={handleSave}
          className="h-7 px-3 text-xs"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function HabitsMatrix({
  calendar,
  todayDateKey,
  habits,
  logsByKey,
  linkedTaskByKey = {},
  summaryByHabitId,
  readOnly = false,
  onCycleLog,
  onSaveCellDetail,
  onInspectHabit,
}: HabitsMatrixProps) {
  const [openCellKey, setOpenCellKey] = useState<string | null>(null);

  // Track which habits have at least one linked task in this month for the subtle icon
  const linkedHabitIds = new Set<string>();
  for (const key of Object.keys(linkedTaskByKey)) {
    const habitId = key.split("::")[0];
    if (habitId) linkedHabitIds.add(habitId);
  }

  return (
    <section aria-label="Monthly habit matrix" className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            {/* Row 1: Real Calendar Week Groups (W1..W5/W6) */}
            <tr>
              <th
                rowSpan={2}
                scope="col"
                className="sticky left-0 z-20 min-w-[158px] max-w-[210px] border-r border-b border-border bg-card px-3 py-2 align-bottom sm:min-w-[204px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Habit
                  </span>
                  <span className="mono-tabular text-[10px] text-muted-foreground">
                    {calendar.daysInMonth}d
                  </span>
                </div>
              </th>

              {calendar.weeks.map((week, wIdx) => (
                <th
                  key={week.label}
                  colSpan={week.days.length}
                  scope="colgroup"
                  className={cn(
                    "border-b border-border bg-background/70 px-1.5 py-1 text-center text-[10px] font-medium text-muted-foreground",
                    wIdx > 0 && "border-l border-border"
                  )}
                >
                  <span className="mono-tabular font-semibold text-foreground">
                    {week.label}
                  </span>
                  {week.days.length >= 2 ? (
                    <span className="ml-1 hidden font-normal text-muted-foreground sm:inline">
                      {week.dateRangeLabel}
                    </span>
                  ) : null}
                </th>
              ))}

              <th
                rowSpan={2}
                scope="col"
                className="sticky right-0 z-20 min-w-[92px] border-b border-l border-border bg-card px-2.5 py-2 text-right align-bottom"
              >
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Streak / %
                </span>
              </th>
            </tr>

            {/* Row 2: Real Calendar Day Columns (1..28/29/30/31) */}
            <tr>
              {calendar.weeks.flatMap((week, wIdx) =>
                week.days.map((day, dIdx) => {
                  const isToday = day.dateKey === todayDateKey;
                  const isFuture = day.dateKey > todayDateKey;
                  return (
                    <th
                      key={day.dateKey}
                      scope="col"
                      className={cn(
                        "border-b border-border px-0.5 py-1.5 text-center align-middle",
                        wIdx > 0 && dIdx === 0 && "border-l border-border",
                        isToday ? "bg-reminder/12" : "bg-card"
                      )}
                    >
                      <div className="flex flex-col items-center leading-none">
                        <span
                          className={cn(
                            "text-[9px] uppercase",
                            isToday
                              ? "font-semibold text-reminder"
                              : "text-muted-foreground"
                          )}
                        >
                          {day.weekdayLetter}
                        </span>
                        <span
                          className={cn(
                            "mono-tabular mt-1 flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[10px]",
                            isToday
                              ? "bg-primary font-semibold text-primary-foreground"
                              : isFuture
                                ? "text-muted-foreground/60"
                                : "font-medium text-foreground"
                          )}
                        >
                          {day.dayOfMonth}
                        </span>
                      </div>
                    </th>
                  );
                })
              )}
            </tr>
          </thead>

          <tbody>
            {habits.map((habit) => {
              const scheduledDays = parseScheduledDaysJson(
                habit.scheduledDaysJson
              );
              const summary = summaryByHabitId[habit.id];
              const cadenceTag = formatCadenceTag(habit);
              const hasLinkedTask = linkedHabitIds.has(habit.id);
              const pctText =
                summary && summary.completionRate !== null
                  ? `${Math.round(summary.completionRate * 100)}%`
                  : "—";

              return (
                <tr
                  key={habit.id}
                  className="group transition-colors hover:bg-accent/25"
                >
                  {/* Sticky Left Habit Info Column */}
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-b border-border bg-card px-3 py-1.5 font-normal group-hover:bg-accent/25"
                  >
                    {readOnly ? (
                      <div className="flex min-h-9 w-full flex-col justify-center text-left md:min-h-7">
                        <span className="max-w-[140px] truncate text-xs font-medium text-foreground sm:max-w-[175px]">
                          {habit.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="mono-tabular">{cadenceTag}</span>
                          {habit.category ? (
                            <>
                              <span>·</span>
                              <span className="max-w-[80px] truncate">
                                {habit.category}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onInspectHabit?.(habit)}
                        className="flex min-h-9 w-full flex-col justify-center text-left focus:outline-none md:min-h-7"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-[130px] truncate text-xs font-medium text-foreground sm:max-w-[165px]">
                            {habit.title}
                          </span>
                          {hasLinkedTask || habit.autoSyncDailyTask ? (
                            <Link2
                              aria-label="Linked with tasks"
                              className="size-3 shrink-0 text-done"
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="mono-tabular">{cadenceTag}</span>
                          {habit.category ? (
                            <>
                              <span>·</span>
                              <span className="max-w-[80px] truncate">
                                {habit.category}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </button>
                    )}
                  </th>

                  {/* Scrollable Real Calendar Day Cells */}
                  {calendar.weeks.flatMap((week, wIdx) =>
                    week.days.map((day, dIdx) => {
                      const cellKey = `${habit.id}::${day.dateKey}`;
                      const log = logsByKey[cellKey] ?? null;
                      const linkedTask = linkedTaskByKey[cellKey] ?? null;
                      const isToday = day.dateKey === todayDateKey;
                      const isFuture = day.dateKey > todayDateKey;
                      const isBeforeStart = day.dateKey < habit.startDate;
                      const isDisabled = isFuture || isBeforeStart;
                      const isScheduled = isHabitScheduledOnDate(
                        {
                          cadenceType: habit.cadenceType,
                          scheduledDays,
                          startDate: habit.startDate,
                        },
                        day.dateKey
                      );
                      const isPopoverOpen = openCellKey === cellKey;
                      const status = log?.status ?? null;
                      const hasNote = Boolean(log?.note);
                      const isLate = Boolean(log?.isBackfilledLate);

                      const tooltipParts = [
                        `${habit.title} · ${day.dateKey}`,
                        isBeforeStart
                          ? `Starts ${habit.startDate}`
                          : isFuture
                            ? "Future date"
                            : status
                              ? status.toUpperCase()
                              : isScheduled
                                ? "Unlogged (click to mark Done)"
                                : "Off-day",
                      ];
                      if (hasNote && log?.note) {
                        tooltipParts.push(`Note: ${log.note}`);
                      }
                      if (isLate) {
                        tooltipParts.push("Backfilled >48h after date");
                      }

                      return (
                        <td
                          key={day.dateKey}
                          className={cn(
                            "border-b border-border p-0.5 text-center align-middle",
                            wIdx > 0 && dIdx === 0 && "border-l border-border",
                            isToday && "bg-reminder/8"
                          )}
                        >
                          <Popover
                            open={isPopoverOpen}
                            onOpenChange={(nextOpen) =>
                              setOpenCellKey(nextOpen ? cellKey : null)
                            }
                          >
                            <PopoverAnchor asChild>
                              <button
                                type="button"
                                disabled={isDisabled || (readOnly && !hasNote)}
                                title={tooltipParts.join(" — ")}
                                aria-label={`${habit.title} on ${day.dateKey}: ${
                                  isBeforeStart
                                    ? "before start date"
                                    : isFuture
                                      ? "future date"
                                      : status ?? "unlogged"
                                }`}
                                data-habit-id={habit.id}
                                data-date-key={day.dateKey}
                                data-status={status ?? "unlogged"}
                                onClick={(event) => {
                                  if (isDisabled) return;
                                  if (readOnly) {
                                    if (hasNote) setOpenCellKey(cellKey);
                                    return;
                                  }
                                  if (event.shiftKey) {
                                    event.preventDefault();
                                    setOpenCellKey(cellKey);
                                    return;
                                  }
                                  onCycleLog?.(
                                    habit,
                                    day.dateKey,
                                    nextCycleStatus(status)
                                  );
                                }}
                                onContextMenu={(event) => {
                                  if (isDisabled) return;
                                  if (readOnly) {
                                    if (hasNote) {
                                      event.preventDefault();
                                      setOpenCellKey(cellKey);
                                    }
                                    return;
                                  }
                                  event.preventDefault();
                                  setOpenCellKey(cellKey);
                                }}
                                className={cn(
                                  "relative mx-auto flex min-h-9 min-w-9 items-center justify-center rounded border transition-colors md:min-h-7 md:min-w-7",
                                  isDisabled
                                    ? "cursor-not-allowed border-transparent bg-transparent opacity-30"
                                    : status === "done"
                                      ? readOnly
                                        ? "border-done/55 bg-done/15 text-done"
                                        : "border-done/55 bg-done/15 text-done hover:bg-done/25"
                                      : status === "missed"
                                        ? readOnly
                                          ? "border-overdue/45 bg-overdue/12 text-overdue"
                                          : "border-overdue/45 bg-overdue/12 text-overdue hover:bg-overdue/20"
                                        : status === "skipped"
                                          ? readOnly
                                            ? "border-border bg-muted text-muted-foreground"
                                            : "border-border bg-muted text-muted-foreground hover:bg-accent"
                                          : isScheduled
                                            ? readOnly
                                              ? "border-border/80 bg-background text-muted-foreground/40"
                                              : "border-border/80 bg-background text-muted-foreground/40 hover:border-foreground/35 hover:bg-accent/70"
                                            : readOnly
                                              ? "border-dashed border-border/50 bg-transparent text-muted-foreground/25"
                                              : "border-dashed border-border/50 bg-transparent text-muted-foreground/25 hover:border-border hover:bg-accent/40",
                                  readOnly && !hasNote && "cursor-default"
                                )}
                              >
                                {status === "done" ? (
                                  <Check className="size-3.5 stroke-[2.4]" />
                                ) : status === "missed" ? (
                                  <X className="size-3.5 stroke-[2.2]" />
                                ) : status === "skipped" ? (
                                  <Minus className="size-3.5 stroke-[2.2]" />
                                ) : !isDisabled && !isScheduled ? (
                                  <span
                                    aria-hidden="true"
                                    className="size-1 rounded-full bg-muted-foreground/30"
                                  />
                                ) : null}

                                {/* Tiny corner dot indicating micro-note */}
                                {hasNote ? (
                                  <span
                                    aria-hidden="true"
                                    className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-foreground"
                                  />
                                ) : null}

                                {/* Subtle muted clock indicator for >48h retroactive backfills */}
                                {isLate ? (
                                  <Clock
                                    aria-hidden="true"
                                    className="absolute right-0.5 bottom-0.5 size-2.5 text-muted-foreground/75"
                                  />
                                ) : null}
                              </button>
                            </PopoverAnchor>

                            {isPopoverOpen ? (
                              <PopoverContent
                                align="center"
                                side="bottom"
                                className="w-72 border-border bg-popover p-3 shadow-none"
                              >
                                {readOnly ? (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate text-xs font-semibold text-foreground">
                                        {habit.title}
                                      </span>
                                      <span className="mono-tabular text-[11px] text-muted-foreground">
                                        {day.dateKey}
                                      </span>
                                    </div>
                                    <p className="text-xs leading-relaxed text-foreground">
                                      {log?.note}
                                    </p>
                                    {isLate ? (
                                      <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                        <Clock className="size-2.5" />
                                        Backfilled &gt;48h after date
                                      </p>
                                    ) : null}
                                  </div>
                                ) : (
                                  <CellNotePopoverBody
                                    key={`${cellKey}-${status ?? "none"}-${log?.note ?? ""}`}
                                    habit={habit}
                                    dateKey={day.dateKey}
                                    initialStatus={status}
                                    initialNote={log?.note ?? ""}
                                    isBackfilledLate={isLate}
                                    linkedTask={linkedTask}
                                    onSave={(nextStatus, nextNote) =>
                                      onSaveCellDetail?.(
                                        habit,
                                        day.dateKey,
                                        nextStatus,
                                        nextNote
                                      )
                                    }
                                    onClose={() => setOpenCellKey(null)}
                                  />
                                )}
                              </PopoverContent>
                            ) : null}
                          </Popover>
                        </td>
                      );
                    })
                  )}

                  {/* Sticky Right Streak & Monthly % Summary */}
                  <td className="sticky right-0 z-10 border-b border-l border-border bg-card px-2.5 py-1.5 text-right align-middle group-hover:bg-accent/25">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        title={`Current streak (best: ${summary?.bestStreak ?? 0}${
                          summary?.streakUnit === "weeks" ? "w" : "d"
                        })`}
                        className="mono-tabular inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
                      >
                        <Flame
                          className={cn(
                            "size-3",
                            (summary?.currentStreak ?? 0) > 0
                              ? "text-reminder"
                              : "text-muted-foreground/40"
                          )}
                        />
                        {summary?.currentStreak ?? 0}
                        {summary?.streakUnit === "weeks" ? "w" : "d"}
                      </span>
                      <span
                        className={cn(
                          "mono-tabular min-w-[34px] text-right text-xs font-semibold",
                          summary && summary.completionRate !== null
                            ? summary.completionRate >= 0.75
                              ? "text-done"
                              : summary.completionRate < 0.45
                                ? "text-overdue"
                                : "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {pctText}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Compact Matrix Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex size-4 items-center justify-center rounded border border-done/55 bg-done/15 text-done">
              <Check className="size-2.5 stroke-[2.5]" />
            </span>
            Done
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex size-4 items-center justify-center rounded border border-overdue/45 bg-overdue/12 text-overdue">
              <X className="size-2.5 stroke-[2.3]" />
            </span>
            Missed
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex size-4 items-center justify-center rounded border border-border bg-muted text-muted-foreground">
              <Minus className="size-2.5 stroke-[2.3]" />
            </span>
            Skipped (rest)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-foreground" />
            Micro-note
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground" />
            &gt;48h backfill
          </span>
        </div>

        <span className="inline-flex items-center gap-1">
          <Repeat2 className="size-3" />
          {readOnly
            ? "Read-only ledger · Tap or hover noted cells for context"
            : "Click to cycle · Right-click or Shift+click for note"}
        </span>
      </div>
    </section>
  );
}
