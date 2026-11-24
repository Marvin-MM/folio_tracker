"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { bulkImportHabitHistoryAction } from "@/actions/habits";
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
import { parseHabitHistoryImport } from "@/server/domain/habit-import";
import {
  parseAliasOverrides,
  planHabitEvolution,
  type AliasOverride,
  type MonthRoster,
} from "@/server/domain/habit-evolution";
import {
  readWorkbook,
  worksheetSheetsToHistoryImport,
} from "@/lib/spreadsheet-import";

interface BulkImportHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SAMPLE_CSV = `Habit,Date,Status
Morning walk,2026-11-01,✔
Morning walk,2026-11-02,✗
Read 20 pages,2026-11-01,done`;

export function BulkImportHistoryDialog({
  open,
  onOpenChange,
}: BulkImportHistoryDialogProps) {
  const [rawText, setRawText] = useState("");
  const [month, setMonth] = useState("");
  const [monthRosters, setMonthRosters] = useState<MonthRoster[]>([]);
  const [aliasText, setAliasText] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [archiveRemoved, setArchiveRemoved] = useState(true);
  const [fileName, setFileName] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRawText("");
    setMonth("");
    setMonthRosters([]);
    setAliasText("");
    setFileName("");
  }, [open]);

  const aliasResult = useMemo(() => parseAliasOverrides(aliasText), [aliasText]);
  const overrides: AliasOverride[] = aliasResult.overrides;

  const parsed = useMemo(
    () =>
      rawText.trim()
        ? parseHabitHistoryImport(rawText, {
            month: month || undefined,
          })
        : null,
    [rawText, month]
  );

  const evolution = useMemo(
    () => planHabitEvolution(monthRosters, overrides),
    [monthRosters, overrides]
  );

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const sheets = await readWorkbook(file);
        const result = worksheetSheetsToHistoryImport(sheets);
        setRawText(result.csv);
        setMonthRosters(result.monthRosters);
        setMonth("");
        for (const warning of result.warnings) toast.warning(warning);
        toast.success(
          `Read ${result.monthRosters.length} month sheets from ${file.name}.`
        );
      } else {
        setRawText(await file.text());
        setMonthRosters([]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not read that file."
      );
    }
  };

  const acceptSuggestion = (sourceTitle: string, canonicalTitle: string) => {
    setAliasText((current) =>
      current.trim()
        ? `${current.replace(/\s+$/, "")}\n${sourceTitle},${canonicalTitle}`
        : `${sourceTitle},${canonicalTitle}`
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || parsed.error) {
      toast.error(parsed?.error ?? "Provide history rows first.");
      return;
    }
    if (aliasResult.error) {
      toast.error(aliasResult.error);
      return;
    }

    startTransition(async () => {
      const result = await bulkImportHabitHistoryAction({
        rawText,
        month: month || undefined,
        createMissing,
        archiveRemoved,
        monthRosters,
        aliasOverrides: overrides,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      const { data } = result;
      toast.success(
        `Imported ${data.importedCount.toLocaleString()} marks across ${data.matchedTitleCount + data.createdHabits.length} habits.`
      );
      if (data.createdHabits.length > 0) {
        toast.info(`Created ${data.createdHabits.length} new habits.`);
      }
      if (data.archivedHabits.length > 0) {
        toast.info(`Archived ${data.archivedHabits.length} finished habits.`);
      }
      for (const warning of data.warnings.slice(0, 3)) {
        toast.warning(warning);
      }
      onOpenChange(false);
    });
  };

  const evolutionGroups = evolution.groups.filter(
    (group) => group.aliases.length > 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" />
            Import completion history
          </DialogTitle>
          <DialogDescription>
            Upload an Excel tracker or paste a grid. Rows are habits, columns
            are dates; use ✔ done, ✗ missed, ⚠ skipped. Renames and merges are
            previewed before anything is written.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" />
              Choose file
            </Button>
            {fileName ? (
              <span className="text-xs text-muted-foreground">{fileName}</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                .xlsx (multi-sheet), .csv or pasted text
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="history-month">
                Month for bare day columns (optional)
              </Label>
              <input
                id="history-month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                placeholder="2026-11"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="history-text">History grid or long CSV</Label>
            <Textarea
              id="history-text"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder={SAMPLE_CSV}
              rows={7}
              className="font-mono text-[11px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Long format: Habit,Date,Status. Wide format: first cell "Habit",
              then date or day columns.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(event) => setCreateMissing(event.target.checked)}
              />
              Create missing habits
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={archiveRemoved}
                onChange={(event) => setArchiveRemoved(event.target.checked)}
              />
              Archive habits absent from the last month
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alias-text">
              Alias overrides — "Old title,Current title" (optional)
            </Label>
            <Textarea
              id="alias-text"
              value={aliasText}
              onChange={(event) => setAliasText(event.target.value)}
              placeholder="Pray and read Daily Text,Pray · Meditate · Gratitude"
              rows={3}
              className="font-mono text-[11px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Use this for renames we could not detect automatically. One
              mapping per line.
            </p>
          </div>

          {parsed?.error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {parsed.error}
            </p>
          ) : null}
          {aliasResult.error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {aliasResult.error}
            </p>
          ) : null}

          {parsed && !parsed.error ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <p className="font-semibold">
                {parsed.rows.length.toLocaleString()} marks ·{" "}
                {parsed.titles.length} titles ·{" "}
                {evolution.groups.length} habit identities
              </p>
              <p className="mt-1 text-muted-foreground">
                {monthRosters.length > 0
                  ? `${monthRosters.length} months detected (${monthRosters[0]?.month} → ${monthRosters[monthRosters.length - 1]?.month}).`
                  : "No month sheets supplied; every source title stays separate unless you add an alias."}
              </p>

              {evolutionGroups.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <p className="font-semibold">Detected renames & merges</p>
                  <div className="max-h-40 overflow-y-auto rounded border bg-background p-2">
                    {evolutionGroups.map((group) => (
                      <div
                        key={group.id}
                        className="border-b border-border/60 py-1 last:border-0"
                      >
                        <span className="font-medium">
                          {group.canonicalTitle}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          ← {group.aliases.join(", ")}
                          {group.isMerge ? " (merged)" : ""}
                          {group.lastMonth ? ` · through ${group.lastMonth}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {evolution.suggestions.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <p className="font-semibold">Possible matches — confirm?</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {evolution.suggestions.slice(0, 8).map((suggestion) => (
                      <div
                        key={`${suggestion.sourceTitle}-${suggestion.canonicalTitle}`}
                        className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1"
                      >
                        <span className="min-w-0 truncate">
                          {suggestion.sourceTitle} → {suggestion.canonicalTitle}
                          <span className="ml-1 text-muted-foreground">
                            ({suggestion.score})
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-[11px]"
                          onClick={() =>
                            acceptSuggestion(
                              suggestion.sourceTitle,
                              suggestion.canonicalTitle
                            )
                          }
                        >
                          Accept
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !parsed || !!parsed.error}>
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Import history
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
