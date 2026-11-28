"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRightCircle,
  Check,
  ListChecks,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { saveHabitMonthRosterAction } from "@/actions/habits";
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
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type { HabitRecord } from "@/server/db/schema";
import type { PreviousMonthRosterSource } from "@/server/services/habit-service";

interface ManageMonthRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearMonth: string;
  monthLabel: string;
  allHabits: HabitRecord[];
  initialSelectedIds: string[];
  previousRosterSource: PreviousMonthRosterSource | null;
}

export function ManageMonthRosterDialog({
  open,
  onOpenChange,
  yearMonth,
  monthLabel,
  allHabits,
  initialSelectedIds,
  previousRosterSource,
}: ManageMonthRosterDialogProps) {
  const invalidate = useInvalidateWorkspace();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setSelectedIds(initialSelectedIds);
      setSearch("");
    }
    onOpenChange(nextOpen);
  };

  // Sync when caller switches initial preset (e.g. clicking "Customize from previous month")
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filteredHabits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allHabits;
    return allHabits.filter(
      (h) =>
        h.title.toLowerCase().includes(q) ||
        (h.category ?? "").toLowerCase().includes(q)
    );
  }, [allHabits, search]);

  const toggleHabit = (habitId: string) => {
    setSelectedIds((prev) =>
      prev.includes(habitId)
        ? prev.filter((id) => id !== habitId)
        : [...prev, habitId]
    );
  };

  const applyPreviousMonth = () => {
    if (!previousRosterSource) return;
    setSelectedIds(previousRosterSource.habitIds);
    toast.info(
      `Loaded ${previousRosterSource.habitIds.length} habits from ${previousRosterSource.monthLabel}. Adjust as needed and save.`
    );
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveHabitMonthRosterAction({
        yearMonth,
        habitIds: selectedIds,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      await invalidate(["habits", "today", "sidebar"]);
      toast.success(
        `Saved ${res.data.habitIds.length} habit${res.data.habitIds.length === 1 ? "" : "s"} for ${monthLabel}.`
      );
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-4 text-done" aria-hidden="true" />
            Manage {monthLabel} habits
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            Choose exactly which habits appear and are scored in {monthLabel}.
            Changes here never alter earlier months&apos; history or analytics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Quick Carry-Over & Selection Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {previousRosterSource ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyPreviousMonth}
                  className="mira-row gap-1.5 text-xs"
                >
                  <ArrowRightCircle
                    className="size-3.5 text-done"
                    aria-hidden="true"
                  />
                  Load {previousRosterSource.monthLabel} (
                  {previousRosterSource.habitIds.length})
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(allHabits.map((h) => h.id))}
                className="mira-row px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds([])}
                className="mira-row px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            </div>

            <span className="mono-tabular text-xs font-medium text-foreground">
              {selectedIds.length} selected
            </span>
          </div>

          {/* Filter Search */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5">
            <Search
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="month-roster-search"
              name="monthRosterSearch"
              aria-label="Filter habits for this month"
              placeholder="Filter habits by title or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mira-row border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            />
            {search ? (
              <button
                type="button"
                aria-label="Clear habit filter"
                onClick={() => setSearch("")}
                className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          {/* Habits Checklist */}
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background">
            {filteredHabits.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No habits match your filter.
              </div>
            ) : (
              filteredHabits.map((habit) => {
                const checked = selectedSet.has(habit.id);
                return (
                  <button
                    key={habit.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleHabit(habit.id)}
                    className={cn(
                      "flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50 md:min-h-8",
                      checked && "bg-accent/30"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                          checked
                            ? "border-done bg-done text-primary-foreground"
                            : "border-muted-foreground/50 bg-card"
                        )}
                      >
                        {checked ? (
                          <Check className="size-2.5 stroke-[2.5]" />
                        ) : null}
                      </span>
                      <span className="block min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {habit.title}
                        </span>
                        <span className="mono-tabular block text-[10px] text-muted-foreground">
                          Started {habit.startDate}
                          {habit.category ? ` · ${habit.category}` : ""}
                        </span>
                      </span>
                    </span>

                    {habit.isArchived ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 border-border px-1.5 text-[9px] font-normal text-muted-foreground"
                      >
                        Archived
                      </Badge>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
            className="mira-row text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleSave}
            className="mira-row gap-1.5 px-4 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              `Save ${selectedIds.length} for ${monthLabel}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
