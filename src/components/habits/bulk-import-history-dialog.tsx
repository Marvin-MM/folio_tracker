"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Sheet } from "read-excel-file/browser";
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import type { HabitLogStatus, HabitRecord } from "@/server/db/schema";
import {
  normalizeImportTitle,
  parseAliasOverrides,
  planHabitEvolution,
  resolveCanonicalTitle,
  type AliasOverride,
  type MonthRoster,
} from "@/server/domain/habit-evolution";
import {
  deriveMonthRostersFromLogs,
  MAX_HISTORY_IMPORT_CHUNK_SIZE,
  parseHabitHistoryImport,
} from "@/server/domain/habit-import";

interface BulkImportHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current user's local today YYYY-MM-DD so future dates/months are prevented. */
  todayDateKey: string;
}

type CompactChunkTuple = [string, string, HabitLogStatus];

interface ImportChunkBatch {
  label: string;
  entries: CompactChunkTuple[];
}

interface PrepareApiResponse {
  ok: true;
  phase: "prepare";
  data: {
    habitIdByCanonicalKey: Record<string, string>;
    createdHabits: HabitRecord[];
    archivedHabits: HabitRecord[];
    matchedTitleCount: number;
    skippedTitleCount: number;
    aliasCount: number;
  };
}

interface ChunkApiResponse {
  ok: true;
  phase: "chunk";
  data: {
    importedCount: number;
    syncedTaskCount: number;
    warnings: string[];
  };
}

interface ImportProgressState {
  statusLabel: string;
  completedMarks: number;
  totalMarks: number;
  completedChunks: number;
  totalChunks: number;
}

interface ResumableImportState {
  chunks: ImportChunkBatch[];
  nextChunkIndex: number;
  allowAutoLockedBackfill: boolean;
  preparedMeta: PrepareApiResponse["data"];
  importedSoFar: number;
  totalMarks: number;
  warnings: string[];
  errorMessage: string;
}

const MERGE_STATUS_PRIORITY: Record<HabitLogStatus, number> = {
  done: 3,
  skipped: 2,
  missed: 1,
};

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

function buildChunkBatches(
  tuples: CompactChunkTuple[],
  maxPerChunk: number
): ImportChunkBatch[] {
  // Sort by dateKey so chunks group cleanly by calendar month for readable progress
  const sorted = [...tuples].sort(
    (a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])
  );
  const chunks: ImportChunkBatch[] = [];

  for (let i = 0; i < sorted.length; i += maxPerChunk) {
    const slice = sorted.slice(i, i + maxPerChunk);
    const firstMonth = slice[0]![1].slice(0, 7);
    const lastMonth = slice[slice.length - 1]![1].slice(0, 7);
    const label =
      firstMonth === lastMonth ? firstMonth : `${firstMonth} → ${lastMonth}`;
    chunks.push({ label, entries: slice });
  }

  return chunks;
}

async function postImportPhase<T>(
  payload: unknown,
  maxRetries = 1
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("/api/workspace/habits/import-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const json = contentType.includes("application/json")
        ? ((await response.json()) as {
            ok?: boolean;
            error?: { code?: string; message?: string };
          })
        : null;

      if (!response.ok) {
        const message =
          json?.error?.message ??
          `Import request failed (${response.status}).`;
        // Retry only on transient 5xx / 504 errors, never on 4xx validation or lock errors
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = new Error(message);
          await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
          continue;
        }
        throw new Error(message);
      }

      return json as T;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Network error while importing.");
      if (attempt < maxRetries && error instanceof TypeError) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("Import request failed.");
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
  const [allowAutoLockedBackfill, setAllowAutoLockedBackfill] = useState(true);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [resumable, setResumable] = useState<ResumableImportState | null>(null);
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
    setIsImporting(false);
    setProgress(null);
    setResumable(null);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isImporting) {
      return;
    }
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

  const hasPastMonths = useMemo(
    () => effectiveMonthRosters.some((roster) => roster.month < currentMonth),
    [effectiveMonthRosters, currentMonth]
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
    setResumable(null);
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
    setResumable(null);
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

  const runChunks = async (params: {
    chunks: ImportChunkBatch[];
    startIndex: number;
    allowBackfill: boolean;
    preparedMeta: PrepareApiResponse["data"];
    importedSoFar: number;
    totalMarks: number;
    warnings: string[];
  }) => {
    const {
      chunks,
      startIndex,
      allowBackfill,
      preparedMeta,
      totalMarks,
      warnings,
    } = params;

    let importedCount = params.importedSoFar;
    const allWarnings = [...warnings];

    for (let idx = startIndex; idx < chunks.length; idx++) {
      const batch = chunks[idx]!;
      setProgress({
        statusLabel: `Importing ${batch.label} (batch ${idx + 1} of ${chunks.length})…`,
        completedMarks: importedCount,
        totalMarks,
        completedChunks: idx,
        totalChunks: chunks.length,
      });

      try {
        const chunkResp = await postImportPhase<ChunkApiResponse>({
          phase: "chunk",
          allowAutoLockedBackfill: allowBackfill,
          entries: batch.entries,
        });
        importedCount += chunkResp.data.importedCount;
        allWarnings.push(...chunkResp.data.warnings);
        setProgress({
          statusLabel: `Imported ${batch.label} (${importedCount.toLocaleString()} / ${totalMarks.toLocaleString()} marks)`,
          completedMarks: importedCount,
          totalMarks,
          completedChunks: idx + 1,
          totalChunks: chunks.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Chunk import failed.";
        setResumable({
          chunks,
          nextChunkIndex: idx,
          allowAutoLockedBackfill: allowBackfill,
          preparedMeta,
          importedSoFar: importedCount,
          totalMarks,
          warnings: allWarnings,
          errorMessage: message,
        });
        setIsImporting(false);
        toast.error(message);
        return;
      }
    }

    await invalidate(["habits", "today", "tasks", "sidebar", "admin"]);

    const totalHabits =
      preparedMeta.matchedTitleCount + preparedMeta.createdHabits.length;
    toast.success(
      `Imported ${importedCount.toLocaleString()} marks across ${totalHabits} habit${totalHabits === 1 ? "" : "s"}.`
    );
    if (preparedMeta.createdHabits.length > 0) {
      toast.info(
        `Created ${preparedMeta.createdHabits.length} new habit${preparedMeta.createdHabits.length === 1 ? "" : "s"}.`
      );
    }
    if (preparedMeta.archivedHabits.length > 0) {
      toast.info(
        `Archived ${preparedMeta.archivedHabits.length} finished habit${preparedMeta.archivedHabits.length === 1 ? "" : "s"}.`
      );
    }
    for (const warning of allWarnings.slice(0, 3)) {
      toast.warning(warning);
    }

    setIsImporting(false);
    resetFormState();
    onOpenChange(false);
  };

  const handleResumeRemaining = async () => {
    if (!resumable || isImporting) return;
    setIsImporting(true);
    setResumable(null);
    await runChunks({
      chunks: resumable.chunks,
      startIndex: resumable.nextChunkIndex,
      allowBackfill: resumable.allowAutoLockedBackfill,
      preparedMeta: resumable.preparedMeta,
      importedSoFar: resumable.importedSoFar,
      totalMarks: resumable.totalMarks,
      warnings: resumable.warnings,
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isImporting) return;
    if (!parsed || parsed.error) {
      toast.error(parsed?.error ?? "Provide history rows first.");
      return;
    }
    if (aliasResult.error) {
      toast.error(aliasResult.error);
      return;
    }

    setIsImporting(true);
    setResumable(null);
    setProgress({
      statusLabel: "Preparing habits and verifying month locks…",
      completedMarks: 0,
      totalMarks: parsed.rows.length,
      completedChunks: 0,
      totalChunks: Math.max(
        1,
        Math.ceil(parsed.rows.length / MAX_HISTORY_IMPORT_CHUNK_SIZE)
      ),
    });

    try {
      const resolvedRows = parsed.rows.map((row) => ({
        ...row,
        canonicalTitle: resolveCanonicalTitle(row.title, evolution, overrides),
      }));

      const groupByKey = new Map<
        string,
        {
          canonicalTitle: string;
          firstDate: string;
          lastDate: string;
          lastMonth: string;
          sourceTitles: Set<string>;
        }
      >();
      const aliasMeta = new Map<
        string,
        {
          sourceTitle: string;
          canonicalTitle: string;
          firstDate: string;
          lastDate: string;
        }
      >();
      const monthsSet = new Set<string>();

      for (const row of resolvedRows) {
        const key = normalizeImportTitle(row.canonicalTitle);
        const ym = row.dateKey.slice(0, 7);
        monthsSet.add(ym);

        const existing = groupByKey.get(key);
        if (!existing) {
          groupByKey.set(key, {
            canonicalTitle: row.canonicalTitle,
            firstDate: row.dateKey,
            lastDate: row.dateKey,
            lastMonth: ym,
            sourceTitles: new Set([row.canonicalTitle, row.title]),
          });
        } else {
          existing.sourceTitles.add(row.title);
          if (row.dateKey < existing.firstDate) existing.firstDate = row.dateKey;
          if (row.dateKey > existing.lastDate) {
            existing.lastDate = row.dateKey;
            existing.lastMonth = ym;
          }
        }

        const sourceKey = normalizeImportTitle(row.title);
        const existingAlias = aliasMeta.get(sourceKey);
        if (!existingAlias) {
          aliasMeta.set(sourceKey, {
            sourceTitle: row.title,
            canonicalTitle: row.canonicalTitle,
            firstDate: row.dateKey,
            lastDate: row.dateKey,
          });
        } else {
          if (row.dateKey < existingAlias.firstDate) {
            existingAlias.firstDate = row.dateKey;
          }
          if (row.dateKey > existingAlias.lastDate) {
            existingAlias.lastDate = row.dateKey;
          }
        }
      }

      for (const group of evolution.groups) {
        const entry = groupByKey.get(normalizeImportTitle(group.canonicalTitle));
        if (!entry) continue;
        if (group.lastMonth) entry.lastMonth = group.lastMonth;
        for (const sourceTitle of group.sourceTitles) {
          entry.sourceTitles.add(sourceTitle);
        }
      }

      // Phase 1: Prepare habits, startDate backfills, archival, aliases & month-lock check
      const prepareResp = await postImportPhase<PrepareApiResponse>({
        phase: "prepare",
        habits: Array.from(groupByKey.values()).map((g) => ({
          canonicalTitle: g.canonicalTitle,
          firstDate: g.firstDate,
          lastDate: g.lastDate,
          lastMonth: g.lastMonth,
          sourceTitles: Array.from(g.sourceTitles),
        })),
        months: Array.from(monthsSet).sort(),
        firstMonth: evolution.firstMonth,
        lastMonth: evolution.lastMonth,
        createMissing,
        archiveRemoved,
        allowAutoLockedBackfill,
        aliasEntries: Array.from(aliasMeta.values()),
      });

      const idByKey = prepareResp.data.habitIdByCanonicalKey;

      // Deduplicate by (habitId, dateKey) with deterministic done > skipped > missed precedence
      const dedupedByComposite = new Map<string, CompactChunkTuple>();
      for (const row of resolvedRows) {
        const habitId = idByKey[normalizeImportTitle(row.canonicalTitle)];
        if (!habitId) continue;
        const compositeKey = `${habitId}|${row.dateKey}`;
        const prev = dedupedByComposite.get(compositeKey);
        if (
          prev &&
          MERGE_STATUS_PRIORITY[prev[2]] >= MERGE_STATUS_PRIORITY[row.status]
        ) {
          continue;
        }
        dedupedByComposite.set(compositeKey, [habitId, row.dateKey, row.status]);
      }

      const compactTuples = Array.from(dedupedByComposite.values());
      const chunks = buildChunkBatches(
        compactTuples,
        MAX_HISTORY_IMPORT_CHUNK_SIZE
      );

      if (chunks.length === 0) {
        await invalidate(["habits", "today", "tasks", "sidebar", "admin"]);
        toast.info("No matching habit marks to import.");
        setIsImporting(false);
        resetFormState();
        onOpenChange(false);
        return;
      }

      // Phase 2: Sequential sub-second chunks (~45 KB JSON each, immune to Vercel timeouts)
      await runChunks({
        chunks,
        startIndex: 0,
        allowBackfill: allowAutoLockedBackfill,
        preparedMeta: prepareResp.data,
        importedSoFar: 0,
        totalMarks: compactTuples.length,
        warnings: [...parsed.warnings, ...evolution.warnings],
      });
    } catch (error) {
      setIsImporting(false);
      setProgress(null);
      toast.error(
        error instanceof Error ? error.message : "Unable to import habit history."
      );
    }
  };

  const evolutionGroups = evolution.groups.filter(
    (group) => group.aliases.length > 0
  );
  const progressPct =
    progress && progress.totalMarks > 0
      ? Math.min(
          100,
          Math.round((progress.completedMarks / progress.totalMarks) * 100)
        )
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onInteractOutside={(event) => {
          if (isImporting) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isImporting) event.preventDefault();
        }}
        className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4 text-done" aria-hidden="true" />
            Import completion history
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Upload a 1-month or multi-year Excel workbook (`.xlsx`), `.csv`,
            `.txt`, or paste a grid. Large multi-month imports stream in safe
            batches with live progress.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
                disabled={isReadingFile || isImporting}
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
                disabled={isReadingFile || isImporting}
                onClick={() => {
                  resetFormState();
                  setPastedText(SAMPLE_CSV);
                }}
                className="mira-row px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Load sample
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Allowed: .xlsx, .csv, .txt (max 10 MB · up to 50,000 marks)
              </span>
            </div>
          </div>

          {/* Compact Loaded File Summary Card */}
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
                  disabled={isImporting}
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
                disabled={isImporting}
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
                disabled={isImporting}
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
                disabled={isImporting}
                value={pastedText}
                onChange={(event) => {
                  setPastedText(event.target.value);
                  setResumable(null);
                }}
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

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label
              htmlFor="history-create-missing"
              className="flex min-h-9 cursor-pointer items-center gap-2 text-xs md:min-h-6"
            >
              <input
                id="history-create-missing"
                name="createMissing"
                type="checkbox"
                disabled={isImporting}
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
                disabled={isImporting}
                checked={archiveRemoved}
                onChange={(event) => setArchiveRemoved(event.target.checked)}
                className="size-4 accent-foreground"
              />
              Archive habits absent from the last month
            </label>
            {hasPastMonths ? (
              <label
                htmlFor="history-allow-past-backfill"
                className="flex min-h-9 cursor-pointer items-center gap-2 text-xs md:min-h-6"
              >
                <input
                  id="history-allow-past-backfill"
                  name="allowAutoLockedBackfill"
                  type="checkbox"
                  disabled={isImporting}
                  checked={allowAutoLockedBackfill}
                  onChange={(event) =>
                    setAllowAutoLockedBackfill(event.target.checked)
                  }
                  className="size-4 accent-foreground"
                />
                Include past months during historical import (manually locked
                months stay protected)
              </label>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alias-text" className="text-xs">
              Alias overrides — &ldquo;Old title,Current title&rdquo; (optional)
            </Label>
            <Textarea
              id="alias-text"
              name="aliasOverrides"
              disabled={isImporting}
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

          {/* Live Chunk Progress Bar */}
          {isImporting && progress ? (
            <div
              role="status"
              aria-live="polite"
              className="space-y-2 rounded-md border border-border bg-background p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Loader2
                    className="size-3.5 animate-spin text-done"
                    aria-hidden="true"
                  />
                  {progress.statusLabel}
                </span>
                <span className="mono-tabular text-[11px] text-muted-foreground">
                  {progressPct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-done transition-all duration-200"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
              <p className="mono-tabular text-[11px] text-muted-foreground">
                {progress.completedMarks.toLocaleString()} /{" "}
                {progress.totalMarks.toLocaleString()} marks saved ·{" "}
                {progress.completedChunks}/{progress.totalChunks} batches
              </p>
            </div>
          ) : null}

          {/* Resumable Partial-Failure Banner */}
          {resumable && !isImporting ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-md border border-overdue/35 bg-overdue/10 p-3 text-xs"
            >
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-overdue"
                  aria-hidden="true"
                />
                <div className="space-y-0.5">
                  <p className="font-medium text-overdue">
                    Paused at batch {resumable.nextChunkIndex + 1} of{" "}
                    {resumable.chunks.length}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {resumable.errorMessage} ({resumable.importedSoFar.toLocaleString()}{" "}
                    marks already saved safely — resuming will not create duplicates.)
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleResumeRemaining()}
                className="mira-row gap-1.5 border-border bg-card text-xs"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Resume remaining
              </Button>
            </div>
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
                  ? `${effectiveMonthRosters.length} month${effectiveMonthRosters.length === 1 ? "" : "s"} detected (${effectiveMonthRosters[0]?.month} → ${effectiveMonthRosters[effectiveMonthRosters.length - 1]?.month}). Streams in ${Math.max(1, Math.ceil(parsed.rows.length / MAX_HISTORY_IMPORT_CHUNK_SIZE))} fast batch${Math.ceil(parsed.rows.length / MAX_HISTORY_IMPORT_CHUNK_SIZE) === 1 ? "" : "es"}.`
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
                          disabled={isImporting}
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
              disabled={isImporting}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                isImporting ||
                isReadingFile ||
                !parsed ||
                Boolean(parsed.error) ||
                Boolean(aliasResult.error)
              }
              className="mira-row gap-1.5 px-4 text-xs"
            >
              {isImporting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-3.5" aria-hidden="true" />
              )}
              {isImporting ? "Importing…" : "Import history"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
