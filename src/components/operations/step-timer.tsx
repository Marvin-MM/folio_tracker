"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function formatTimerSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function playSubtleChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [587.33, 880]; // D5 -> A5 gentle paper-and-ink chime

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.07, now + idx * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.48);
    });

    setTimeout(() => {
      void ctx.close().catch(() => null);
    }, 1000);
  } catch {
    // Ignore restricted autoplay / headless audio contexts
  }
}

interface StepTimerProps {
  initialSeconds: number;
  stepTitle?: string;
  compact?: boolean;
  onComplete?: () => void;
}

export function StepTimer({
  initialSeconds,
  stepTitle,
  compact = false,
  onComplete,
}: StepTimerProps) {
  const safeInitial = Math.max(1, Math.floor(initialSeconds));
  const [remainingMs, setRemainingMs] = useState(safeInitial * 1000);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const endAtMsRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (endAtMsRef.current === null) return;
      const next = Math.max(0, endAtMsRef.current - Date.now());
      setRemainingMs(next);
      if (next === 0) {
        endAtMsRef.current = null;
        setRunning(false);
        setFinished(true);
        playSubtleChime();
        toast.success(
          stepTitle ? `Timer complete · ${stepTitle}` : "Step timer complete"
        );
        onCompleteRef.current?.();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, stepTitle]);

  const handleToggle = useCallback(() => {
    if (running) {
      if (endAtMsRef.current !== null) {
        setRemainingMs(Math.max(0, endAtMsRef.current - Date.now()));
      }
      endAtMsRef.current = null;
      setRunning(false);
      return;
    }

    const startFromMs = remainingMs <= 0 ? safeInitial * 1000 : remainingMs;
    setFinished(false);
    setRemainingMs(startFromMs);
    endAtMsRef.current = Date.now() + startFromMs;
    setRunning(true);
  }, [running, remainingMs, safeInitial]);

  const handleReset = useCallback(() => {
    endAtMsRef.current = null;
    setRunning(false);
    setFinished(false);
    setRemainingMs(safeInitial * 1000);
  }, [safeInitial]);

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progressPct = Math.min(
    100,
    Math.max(0, ((safeInitial * 1000 - remainingMs) / (safeInitial * 1000)) * 100)
  );

  return (
    <div
      data-testid="step-timer"
      className={cn(
        "rounded-md border transition-colors",
        finished
          ? "border-done/45 bg-done/10"
          : running
            ? "border-reminder/45 bg-reminder/5"
            : "border-border bg-muted/60",
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {finished ? (
            <CheckCircle2 className="size-4 shrink-0 text-done" />
          ) : (
            <Timer
              className={cn(
                "size-4 shrink-0",
                running ? "text-reminder" : "text-muted-foreground"
              )}
            />
          )}
          <span
            data-testid="step-timer-display"
            className={cn(
              "mono-tabular font-semibold tracking-tight",
              compact ? "text-sm" : "text-base",
              finished ? "text-done" : "text-foreground"
            )}
          >
            {formatTimerSeconds(remainingSeconds)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {finished
              ? "Done"
              : running
                ? "Running"
                : `of ${formatTimerSeconds(safeInitial)}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={running ? "outline" : "default"}
            onClick={handleToggle}
            className="h-9 gap-1.5 px-3 text-xs md:h-7 md:px-2.5"
          >
            {running ? (
              <>
                <Pause className="size-3" />
                Pause
              </>
            ) : (
              <>
                <Play className="size-3" />
                {finished ? "Restart" : remainingMs < safeInitial * 1000 ? "Resume" : "Start"}
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleReset}
            disabled={!running && remainingMs === safeInitial * 1000 && !finished}
            aria-label="Reset timer"
            className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground md:h-7"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full transition-all duration-200",
            finished ? "bg-done" : "bg-reminder"
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
