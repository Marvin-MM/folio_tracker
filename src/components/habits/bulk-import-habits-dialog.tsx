"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { bulkImportHabitsAction } from "@/actions/habits";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
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
  IMPORT_FILE_ACCEPT,
  isLikelyHistoryWorkbook,
  readWorkbook,
  validateImportFile,
  worksheetToHabitCsv,
} from "@/lib/spreadsheet-import";
import {
  MAX_BULK_IMPORT_HABITS,
  parseBulkHabitImport,
  type ParsedBulkHabitRow,
} from "@/server/domain/habit-analytics";

function formatPreviewCadence(row: ParsedBulkHabitRow): string {
  if (row.cadenceType === "daily") return "Daily";
  if (row.cadenceType === "weekly_target") {
    return `${row.weeklyTargetCount ?? 3}×/wk`;
  }
  const key = row.scheduledDays.join(",");
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,6") return "Weekends";
  return `${row.scheduledDays.length}d/wk`;
}

interface BulkImportHabitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetYearMonth?: string;
  onSwitchToHistoryImport?: () => void;
}

const SAMPLE_CSV = `title,category,cadence,preferredTime,startDate
Morning walk,Health,daily,07:00,2026-01-01
Strength training,Fitness,4x,17:30,2026-01-01
Daily Git commit,Craft,weekdays,18:00,2026-02-01
Read 20 pages,Learning,daily,21:30,`;

export function BulkImportHabitsDialog({
  open,
  onOpenChange,
  targetYearMonth,
  onSwitchToHistoryImport,
}: BulkImportHabitsDialogProps) {
  const [rawText, setRawText] = useState("");
  const [historyFileHint, setHistoryFileHint] = useState(false);
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseBulkHabitImport(rawText);
  }, [rawText]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRawText("");
      setHistoryFileHint(false);
    }
    onOpenChange(nextOpen);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setHistoryFileHint(false);
    try {
      const checked = await validateImportFile(file);
      if (checked.kind === "xlsx") {
        const sheets = await readWorkbook(file);
        if (sheets.length === 0) {
          toast.error("That workbook has no sheets.");
          return;
        }
        if (isLikelyHistoryWorkbook(sheets)) {
          setHistoryFileHint(true);
          toast.warning(
            "This workbook contains a monthly completion grid. Use 'Import History' to import all months and marks."
          );
          return;
        }
        setRawText(worksheetToHabitCsv(sheets[0]!));
        toast.success(`Read "${sheets[0]!.sheet}" from ${file.name}.`);
      } else {
        setRawText(await file.text());
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Only .xlsx, .csv, and .txt files can be imported."
      );
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
      const result = await bulkImportHabitsAction({
        rawText,
        targetYearMonth,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["habits", "today", "sidebar", "admin"]);
      toast.success(
        `Imported ${result.data.importedCount} habit${result.data.importedCount === 1 ? "" : "s"}.`
      );
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Bulk import habits
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Paste one habit per line or CSV columns{" "}
            <code className="mono-tabular rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
              title,category,cadence,preferredTime,startDate
            </code>{" "}
            (startDate optional; up to {MAX_BULK_IMPORT_HABITS} rows). You can
            also upload an .xlsx sheet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <input
                id="bulk-habits-file"
                name="bulkHabitsFile"
                aria-label="Upload habits CSV, TXT, or Excel file"
                ref={fileInputRef}
                type="file"
                accept={IMPORT_FILE_ACCEPT}
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
                Upload file
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

          {historyFileHint ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-reminder/35 bg-reminder/10 px-3 py-2 text-xs text-foreground">
              <span>
                This Excel file contains monthly habit tracking grids. Use{" "}
                <strong>Import History</strong> to import all months &amp; marks.
              </span>
              {onSwitchToHistoryImport ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    handleOpenChange(false);
                    onSwitchToHistoryImport();
                  }}
                  className="h-7 px-2.5 text-xs"
                >
                  Open Import History
                </Button>
              ) : null}
            </div>
          ) : null}

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
              className="max-h-40 resize-y overflow-y-auto bg-background font-mono text-xs leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground">
              Cadence accepts <code className="font-mono">daily</code>,{" "}
              <code className="font-mono">weekdays</code>,{" "}
              <code className="font-mono">weekends</code>, or{" "}
              <code className="font-mono">3x</code>–
              <code className="font-mono">7x</code>. Start date uses{" "}
              <code className="font-mono">YYYY-MM-DD</code>; blank means today.
            </p>
          </div>

          {preview && !preview.error && preview.rows.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
              <table className="w-full text-left text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-1">Title</th>
                    <th className="pb-1">Category</th>
                    <th className="pb-1">Cadence</th>
                    <th className="pb-1">Start</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.title} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-medium">{row.title}</td>
                      <td className="py-1 pr-2">{row.category ?? "—"}</td>
                      <td className="py-1 pr-2">
                        {formatPreviewCadence(row)}
                      </td>
                      <td className="py-1 font-mono">
                        {row.startDate ?? "today"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.warnings?.length ? (
                <p className="mt-2 text-[11px] text-overdue">
                  {preview.warnings.join(" ")}
                </p>
              ) : null}
            </div>
          ) : null}

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
