"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { bulkImportHabitsAction } from "@/actions/habits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BULK_IMPORT_HABITS,
  parseBulkHabitImport,
} from "@/server/domain/habit-analytics";

interface BulkImportHabitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SAMPLE_CSV = `Morning walk,Health,daily,07:00
Strength training,Fitness,4x,17:30
Daily Git commit,Craft,weekdays,18:00
Read 20 pages,Learning,daily,21:30`;

export function BulkImportHabitsDialog({
  open,
  onOpenChange,
}: BulkImportHabitsDialogProps) {
  const [rawText, setRawText] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseBulkHabitImport(rawText);
  }, [rawText]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRawText("");
    }
    onOpenChange(nextOpen);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setRawText(content);
    } catch {
      toast.error("Could not read selected file.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preview || preview.error || preview.rows.length === 0 || isPending) {
      return;
    }

    startTransition(async () => {
      const result = await bulkImportHabitsAction({ rawText });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        `Imported ${result.data.importedCount} habit${result.data.importedCount === 1 ? "" : "s"}.`
      );
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Bulk import habits
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Paste one habit per line or CSV columns{" "}
            <code className="mono-tabular rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
              title,category,cadence,preferredTime
            </code>{" "}
            (up to {MAX_BULK_IMPORT_HABITS} rows).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => fileInputRef.current?.click()}
                className="mira-row gap-1.5 px-2.5 text-xs"
              >
                <Upload className="size-3" />
                Upload .csv
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setRawText(SAMPLE_CSV)}
                className="mira-row px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Load sample
              </Button>
            </div>

            {preview ? (
              preview.error ? (
                <span className="text-[11px] font-medium text-overdue">
                  {preview.error}
                </span>
              ) : (
                <span className="mono-tabular text-[11px] font-medium text-done">
                  {preview.rows.length} habit
                  {preview.rows.length === 1 ? "" : "s"} ready
                </span>
              )
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-habits-input" className="text-xs">
              Habits list or CSV
            </Label>
            <Textarea
              id="bulk-habits-input"
              name="bulkHabitsRaw"
              rows={7}
              placeholder={SAMPLE_CSV}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="bg-background font-mono text-xs leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground">
              Cadence accepts <code className="font-mono">daily</code>,{" "}
              <code className="font-mono">weekdays</code>,{" "}
              <code className="font-mono">weekends</code>, or{" "}
              <code className="font-mono">3x</code>–
              <code className="font-mono">7x</code>.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                !preview ||
                Boolean(preview.error) ||
                preview.rows.length === 0 ||
                isPending
              }
              className="mira-row px-4 text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${preview && !preview.error ? preview.rows.length : ""} habits`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
