"use client";

import { useState, useTransition, type FormEvent } from "react";
import { KeyRound, Loader2, LockOpen, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { unlockHabitMonthAction } from "@/actions/habits";
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
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";

interface MonthLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearMonth: string;
  monthLabel: string;
  hasPin: boolean;
  isAutoLocked: boolean;
}

export function MonthLockDialog({
  open,
  onOpenChange,
  yearMonth,
  monthLabel,
  hasPin,
  isAutoLocked,
}: MonthLockDialogProps) {
  const invalidate = useInvalidateWorkspace();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPin("");
      setReason("");
      setErrorMessage(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (hasPin && !/^\d{4,6}$/.test(pin.trim())) {
      setErrorMessage("Enter your 4–6 digit Accountability PIN.");
      return;
    }

    startTransition(async () => {
      const result = await unlockHabitMonthAction({
        yearMonth,
        ...(hasPin ? { pin: pin.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      await invalidate(["habits", "circle"]);
      toast.success(
        `${monthLabel} unlocked for 30 minutes. It will re-lock automatically when the window expires.`
      );
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <LockOpen className="size-4 text-reminder" aria-hidden="true" />
            Unlock {monthLabel}?
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {isAutoLocked
              ? `${monthLabel} auto-locked after your grace window to protect historical consistency.`
              : `${monthLabel} is locked and read-only.`}{" "}
            Unlocking opens a temporary <strong className="font-medium text-foreground">30-minute</strong> edit window and records an integrity note.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {hasPin ? (
            <div className="space-y-1.5">
              <Label
                htmlFor="month-unlock-pin"
                className="flex items-center gap-1.5 text-xs"
              >
                <KeyRound className="size-3 text-muted-foreground" aria-hidden="true" />
                Accountability PIN
              </Label>
              <Input
                id="month-unlock-pin"
                name="monthUnlockPin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="Enter 4–6 digit PIN"
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setPin(digits);
                  if (errorMessage) setErrorMessage(null);
                }}
                autoFocus
                className="mono-tabular mira-row bg-background text-xs tracking-widest"
              />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              No Accountability PIN is configured yet. You can add an optional
              4–6 digit PIN in <span className="font-medium text-foreground">Habit Settings</span> for extra edit friction.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="month-unlock-reason" className="text-xs">
              Reason for editing (optional)
            </Label>
            <Input
              id="month-unlock-reason"
              name="monthUnlockReason"
              maxLength={200}
              placeholder="e.g., Correcting missed check-in from travel"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mira-row bg-background text-xs"
            />
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-overdue/35 bg-overdue/10 px-3 py-2 text-xs text-overdue"
            >
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || (hasPin && pin.trim().length < 4)}
              className="mira-row gap-1.5 px-3.5 text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Unlocking…
                </>
              ) : (
                <>
                  <LockOpen className="size-3.5" aria-hidden="true" />
                  Unlock for 30 min
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
