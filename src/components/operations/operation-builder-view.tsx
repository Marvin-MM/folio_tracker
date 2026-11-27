"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Code2,
  Eye,
  FileText,
  GitBranch,
  History,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  Undo2,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import {
  createOperationAction,
  publishOperationVersionAction,
  rollbackOperationVersionAction,
} from "@/actions/operations";
import { SafeMarkdown } from "@/components/operations/safe-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { generateEvenPositions } from "@/lib/fractional-index";
import { cn } from "@/lib/utils";
import {
  OPERATION_DIFFICULTIES,
  OPERATION_DOMAINS,
  OPERATION_VISIBILITIES,
  type OperationDifficulty,
  type OperationDomain,
  type OperationVisibility,
} from "@/server/db/schema";
import {
  getOperationDomainPreset,
  MAX_OPERATION_SUMMARY_LENGTH,
  OPERATION_STEP_TYPES,
  OPERATION_VARIABLE_KEY_REGEX,
  OPERATION_VARIABLE_TYPES,
  scanOperationForSecrets,
  type OperationPrerequisite,
  type OperationStep,
  type OperationStepType,
  type OperationVariable,
  type OperationVariableType,
  type SecretScanFinding,
} from "@/server/domain/operations";
import type {
  OperationDetailPayload,
  OperationLinkOptions,
} from "@/server/services/operation-service";

interface OperationBuilderViewProps {
  mode: "create" | "edit";
  timezone: string;
  initialDomain?: OperationDomain;
  detail?: OperationDetailPayload;
  linkOptions: OperationLinkOptions;
}

interface EditableStep extends OperationStep {
  showCode: boolean;
  showTimer: boolean;
  showVerification: boolean;
  showRollback: boolean;
  showBranch: boolean;
  previewMarkdown: boolean;
}

function makeClientKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyStep(domain: OperationDomain, position = "a0"): EditableStep {
  const preset = getOperationDomainPreset(domain);
  return {
    key: makeClientKey("step"),
    position,
    type: preset.defaultStepType,
    title: "",
    bodyMarkdown: "",
    codeBlock: preset.showCodeByDefault
      ? { language: preset.defaultCodeLanguage, content: "" }
      : null,
    timerSeconds: null,
    verificationCue: null,
    rollbackHint: null,
    branchHint: null,
    showCode: preset.showCodeByDefault,
    showTimer: preset.showTimerByDefault,
    showVerification: false,
    showRollback: false,
    showBranch: false,
    previewMarkdown: false,
  };
}

function toEditableStep(step: OperationStep): EditableStep {
  return {
    ...step,
    showCode: Boolean(step.codeBlock?.content),
    showTimer: Boolean(step.timerSeconds && step.timerSeconds > 0),
    showVerification: Boolean(step.verificationCue),
    showRollback: Boolean(step.rollbackHint),
    showBranch: Boolean(step.branchHint),
    previewMarkdown: false,
  };
}

export function OperationBuilderView({
  mode,
  timezone,
  initialDomain = "general",
  detail,
  linkOptions,
}: OperationBuilderViewProps) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const existingOp = detail?.operation;
  const existingVer = detail?.currentVersion;

  const [title, setTitle] = useState(existingOp?.title ?? "");
  const [summary, setSummary] = useState(existingOp?.summary ?? "");
  const [domain, setDomain] = useState<OperationDomain>(
    existingOp?.domain ?? initialDomain
  );
  const [difficulty, setDifficulty] = useState<OperationDifficulty | "none">(
    existingOp?.difficulty ?? "none"
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    existingOp?.estimatedMinutes ? String(existingOp.estimatedMinutes) : ""
  );
  const [reviewCycleDays, setReviewCycleDays] = useState(
    existingOp?.reviewCycleDays ? String(existingOp.reviewCycleDays) : ""
  );
  const [tagsInput, setTagsInput] = useState(
    detail?.tags ? detail.tags.join(", ") : ""
  );
  const [visibility, setVisibility] = useState<OperationVisibility>(
    existingOp?.visibility ?? "private"
  );
  const [allowForking, setAllowForking] = useState(
    existingOp?.allowForking ?? true
  );
  const [projectId, setProjectId] = useState<string>(
    existingOp?.projectId ?? "none"
  );
  const [linkedHabitId, setLinkedHabitId] = useState<string>(
    existingOp?.linkedHabitId ?? "none"
  );
  const [referenceNoteIds, setReferenceNoteIds] = useState<string[]>(
    detail?.referenceNotes.map((n) => n.id) ?? []
  );

  const [variables, setVariables] = useState<OperationVariable[]>(
    existingVer?.variables ?? []
  );
  const [prerequisites, setPrerequisites] = useState<OperationPrerequisite[]>(
    existingVer?.prerequisites ?? []
  );
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    existingVer && existingVer.steps.length > 0
      ? existingVer.steps.map(toEditableStep)
      : [createEmptyStep(existingOp?.domain ?? initialDomain)]
  );

  const [changeSummary, setChangeSummary] = useState("");
  const [editVersion, setEditVersion] = useState(existingOp?.editVersion ?? 1);
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [serverSecretState, setServerSecretState] = useState<{
    fingerprint: string;
    findings: SecretScanFinding[];
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Add Variable inline form state
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarLabel, setNewVarLabel] = useState("");
  const [newVarType, setNewVarType] = useState<OperationVariableType>("text");
  const [newVarDefault, setNewVarDefault] = useState("");
  const [newVarOptions, setNewVarOptions] = useState("");

  // Add Prerequisite inline input
  const [newPrereqLabel, setNewPrereqLabel] = useState("");

  const preset = getOperationDomainPreset(domain);

  const cleanStepsForSubmit = useMemo((): OperationStep[] => {
    const positions = generateEvenPositions(steps.length);
    return steps.map((step, index) => ({
      key: step.key,
      position: positions[index]!,
      type: step.type,
      title: step.title.trim(),
      bodyMarkdown: step.bodyMarkdown,
      codeBlock:
        step.showCode && step.codeBlock && step.codeBlock.content.trim().length > 0
          ? {
              language: step.codeBlock.language.trim() || preset.defaultCodeLanguage,
              content: step.codeBlock.content,
            }
          : null,
      timerSeconds:
        step.showTimer && step.timerSeconds && step.timerSeconds > 0
          ? Math.floor(step.timerSeconds)
          : null,
      verificationCue:
        step.showVerification && step.verificationCue?.trim()
          ? step.verificationCue.trim()
          : null,
      rollbackHint:
        step.showRollback && step.rollbackHint?.trim()
          ? step.rollbackHint.trim()
          : null,
      branchHint:
        step.showBranch && step.branchHint?.trim()
          ? step.branchHint.trim()
          : null,
    }));
  }, [steps, preset.defaultCodeLanguage]);

  const liveScanReport = useMemo(
    () =>
      scanOperationForSecrets({
        title,
        summary,
        variables,
        prerequisites,
        steps: cleanStepsForSubmit,
      }),
    [title, summary, variables, prerequisites, cleanStepsForSubmit]
  );

  const draftFingerprint = useMemo(
    () =>
      JSON.stringify({
        title,
        summary,
        visibility,
        variables,
        prerequisites,
        steps: cleanStepsForSubmit,
      }),
    [title, summary, visibility, variables, prerequisites, cleanStepsForSubmit]
  );

  const isSharedVisibility =
    visibility === "public" || visibility === "unlisted";
  const activeBlockers =
    serverSecretState && serverSecretState.fingerprint === draftFingerprint
      ? serverSecretState.findings
      : liveScanReport.blockers;

  const handleAddVariable = () => {
    const cleanKey = newVarKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_");
    if (!OPERATION_VARIABLE_KEY_REGEX.test(cleanKey)) {
      toast.error(
        "Variable key must start with a lowercase letter and use a-z, 0-9, or _."
      );
      return;
    }
    if (variables.some((v) => v.key === cleanKey)) {
      toast.error(`Variable "{{${cleanKey}}}" already exists.`);
      return;
    }
    const label = newVarLabel.trim() || cleanKey.replace(/_/g, " ");
    const parsedOptions =
      newVarType === "select"
        ? newVarOptions
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    if (newVarType === "select" && (!parsedOptions || parsedOptions.length === 0)) {
      toast.error("Provide comma-separated options for a Select variable.");
      return;
    }

    setVariables((prev) => [
      ...prev,
      {
        key: cleanKey,
        label,
        type: newVarType,
        required: false,
        defaultValue:
          newVarType === "secret"
            ? undefined
            : newVarDefault.trim() || undefined,
        options: parsedOptions,
      },
    ]);
    setNewVarKey("");
    setNewVarLabel("");
    setNewVarDefault("");
    setNewVarOptions("");
    setNewVarType("text");
  };

  const handleQuickSuggestVariable = (suggestion: {
    key: string;
    label: string;
    type: OperationVariableType;
    placeholder: string;
  }) => {
    if (variables.some((v) => v.key === suggestion.key)) {
      toast.info(`{{${suggestion.key}}} is already added.`);
      return;
    }
    setVariables((prev) => [
      ...prev,
      {
        key: suggestion.key,
        label: suggestion.label,
        type: suggestion.type,
        required: false,
        placeholder: suggestion.placeholder,
      },
    ]);
  };

  const handleAddPrereq = () => {
    const clean = newPrereqLabel.trim();
    if (!clean) return;
    setPrerequisites((prev) => [
      ...prev,
      { id: makeClientKey("pre"), label: clean },
    ]);
    setNewPrereqLabel("");
  };

  const updateStep = (
    stepKey: string,
    updater: (prev: EditableStep) => EditableStep
  ) => {
    setSteps((prev) =>
      prev.map((step) => (step.key === stepKey ? updater(step) : step))
    );
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      const a = next[index]!;
      next[index] = next[target]!;
      next[target] = a;
      return next;
    });
  };

  const removeStep = (stepKey: string) => {
    if (steps.length <= 1) {
      toast.error("An operation needs at least one step.");
      return;
    }
    setSteps((prev) => prev.filter((s) => s.key !== stepKey));
  };

  const toggleReferenceNote = (noteId: string) => {
    setReferenceNoteIds((prev) =>
      prev.includes(noteId)
        ? prev.filter((id) => id !== noteId)
        : [...prev, noteId]
    );
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Enter a title for this operation.");
      return;
    }
    const emptyStepIndex = cleanStepsForSubmit.findIndex((s) => !s.title);
    if (emptyStepIndex !== -1) {
      toast.error(`Step ${emptyStepIndex + 1} needs a title.`);
      return;
    }

    setConcurrencyConflict(false);
    setServerSecretState(null);

    const parsedTags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const estMin = estimatedMinutes.trim()
      ? Number.parseInt(estimatedMinutes, 10)
      : null;
    const revDays = reviewCycleDays.trim()
      ? Number.parseInt(reviewCycleDays, 10)
      : null;

    const basePayload = {
      title: title.trim(),
      summary: summary.trim(),
      domain,
      tags: parsedTags,
      difficulty: difficulty === "none" ? null : difficulty,
      estimatedMinutes: Number.isFinite(estMin) && estMin! > 0 ? estMin : null,
      reviewCycleDays: Number.isFinite(revDays) && revDays! > 0 ? revDays : null,
      visibility,
      allowForking,
      projectId: projectId === "none" ? null : projectId,
      linkedHabitId: linkedHabitId === "none" ? null : linkedHabitId,
      referenceNoteIds,
      variables,
      prerequisites,
      steps: cleanStepsForSubmit,
      changeSummary: changeSummary.trim() || null,
    };

    startTransition(async () => {
      if (mode === "create") {
        const result = await createOperationAction(basePayload);
        if (!result.ok) {
          if (result.error.code === "SECRET_SCAN_BLOCKED") {
            setServerSecretState({
              fingerprint: draftFingerprint,
              findings: result.error.secretFindings ?? [],
            });
          }
          toast.error(result.error.message);
          return;
        }
        await invalidate(["operations", "sidebar"]);
        if (result.data.secretScanWarnings.length > 0) {
          toast.warning(
            `Operation created with ${result.data.secretScanWarnings.length} scanner advisory note(s).`
          );
        } else {
          toast.success("Operation created.");
        }
        router.push(`/app/operations/${result.data.operation.id}`);
        return;
      }

      if (!existingOp) return;
      const result = await publishOperationVersionAction({
        operationId: existingOp.id,
        expectedEditVersion: editVersion,
        ...basePayload,
      });

      if (!result.ok) {
        if (result.error.code === "CONCURRENCY_CONFLICT") {
          setConcurrencyConflict(true);
        } else if (result.error.code === "SECRET_SCAN_BLOCKED") {
          setServerSecretState({
            fingerprint: draftFingerprint,
            findings: result.error.secretFindings ?? [],
          });
        }
        toast.error(result.error.message);
        return;
      }

      setEditVersion(result.data.operation.editVersion);
      await invalidate(["operations", "sidebar"]);
      toast.success(
        `Published v${result.data.operation.currentVersion} cleanly.`
      );
      router.push(`/app/operations/${result.data.operation.id}`);
    });
  };

  const handleRollback = (targetVersionNumber: number) => {
    if (!existingOp) return;
    startTransition(async () => {
      const result = await rollbackOperationVersionAction({
        operationId: existingOp.id,
        targetVersionNumber,
        expectedEditVersion: editVersion,
      });
      if (!result.ok) {
        if (result.error.code === "CONCURRENCY_CONFLICT") {
          setConcurrencyConflict(true);
        }
        toast.error(result.error.message);
        return;
      }
      setHistoryOpen(false);
      await invalidate(["operations"]);
      toast.success(
        `Restored v${targetVersionNumber} as v${result.data.operation.currentVersion}.`
      );
      router.push(`/app/operations/${existingOp.id}`);
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 pb-20 md:px-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link
            href={
              existingOp
                ? `/app/operations/${existingOp.id}`
                : "/app/operations"
            }
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {existingOp ? "Back to blueprint" : "Back to Operations"}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {mode === "edit" && detail ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              <History className="size-3.5" />
              History ({detail.versions.length})
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleSubmit}
            className="h-9 gap-1.5 px-3 text-xs md:h-8"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {mode === "create"
              ? "Create Operation"
              : `Publish v${(existingOp?.currentVersion ?? 1) + 1}`}
          </Button>
        </div>
      </div>

      {/* Optimistic Lock Conflict Banner */}
      {concurrencyConflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-overdue/50 bg-overdue/10 px-4 py-3 text-xs text-overdue"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Version conflict detected</p>
              <p className="mt-0.5 text-foreground/85">
                This blueprint was updated in another tab or session. Reload the
                latest version to avoid overwriting recent changes.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
            className="h-8 gap-1.5 border-overdue/40 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Reload latest
          </Button>
        </div>
      ) : null}

      {/* Pre-Publish Secret Scanner Alert */}
      {activeBlockers.length > 0 ? (
        <div
          role="alert"
          data-testid="secret-scanner-alert"
          className={cn(
            "space-y-2 rounded-lg border px-4 py-3 text-xs",
            isSharedVisibility
              ? "border-overdue/60 bg-overdue/10"
              : "border-border bg-muted/80"
          )}
        >
          <div className="flex items-center gap-2 font-semibold text-overdue">
            <ShieldAlert className="size-4 shrink-0" />
            <span>
              {isSharedVisibility
                ? `Publishing blocked: ${activeBlockers.length} secret(s) detected`
                : `${activeBlockers.length} potential secret(s) detected (convert to Secret variables before sharing)`}
            </span>
          </div>
          <ul className="space-y-1.5 pl-6 text-foreground/90">
            {activeBlockers.map((finding) => (
              <li key={finding.id} className="list-disc">
                <span className="font-medium">{finding.ruleLabel}</span> in{" "}
                <span className="font-medium">{finding.location}</span>:{" "}
                <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px]">
                  {finding.redactedMatch}
                </code>{" "}
                — <span className="text-muted-foreground">{finding.suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : isSharedVisibility && liveScanReport.hasWarnings ? (
        <div className="space-y-1.5 rounded-lg border border-reminder/40 bg-reminder/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-reminder">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Scanner advisory ({liveScanReport.warnings.length} item
              {liveScanReport.warnings.length === 1 ? "" : "s"} — non-blocking)
            </span>
          </div>
          <ul className="space-y-1 pl-6 text-foreground/85">
            {liveScanReport.warnings.map((w) => (
              <li key={w.id} className="list-disc">
                {w.ruleLabel} in {w.location} (
                <code className="font-mono text-[11px]">{w.redactedMatch}</code>)
              </li>
            ))}
          </ul>
        </div>
      ) : isSharedVisibility ? (
        <div className="flex items-center gap-2 rounded-lg border border-done/35 bg-done/10 px-3.5 py-2 text-xs text-done">
          <ShieldCheck className="size-4 shrink-0" />
          <span>Pre-publish secret scan passed — zero hardcoded secrets found.</span>
        </div>
      ) : null}

      {/* Section 1: Metadata & Domain Picker */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              {mode === "create"
                ? "New Operation Blueprint"
                : `Edit "${existingOp?.title}"`}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {preset.description}
            </p>
          </div>
          {mode === "edit" && existingOp ? (
            <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
              Current v{existingOp.currentVersion} · Lock #{editVersion}
            </span>
          ) : null}
        </div>

        {/* Domain Adaptive Selector */}
        <div className="space-y-1.5">
          <Label className="text-xs">Domain</Label>
          <div className="flex flex-wrap gap-1.5">
            {OPERATION_DOMAINS.map((d) => {
              const p = getOperationDomainPreset(d);
              const active = domain === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDomain(d)}
                  className={cn(
                    "h-8 rounded-md border px-2.5 text-xs transition-colors md:h-7",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="op-title" className="text-xs">
              Title
            </Label>
            <Input
              id="op-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                domain === "cooking"
                  ? "e.g., Sunday Sourdough Boule"
                  : domain === "tech"
                    ? "e.g., Zero-Downtime Nginx SSL Renewal"
                    : domain === "fitness"
                      ? "e.g., 1,500m Threshold Swim Session"
                      : "Give this operation a clear, repeatable title"
              }
              className="h-9 bg-background text-xs md:h-8"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="op-summary" className="text-xs">
                Summary
              </Label>
              <span className="mono-tabular text-[10px] text-muted-foreground">
                {summary.length}/{MAX_OPERATION_SUMMARY_LENGTH}
              </span>
            </div>
            <Textarea
              id="op-summary"
              rows={2}
              maxLength={MAX_OPERATION_SUMMARY_LENGTH}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="When to use this blueprint and what outcome it guarantees…"
              className="bg-background text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-difficulty" className="text-xs">
              Difficulty
            </Label>
            <Select
              value={difficulty}
              onValueChange={(v) =>
                setDifficulty(v as OperationDifficulty | "none")
              }
            >
              <SelectTrigger id="op-difficulty" className="h-9 bg-background text-xs md:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">Unspecified</SelectItem>
                {OPERATION_DIFFICULTIES.map((diff) => (
                  <SelectItem
                    key={diff}
                    value={diff}
                    className="text-xs capitalize"
                  >
                    {diff}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="op-est-minutes" className="text-xs">
                Est. minutes
              </Label>
              <Input
                id="op-est-minutes"
                type="number"
                min={1}
                max={10080}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                placeholder="30"
                className="mono-tabular h-9 bg-background text-xs md:h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="op-review-days" className="text-xs">
                Review every (days)
              </Label>
              <Input
                id="op-review-days"
                type="number"
                min={1}
                max={3650}
                value={reviewCycleDays}
                onChange={(e) => setReviewCycleDays(e.target.value)}
                placeholder="90"
                className="mono-tabular h-9 bg-background text-xs md:h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-tags" className="text-xs">
              Tags (comma-separated, max 8)
            </Label>
            <Input
              id="op-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g., weekly, prod, high-protein"
              className="h-9 bg-background text-xs md:h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-visibility" className="text-xs">
              Visibility
            </Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as OperationVisibility)}
            >
              <SelectTrigger id="op-visibility" className="h-9 bg-background text-xs md:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATION_VISIBILITIES.map((vis) => (
                  <SelectItem
                    key={vis}
                    value={vis}
                    className="text-xs capitalize"
                  >
                    {vis === "private"
                      ? "Private (Only you)"
                      : vis === "unlisted"
                        ? "Unlisted (Secret scan enforced)"
                        : "Public (Secret scan enforced)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Cross-Module Links */}
        <div className="grid grid-cols-1 gap-3 border-t border-border/70 pt-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="op-project" className="text-xs">
              Linked Project (optional)
            </Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="op-project" className="h-9 bg-background text-xs md:h-8">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  No project linked
                </SelectItem>
                {linkOptions.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-habit" className="text-xs">
              Linked Habit (auto-logged on run completion)
            </Label>
            <Select value={linkedHabitId} onValueChange={setLinkedHabitId}>
              <SelectTrigger id="op-habit" className="h-9 bg-background text-xs md:h-8">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  No habit linked
                </SelectItem>
                {linkOptions.habits.map((h) => (
                  <SelectItem key={h.id} value={h.id} className="text-xs">
                    {h.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {linkOptions.notes.length > 0 ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Reference Notes</Label>
            <div className="flex flex-wrap gap-1.5">
              {linkOptions.notes.slice(0, 12).map((note) => {
                const selected = referenceNoteIds.includes(note.id);
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => toggleReferenceNote(note.id)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
                      selected
                        ? "border-reminder bg-reminder/10 text-reminder"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileText className="size-3" />
                    <span className="max-w-[160px] truncate">{note.title}</span>
                    {selected ? <Check className="size-3" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-border/70 pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={allowForking}
              onCheckedChange={setAllowForking}
              aria-label="Allow forking when shared"
            />
            <span>Allow forking when shared</span>
          </label>
        </div>
      </section>

      {/* Section 2: Dynamic Variables */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Variable className="size-3.5 text-reminder" />
              Dynamic Variables ({variables.length})
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Reference variables as{" "}
              <code className="font-mono text-foreground">{`{{variable_key}}`}</code>{" "}
              inside any step or command. Mark passwords/tokens as{" "}
              <strong>Secret</strong> so they stay in RAM only.
            </p>
          </div>
        </div>

        {/* Domain Quick-Add Suggestions */}
        {preset.suggestedVariableKeys.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              Quick add:
            </span>
            {preset.suggestedVariableKeys.map((sug) => (
              <button
                key={sug.key}
                type="button"
                onClick={() => handleQuickSuggestVariable(sug)}
                className="inline-flex h-7 items-center gap-1 rounded border border-dashed border-border bg-background px-2 font-mono text-[11px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              >
                + {`{{${sug.key}}}`}
                {sug.type === "secret" ? (
                  <Lock className="size-2.5 text-overdue" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {variables.length > 0 ? (
          <div className="space-y-1.5">
            {variables.map((v) => (
              <div
                key={v.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-reminder">
                    {`{{${v.key}}}`}
                  </code>
                  <span className="font-medium text-foreground">{v.label}</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">
                    {v.type === "secret" ? (
                      <span className="inline-flex items-center gap-1 text-overdue">
                        <Lock className="size-2.5" />
                        Secret (RAM only)
                      </span>
                    ) : (
                      v.type
                    )}
                  </Badge>
                  {v.defaultValue ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      default: {v.defaultValue}
                    </span>
                  ) : null}
                  {v.options && v.options.length > 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      options: {v.options.join(", ")}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVariables((prev) => prev.filter((item) => item.key !== v.key))
                  }
                  aria-label={`Remove variable ${v.key}`}
                  className="h-7 px-2 text-muted-foreground hover:text-overdue"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Add Variable Inline Row */}
        <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border bg-background/60 p-3 sm:grid-cols-12">
          <div className="sm:col-span-3">
            <Input
              value={newVarKey}
              onChange={(e) => setNewVarKey(e.target.value)}
              placeholder="key (e.g. servings)"
              aria-label="New variable key"
              className="h-9 font-mono text-xs md:h-8"
            />
          </div>
          <div className="sm:col-span-3">
            <Input
              value={newVarLabel}
              onChange={(e) => setNewVarLabel(e.target.value)}
              placeholder="Label (e.g. Servings)"
              aria-label="New variable label"
              className="h-9 text-xs md:h-8"
            />
          </div>
          <div className="sm:col-span-2">
            <Select
              value={newVarType}
              onValueChange={(v) => setNewVarType(v as OperationVariableType)}
            >
              <SelectTrigger aria-label="Variable type" className="h-9 text-xs md:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATION_VARIABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3">
            {newVarType === "select" ? (
              <Input
                value={newVarOptions}
                onChange={(e) => setNewVarOptions(e.target.value)}
                placeholder="opt1, opt2, opt3"
                aria-label="Select variable options"
                className="h-9 text-xs md:h-8"
              />
            ) : (
              <Input
                value={newVarType === "secret" ? "" : newVarDefault}
                disabled={newVarType === "secret"}
                onChange={(e) => setNewVarDefault(e.target.value)}
                placeholder={
                  newVarType === "secret"
                    ? "RAM only (no default)"
                    : "Default (optional)"
                }
                aria-label="Variable default value"
                className="h-9 text-xs md:h-8"
              />
            )}
          </div>
          <div className="sm:col-span-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddVariable}
              aria-label="Add variable"
              className="h-9 w-full px-2 text-xs md:h-8"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Section 3: Adaptive Prerequisites / Ingredients / Gear */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {preset.prerequisitesLabel} ({prerequisites.length})
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {preset.emptyPrerequisitesHint}
          </p>
        </div>

        {prerequisites.length > 0 ? (
          <div className="space-y-1.5">
            {prerequisites.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
              >
                <Input
                  value={item.label}
                  onChange={(e) =>
                    setPrerequisites((prev) =>
                      prev.map((p) =>
                        p.id === item.id ? { ...p, label: e.target.value } : p
                      )
                    )
                  }
                  className="h-8 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPrerequisites((prev) =>
                      prev.filter((p) => p.id !== item.id)
                    )
                  }
                  aria-label="Remove item"
                  className="h-7 px-2 text-muted-foreground hover:text-overdue"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Input
            value={newPrereqLabel}
            onChange={(e) => setNewPrereqLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddPrereq();
              }
            }}
            placeholder={preset.prerequisitePlaceholder}
            aria-label={`Add item to ${preset.prerequisitesLabel}`}
            className="h-9 flex-1 bg-background text-xs md:h-8"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddPrereq}
            className="h-9 gap-1 px-3 text-xs md:h-8"
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </section>

      {/* Section 4: Adaptive Steps */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {preset.stepsLabel} ({steps.length})
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSteps((prev) => [...prev, createEmptyStep(domain)])
            }
            className="h-9 gap-1.5 text-xs md:h-7"
          >
            <Plus className="size-3.5" />
            {preset.addStepLabel}
          </Button>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => {
            const timerMin = step.timerSeconds
              ? Math.floor(step.timerSeconds / 60)
              : 0;
            const timerSec = step.timerSeconds ? step.timerSeconds % 60 : 0;

            return (
              <div
                key={step.key}
                className={cn(
                  "space-y-3 rounded-lg border bg-card p-4",
                  step.type === "caution"
                    ? "border-overdue/55 bg-overdue/5"
                    : "border-border"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="mono-tabular inline-flex size-6 shrink-0 items-center justify-center rounded border border-border bg-background text-[11px] font-semibold">
                      {index + 1}
                    </span>
                    <Input
                      value={step.title}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      placeholder={`Step ${index + 1} title…`}
                      aria-label={`Step ${index + 1} title`}
                      className="h-9 flex-1 bg-background text-xs font-medium md:h-8"
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <Select
                      value={step.type}
                      onValueChange={(v) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          type: v as OperationStepType,
                          showCode: v === "command" ? true : prev.showCode,
                          codeBlock:
                            v === "command" && !prev.codeBlock
                              ? { language: preset.defaultCodeLanguage, content: "" }
                              : prev.codeBlock,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={`Step ${index + 1} type`}
                        className="h-9 w-[108px] bg-background text-xs capitalize md:h-8"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATION_STEP_TYPES.map((t) => (
                          <SelectItem
                            key={t}
                            value={t}
                            className="text-xs capitalize"
                          >
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                      aria-label="Move step up"
                      className="h-9 px-2 md:h-8"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                      aria-label="Move step down"
                      className="h-9 px-2 md:h-8"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(step.key)}
                      aria-label={`Delete step ${index + 1}`}
                      className="h-9 px-2 text-muted-foreground hover:text-overdue md:h-8"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Instructions Markdown + Live Preview toggle */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-muted-foreground">
                      Instructions (Markdown &amp; {`{{variables}}`} supported)
                    </Label>
                    <button
                      type="button"
                      onClick={() =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          previewMarkdown: !prev.previewMarkdown,
                        }))
                      }
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Eye className="size-3" />
                      {step.previewMarkdown ? "Edit" : "Preview"}
                    </button>
                  </div>

                  {step.previewMarkdown ? (
                    <div className="min-h-[72px] rounded-md border border-border bg-background p-3">
                      {step.bodyMarkdown.trim() ? (
                        <SafeMarkdown content={step.bodyMarkdown} />
                      ) : (
                        <p className="text-xs italic text-muted-foreground">
                          Nothing written yet.
                        </p>
                      )}
                    </div>
                  ) : (
                    <Textarea
                      rows={3}
                      value={step.bodyMarkdown}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          bodyMarkdown: e.target.value,
                        }))
                      }
                      placeholder="Write clear instructions… Use {{variable_key}} for dynamic values."
                      className="bg-background text-xs leading-relaxed"
                    />
                  )}
                </div>

                {/* Clean Collapsible Optional Power Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.key, (prev) => ({
                        ...prev,
                        showCode: !prev.showCode,
                        codeBlock:
                          !prev.showCode && !prev.codeBlock
                            ? {
                                language: preset.defaultCodeLanguage,
                                content: "",
                              }
                            : prev.codeBlock,
                      }))
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                      step.showCode
                        ? "border-collab/40 bg-collab/10 text-collab"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Code2 className="size-3" />
                    Command / Snippet
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.key, (prev) => ({
                        ...prev,
                        showTimer: !prev.showTimer,
                        timerSeconds:
                          !prev.showTimer && !prev.timerSeconds
                            ? 60
                            : prev.timerSeconds,
                      }))
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                      step.showTimer
                        ? "border-reminder/40 bg-reminder/10 text-reminder"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Timer className="size-3" />
                    Timer
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.key, (prev) => ({
                        ...prev,
                        showVerification: !prev.showVerification,
                      }))
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                      step.showVerification
                        ? "border-done/40 bg-done/10 text-done"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ShieldCheck className="size-3" />
                    {preset.verificationLabel}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.key, (prev) => ({
                        ...prev,
                        showBranch: !prev.showBranch,
                      }))
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                      step.showBranch
                        ? "border-collab/40 bg-collab/10 text-collab"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <GitBranch className="size-3" />
                    Decision cue
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateStep(step.key, (prev) => ({
                        ...prev,
                        showRollback: !prev.showRollback,
                      }))
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                      step.showRollback
                        ? "border-overdue/40 bg-overdue/10 text-overdue"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Undo2 className="size-3" />
                    {preset.rollbackLabel}
                  </button>
                </div>

                {/* Expanded Optional Fields */}
                {step.showCode ? (
                  <div className="space-y-1.5 rounded-md border border-border bg-muted/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[11px] text-muted-foreground">
                        {preset.codeBlockLabel}
                      </Label>
                      <Input
                        value={
                          step.codeBlock?.language ?? preset.defaultCodeLanguage
                        }
                        onChange={(e) =>
                          updateStep(step.key, (prev) => ({
                            ...prev,
                            codeBlock: {
                              language: e.target.value,
                              content: prev.codeBlock?.content ?? "",
                            },
                          }))
                        }
                        aria-label="Snippet language"
                        className="h-7 w-24 bg-background font-mono text-[11px]"
                      />
                    </div>
                    <Textarea
                      rows={3}
                      value={step.codeBlock?.content ?? ""}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          codeBlock: {
                            language:
                              prev.codeBlock?.language ??
                              preset.defaultCodeLanguage,
                            content: e.target.value,
                          },
                        }))
                      }
                      placeholder="e.g., ssh deploy@{{server_ip}} 'systemctl reload nginx'"
                      className="bg-background font-mono text-xs"
                    />
                  </div>
                ) : null}

                {step.showTimer ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-reminder/30 bg-reminder/5 px-3 py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-reminder">
                      <Timer className="size-3.5" />
                      Step timer duration
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        aria-label={`Step ${index + 1} timer minutes`}
                        value={timerMin}
                        onChange={(e) => {
                          const mins = Math.max(
                            0,
                            Number.parseInt(e.target.value || "0", 10) || 0
                          );
                          updateStep(step.key, (prev) => ({
                            ...prev,
                            timerSeconds: Math.max(1, mins * 60 + timerSec),
                          }));
                        }}
                        className="mono-tabular h-8 w-16 bg-background text-xs"
                      />
                      <span className="text-muted-foreground">min</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        aria-label={`Step ${index + 1} timer seconds`}
                        value={timerSec}
                        onChange={(e) => {
                          const secs = Math.min(
                            59,
                            Math.max(
                              0,
                              Number.parseInt(e.target.value || "0", 10) || 0
                            )
                          );
                          updateStep(step.key, (prev) => ({
                            ...prev,
                            timerSeconds: Math.max(1, timerMin * 60 + secs),
                          }));
                        }}
                        className="mono-tabular h-8 w-16 bg-background text-xs"
                      />
                      <span className="text-muted-foreground">sec</span>
                    </div>
                  </div>
                ) : null}

                {step.showVerification ? (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-done">
                      {preset.verificationLabel}
                    </Label>
                    <Input
                      value={step.verificationCue ?? ""}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          verificationCue: e.target.value,
                        }))
                      }
                      placeholder={preset.verificationPlaceholder}
                      className="h-9 bg-background text-xs md:h-8"
                    />
                  </div>
                ) : null}

                {step.showBranch ? (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-collab">
                      Decision / branch cue
                    </Label>
                    <Input
                      value={step.branchHint ?? ""}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          branchHint: e.target.value,
                        }))
                      }
                      placeholder="e.g., If dough feels stiff, rest 10 extra minutes before folding"
                      className="h-9 bg-background text-xs md:h-8"
                    />
                  </div>
                ) : null}

                {step.showRollback ? (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-overdue">
                      {preset.rollbackLabel}
                    </Label>
                    <Input
                      value={step.rollbackHint ?? ""}
                      onChange={(e) =>
                        updateStep(step.key, (prev) => ({
                          ...prev,
                          rollbackHint: e.target.value,
                        }))
                      }
                      placeholder={preset.rollbackPlaceholder}
                      className="h-9 bg-background text-xs md:h-8"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSteps((prev) => [...prev, createEmptyStep(domain)])}
          className="h-9 w-full gap-1.5 border-dashed text-xs md:h-8"
        >
          <Plus className="size-3.5" />
          {preset.addStepLabel}
        </Button>
      </section>

      {/* Bottom Publish Bar */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="op-change-summary" className="text-xs">
            Version note (optional)
          </Label>
          <Input
            id="op-change-summary"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder={
              mode === "create"
                ? "Initial version"
                : "What changed in this revision?"
            }
            className="h-9 bg-background text-xs md:h-8"
          />
        </div>

        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={handleSubmit}
          className="h-9 gap-1.5 px-4 text-xs md:h-8"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {mode === "create"
            ? "Create Operation"
            : `Publish v${(existingOp?.currentVersion ?? 1) + 1}`}
        </Button>
      </section>

      {/* Version History Drawer in Edit Mode */}
      {mode === "edit" && detail ? (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="text-sm">Version History</SheetTitle>
              <SheetDescription className="text-xs">
                Restoring any past snapshot creates a new version (v
                {(existingOp?.currentVersion ?? 1) + 1}) so full history is
                always preserved.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-3">
              {detail.versions.map((ver) => {
                const isCurrent =
                  ver.versionNumber === existingOp?.currentVersion;
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
                      <span className="mono-tabular font-semibold">
                        v{ver.versionNumber} {isCurrent ? "(Current)" : ""}
                      </span>
                      <span className="mono-tabular text-[10px] text-muted-foreground">
                        {formatInTimeZone(
                          ver.createdAt,
                          timezone,
                          "MMM d · HH:mm"
                        )}
                      </span>
                    </div>
                    {ver.changeSummary ? (
                      <p className="text-foreground/90">{ver.changeSummary}</p>
                    ) : null}
                    <p className="mono-tabular text-[11px] text-muted-foreground">
                      {ver.steps.length} steps · {ver.variables.length} vars
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
                        Restore as v{(existingOp?.currentVersion ?? 1) + 1}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
