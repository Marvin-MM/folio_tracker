"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  Flag,
  Focus,
  GitFork,
  Globe,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  LogIn,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Terminal,
  Undo2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import {
  flagOperationStepAction,
  forkOperationAction,
  startOperationRunAction,
} from "@/actions/operations";
import { SafeMarkdown } from "@/components/operations/safe-markdown";
import { StepTimer } from "@/components/operations/step-timer";
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
import { Textarea } from "@/components/ui/textarea";
import { setEphemeralRunSecrets } from "@/lib/ephemeral-run-secrets";
import { cn } from "@/lib/utils";
import {
  getOperationDomainPreset,
  interpolateStep,
  stripSecretVariables,
  type PublicOperationDetailDto,
} from "@/server/domain/operations";

interface GuestOperationRunnerProps {
  operation: PublicOperationDetailDto;
  isAuthenticated: boolean;
  isOwner: boolean;
  unlistedToken?: string | null;
}

type LocalStepStatus = "pending" | "done" | "skipped";

export function GuestOperationRunner({
  operation,
  isAuthenticated,
  isOwner,
  unlistedToken = null,
}: GuestOperationRunnerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const preset = getOperationDomainPreset(operation.domain);
  const { version } = operation;

  const [mode, setMode] = useState<"focus" | "checklist">("focus");
  const [activeIndex, setActiveIndex] = useState(0);
  const [preflightOpen, setPreflightOpen] = useState(
    version.variables.length > 0 || version.prerequisites.length > 0
  );
  const [expandedRollbackKeys, setExpandedRollbackKeys] = useState<string[]>([]);
  const [copiedStepKey, setCopiedStepKey] = useState<string | null>(null);

  // Strictly RAM-only browser runner state
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    () => {
      const init: Record<string, string> = {};
      for (const v of version.variables) {
        init[v.key] = v.type === "secret" ? "" : v.defaultValue ?? "";
      }
      return init;
    }
  );
  const [checkedPrereqs, setCheckedPrereqs] = useState<string[]>([]);
  const [stepStatuses, setStepStatuses] = useState<
    Record<string, LocalStepStatus>
  >(() => {
    const map: Record<string, LocalStepStatus> = {};
    for (const s of version.steps) map[s.key] = "pending";
    return map;
  });

  // Flag Step Modal (authenticated users only)
  const [flagStepKey, setFlagStepKey] = useState<string | null>(null);
  const [flagMessage, setFlagMessage] = useState("");

  const completedCount = useMemo(
    () =>
      version.steps.filter((s) => {
        const st = stepStatuses[s.key];
        return st === "done" || st === "skipped";
      }).length,
    [version.steps, stepStatuses]
  );

  const progressPct =
    version.steps.length > 0
      ? Math.round((completedCount / version.steps.length) * 100)
      : 0;

  const currentUrl =
    operation.visibility === "unlisted" && unlistedToken
      ? `/ops/${operation.slug}?token=${encodeURIComponent(unlistedToken)}`
      : `/ops/${operation.slug}`;

  const toggleStepStatus = (stepKey: string, next: LocalStepStatus) => {
    setStepStatuses((prev) => ({
      ...prev,
      [stepKey]: prev[stepKey] === next ? "pending" : next,
    }));
  };

  const handleCopyCode = async (stepKey: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedStepKey(stepKey);
      toast.success("Copied command to clipboard.");
      setTimeout(
        () => setCopiedStepKey((prev) => (prev === stepKey ? null : prev)),
        1500
      );
    } catch {
      toast.error("Unable to copy to clipboard.");
    }
  };

  const handleResetLocalRun = () => {
    const resetMap: Record<string, LocalStepStatus> = {};
    for (const s of version.steps) resetMap[s.key] = "pending";
    setStepStatuses(resetMap);
    setCheckedPrereqs([]);
    setActiveIndex(0);
    toast.success("Reset local progress.");
  };

  const handleStartSavedRun = () => {
    if (!isAuthenticated) {
      router.push(`/login?callbackURL=${encodeURIComponent(currentUrl)}`);
      return;
    }

    startTransition(async () => {
      const nonSecrets = stripSecretVariables(variableValues, version.variables);
      const secrets: Record<string, string> = {};
      for (const v of version.variables) {
        if (v.type === "secret" && variableValues[v.key]?.trim()) {
          secrets[v.key] = variableValues[v.key]!;
        }
      }

      const result = await startOperationRunAction({
        operationId: operation.id,
        variablesValues: nonSecrets,
        prerequisitesChecked: checkedPrereqs,
        unlistedToken,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      if (Object.keys(secrets).length > 0) {
        setEphemeralRunSecrets(result.data.run.id, secrets);
      }
      toast.success("Saved run started.");
      router.push(`/app/operations/runs/${result.data.run.id}`);
    });
  };

  const handleFork = () => {
    if (!isAuthenticated) {
      router.push(`/login?callbackURL=${encodeURIComponent(currentUrl)}`);
      return;
    }

    startTransition(async () => {
      const result = await forkOperationAction({
        operationId: operation.id,
        unlistedToken,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Forked to your workspace.");
      router.push(`/app/operations/${result.data.forked.id}`);
    });
  };

  const handleSubmitFlag = () => {
    if (!flagStepKey || !flagMessage.trim()) return;
    startTransition(async () => {
      const result = await flagOperationStepAction({
        operationId: operation.id,
        stepKey: flagStepKey,
        versionNumber: version.versionNumber,
        message: flagMessage.trim(),
        unlistedToken,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setFlagStepKey(null);
      setFlagMessage("");
      toast.success("Step flagged for the maintainer.");
    });
  };

  const toggleRollback = (stepKey: string) => {
    setExpandedRollbackKeys((prev) =>
      prev.includes(stepKey)
        ? prev.filter((k) => k !== stepKey)
        : [...prev, stepKey]
    );
  };

  const renderStepCard = (
    step: (typeof version.steps)[number],
    index: number
  ) => {
    const status = stepStatuses[step.key] ?? "pending";
    const interpolated = interpolateStep(
      step,
      variableValues,
      version.variables
    );
    const isRollbackOpen = expandedRollbackKeys.includes(step.key);
    const isDone = status === "done";
    const isSkipped = status === "skipped";

    return (
      <article
        key={step.key}
        className={cn(
          "space-y-3 rounded-lg border bg-card p-4 transition-colors",
          step.type === "caution"
            ? "border-overdue/55 bg-overdue/5"
            : isDone
              ? "border-done/45 bg-done/5"
              : "border-border"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                "mono-tabular mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
                isDone
                  ? "border-done bg-done text-white"
                  : "border-border bg-background text-foreground"
              )}
            >
              {isDone ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="space-y-0.5">
              <h2
                className={cn(
                  "text-sm font-semibold tracking-tight text-foreground",
                  isDone && "line-through opacity-75"
                )}
              >
                {step.title}
              </h2>
              {step.type === "caution" ? (
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-overdue">
                  <AlertTriangle className="size-3" />
                  Caution step — double-check before continuing
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px] capitalize",
                step.type === "caution" && "border-overdue/45 text-overdue",
                step.type === "command" && "border-collab/40 text-collab"
              )}
            >
              {step.type}
            </Badge>
            {isAuthenticated ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlagStepKey(step.key);
                  setFlagMessage("");
                }}
                aria-label={`Flag step ${index + 1}`}
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-overdue"
              >
                <Flag className="size-3" />
                Flag
              </Button>
            ) : null}
          </div>
        </div>

        {/* Built-in Step Timer */}
        {step.timerSeconds && step.timerSeconds > 0 ? (
          <StepTimer
            key={`${step.key}:${step.timerSeconds}`}
            initialSeconds={step.timerSeconds}
            stepTitle={step.title}
          />
        ) : null}

        {/* Interpolated Markdown Body */}
        {interpolated.bodyMarkdown ? (
          <SafeMarkdown content={interpolated.bodyMarkdown} />
        ) : null}

        {/* Interpolated Code / Command Snippet */}
        {interpolated.codeBlock?.content ? (
          <div className="overflow-hidden rounded-md border border-border bg-muted">
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <Terminal className="size-3" />
                {interpolated.codeBlock.language || "text"}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyCode(step.key, interpolated.codeBlock!.content)
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
              {interpolated.codeBlock.content}
            </pre>
          </div>
        ) : null}

        {/* Verification & Branch Cues */}
        {step.verificationCue || step.branchHint ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {step.verificationCue ? (
              <div className="rounded-md border border-done/30 bg-done/5 px-3 py-2 text-xs">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-done">
                  {preset.verificationLabel}
                </p>
                <p className="mt-0.5 text-foreground/90">
                  {step.verificationCue}
                </p>
              </div>
            ) : null}
            {step.branchHint ? (
              <div className="rounded-md border border-collab/30 bg-collab/5 px-3 py-2 text-xs">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-collab">
                  Decision cue
                </p>
                <p className="mt-0.5 text-foreground/90">{step.branchHint}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Expandable Rollback / Recovery Tip */}
        {step.rollbackHint ? (
          <div className="rounded-md border border-overdue/30 bg-overdue/5">
            <button
              type="button"
              onClick={() => toggleRollback(step.key)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-overdue"
            >
              <span className="inline-flex items-center gap-1.5">
                <Undo2 className="size-3.5" />
                {preset.rollbackLabel}
              </span>
              {isRollbackOpen ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {isRollbackOpen ? (
              <p className="border-t border-overdue/20 px-3 py-2 text-xs text-foreground/90">
                {step.rollbackHint}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Local Runner Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={isDone ? "default" : "outline"}
              onClick={() => {
                toggleStepStatus(step.key, "done");
                if (
                  mode === "focus" &&
                  !isDone &&
                  index < version.steps.length - 1
                ) {
                  setActiveIndex(index + 1);
                }
              }}
              className={cn(
                "h-9 gap-1.5 px-3 text-xs md:h-8",
                isDone && "bg-done text-white hover:bg-done/90"
              )}
            >
              {isDone ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Circle className="size-3.5" />
              )}
              {isDone ? "Done" : "Mark Done"}
            </Button>

            <Button
              type="button"
              size="sm"
              variant={isSkipped ? "secondary" : "ghost"}
              onClick={() => toggleStepStatus(step.key, "skipped")}
              className="h-9 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground md:h-8"
            >
              <SkipForward className="size-3.5" />
              {isSkipped ? "Skipped" : "Skip"}
            </Button>
          </div>

          {mode === "focus" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={index === 0}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                className="h-9 px-2.5 text-xs md:h-8"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={index >= version.steps.length - 1}
                onClick={() =>
                  setActiveIndex((i) =>
                    Math.min(version.steps.length - 1, i + 1)
                  )
                }
                className="h-9 px-2.5 text-xs md:h-8"
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  const flagStepMeta = flagStepKey
    ? version.steps.find((s) => s.key === flagStepKey)
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 pb-20 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/explore"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Explore Operations
        </Link>
        {isOwner ? (
          <Link
            href={`/app/operations/${operation.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-reminder hover:underline"
          >
            <Settings2 className="size-3.5" />
            Manage in Workspace
          </Link>
        ) : null}
      </div>

      {/* Subtle Guest Banner */}
      {!isAuthenticated ? (
        <div
          data-testid="guest-runner-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-xs"
        >
          <p className="text-muted-foreground">
            Running in browser mode — progress &amp; variables stay strictly in
            local memory.{" "}
            <strong className="font-medium text-foreground">
              Sign in to save run history, flag steps, or fork to your workspace.
            </strong>
          </p>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link
              href={`/login?callbackURL=${encodeURIComponent(currentUrl)}`}
            >
              <LogIn className="size-3.5" />
              Sign in
            </Link>
          </Button>
        </div>
      ) : null}

      {/* Blueprint Header Card */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
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
                ) : (
                  <Link2 className="size-2.5 text-collab" />
                )}
                <span className="capitalize">{operation.visibility}</span>
              </span>
              {operation.estimatedMinutes ? (
                <span className="mono-tabular inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Clock className="size-2.5" />
                  {operation.estimatedMinutes} min
                </span>
              ) : null}
              {operation.difficulty ? (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {operation.difficulty}
                </span>
              ) : null}
              {operation.lastVerifiedAt && !operation.staleness.isStale ? (
                <span className="inline-flex items-center gap-1 rounded border border-done/35 bg-done/10 px-1.5 py-0.5 text-[10px] text-done">
                  <ShieldCheck className="size-2.5" />
                  Verified{" "}
                  {operation.staleness.daysSinceVerified === 0
                    ? "today"
                    : `${operation.staleness.daysSinceVerified}d ago`}
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

            {/* Creator & Fork Attribution Row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {operation.creator.handle ? (
                <Link
                  href={`/u/${operation.creator.handle}`}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                >
                  <User className="size-3.5" />
                  <span className="font-medium text-foreground">
                    {operation.creator.name}
                  </span>
                  <span className="font-mono text-[11px]">
                    @{operation.creator.handle}
                  </span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" />
                  <span>{operation.creator.name}</span>
                </span>
              )}

              {operation.forkedFrom ? (
                <span className="inline-flex items-center gap-1 text-[11px]">
                  <GitFork className="size-3" />
                  Forked from{" "}
                  <Link
                    href={`/ops/${operation.forkedFrom.slug}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {operation.forkedFrom.title}
                  </Link>
                  {operation.forkedFrom.creatorHandle ? (
                    <span className="font-mono text-muted-foreground">
                      (@{operation.forkedFrom.creatorHandle})
                    </span>
                  ) : null}
                </span>
              ) : null}

              {operation.forkCount > 0 ? (
                <span className="mono-tabular inline-flex items-center gap-1 text-[11px]">
                  <GitFork className="size-3" />
                  {operation.forkCount}{" "}
                  {operation.forkCount === 1 ? "fork" : "forks"}
                </span>
              ) : null}
            </div>
          </div>

          {/* Authenticated Persistence / Fork Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            {isAuthenticated ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={handleStartSavedRun}
                  className="h-9 gap-1.5 px-3 text-xs md:h-8"
                >
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Start Saved Run
                </Button>
                {operation.allowForking ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={handleFork}
                    className="h-9 gap-1.5 px-3 text-xs md:h-8"
                  >
                    <GitFork className="size-3.5" />
                    Fork
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {/* Runner Progress + Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 pt-3">
          <div className="flex min-w-[180px] flex-1 items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-done transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="mono-tabular text-xs font-medium text-foreground">
              {completedCount}/{version.steps.length} ({progressPct}%)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div
              role="tablist"
              aria-label="Runner display mode"
              className="inline-flex rounded-md border border-border bg-muted/60 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "focus"}
                onClick={() => setMode("focus")}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium",
                  mode === "focus"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Focus className="size-3" />
                Focus
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "checklist"}
                onClick={() => setMode("checklist")}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium",
                  mode === "checklist"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListChecks className="size-3" />
                Checklist
              </button>
            </div>

            {completedCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetLocalRun}
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Collapsible Preflight: Dynamic Variables & Prerequisites */}
      {version.variables.length > 0 || version.prerequisites.length > 0 ? (
        <section className="rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setPreflightOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Preflight ·{" "}
              {version.variables.length > 0
                ? `${version.variables.length} variable${version.variables.length === 1 ? "" : "s"}`
                : ""}
              {version.variables.length > 0 && version.prerequisites.length > 0
                ? " · "
                : ""}
              {version.prerequisites.length > 0
                ? `${checkedPrereqs.length}/${version.prerequisites.length} ${preset.prerequisitesLabel.toLowerCase()}`
                : ""}
            </span>
            {preflightOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>

          {preflightOpen ? (
            <div className="space-y-4 border-t border-border p-4">
              {version.variables.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {version.variables.map((v) => (
                    <div key={v.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label
                          htmlFor={`guest-var-${v.key}`}
                          className="text-xs"
                        >
                          {v.label}{" "}
                          <code className="font-mono text-[10px] text-muted-foreground">
                            {`{{${v.key}}}`}
                          </code>
                        </Label>
                        {v.type === "secret" ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-overdue">
                            <Lock className="size-2.5" />
                            RAM only
                          </span>
                        ) : null}
                      </div>

                      {v.type === "select" && v.options ? (
                        <Select
                          value={variableValues[v.key] ?? ""}
                          onValueChange={(val) =>
                            setVariableValues((prev) => ({
                              ...prev,
                              [v.key]: val,
                            }))
                          }
                        >
                          <SelectTrigger
                            id={`guest-var-${v.key}`}
                            className="h-9 bg-background text-xs md:h-8"
                          >
                            <SelectValue placeholder="Choose…" />
                          </SelectTrigger>
                          <SelectContent>
                            {v.options.map((opt) => (
                              <SelectItem key={opt} value={opt} className="text-xs">
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`guest-var-${v.key}`}
                          type={
                            v.type === "secret"
                              ? "password"
                              : v.type === "number"
                                ? "number"
                                : "text"
                          }
                          autoComplete="off"
                          value={variableValues[v.key] ?? ""}
                          onChange={(e) =>
                            setVariableValues((prev) => ({
                              ...prev,
                              [v.key]: e.target.value,
                            }))
                          }
                          placeholder={
                            v.placeholder ||
                            (v.type === "secret"
                              ? "Stays strictly in memory"
                              : `Enter ${v.label.toLowerCase()}`)
                          }
                          className="h-9 bg-background font-mono text-xs md:h-8"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {version.prerequisites.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {preset.prerequisitesLabel}
                  </p>
                  {version.prerequisites.map((item) => {
                    const checked = checkedPrereqs.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
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
                        <span
                          className={cn(
                            checked && "line-through text-muted-foreground"
                          )}
                        >
                          {item.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Steps Area */}
      {mode === "focus" && version.steps.length > 0 ? (
        <div className="space-y-3">
          {/* Step Stepper Strip */}
          <div className="flex flex-wrap items-center gap-1.5">
            {version.steps.map((s, idx) => {
              const st = stepStatuses[s.key] ?? "pending";
              const isCurrent = idx === activeIndex;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={cn(
                    "mono-tabular inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors",
                    isCurrent
                      ? "border-foreground bg-foreground text-background"
                      : st === "done"
                        ? "border-done/40 bg-done/10 text-done"
                        : st === "skipped"
                          ? "border-border bg-muted text-muted-foreground line-through"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {renderStepCard(version.steps[activeIndex] ?? version.steps[0]!, activeIndex)}
        </div>
      ) : (
        <div className="space-y-3">
          {version.steps.map((step, index) => renderStepCard(step, index))}
        </div>
      )}

      {/* Flag Step Modal */}
      <Dialog
        open={Boolean(flagStepKey)}
        onOpenChange={(open) => {
          if (!open) {
            setFlagStepKey(null);
            setFlagMessage("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Flag Step Issue</DialogTitle>
            <DialogDescription className="text-xs">
              Report an outdated command, unclear instruction, or missing detail
              for{" "}
              <span className="font-medium text-foreground">
                {flagStepMeta?.title ?? "this step"}
              </span>{" "}
              (v{version.versionNumber}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="guest-flag-message" className="text-xs">
              What needs updating?
            </Label>
            <Textarea
              id="guest-flag-message"
              rows={3}
              maxLength={500}
              value={flagMessage}
              onChange={(e) => setFlagMessage(e.target.value)}
              placeholder="e.g., Step 2 flag changed in the latest CLI release, or bake temperature ran too hot…"
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFlagStepKey(null)}
              className="h-9 text-xs md:h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || !flagMessage.trim()}
              onClick={handleSubmitFlag}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Flag className="size-3.5" />
              )}
              Submit Flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
