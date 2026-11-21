"use client";

import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, CheckSquare, FileText, Loader2, CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import { createNoteAction } from "@/actions/notes";
import { createTaskAction } from "@/actions/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  parseQuickCapture,
  type CaptureEntityKind,
} from "@/lib/natural-language-capture";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/server/db/schema";

interface QuickCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
}

export function QuickCaptureDialog({
  open,
  onOpenChange,
  timezone,
}: QuickCaptureDialogProps) {
  const [rawInput, setRawInput] = useState("");
  const [defaultKind, setDefaultKind] = useState<CaptureEntityKind>("task");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [tagsText, setTagsText] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRawInput("");
      setPriority("none");
      setTagsText("");
    }
    onOpenChange(nextOpen);
  };

  const parsed = useMemo(
    () => parseQuickCapture(rawInput, timezone, { defaultKind }),
    [rawInput, timezone, defaultKind]
  );

  const formattedReminder = useMemo(() => {
    if (!parsed.remindAtUtcMs) return null;
    try {
      return formatInTimeZone(
        parsed.remindAtUtcMs,
        timezone,
        "EEE, MMM d · HH:mm"
      );
    } catch {
      return formatInTimeZone(
        parsed.remindAtUtcMs,
        "UTC",
        "EEE, MMM d · HH:mm"
      );
    }
  }, [parsed.remindAtUtcMs, timezone]);

  const handleSubmit = () => {
    if (!parsed.cleanTitle.trim() || isPending) return;

    startTransition(async () => {
      if (parsed.kind === "task") {
        const result = await createTaskAction({
          title: parsed.cleanTitle,
          priority,
          dueAt: parsed.remindAtUtcMs,
          remindAt: parsed.remindAtUtcMs,
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }

        toast.success(
          result.data.reminder && formattedReminder
            ? `Task captured with reminder (${formattedReminder})`
            : "Task added to Inbox"
        );
        handleOpenChange(false);
        return;
      }

      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const result = await createNoteAction({
        title: parsed.cleanTitle,
        content: "",
        tags,
        remindAt: parsed.remindAtUtcMs,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        result.data.reminder && formattedReminder
          ? `Note saved with reminder (${formattedReminder})`
          : "Note saved"
      );
      handleOpenChange(false);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setDefaultKind((prev) => (prev === "task" ? "note" : "task"));
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  // Highlight detected phrase inline as an ochre pill
  const renderHighlightedPreview = () => {
    if (!parsed.bodyText.trim()) return null;
    if (!parsed.detectedRange || !parsed.detectedPhrase) {
      return null;
    }

    const { start, end } = parsed.detectedRange;
    const before = parsed.bodyText.slice(0, start);
    const match = parsed.bodyText.slice(start, end);
    const after = parsed.bodyText.slice(end);

    return (
      <div
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
      >
        <div className="min-w-0 leading-relaxed text-foreground">
          <span>{before}</span>
          <span className="inline-flex items-center gap-1 rounded border border-reminder/35 bg-reminder/15 px-1.5 py-0.5 font-medium text-reminder">
            <Bell className="size-3" />
            {match}
          </span>
          <span>{after}</span>
        </div>
        {formattedReminder ? (
          <span className="mono-tabular shrink-0 text-[11px] font-medium text-reminder">
            {formattedReminder}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-3 border-border bg-card p-4 sm:max-w-[540px]">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-sm font-semibold tracking-tight">
              Quick capture
            </DialogTitle>
            <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setDefaultKind("task")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  parsed.kind === "task"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <CheckSquare className="size-3" />
                Task
              </button>
              <button
                type="button"
                onClick={() => setDefaultKind("note")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  parsed.kind === "note"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="size-3" />
                Note
              </button>
            </div>
          </div>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Type naturally (e.g. &ldquo;Pay Umeme bill tomorrow 9am&rdquo;). Press{" "}
            <kbd className="mono-tabular rounded border border-border bg-background px-1 py-0.5 text-[10px]">
              Tab
            </kbd>{" "}
            or prefix with{" "}
            <code className="mono-tabular rounded border border-border bg-background px-1 py-0.5 text-[10px]">
              n:
            </code>{" "}
            for notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <Input
            autoFocus
            name="quickCaptureInput"
            aria-label="Quick capture input"
            placeholder={
              parsed.kind === "task"
                ? "Pay Umeme bill tomorrow 9am"
                : "n: Renewal PIN or meeting note (optional time)"
            }
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mira-row bg-background text-xs"
          />

          {renderHighlightedPreview()}

          {parsed.kind === "task" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[11px] text-muted-foreground">
                  Priority:
                </span>
                {(["none", "low", "medium", "high"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPriority(level)}
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px] capitalize transition-colors",
                      priority === level
                        ? "border-foreground bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
              {parsed.remindAtUtcMs ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-reminder/40 bg-reminder/10 text-[10px] font-normal text-reminder"
                >
                  <Bell className="size-2.5" />
                  Auto-reminder attached
                </Badge>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                name="quickCaptureTags"
                aria-label="Note tags"
                placeholder="Optional tags (comma-separated, e.g. bills, reference)"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                className="h-7 flex-1 bg-background text-xs"
              />
              {parsed.remindAtUtcMs ? (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-reminder/40 bg-reminder/10 text-[10px] font-normal text-reminder"
                >
                  <Bell className="size-2.5" />
                  Timed note
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px] font-normal"
                >
                  Quiet note
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="mono-tabular text-[10px] text-muted-foreground">
            TZ · {timezone}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={!parsed.cleanTitle.trim() || isPending}
            onClick={handleSubmit}
            className="mira-row gap-1.5 px-3 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <span>
                  Create {parsed.kind === "task" ? "Task" : "Note"}
                </span>
                <CornerDownLeft className="size-3 opacity-70" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
