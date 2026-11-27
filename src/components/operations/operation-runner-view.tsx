"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
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
  CloudOff,
  Copy,
  FileText,
  Focus,
  ListChecks,
  Loader2,
  Lock,
  PlusSquare,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  SkipForward,
  Terminal,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  abandonOperationRunAction,
  completeOperationRunAction,
  createBlockedStepTaskAction,
  syncOfflineRunMutationsAction,
  updateOperationRunPreflightAction,
  updateOperationRunStepAction,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import {
  clearEphemeralRunSecrets,
  getEphemeralRunSecrets,
  setEphemeralRunSecrets,
} from "@/lib/ephemeral-run-secrets";
import {
  clearPendingOfflineMutations,
  countPendingOfflineMutations,
  loadOfflineRunCache,
  queueOfflinePreflightMutation,
  queueOfflineStepMutation,
  removeOfflineRunCache,
  saveOfflineRunSnapshot,
  type OfflineRunCacheRecord,
} from "@/lib/offline-run-store";
import { zonedWallClockToUtcMs } from "@/lib/reminder-presets";
import { cn } from "@/lib/utils";
import type {
  OperationRunStepStatus,
  TaskPriority,
} from "@/server/db/schema";
import {
  getOperationDomainPreset,
  interpolateStep,
  stripSecretVariables,
} from "@/server/domain/operations";
import type { OperationRunDetailPayload } from "@/server/services/operation-run-service";

interface OperationRunnerViewProps {
  detail: OperationRunDetailPayload;
  userId: string;
  timezone: string;
}

type StepStateMap = OfflineRunCacheRecord["stepStates"];

function buildInitialStepStateMap(detail: OperationRunDetailPayload): StepStateMap {
  const map: StepStateMap = {};
  for (const step of detail.pinnedVersion.steps) {
    map[step.key] = {
      status: "pending",
      note: null,
      completedAt: null,
      updatedAt: detail.run.startedAt,
    };
  }
  for (const row of detail.stepStates) {
    map[row.stepKey] = {
      status: row.status,
      note: row.note,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    };
  }
  return map;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function subscribeOnlineStatus(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof window === "undefined" ? true : window.navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

export function OperationRunnerView({
  detail,
  userId,
  timezone,
}: OperationRunnerViewProps) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const { run, operation, pinnedVersion, referenceNotes } = detail;
  const preset = getOperationDomainPreset(operation.domain);
  const isReadOnly = run.status !== "in_progress";

  const [mode, setMode] = useState<"focus" | "checklist">("focus");
  const [activeIndex, setActiveIndex] = useState(0);
  const [preflightOpen, setPreflightOpen] = useState(
    pinnedVersion.variables.length > 0 || pinnedVersion.prerequisites.length > 0
  );
  const [expandedRollbackKeys, setExpandedRollbackKeys] = useState<string[]>([]);
  const [copiedStepKey, setCopiedStepKey] = useState<string | null>(null);

  // Persisted non-secret variable values + prerequisites + step states
  const [nonSecretValues, setNonSecretValues] = useState<Record<string, string>>(
    () => stripSecretVariables(detail.variablesValues, pinnedVersion.variables)
  );
  // STRICTLY RAM-ONLY secret values — NEVER saved to Turso or localStorage!
  const [secretValues, setSecretValues] = useState<Record<string, string>>(() =>
    getEphemeralRunSecrets(run.id)
  );
  const [checkedPrereqs, setCheckedPrereqs] = useState<string[]>(
    detail.prerequisitesChecked
  );
  const [stepStates, setStepStates] = useState<StepStateMap>(() =>
    buildInitialStepStateMap(detail)
  );

  // Offline resilience state
  const browserOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  );
  const [networkDropped, setNetworkDropped] = useState(false);
  const isOffline = !browserOnline || networkDropped;
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);

  // Dialog states
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [markVerifiedOnComplete, setMarkVerifiedOnComplete] = useState(
    operation.ownerId === userId
  );
  const [autoLogHabitOnComplete, setAutoLogHabitOnComplete] = useState(
    Boolean(operation.linkedHabitId)
  );

  const [blockedDialogStepKey, setBlockedDialogStepKey] = useState<
    string | null
  >(null);
  const [blockedTaskTitle, setBlockedTaskTitle] = useState("");
  const [blockedTaskDesc, setBlockedTaskDesc] = useState("");
  const [blockedTaskDate, setBlockedTaskDate] = useState("");
  const [blockedTaskTime, setBlockedTaskTime] = useState("09:00");
  const [blockedTaskPriority, setBlockedTaskPriority] =
    useState<TaskPriority>("high");

  const mergedVariableValues = useMemo(
    () => ({ ...nonSecretValues, ...secretValues }),
    [nonSecretValues, secretValues]
  );

  const stepStatesRef = useRef(stepStates);
  const nonSecretRef = useRef(nonSecretValues);
  const checkedPrereqsRef = useRef(checkedPrereqs);
  useEffect(() => {
    stepStatesRef.current = stepStates;
  }, [stepStates]);
  useEffect(() => {
    nonSecretRef.current = nonSecretValues;
  }, [nonSecretValues]);
  useEffect(() => {
    checkedPrereqsRef.current = checkedPrereqs;
  }, [checkedPrereqs]);

  const flushOfflineQueue = useCallback(async () => {
    if (isReadOnly) return;
    const cached = loadOfflineRunCache(userId, run.id);
    if (!cached || countPendingOfflineMutations(cached) === 0) {
      setPendingOfflineCount(0);
      return;
    }

    setIsSyncingOffline(true);
    try {
      const stepUpdates = Object.values(cached.pendingStepMutations).map(
        (m) => ({
          stepKey: m.stepKey,
          status: m.status,
          note: m.note,
        })
      );
      const result = await syncOfflineRunMutationsAction({
        runId: run.id,
        preflight: cached.pendingPreflight
          ? {
              title: cached.pendingPreflight.title,
              variablesValues: stripSecretVariables(
                cached.pendingPreflight.variablesValues ?? {},
                pinnedVersion.variables
              ),
              prerequisitesChecked:
                cached.pendingPreflight.prerequisitesChecked,
            }
          : undefined,
        stepUpdates,
      });

      if (result.ok) {
        clearPendingOfflineMutations(userId, run.id, pinnedVersion.variables);
        setPendingOfflineCount(0);
        setNetworkDropped(false);
        await invalidate(["operations"]);
        toast.success("Offline progress synced.");
      }
    } catch {
      // Remain queued until connectivity stabilizes
    } finally {
      setIsSyncingOffline(false);
    }
  }, [isReadOnly, userId, run.id, pinnedVersion.variables, invalidate]);

  // Hydrate offline cache on mount + auto-flush when browser comes back online
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const hydrateAndMaybeSync = async () => {
      if (isReadOnly) return;
      const cached = loadOfflineRunCache(userId, run.id);
      if (cached) {
        const pendingCount = countPendingOfflineMutations(cached);
        if (pendingCount > 0) {
          if (!cancelled) {
            setNonSecretValues(
              stripSecretVariables(
                cached.variablesValues,
                pinnedVersion.variables
              )
            );
            setCheckedPrereqs(cached.prerequisitesChecked);
            setStepStates((prev) => ({ ...prev, ...cached.stepStates }));
            setPendingOfflineCount(pendingCount);
          }
          if (window.navigator.onLine) {
            await flushOfflineQueue();
          }
          return;
        }
      }

      saveOfflineRunSnapshot({
        userId,
        runId: run.id,
        variablesSchema: pinnedVersion.variables,
        variablesValues: detail.variablesValues,
        prerequisitesChecked: detail.prerequisitesChecked,
        stepStates: buildInitialStepStateMap(detail),
      });
    };

    void hydrateAndMaybeSync();

    const handleOnline = () => {
      setNetworkDropped(false);
      void flushOfflineQueue();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, [
    userId,
    run.id,
    isReadOnly,
    pinnedVersion.variables,
    detail,
    flushOfflineQueue,
  ]);

  // Progress counts
  const progressStats = useMemo(() => {
    let done = 0;
    let skipped = 0;
    let blocked = 0;
    for (const step of pinnedVersion.steps) {
      const status = stepStates[step.key]?.status ?? "pending";
      if (status === "done") done += 1;
      else if (status === "skipped") skipped += 1;
      else if (status === "blocked") blocked += 1;
    }
    const total = pinnedVersion.steps.length;
    const finished = done + skipped;
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
    return { total, done, skipped, blocked, finished, pct };
  }, [pinnedVersion.steps, stepStates]);

  const persistPreflight = useCallback(
    async (
      nextNonSecret: Record<string, string>,
      nextCheckedPrereqs: string[]
    ) => {
      if (isReadOnly) return;
      const safeNonSecret = stripSecretVariables(
        nextNonSecret,
        pinnedVersion.variables
      );

      if (typeof window !== "undefined" && !window.navigator.onLine) {
        const cached = queueOfflinePreflightMutation({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: safeNonSecret,
          prerequisitesChecked: nextCheckedPrereqs,
          stepStates: stepStatesRef.current,
        });
        setPendingOfflineCount(countPendingOfflineMutations(cached));
        return;
      }

      try {
        const result = await updateOperationRunPreflightAction({
          runId: run.id,
          variablesValues: safeNonSecret,
          prerequisitesChecked: nextCheckedPrereqs,
        });
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        saveOfflineRunSnapshot({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: safeNonSecret,
          prerequisitesChecked: nextCheckedPrereqs,
          stepStates: stepStatesRef.current,
        });
      } catch {
        setNetworkDropped(true);
        const cached = queueOfflinePreflightMutation({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: safeNonSecret,
          prerequisitesChecked: nextCheckedPrereqs,
          stepStates: stepStatesRef.current,
        });
        setPendingOfflineCount(countPendingOfflineMutations(cached));
      }
    },
    [isReadOnly, pinnedVersion.variables, userId, run.id]
  );

  const handleStepStatusChange = useCallback(
    async (
      stepKey: string,
      status: OperationRunStepStatus,
      noteOverride?: string | null
    ) => {
      if (isReadOnly) return;
      const nowMs = Date.now();
      const prevEntry = stepStatesRef.current[stepKey];
      const nextNote =
        noteOverride !== undefined ? noteOverride : (prevEntry?.note ?? null);

      const nextMap: StepStateMap = {
        ...stepStatesRef.current,
        [stepKey]: {
          status,
          note: nextNote,
          completedAt: status === "done" ? nowMs : null,
          updatedAt: nowMs,
        },
      };
      setStepStates(nextMap);
      stepStatesRef.current = nextMap;

      if (typeof window !== "undefined" && !window.navigator.onLine) {
        const cached = queueOfflineStepMutation({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: nonSecretRef.current,
          prerequisitesChecked: checkedPrereqsRef.current,
          stepStates: nextMap,
          mutation: { stepKey, status, note: nextNote },
        });
        setPendingOfflineCount(countPendingOfflineMutations(cached));
        return;
      }

      try {
        const result = await updateOperationRunStepAction({
          runId: run.id,
          stepKey,
          status,
          note: nextNote,
        });
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        saveOfflineRunSnapshot({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: nonSecretRef.current,
          prerequisitesChecked: checkedPrereqsRef.current,
          stepStates: nextMap,
        });
      } catch {
        setNetworkDropped(true);
        const cached = queueOfflineStepMutation({
          userId,
          runId: run.id,
          variablesSchema: pinnedVersion.variables,
          variablesValues: nonSecretRef.current,
          prerequisitesChecked: checkedPrereqsRef.current,
          stepStates: nextMap,
          mutation: { stepKey, status, note: nextNote },
        });
        setPendingOfflineCount(countPendingOfflineMutations(cached));
      }
    },
    [isReadOnly, userId, run.id, pinnedVersion.variables]
  );

  // Keyboard shortcuts: J (next), K (prev), Space (toggle done)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableElement(event.target) ||
        completeDialogOpen ||
        blockedDialogStepKey !== null
      ) {
        return;
      }

      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        setActiveIndex((prev) =>
          Math.min(pinnedVersion.steps.length - 1, prev + 1)
        );
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      } else if (event.code === "Space" && !isReadOnly) {
        event.preventDefault();
        const currentStep = pinnedVersion.steps[activeIndex];
        if (!currentStep) return;
        const currentStatus =
          stepStatesRef.current[currentStep.key]?.status ?? "pending";
        const nextStatus: OperationRunStepStatus =
          currentStatus === "done" ? "pending" : "done";
        void handleStepStatusChange(currentStep.key, nextStatus);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeIndex,
    pinnedVersion.steps,
    isReadOnly,
    completeDialogOpen,
    blockedDialogStepKey,
    handleStepStatusChange,
  ]);

  const handleCopySnippet = async (stepKey: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStepKey(stepKey);
      toast.success("Copied interpolated snippet.");
      setTimeout(
        () => setCopiedStepKey((prev) => (prev === stepKey ? null : prev)),
        1500
      );
    } catch {
      toast.error("Unable to copy snippet.");
    }
  };

  const openBlockedTaskDialog = (stepKey: string, stepTitle: string) => {
    setBlockedDialogStepKey(stepKey);
    setBlockedTaskTitle(`Unblock "${stepTitle}" (${operation.title})`);
    setBlockedTaskDesc(stepStates[stepKey]?.note ?? "");
    setBlockedTaskDate("");
    setBlockedTaskTime("09:00");
    setBlockedTaskPriority("high");
  };

  const handleCreateBlockedTask = () => {
    if (!blockedDialogStepKey) return;
    startTransition(async () => {
      let utcMs: number | null = null;
      if (blockedTaskDate) {
        utcMs = zonedWallClockToUtcMs(
          blockedTaskDate,
          blockedTaskTime || "09:00",
          timezone
        );
      }

      const result = await createBlockedStepTaskAction({
        runId: run.id,
        stepKey: blockedDialogStepKey,
        title: blockedTaskTitle.trim() || undefined,
        description: blockedTaskDesc.trim() || undefined,
        dueAt: utcMs,
        remindAt: utcMs,
        priority: blockedTaskPriority,
        timezone,
        markStepBlocked: true,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      const targetKey = blockedDialogStepKey;
      setStepStates((prev) => ({
        ...prev,
        [targetKey]: {
          status: "blocked",
          note: prev[targetKey]?.note ?? null,
          completedAt: null,
          updatedAt: Date.now(),
        },
      }));
      setBlockedDialogStepKey(null);
      await invalidate(["operations", "tasks", "reminders", "projects", "sidebar"]);
      toast.success("Follow-up task created and linked to this run.");
    });
  };

  const handleCompleteRun = () => {
    startTransition(async () => {
      if (pendingOfflineCount > 0) {
        await flushOfflineQueue();
      }
      const result = await completeOperationRunAction({
        runId: run.id,
        markOperationVerified: markVerifiedOnComplete,
        autoLogLinkedHabit: autoLogHabitOnComplete,
        timezone,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      removeOfflineRunCache(userId, run.id);
      clearEphemeralRunSecrets(run.id);
      setCompleteDialogOpen(false);
      await invalidate(["operations", "habits", "today", "tasks", "sidebar"]);

      if (result.data.habitAutoLogged) {
        toast.success(
          `Run completed · Logged "${result.data.habitAutoLogged.habitTitle}" for today.`
        );
      } else if (result.data.habitAutoLogSkippedReason) {
        toast.info(
          `Run completed. ${result.data.habitAutoLogSkippedReason}`
        );
      } else {
        toast.success("Run completed.");
      }

      router.push(`/app/operations/${operation.id}`);
    });
  };

  const handleAbandonRun = () => {
    startTransition(async () => {
      const result = await abandonOperationRunAction({ runId: run.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      removeOfflineRunCache(userId, run.id);
      clearEphemeralRunSecrets(run.id);
      await invalidate(["operations"]);
      toast.success("Run abandoned.");
      router.push(`/app/operations/${operation.id}`);
    });
  };

  const renderStepCard = (
    step: OperationRunDetailPayload["pinnedVersion"]["steps"][number],
    index: number,
    isFocusedCard: boolean
  ) => {
    const state = stepStates[step.key] ?? {
      status: "pending" as const,
      note: null,
      completedAt: null,
      updatedAt: run.startedAt,
    };
    const interpolated = interpolateStep(
      step,
      mergedVariableValues,
      pinnedVersion.variables
    );
    const rollbackExpanded = expandedRollbackKeys.includes(step.key);
    const isCaution = step.type === "caution";

    return (
      <article
        key={step.key}
        data-testid={`runner-step-${index + 1}`}
        className={cn(
          "space-y-3 rounded-lg border bg-card p-4 transition-colors",
          isCaution
            ? "border-overdue/60 bg-overdue/5"
            : state.status === "done"
              ? "border-done/40"
              : state.status === "blocked"
                ? "border-overdue/50"
                : "border-border"
        )}
      >
        {/* Step Header */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className={cn(
                "mono-tabular mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
                state.status === "done"
                  ? "border-done bg-done text-primary-foreground"
                  : state.status === "blocked"
                    ? "border-overdue bg-overdue/15 text-overdue"
                    : "border-border bg-background text-foreground"
              )}
            >
              {state.status === "done" ? (
                <Check className="size-3.5 stroke-[2.5]" />
              ) : (
                index + 1
              )}
            </span>
            <div className="min-w-0">
              <h2
                className={cn(
                  "text-sm font-semibold tracking-tight text-foreground",
                  state.status === "skipped" && "text-muted-foreground line-through"
                )}
              >
                {interpolated.title}
              </h2>
              {interpolated.unresolvedKeys.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-reminder">
                  Unfilled variables:{" "}
                  {interpolated.unresolvedKeys
                    .map((k) => `{{${k}}}`)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px] capitalize",
                isCaution && "border-overdue/45 text-overdue",
                step.type === "command" && "border-collab/40 text-collab"
              )}
            >
              {step.type}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px] capitalize",
                state.status === "done" && "border-done/40 bg-done/10 text-done",
                state.status === "blocked" &&
                  "border-overdue/40 bg-overdue/10 text-overdue",
                state.status === "skipped" && "bg-muted text-muted-foreground"
              )}
            >
              {state.status}
            </Badge>
          </div>
        </div>

        {/* Instructions Markdown */}
        {interpolated.bodyMarkdown ? (
          <SafeMarkdown content={interpolated.bodyMarkdown} />
        ) : null}

        {/* Interactive Built-In Countdown Timer */}
        {step.timerSeconds ? (
          <StepTimer
            key={`${step.key}-${step.timerSeconds}`}
            initialSeconds={step.timerSeconds}
            stepTitle={interpolated.title}
            compact={!isFocusedCard}
          />
        ) : null}

        {/* Interpolated Code / Command Block */}
        {interpolated.codeBlock?.content ? (
          <div className="overflow-hidden rounded-md border border-border bg-muted">
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <Terminal className="size-3" />
                {interpolated.codeBlock.language}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopySnippet(step.key, interpolated.codeBlock!.content)
                }
                className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-muted-foreground hover:bg-background hover:text-foreground"
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
            <pre
              data-testid={`runner-code-${index + 1}`}
              className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground"
            >
              {interpolated.codeBlock.content}
            </pre>
          </div>
        ) : null}

        {/* Verification & Decision Cues */}
        {interpolated.verificationCue ? (
          <div className="rounded-md border border-done/35 bg-done/5 px-3 py-2 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-done">
              {preset.verificationLabel}
            </p>
            <p className="mt-0.5 text-foreground/90">
              {interpolated.verificationCue}
            </p>
          </div>
        ) : null}

        {interpolated.branchHint ? (
          <div className="rounded-md border border-collab/35 bg-collab/5 px-3 py-2 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-collab">
              Decision cue
            </p>
            <p className="mt-0.5 text-foreground/90">
              {interpolated.branchHint}
            </p>
          </div>
        ) : null}

        {/* Expandable Rollback Tip */}
        {interpolated.rollbackHint ? (
          <div className="rounded-md border border-overdue/30 bg-background">
            <button
              type="button"
              onClick={() =>
                setExpandedRollbackKeys((prev) =>
                  prev.includes(step.key)
                    ? prev.filter((k) => k !== step.key)
                    : [...prev, step.key]
                )
              }
              className="flex h-9 w-full items-center justify-between px-3 text-left text-xs font-medium text-overdue md:h-8"
            >
              <span className="inline-flex items-center gap-1.5">
                <Undo2 className="size-3.5" />
                {preset.rollbackLabel}
              </span>
              {rollbackExpanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {rollbackExpanded ? (
              <p className="border-t border-overdue/20 px-3 py-2 text-xs text-foreground/90">
                {interpolated.rollbackHint}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Per-Step Status & Note Bar */}
        {!isReadOnly ? (
          <div className="space-y-2.5 border-t border-border/80 pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={state.status === "done" ? "default" : "outline"}
                onClick={() =>
                  void handleStepStatusChange(
                    step.key,
                    state.status === "done" ? "pending" : "done"
                  )
                }
                className={cn(
                  "h-9 gap-1.5 px-3 text-xs md:h-8",
                  state.status === "done" &&
                    "border-done bg-done text-primary-foreground hover:bg-done/90"
                )}
              >
                <CheckCircle2 className="size-3.5" />
                {state.status === "done" ? "Done" : "Mark done"}
              </Button>

              <Button
                type="button"
                size="sm"
                variant={state.status === "skipped" ? "secondary" : "outline"}
                onClick={() =>
                  void handleStepStatusChange(
                    step.key,
                    state.status === "skipped" ? "pending" : "skipped"
                  )
                }
                className="h-9 gap-1.5 px-2.5 text-xs md:h-8"
              >
                <SkipForward className="size-3.5" />
                Skip
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void handleStepStatusChange(
                    step.key,
                    state.status === "blocked" ? "pending" : "blocked"
                  )
                }
                className={cn(
                  "h-9 gap-1.5 px-2.5 text-xs md:h-8",
                  state.status === "blocked" &&
                    "border-overdue bg-overdue/10 text-overdue"
                )}
              >
                <AlertTriangle className="size-3.5" />
                Blocked
              </Button>

              {state.status === "blocked" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openBlockedTaskDialog(step.key, interpolated.title)
                  }
                  className="h-9 gap-1.5 border-overdue/45 bg-overdue/10 px-2.5 text-xs text-overdue hover:bg-overdue/15 md:h-8"
                >
                  <PlusSquare className="size-3.5" />
                  Create Follow-up Task
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={state.note ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setStepStates((prev) => ({
                    ...prev,
                    [step.key]: {
                      ...(prev[step.key] ?? {
                        status: "pending",
                        completedAt: null,
                        updatedAt: Date.now(),
                      }),
                      note: val,
                    },
                  }));
                }}
                onBlur={(e) => {
                  void handleStepStatusChange(
                    step.key,
                    state.status,
                    e.target.value
                  );
                }}
                maxLength={500}
                placeholder="Optional step note (observations, measured temp, error output…)"
                aria-label={`Step ${index + 1} note`}
                className="h-9 flex-1 bg-background text-xs md:h-8"
              />
            </div>
          </div>
        ) : state.note ? (
          <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Run note:</span>{" "}
            {state.note}
          </div>
        ) : null}
      </article>
    );
  };

  const activeStep = pinnedVersion.steps[activeIndex] ?? pinnedVersion.steps[0];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 pb-20 md:px-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/app/operations/${operation.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {operation.title}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {/* Calm Offline / Sync Pill */}
          {isOffline ? (
            <span
              data-testid="offline-status-pill"
              className="inline-flex items-center gap-1.5 rounded-md border border-reminder/45 bg-reminder/10 px-2.5 py-1 text-[11px] font-medium text-reminder"
            >
              <CloudOff className="size-3.5" />
              Offline — changes saved locally
              {pendingOfflineCount > 0 ? ` (${pendingOfflineCount})` : ""}
            </span>
          ) : pendingOfflineCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSyncingOffline}
              onClick={() => void flushOfflineQueue()}
              className="h-7 gap-1.5 border-reminder/40 text-[11px] text-reminder"
            >
              <RefreshCw
                className={cn("size-3", isSyncingOffline && "animate-spin")}
              />
              Sync {pendingOfflineCount} offline change
              {pendingOfflineCount === 1 ? "" : "s"}
            </Button>
          ) : null}

          {!isReadOnly ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleAbandonRun}
                className="h-9 gap-1 px-2.5 text-xs text-muted-foreground hover:text-overdue md:h-8"
              >
                <XCircle className="size-3.5" />
                Abandon
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() => setCompleteDialogOpen(true)}
                className="h-9 gap-1.5 px-3 text-xs md:h-8"
              >
                <CheckCircle2 className="size-3.5" />
                Complete Run
              </Button>
            </>
          ) : (
            <Badge
              variant="outline"
              className={cn(
                "h-6 px-2 text-xs capitalize",
                run.status === "completed"
                  ? "border-done/40 bg-done/10 text-done"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {run.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Progress & Mode Header */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px]", preset.badgeClassName)}
              >
                {preset.shortLabel}
              </Badge>
              <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                v{pinnedVersion.versionNumber} pinned
              </span>
              {operation.currentVersion > pinnedVersion.versionNumber ? (
                <span className="text-[10px] text-muted-foreground">
                  (newer v{operation.currentVersion} available for future runs)
                </span>
              ) : null}
            </div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              {run.title}
            </h1>
          </div>

          <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setMode("focus")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs transition-colors md:h-7",
                mode === "focus"
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Focus className="size-3.5" />
              Focus
            </button>
            <button
              type="button"
              onClick={() => setMode("checklist")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs transition-colors md:h-7",
                mode === "checklist"
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ListChecks className="size-3.5" />
              Checklist
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="mono-tabular font-medium text-foreground">
              {mode === "focus"
                ? `Step ${activeIndex + 1} of ${progressStats.total}`
                : `${progressStats.finished} of ${progressStats.total} complete`}
            </span>
            <span className="mono-tabular text-[11px] text-muted-foreground">
              {progressStats.done} done · {progressStats.skipped} skipped ·{" "}
              {progressStats.blocked} blocked ({progressStats.pct}%)
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-reminder transition-all duration-200"
              style={{ width: `${progressStats.pct}%` }}
            />
          </div>
        </div>
      </section>

      {/* Collapsible Preflight: Dynamic Variables + Prerequisites + Reference Notes */}
      {pinnedVersion.variables.length > 0 ||
      pinnedVersion.prerequisites.length > 0 ||
      referenceNotes.length > 0 ? (
        <section className="rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setPreflightOpen((prev) => !prev)}
            className="flex h-10 w-full items-center justify-between px-4 text-left text-xs font-semibold text-foreground"
          >
            <span>
              Preflight · Variables ({pinnedVersion.variables.length}) &amp;{" "}
              {preset.prerequisitesLabel} ({checkedPrereqs.length}/
              {pinnedVersion.prerequisites.length})
            </span>
            {preflightOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>

          {preflightOpen ? (
            <div className="space-y-4 border-t border-border p-4">
              {pinnedVersion.variables.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {pinnedVersion.variables.map((variable) => {
                    const isSecret = variable.type === "secret";
                    const val = isSecret
                      ? (secretValues[variable.key] ?? "")
                      : (nonSecretValues[variable.key] ?? "");
                    return (
                      <div key={variable.key} className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <Label
                            htmlFor={`run-var-${variable.key}`}
                            className="text-xs"
                          >
                            {variable.label}{" "}
                            <code className="font-mono text-[10px] text-muted-foreground">
                              {`{{${variable.key}}}`}
                            </code>
                          </Label>
                          {isSecret ? (
                            <span
                              data-testid={`secret-badge-${variable.key}`}
                              className="inline-flex items-center gap-1 text-[10px] text-overdue"
                            >
                              <Lock className="size-2.5" />
                              RAM only — never saved
                            </span>
                          ) : null}
                        </div>

                        {variable.type === "select" && variable.options ? (
                          <Select
                            disabled={isReadOnly}
                            value={val}
                            onValueChange={(nextVal) => {
                              const nextMap = {
                                ...nonSecretValues,
                                [variable.key]: nextVal,
                              };
                              setNonSecretValues(nextMap);
                              void persistPreflight(nextMap, checkedPrereqs);
                            }}
                          >
                            <SelectTrigger
                              id={`run-var-${variable.key}`}
                              className="h-9 bg-background text-xs md:h-8"
                            >
                              <SelectValue
                                placeholder={
                                  variable.placeholder || "Select value"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {variable.options.map((opt) => (
                                <SelectItem
                                  key={opt}
                                  value={opt}
                                  className="text-xs"
                                >
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`run-var-${variable.key}`}
                            type={
                              isSecret
                                ? "password"
                                : variable.type === "number"
                                  ? "number"
                                  : "text"
                            }
                            autoComplete="off"
                            disabled={isReadOnly}
                            value={val}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              if (isSecret) {
                                const nextSecrets = {
                                  ...secretValues,
                                  [variable.key]: nextVal,
                                };
                                setSecretValues(nextSecrets);
                                setEphemeralRunSecrets(run.id, nextSecrets);
                              } else {
                                setNonSecretValues((prev) => ({
                                  ...prev,
                                  [variable.key]: nextVal,
                                }));
                              }
                            }}
                            onBlur={() => {
                              if (!isSecret) {
                                void persistPreflight(
                                  nonSecretValues,
                                  checkedPrereqs
                                );
                              }
                            }}
                            placeholder={
                              variable.placeholder ||
                              (isSecret
                                ? "Secret kept in memory only"
                                : `Enter ${variable.label.toLowerCase()}`)
                            }
                            className="h-9 bg-background font-mono text-xs md:h-8"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {pinnedVersion.prerequisites.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {preset.prerequisitesLabel}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {pinnedVersion.prerequisites.map((item) => {
                      const checked = checkedPrereqs.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            disabled={isReadOnly}
                            checked={checked}
                            onChange={() => {
                              const nextChecked = checked
                                ? checkedPrereqs.filter((id) => id !== item.id)
                                : [...checkedPrereqs, item.id];
                              setCheckedPrereqs(nextChecked);
                              void persistPreflight(
                                nonSecretValues,
                                nextChecked
                              );
                            }}
                            className="mt-0.5 size-4 rounded border-border accent-primary"
                          />
                          <span
                            className={cn(
                              checked && "text-muted-foreground line-through"
                            )}
                          >
                            {item.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {referenceNotes.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    Reference Notes:
                  </span>
                  {referenceNotes.map((note) => (
                    <Link
                      key={note.id}
                      href={`/app/notes?item=${note.id}`}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:border-reminder"
                    >
                      <FileText className="size-3 text-muted-foreground" />
                      {note.title}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Main Runner Area: Focus Stepper vs Compact Checklist */}
      {mode === "focus" && activeStep ? (
        <div className="space-y-3">
          {/* Mini Stepper Dots */}
          <div className="flex flex-wrap items-center gap-1.5">
            {pinnedVersion.steps.map((step, idx) => {
              const st = stepStates[step.key]?.status ?? "pending";
              const isCurrent = idx === activeIndex;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  aria-label={`Jump to step ${idx + 1}: ${step.title}`}
                  className={cn(
                    "mono-tabular inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-[11px] transition-colors",
                    isCurrent
                      ? "border-foreground bg-foreground font-semibold text-background"
                      : st === "done"
                        ? "border-done/40 bg-done/10 text-done"
                        : st === "blocked"
                          ? "border-overdue/45 bg-overdue/10 text-overdue"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {renderStepCard(activeStep, activeIndex, true)}

          {/* Focus Navigation Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
              className="h-9 gap-1.5 px-3 text-xs md:h-8"
            >
              <ChevronLeft className="size-3.5" />
              Previous
            </Button>

            <span className="mono-tabular hidden text-[11px] text-muted-foreground sm:inline">
              Shortcuts: <kbd className="rounded border border-border px-1">J</kbd>{" "}
              next · <kbd className="rounded border border-border px-1">K</kbd>{" "}
              prev · <kbd className="rounded border border-border px-1">Space</kbd>{" "}
              toggle done
            </span>

            {activeIndex < pinnedVersion.steps.length - 1 ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  setActiveIndex((prev) =>
                    Math.min(pinnedVersion.steps.length - 1, prev + 1)
                  )
                }
                className="h-9 gap-1.5 px-3 text-xs md:h-8"
              >
                Next Step
                <ChevronRight className="size-3.5" />
              </Button>
            ) : !isReadOnly ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCompleteDialogOpen(true)}
                className="h-9 gap-1.5 px-3 text-xs md:h-8"
              >
                <CheckCircle2 className="size-3.5" />
                Finish Run
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Circle className="size-3" />
                End of run
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {pinnedVersion.steps.map((step, idx) =>
            renderStepCard(step, idx, false)
          )}
        </div>
      )}

      {/* Complete Run Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Complete Operation Run</DialogTitle>
            <DialogDescription className="text-xs">
              {progressStats.done} of {progressStats.total} steps completed
              {progressStats.skipped > 0
                ? `, ${progressStats.skipped} skipped`
                : ""}
              {progressStats.blocked > 0
                ? `, ${progressStats.blocked} blocked`
                : ""}
              .
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {operation.ownerId === userId ? (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-xs">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-done" />
                  <span>Mark blueprint as verified today</span>
                </span>
                <Switch
                  checked={markVerifiedOnComplete}
                  onCheckedChange={setMarkVerifiedOnComplete}
                />
              </label>
            ) : null}

            {operation.linkedHabitId && operation.linkedHabitTitle ? (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-done/35 bg-done/5 p-3 text-xs">
                <span className="flex items-center gap-2">
                  <Repeat2 className="size-4 text-done" />
                  <span>
                    Auto-log habit:{" "}
                    <strong className="font-medium text-foreground">
                      {operation.linkedHabitTitle}
                    </strong>{" "}
                    for today
                  </span>
                </span>
                <Switch
                  checked={autoLogHabitOnComplete}
                  onCheckedChange={setAutoLogHabitOnComplete}
                />
              </label>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCompleteDialogOpen(false)}
              className="h-9 text-xs md:h-8"
            >
              Keep running
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={handleCompleteRun}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Complete Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Blocked Step Follow-up Task Dialog */}
      <Dialog
        open={blockedDialogStepKey !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedDialogStepKey(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Follow-up Task</DialogTitle>
            <DialogDescription className="text-xs">
              Creates a task linked directly back to this Operation Run so you
              can unblock and resume without losing context.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="blocked-task-title" className="text-xs">
                Task title
              </Label>
              <Input
                id="blocked-task-title"
                value={blockedTaskTitle}
                onChange={(e) => setBlockedTaskTitle(e.target.value)}
                className="h-9 text-xs md:h-8"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="blocked-task-desc" className="text-xs">
                Context / blocker notes
              </Label>
              <Textarea
                id="blocked-task-desc"
                rows={3}
                value={blockedTaskDesc}
                onChange={(e) => setBlockedTaskDesc(e.target.value)}
                placeholder="What blocked this step?"
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="blocked-task-date" className="text-xs">
                  Due / Remind date
                </Label>
                <Input
                  id="blocked-task-date"
                  type="date"
                  value={blockedTaskDate}
                  onChange={(e) => setBlockedTaskDate(e.target.value)}
                  className="mono-tabular h-9 text-xs md:h-8"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="blocked-task-time" className="text-xs">
                  Time
                </Label>
                <Input
                  id="blocked-task-time"
                  type="time"
                  disabled={!blockedTaskDate}
                  value={blockedTaskTime}
                  onChange={(e) => setBlockedTaskTime(e.target.value)}
                  className="mono-tabular h-9 text-xs md:h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="blocked-task-priority" className="text-xs">
                Priority
              </Label>
              <Select
                value={blockedTaskPriority}
                onValueChange={(v) => setBlockedTaskPriority(v as TaskPriority)}
              >
                <SelectTrigger
                  id="blocked-task-priority"
                  className="h-9 text-xs md:h-8"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low" className="text-xs">Low</SelectItem>
                  <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                  <SelectItem value="high" className="text-xs">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBlockedDialogStepKey(null)}
              className="h-9 text-xs md:h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || !blockedTaskTitle.trim()}
              onClick={handleCreateBlockedTask}
              className="h-9 gap-1.5 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlusSquare className="size-3.5" />
              )}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
