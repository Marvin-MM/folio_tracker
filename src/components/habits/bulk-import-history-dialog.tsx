"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import type { Sheet } from "read-excel-file/browser";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { bulkImportHabitHistoryAction } from "@/actions/habits";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import {
  IMPORT_FILE_ACCEPT,
  readWorkbook,
  validateImportFile,
  worksheetSheetsToHistoryImport,
  type WorkbookHistoryImport,
} from "@/lib/spreadsheet-import";
import {
  parseAliasOverrides,
  planHabitEvolution,
  type AliasOverride,
  type MonthRoster,
} from "@/server/domain/habit-evolution";
import {
  deriveMonthRostersFromLogs,
  parseHabitHistoryImport,
} from "@/server/domain/habit-import";

interface BulkImportHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current user's local today YYYY-MM-DD so future dates/months are prevented. */
  todayDateKey: string;
}

const SAMPLE_CSV = `Habit,Date,Status
Wake up at 4:30,2026-09-01,✔
Wake up at 4:30,2026-09-02,✔
Wake up 4:30,2026-10-01,✔
Wake up 4:30,2026-10-02,⚠
Odoo Documentation,2026-09-01,✔
Odoo Documentation,2026-09-02,✗`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BulkImportHistoryDialog({
  open,
  onOpenChange,
  todayDateKey,
}: BulkImportHistoryDialogProps) {
  const invalidate = useInvalidateWorkspace();
  const currentMonth = todayDateKey.slice(0, 7);

  const [pastedText, setPastedText] = useState("");
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{
    name: string;
    size: number;
    kind: "xlsx" | "text";
  } | null>(null);
  const [uploadedCsv, setUploadedCsv] = useState<string | null>(null);
  const [sheetSummaries, setSheetSummaries] = useState<
    WorkbookHistoryImport["sheetSummaries"]
  >([]);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [workbookYear, setWorkbookYear] = useState(() =>
    todayDateKey.slice(0, 4)
  );
  const [loadedSheets, setLoadedSheets] = useState<Sheet[] | null>(null);
  const [monthRosters, setMonthRosters] = useState<MonthRoster[]>([]);
  const [aliasText, setAliasText] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [archiveRemoved, setArchiveRemoved] = useState(true);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const resetFormState = () => {
    setPastedText("");
    setUploadedFileMeta(null);
    setUploadedCsv(null);
    setSheetSummaries([]);
    setFileWarnings([]);
    setMonth("");
    setLoadedSheets(null);
    setMonthRosters([]);
    setAliasText("");
    setIsReadingFile(false);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetFormState();
    }
    onOpenChange(nextOpen);
  };

  const effectiveRawText = uploadedCsv !== null ? uploadedCsv : pastedText;

  const aliasResult = useMemo(() => parseAliasOverrides(aliasText), [aliasText]);
  const overrides: AliasOverride[] = aliasResult.overrides;

  const parsed = useMemo(
    () =>
      effectiveRawText.trim()
        ? parseHabitHistoryImport(effectiveRawText, {
            month:
              uploadedFileMeta?.kind === "xlsx"
                ? undefined
                : month.trim() || undefined,
            todayDateKey,
          })
        : null,
    [effectiveRawText, month, todayDateKey, uploadedFileMeta]
  );

  // Derive rosters automatically from parsed CSV/pasted rows when no Excel sheet rosters exist
  const effectiveMonthRosters = useMemo(() => {
    if (monthRosters.length > 0) return monthRosters;
    if (parsed && !parsed.error && parsed.rows.length > 0) {
      return deriveMonthRostersFromLogs(parsed.rows);
    }
    return [];
  }, [monthRosters, parsed]);

  const evolution = useMemo(
    () => planHabitEvolution(effectiveMonthRosters, overrides),
    [effectiveMonthRosters, overrides]
  );

  const applyWorkbookSheets = (
    sheets: Sheet[],
    yearStr: string,
    fallbackMonthStr: string,
    fileName: string,
    announceToast = true
  ) => {
    const parsedYear = Number(yearStr);
    const resolvedYear =
      Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2099
        ? parsedYear
        : Number(todayDateKey.slice(0, 4)) || new Date().getFullYear();

    const result = worksheetSheetsToHistoryImport(sheets, {
      defaultYear: resolvedYear,
      fallbackMonth: fallbackMonthStr.trim() || undefined,
      maxMonth: currentMonth,
    });
    setUploadedCsv(result.csv);
    setMonthRosters(result.monthRosters);
    setSheetSummaries(result.sheetSummaries);
    setFileWarnings(result.warnings);
    if (announceToast) {
      for (const warning of result.warnings.slice(0, 3)) toast.warning(warning);
      if (result.monthRosters.length > 0) {
        toast.success(
          `Read ${result.monthRosters.length} month sheet${result.monthRosters.length === 1 ? "" : "s"} from ${fileName}.`
        );
      }
    }
  };

  const handleFile = async (file: File) => {
    setIsReadingFile(true);
    try {
      const checked = await validateImportFile(file);
      if (checked.kind === "xlsx") {
        const sheets = await readWorkbook(file);
        if (sheets.length === 0) {
          toast.error("This workbook has no readable sheets.");
          return;
        }
        setLoadedSheets(sheets);
        setUploadedFileMeta({ name: file.name, size: file.size, kind: "xlsx" });
        setPastedText("");
        applyWorkbookSheets(sheets, workbookYear, month, file.name, true);
      } else {
        const text = await file.text();
        setLoadedSheets(null);
        setSheetSummaries([]);
        setFileWarnings([]);
        setMonthRosters([]);
        setUploadedFileMeta({ name: file.name, size: file.size, kind: "text" });
        setUploadedCsv(text);
        setPastedText("");
        toast.success(`Loaded ${file.name}.`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not read that file. Only .xlsx, .csv, and .txt files are allowed."
      );
    } finally {
      setIsReadingFile(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const handleWorkbookYearChange = (nextYear: string) => {
    setWorkbookYear(nextYear);
    if (
      loadedSheets &&
      /^(20\d{2})$/.test(nextYear.trim()) &&
      uploadedFileMeta
    ) {
      applyWorkbookSheets(
        loadedSheets,
        nextYear.trim(),
        month,
        uploadedFileMeta.name,
        false
      );
    }
  };

  const handleMonthChange = (nextMonth: string) => {
    setMonth(nextMonth);
    if (
      loadedSheets &&
      loadedSheets.length === 1 &&
      uploadedFileMeta &&
      (/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth.trim()) || !nextMonth.trim())
    ) {
      applyWorkbookSheets(
        loadedSheets,
        workbookYear,
        nextMonth.trim(),
        uploadedFileMeta.name,
        false
      );
    }
  };

  const acceptSuggestion = (sourceTitle: string, canonicalTitle: string) => {
    const escapeIfComma = (val: string) =>
      val.includes(",") ? `"${val.replace(/"/g, '""')}"` : val;
    const line = `${escapeIfComma(sourceTitle)},${escapeIfComma(canonicalTitle)}`;
    setAliasText((current) =>
      current.trim() ? `${current.replace(/\s+$/, "")}\n${line}` : line
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
        rawText: effectiveRawText,
        month:
          uploadedFileMeta?.kind === "xlsx"
            ? undefined
            : month.trim() || undefined,
        createMissing,
        archiveRemoved,
        monthRosters: effectiveMonthRosters,
        aliasOverrides: overrides,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(["habits", "today", "tasks", "sidebar", "admin"]);

      const { data } = result;
      toast.success(
        `Imported ${data.importedCount.toLocaleString()} marks across ${data.matchedTitleCount + data.createdHabits.length} habits.`
      );
      if (data.createdHabits.length > 0) {
        toast.info(
          `Created ${data.createdHabits.length} new habit${data.createdHabits.length === 1 ? "" : "s"}.`
        );
      }
      if (data.archivedHabits.length > 0) {
        toast.info(
          `Archived ${data.archivedHabits.length} finished habit${data.archivedHabits.length === 1 ? "" : "s"}.`
        );
      }
      for (const warning of data.warnings.slice(0, 3)) {
        toast.warning(warning);
      }
      handleOpenChange(false);
    });
  };

  const evolutionGroups = evolution.groups.filter(
    (group) => group.aliases.length > 0
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4 text-done" aria-hidden="true" />
            Import completion history
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Upload a 1-month or multi-month Excel workbook (`.xlsx`), `.csv`,
            `.txt`, or paste a grid. Each sheet populates that month&apos;s
            exact habit roster; future months are automatically skipped.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="history-import-file"
                name="historyImportFile"
                aria-label="Upload habit history spreadsheet (.xlsx, .csv, or .txt)"
                ref={fileRef}
                type="file"
                accept={IMPORT_FILE_ACCEPT}
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
                disabled={isReadingFile || isPending}
                onClick={() => fileRef.current?.click()}
                className="mira-row gap-1.5 text-xs"
              >
                {isReadingFile ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload className="size-3.5" aria-hidden="true" />
                )}
                {isReadingFile ? "Reading file…" : "Choose file"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isReadingFile || isPending}
                onClick={() => {
                  resetFormState();
                  setPastedText(SAMPLE_CSV);
                }}
                className="mira-row px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Load sample
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Allowed: .xlsx, .csv, .txt (max 10 MB)
              </span>
            </div>
          </div>

          {/* Compact Loaded File Summary Card (prevents 8,000+ lines freezing a textarea) */}
          {uploadedFileMeta ? (
            <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileSpreadsheet
                    className="size-4 shrink-0 text-done"
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium text-foreground">
                    {uploadedFileMeta.name}
                  </span>
                  <span className="mono-tabular shrink-0 text-[11px] text-muted-foreground">
                    {formatBytes(uploadedFileMeta.size)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={resetFormState}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" aria-hidden="true" />
                  Clear
                </Button>
              </div>

              {sheetSummaries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sheetSummaries.map((sheet) => (
                    <Badge
                      key={sheet.sheet}
                      variant="outline"
                      className="mono-tabular h-5 border-border bg-card px-1.5 text-[10px] font-normal"
                    >
                      {sheet.sheet}
                      {sheet.skippedReason
                        ? ` · skipped (${sheet.skippedReason})`
                        : ` · ${sheet.habitCount} habits`}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {fileWarnings.length > 0 ? (
                <p className="text-[11px] text-reminder">
                  {fileWarnings.slice(0, 2).join(" ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="history-month" className="text-xs">
                Month for bare day columns / 1-sheet file (optional)
              </Label>
              <Input
                id="history-month"
                name="historyMonth"
                value={month}
                onChange={(event) => handleMonthChange(event.target.value)}
                placeholder={currentMonth}
                className="mira-row bg-background font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-workbook-year" className="text-xs">
                Default year for month-only Excel tabs
              </Label>
              <Input
                id="history-workbook-year"
                name="historyWorkbookYear"
                value={workbookYear}
                onChange={(event) =>
                  handleWorkbookYearChange(event.target.value)
                }
                placeholder={todayDateKey.slice(0, 4)}
                maxLength={4}
                className="mira-row bg-background font-mono text-xs"
              />
            </div>
          </div>

          {!uploadedFileMeta ? (
            <div className="space-y-1.5">
              <Label htmlFor="history-text" className="text-xs">
                Or paste a history grid / CSV
              </Label>
              <Textarea
                id="history-text"
                name="historyRawText"
                value={pastedText}
                onChange={(event) => setPastedText(event.target.value)}
                placeholder={SAMPLE_CSV}
                rows={6}
                className="max-h-40 resize-y overflow-y-auto bg-background font-mono text-[11px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Long format: <code className="font-mono">Habit,Date,Status</code>
                . Wide format: first cell &ldquo;Habit&rdquo;, then ISO dates,
                day numbers (<code className="font-mono">1–31</code>), or
                weekday letters.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-4">
            <label
              htmlFor="history-create-missing"
              className="flex min-h-9 cursor-pointer items-center gap-2 text-xs md:min-h-6"
            >
              <input
                id="history-create-missing"
                name="createMissing"
                type="checkbox"
                checked={createMissing}
                onChange={(event) => setCreateMissing(event.target.checked)}
                className="size-4 accent-foreground"
              />
              Create missing habits
            </label>
            <label
              htmlFor="history-archive-removed"
              className="flex min-h-9 cursor-pointer items-center gap-2 text-xs md:min-h-6"
            >
              <input
                id="history-archive-removed"
                name="archiveRemoved"
                type="checkbox"
                checked={archiveRemoved}
                onChange={(event) => setArchiveRemoved(event.target.checked)}
                className="size-4 accent-foreground"
              />
              Archive habits absent from the last month
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alias-text" className="text-xs">
              Alias overrides — &ldquo;Old title,Current title&rdquo; (optional)
            </Label>
            <Textarea
              id="alias-text"
              name="aliasOverrides"
              value={aliasText}
              onChange={(event) => setAliasText(event.target.value)}
              placeholder="Pray and read Daily Text,Pray · Meditate · Gratitude"
              rows={3}
              className="max-h-28 resize-y overflow-y-auto bg-background font-mono text-[11px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Use this for renames we could not detect automatically. One
              mapping per line (wrap titles containing commas in quotes).
            </p>
          </div>

          {parsed?.error ? (
            <p className="rounded-md border border-overdue/30 bg-overdue/10 px-3 py-2 text-xs text-overdue">
              {parsed.error}
            </p>
          ) : null}
          {aliasResult.error ? (
            <p className="rounded-md border border-overdue/30 bg-overdue/10 px-3 py-2 text-xs text-overdue">
              {aliasResult.error}
            </p>
          ) : null}

          {parsed && !parsed.error ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <p className="mono-tabular font-semibold text-foreground">
                {parsed.rows.length.toLocaleString()} marks ·{" "}
                {parsed.titles.length} source titles ·{" "}
                {evolution.groups.length} habit identities
              </p>
              <p className="mt-1 text-muted-foreground">
                {effectiveMonthRosters.length > 0
                  ? `${effectiveMonthRosters.length} month${effectiveMonthRosters.length === 1 ? "" : "s"} detected (${effectiveMonthRosters[0]?.month} → ${effectiveMonthRosters[effectiveMonthRosters.length - 1]?.month}). Each month will render only its own habits.`
                  : "Every source title stays separate unless you add an alias."}
              </p>

              {evolutionGroups.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <p className="font-semibold text-foreground">
                    Detected renames &amp; merges
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded border border-border bg-background p-2">
                    {evolutionGroups.map((group) => (
                      <div
                        key={group.id}
                        className="border-b border-border/60 py-1 last:border-0"
                      >
                        <span className="font-medium text-foreground">
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
                  <p className="font-semibold text-foreground">
                    Possible matches — confirm?
                  </p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {evolution.suggestions.slice(0, 8).map((suggestion) => (
                      <div
                        key={`${suggestion.sourceTitle}-${suggestion.canonicalTitle}`}
                        className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background px-2 py-1"
                      >
                        <span className="min-w-0 truncate">
                          {suggestion.sourceTitle} → {suggestion.canonicalTitle}
                          <span className="mono-tabular ml-1 text-muted-foreground">
                            ({suggestion.score})
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="min-h-8 shrink-0 px-2 text-[11px] md:min-h-6"
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

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                isPending ||
                isReadingFile ||
                !parsed ||
                Boolean(parsed.error) ||
                Boolean(aliasResult.error)
              }
              className="mira-row gap-1.5 px-4 text-xs"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-3.5" aria-hidden="true" />
              )}
              Import history
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
