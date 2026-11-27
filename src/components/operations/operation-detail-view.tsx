"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  FolderKanban,
  Globe,
  History,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Play,
  Repeat2,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveOperationAction,
  deleteOperationAction,
  markOperationVerifiedAction,
  rollbackOperationVersionAction,
  scheduleOperationRunTaskAction,
  startOperationRunAction,
} from "@/actions/operations";
import { SafeMarkdown } from "@/components/operations/safe-markdown";
import { formatTimerSeconds } from "@/components/operations/step-timer";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { setEphemeralRunSecrets } from "@/lib/ephemeral-run-secrets";
import { zonedWallClockToUtcMs } from "@/lib/reminder-presets";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/server/db/schema";
import {
  getOperationDomainPreset,
  stripSecretVariables,
} from "@/server/domain/operations";
import type { OperationDetailPayload } from "@/server/services/operation-service";

interface OperationDetailViewProps {
  detail: OperationDetailPayload;
  timezone: string;
  autoOpenStartDialog?: boolean;
}

function formatDateTime(ms: number, timezone: string): string {
  try {
    return formatInTimeZone(ms, timezone, "MMM d, yyyy · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d, yyyy · HH:mm");
  }
}

export function OperationDetailView({
  detail,
  timezone,
  autoOpenStartDialog = false,
}: OperationDetailViewProps) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const { operation, currentVersion, versions, referenceNotes, recentRuns } =
    detail;
  const preset = getOperationDomainPreset(operation.domain);

  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [copiedStepKey, setCopiedStepKey] = useState<string | null>(null);

  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenStartDialog && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setStartDialogOpen(true);
    }
  }, [autoOpenStartDialog]);

  // Start Run Preflight state
  const defaultVariableValues = useMemo(() => {
    const init: Record<string, string> = {};
    for (const v of currentVersion.variables) {
      if (v.type !== "secret" && v.defaultValue) {
        init[v.key] = v.defaultValue;
      } else {
        init[v.key] = "";
      }
    }
    return init;
  }, [currentVersion.variables]);

  const [runTitle, setRunTitle] = useState(`${operation.title} · Run`);
  const [varInputs, setVarInputs] = useState<Record<string, string>>(
    defaultVariableValues
  );
  const [checkedPrereqs, setCheckedPrereqs] = useState<string[]>([]);

  // Schedule Run Task state
  const [scheduleTitle, setScheduleTitle] = useState(
    `Run Operation: ${operation.title}`
  );
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [attachReminder, setAttachReminder] = useState(true);
  const [schedulePriority, setSchedulePriority] =
    useState<TaskPriority>("medium");

  const handleCopyCode = async (stepKey: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStepKey(stepKey);
      toast.success("Copied snippet.");
      setTimeout(() => setCopiedStepKey((prev) => (prev === stepKey ? null : prev)), 1500);
    } catch {
      toast.error("Unable to copy to clipboard.");
    }
  };

  const handleStartRun = () => {
    startTransition(async () => {
      const nonSecretValues = stripSecretVariables(
        varInputs,
        currentVersion.variables
      );
      const secretValues: Record<string, string> = {};
      for (const variable of currentVersion.variables) {
        if (variable.type === "secret" && varInputs[variable.key]?.trim()) {
          secretValues[variable.key] = varInputs[variable.key]!;
        }
      }

      const result = await startOperationRunAction({
        operationId: operation.id,
        title: runTitle.trim() || undefined,
        variablesValues: nonSecretValues,
        prerequisitesChecked: checkedPrereqs,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      // Hand off RAM-only secret variables without touching storage or URL.
      if (Object.keys(secretValues).length > 0) {
        setEphemeralRunSecrets(result.data.run.id, secretValues);
      }

      setStartDialogOpen(false);
      await invalidate(["operations"]);
      router.push(`/app/operations/runs/${result.data.run.id}`);
    });
  };

  const handleScheduleRun = () => {
    startTransition(async () => {
      let utcMs: number | null = null;
      if (scheduleDate) {
        utcMs = zonedWallClockToUtcMs(
          scheduleDate,
          scheduleTime || "09:00",
          timezone
        );
      }

      const result = await scheduleOperationRunTaskAction({
        operationId: operation.id,
        title: scheduleTitle.trim() || `Run Operation: ${operation.title}`,
        dueAt: utcMs,
        remindAt: attachReminder && utcMs ? utcMs : null,
        priority: schedulePriority,
        timezone,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setScheduleDialogOpen(false);
      await invalidate(["tasks", "reminders", "projects", "sidebar"]);
      toast.success(
        result.data.reminder
          ? "Scheduled run as a task with a timed reminder."
          : "Scheduled run as a task."
      );
    });
  };

  const handleMarkVerified = () => {
    startTransition(async () => {
      const result = await markOperationVerifiedAction({
        operationId: operation.id,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success("Marked blueprint as verified today.");
    });
  };

  const handleRollback = (targetVersionNumber: number) => {
    startTransition(async () => {
      const result = await rollbackOperationVersionAction({
        operationId: operation.id,
        targetVersionNumber,
        expectedEditVersion: operation.editVersion,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setHistoryOpen(false);
      await invalidate(["operations"]);
      toast.success(
        `Restored v${targetVersionNumber} as new v${result.data.operation.currentVersion}.`
      );
    });
  };

  const handleArchiveToggle = () => {
    startTransition(async () => {
      const result = await archiveOperationAction({
        operationId: operation.id,
        isArchived: !operation.isArchived,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations", "sidebar"]);
      toast.success(
        operation.isArchived ? "Operation restored." : "Operation archived."
      );
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteOperationAction({ operationId: operation.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setDeleteDialogOpen(false);
      await invalidate(["operations", "sidebar"]);
      toast.success("Operation deleted.");
      router.push("/app/operations");
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 md:px-6">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/app/operations"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to Operations
        </Link>
        <span className="mono-tabular text-[11px] text-muted-foreground">
          /{operation.slug}
        </span>
      </div>

      {/* Header Card */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px]", preset.badgeClassName)}
              >
                {preset.label}
              </Badge>
              <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                v{operation.currentVersion}
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {operation.visibility === "public" ? (
                  <Globe className="size-2.5 text-done" />
                ) : operation.visibility === "unlisted" ? (
                  <Link2 className="size-2.5 text-collab" />
                ) : (
                  <Lock className="size-2.5" />
                )}
                <span className="capitalize">{operation.visibility}</span>
              </span>
              {operation.difficulty ? (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {operation.difficulty}
                </span>
              ) : null}
              {operation.estimatedMinutes ? (
                <span className="mono-tabular inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Clock className="size-2.5" />
                  {operation.estimatedMinutes} min
                </span>
              ) : null}
              {detail.staleness.isStale ? (
                <span className="inline-flex items-center gap-1 rounded border border-overdue/40 bg-overdue/10 px-1.5 py-0.5 text-[10px] font-medium text-overdue">
                  <AlertTriangle className="size-2.5" />
                  Review due
                </span>
              ) : operation.lastVerifiedAt ? (
                <span className="inline-flex items-center gap-1 rounded border border-done/35 bg-done/10 px-1.5 py-0.5 text-[10px] text-done">
                  <ShieldCheck className="size-2.5" />
                  Verified{" "}
                  {detail.staleness.daysSinceVerified === 0
                    ? "today"
                    : `${detail.staleness.daysSinceVerified}d ago`}
                </span>
              ) : null}
            </div>

            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {operation.title}
            </h1>

            {operation.summary ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {operation.summary}
              </p>
            ) : null}

            {detail.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => setStartDialogOpen(true)}
              className="h-9 gap-1.5 px-3 text-xs md:h-8"
            >
              <Play className="size-3.5" />
              Start Run
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3 text-xs md:h-8"
            >
              <Link href={`/app/operations/${operation.id}/edit`}>
                <Pencil className="size-3.5" />
                Edit
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScheduleDialogOpen(true)}
              className="h-9 gap-1.5 px-2.5 text-xs md:h-8"
            >
              <CalendarPlus className="size-3.5" />
              Schedule
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="h-9 gap-1.5 px-2.5 text-xs md:h-8"
            >
              <History className="size-3.5" />
              History ({versions.length})
            </Button>
          </div>
        </div>

        {/* Cross-Module Integrations Strip */}
        {(detail.linkedProject ||
          detail.linkedHabit ||
          referenceNotes.length > 0 ||
          detail.staleness.isStale) ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {detail.linkedProject ? (
                <Link
                  href={`/app/projects/${detail.linkedProject.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:border-collab"
                >
                  <FolderKanban className="size-3 text-collab" />
                  <span>{detail.linkedProject.name}</span>
                </Link>
              ) : null}

              {detail.linkedHabit ? (
                <Link
                  href="/app/habits"
                  className="inline-flex items-center gap-1.5 rounded-md border border-done/35 bg-done/10 px-2 py-1 text-[11px] text-done transition-colors hover:bg-done/15"
                >
                  <Repeat2 className="size-3" />
                  <span>Auto-logs habit: {detail.linkedHabit.title}</span>
                </Link>
              ) : null}

              {referenceNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/app/notes?item=${note.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <FileText className="size-3" />
                  <span className="max-w-[160px] truncate">{note.title}</span>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={handleMarkVerified}
                className="h-8 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground md:h-7"
              >
                <ShieldCheck className="size-3.5" />
                Mark verified
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={handleArchiveToggle}
                className="h-8 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground md:h-7"
              >
                <Archive className="size-3.5" />
                {operation.isArchived ? "Restore" : "Archive"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => setDeleteDialogOpen(true)}
                className="h-8 gap-1 px-2 text-[11px] text-overdue hover:text-overdue md:h-7"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border/80 pt-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleMarkVerified}
              className="h-8 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground md:h-7"
            >
              <ShieldCheck className="size-3.5" />
              Mark verified
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleArchiveToggle}
              className="h-8 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground md:h-7"
            >
              <Archive className="size-3.5" />
              {operation.isArchived ? "Restore" : "Archive"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setDeleteDialogOpen(true)}
              className="h-8 gap-1 px-2 text-[11px] text-overdue hover:text-overdue md:h-7"
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        )}
      </section>

      {/* Variables Preview */}
      {currentVersion.variables.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Dynamic Variables ({currentVersion.variables.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {currentVersion.variables.map((v) => (
              <div
                key={v.key}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs"
              >
                <code className="font-mono text-[11px] text-reminder">
                  {`{{${v.key}}}`}
                </code>
                <span className="text-muted-foreground">·</span>
                <span className="text-foreground">{v.label}</span>
                {v.type === "secret" ? (
                  <span className="inline-flex items-center gap-0.5 rounded border border-overdue/30 bg-overdue/10 px-1 py-0.5 text-[10px] text-overdue">
                    <Lock className="size-2.5" />
                    RAM only
                  </span>
                ) : v.defaultValue ? (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    = {v.defaultValue}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Adaptive Prerequisites / Ingredients / Gear */}
      {currentVersion.prerequisites.length > 0 ? (
        <section className="space-y-2.5 rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {preset.prerequisitesLabel} ({currentVersion.prerequisites.length})
          </h2>
          <ul className="space-y-1.5">
            {currentVersion.prerequisites.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  {item.detail ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Adaptive Steps List */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {preset.stepsLabel} ({currentVersion.steps.length})
          </h2>
          {currentVersion.changeSummary ? (
            <span className="text-[11px] text-muted-foreground">
              v{currentVersion.versionNumber}: {currentVersion.changeSummary}
            </span>
          ) : null}
        </div>

        <ol className="space-y-2.5">
          {currentVersion.steps.map((step, index) => (
            <li
              key={step.key}
              className={cn(
                "space-y-2.5 rounded-lg border bg-card p-4",
                step.type === "caution"
                  ? "border-overdue/55 bg-overdue/5"
                  : "border-border"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="mono-tabular inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[11px] font-semibold text-foreground">
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-medium text-foreground">
                    {step.title}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5">
                  {step.timerSeconds ? (
                    <span className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/35 bg-reminder/10 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
                      <Timer className="size-2.5" />
                      {formatTimerSeconds(step.timerSeconds)}
                    </span>
                  ) : null}
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 px-1.5 text-[10px] capitalize",
                      step.type === "caution" &&
                        "border-overdue/45 text-overdue",
                      step.type === "command" && "border-collab/40 text-collab"
                    )}
                  >
                    {step.type}
                  </Badge>
                </div>
              </div>

              {step.bodyMarkdown ? (
                <SafeMarkdown content={step.bodyMarkdown} />
              ) : null}

              {step.codeBlock?.content ? (
                <div className="overflow-hidden rounded-md border border-border bg-muted">
                  <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      <Terminal className="size-3" />
                      {step.codeBlock.language}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyCode(step.key, step.codeBlock!.content)
                      }
                      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      {copiedStepKey === step.key ? (
                        <>
                          <Check className="size-3 text-done" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground">
                    {step.codeBlock.content}
                  </pre>
                </div>
              ) : null}

              {step.verificationCue || step.branchHint || step.rollbackHint ? (
                <div className="grid grid-cols-1 gap-2 pt-1 text-xs sm:grid-cols-2">
                  {step.verificationCue ? (
                    <div className="rounded-md border border-done/30 bg-done/5 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-done">
                        {preset.verificationLabel}
                      </p>
                      <p className="mt-0.5 text-foreground/90">
                        {step.verificationCue}
                      </p>
                    </div>
                  ) : null}
                  {step.branchHint ? (
                    <div className="rounded-md border border-collab/30 bg-collab/5 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-collab">
                        Decision / branch cue
                      </p>
                      <p className="mt-0.5 text-foreground/90">
                        {step.branchHint}
                      </p>
                    </div>
                  ) : null}
                  {step.rollbackHint ? (
                    <div className="rounded-md border border-overdue/30 bg-overdue/5 px-2.5 py-2 sm:col-span-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-overdue">
                        {preset.rollbackLabel}
                      </p>
                      <p className="mt-0.5 text-foreground/90">
                        {step.rollbackHint}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* Recent Runs for this Operation */}
      {recentRuns.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Runs ({recentRuns.length})
          </h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {recentRuns.map((entry) => (
              <div
                key={entry.run.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        entry.run.status === "in_progress"
                          ? "border-reminder/40 bg-reminder/10 text-reminder"
                          : entry.run.status === "completed"
                            ? "border-done/35 bg-done/10 text-done"
                            : "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      {entry.run.status.replace("_", " ")}
                    </span>
                    <span className="mono-tabular text-[10px] text-muted-foreground">
                      v{entry.versionNumber}
                    </span>
                    <span className="truncate font-medium text-foreground">
                      {entry.run.title}
                    </span>
                  </div>
                  <p className="mono-tabular text-[11px] text-muted-foreground">
                    {entry.doneSteps}/{entry.totalSteps} done ·{" "}
                    {formatDateTime(entry.run.startedAt, timezone)}
                  </p>
                </div>

                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 text-xs md:h-7"
                >
                  <Link href={`/app/operations/runs/${entry.run.id}`}>
                    {entry.run.status === "in_progress" ? "Resume" : "View"}
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Start Run Preflight Dialog */}
      <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Start Guided Run</DialogTitle>
            <DialogDescription className="text-xs">
              This run pins cleanly to{" "}
              <span className="font-mono font-medium text-foreground">
                v{currentVersion.versionNumber}
              </span>
              . Later edits to the blueprint will never disrupt your progress.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="start-run-title" className="text-xs">
                Run label
              </Label>
              <Input
                id="start-run-title"
                value={runTitle}
                onChange={(e) => setRunTitle(e.target.value)}
                className="h-9 text-xs md:h-8"
              />
            </div>

            {currentVersion.variables.length > 0 ? (
              <div className="space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Variables
                </p>
                {currentVersion.variables.map((variable) => (
                  <div key={variable.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor={`preflight-var-${variable.key}`}
                        className="text-xs"
                      >
                        {variable.label}{" "}
                        <code className="font-mono text-[10px] text-muted-foreground">
                          {`{{${variable.key}}}`}
                        </code>
                      </Label>
                      {variable.type === "secret" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-overdue">
                          <Lock className="size-2.5" />
                          Memory only — never saved
                        </span>
                      ) : null}
                    </div>

                    {variable.type === "select" && variable.options ? (
                      <Select
                        value={varInputs[variable.key] ?? ""}
                        onValueChange={(val) =>
                          setVarInputs((prev) => ({
                            ...prev,
                            [variable.key]: val,
                          }))
                        }
                      >
                        <SelectTrigger
                          id={`preflight-var-${variable.key}`}
                          className="h-9 text-xs md:h-8"
                        >
                          <SelectValue
                            placeholder={
                              variable.placeholder || "Select an option"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {variable.options.map((option) => (
                            <SelectItem
                              key={option}
                              value={option}
                              className="text-xs"
                            >
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`preflight-var-${variable.key}`}
                        type={
                          variable.type === "secret"
                            ? "password"
                            : variable.type === "number"
                              ? "number"
                              : "text"
                        }
                        autoComplete="off"
                        value={varInputs[variable.key] ?? ""}
                        onChange={(e) =>
                          setVarInputs((prev) => ({
                            ...prev,
                            [variable.key]: e.target.value,
                          }))
                        }
                        placeholder={
                          variable.placeholder ||
                          (variable.type === "secret"
                            ? "Enter secret value (kept in RAM only)"
                            : `Enter ${variable.label.toLowerCase()}`)
                        }
                        className="h-9 font-mono text-xs md:h-8"
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {currentVersion.prerequisites.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {preset.prerequisitesLabel}
                </p>
                <div className="space-y-1.5">
                  {currentVersion.prerequisites.map((item) => {
                    const checked = checkedPrereqs.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCheckedPrereqs((prev) =>
                              prev.includes(item.id)
                                ? prev.filter((id) => id !== item.id)
                                : [...prev, item.id]
                            )
                          }
                          className="mt-0.5 size-4 rounded border-border accent-primary"
                        />
                        <span className={cn(checked && "line-through text-muted-foreground")}>
                          {item.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStartDialogOpen(false)}
              className="h-9 text-xs md:h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={handleStartRun}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Launch Runner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Run as Task + Reminder Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Schedule Operation Run</DialogTitle>
            <DialogDescription className="text-xs">
              Creates a linked task (and optional timed reminder) that opens
              directly into Start Run.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="schedule-task-title" className="text-xs">
                Task title
              </Label>
              <Input
                id="schedule-task-title"
                value={scheduleTitle}
                onChange={(e) => setScheduleTitle(e.target.value)}
                className="h-9 text-xs md:h-8"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="schedule-date" className="text-xs">
                  Date ({timezone})
                </Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="mono-tabular h-9 text-xs md:h-8"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="schedule-time" className="text-xs">
                  Time
                </Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={scheduleTime}
                  disabled={!scheduleDate}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="mono-tabular h-9 text-xs md:h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="schedule-priority" className="text-xs">
                Priority
              </Label>
              <Select
                value={schedulePriority}
                onValueChange={(v) => setSchedulePriority(v as TaskPriority)}
              >
                <SelectTrigger
                  id="schedule-priority"
                  className="h-9 text-xs md:h-8"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">None</SelectItem>
                  <SelectItem value="low" className="text-xs">Low</SelectItem>
                  <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                  <SelectItem value="high" className="text-xs">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scheduleDate ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={attachReminder}
                  onChange={(e) => setAttachReminder(e.target.checked)}
                  className="size-4 rounded border-border accent-primary"
                />
                <span>Attach a timed Push / Email reminder</span>
              </label>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScheduleDialogOpen(false)}
              className="h-9 text-xs md:h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || !scheduleTitle.trim()}
              onClick={handleScheduleRun}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CalendarPlus className="size-3.5" />
              )}
              Schedule Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History & Rollback Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-sm">Version History</SheetTitle>
            <SheetDescription className="text-xs">
              Every published edit creates an immutable snapshot. Restoring an
              older version publishes a new version without overwriting history.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {versions.map((ver) => {
              const isCurrent = ver.versionNumber === operation.currentVersion;
              return (
                <div
                  key={ver.id}
                  className={cn(
                    "space-y-2 rounded-lg border p-3 text-xs",
                    isCurrent
                      ? "border-reminder/45 bg-reminder/5"
                      : "border-border bg-card"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="mono-tabular font-semibold text-foreground">
                        v{ver.versionNumber}
                      </span>
                      {isCurrent ? (
                        <Badge
                          variant="outline"
                          className="h-4 border-reminder/40 px-1 text-[9px] text-reminder"
                        >
                          Current
                        </Badge>
                      ) : null}
                    </div>
                    <span className="mono-tabular text-[10px] text-muted-foreground">
                      {formatDateTime(ver.createdAt, timezone)}
                    </span>
                  </div>

                  {ver.changeSummary ? (
                    <p className="text-foreground/90">{ver.changeSummary}</p>
                  ) : null}

                  <p className="mono-tabular text-[11px] text-muted-foreground">
                    {ver.steps.length} steps · {ver.prerequisites.length}{" "}
                    checklist · {ver.variables.length} vars
                  </p>

                  {!isCurrent ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleRollback(ver.versionNumber)}
                      className="h-8 gap-1.5 text-xs md:h-7"
                    >
                      <RotateCcw className="size-3" />
                      Restore as v{operation.currentVersion + 1}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Operation?</DialogTitle>
            <DialogDescription className="text-xs">
              This permanently removes &ldquo;{operation.title}&rdquo;, its
              version history, and past runs. Any tasks scheduled from it stay
              in your workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(false)}
              className="h-9 text-xs md:h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={handleDelete}
              className="h-9 text-xs md:h-8"
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
