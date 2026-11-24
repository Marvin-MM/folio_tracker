"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { acceptHabitInviteTokenAction } from "@/actions/habits-social";
import { Button } from "@/components/ui/button";
import {
  hardNavigateAfterSignOut,
  performSecureSignOut,
} from "@/lib/client-sign-out";
import type { HabitInviteTokenPreview } from "@/server/services/habit-monitor-service";

interface HabitInviteAcceptCardProps {
  token: string;
  preview: HabitInviteTokenPreview;
  emailPasswordEnabled: boolean;
  currentUser: {
    email: string;
    name: string;
    emailVerified: boolean;
  } | null;
}

export function HabitInviteAcceptCard({
  token,
  preview,
  emailPasswordEnabled,
  currentUser,
}: HabitInviteAcceptCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  const callbackUrl = `/invite/habit/${encodeURIComponent(token)}`;

  if (preview.status !== "valid") {
    const titleByStatus: Record<typeof preview.status, string> = {
      expired: "Invitation expired",
      revoked: "Invitation cancelled",
      accepted: "Invitation already accepted",
      declined: "Invitation declined",
      not_found: "Invitation not found",
    };

    const bodyByStatus: Record<typeof preview.status, string> = {
      expired:
        "This accountability invitation link has passed its 7-day window. Ask your friend to send a fresh invite.",
      revoked: "The habit owner cancelled this invitation before it was used.",
      accepted: "This single-use accountability invitation has already been claimed.",
      declined: "This invitation was declined.",
      not_found: "This invitation link is invalid or no longer exists.",
    };

    return (
      <div className="space-y-4 rounded-md border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-overdue">
          <AlertTriangle className="size-4 shrink-0" />
          <h1 className="text-sm font-semibold text-foreground">
            {titleByStatus[preview.status]}
          </h1>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {bodyByStatus[preview.status]}
        </p>
        <div className="pt-1">
          <Button asChild size="sm" variant="outline" className="mira-row text-xs">
            <Link href={currentUser ? "/app/habits/circle" : "/login"}>
              {currentUser ? "Go to Accountability Circle" : "Sign in to Folio"}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const emailMatches =
    currentUser !== null &&
    currentUser.email.trim().toLowerCase() === preview.invitedEmailNormalized;

  const handleAccept = () => {
    startTransition(async () => {
      const result = await acceptHabitInviteTokenAction({ token });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`Joined ${preview.ownerName}'s Accountability Circle.`);
      router.push(`/app/habits/circle/${result.data.ownerId}`);
      router.refresh();
    });
  };

  const handleSwitchAccount = async () => {
    setSigningOut(true);
    try {
      await performSecureSignOut();
      hardNavigateAfterSignOut(
        `/login?callbackURL=${encodeURIComponent(callbackUrl)}`
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-6">
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-collab">
          <Users className="size-3.5" />
          Accountability Circle Invitation
        </span>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          Monitor {preview.ownerName}&apos;s habits
        </h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {preview.ownerName} invited{" "}
          <span className="mono-tabular font-medium text-foreground">
            {preview.invitedEmailMasked}
          </span>{" "}
          to view{" "}
          {preview.scope === "all"
            ? "all of their active habits"
            : "selected habits"}{" "}
          in read-only mode and share review feedback.
        </p>
      </div>

      {!currentUser ? (
        <div className="space-y-2.5 pt-1">
          {emailPasswordEnabled ? (
            <>
              <Button asChild className="mira-row w-full text-xs">
                <Link
                  href={`/register?callbackURL=${encodeURIComponent(callbackUrl)}`}
                >
                  Create account to accept
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="mira-row w-full text-xs"
              >
                <Link
                  href={`/login?callbackURL=${encodeURIComponent(callbackUrl)}`}
                >
                  Sign in with existing account
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild className="mira-row w-full text-xs">
              <Link
                href={`/login?callbackURL=${encodeURIComponent(callbackUrl)}`}
              >
                Continue with Google to accept
              </Link>
            </Button>
          )}
        </div>
      ) : !currentUser.emailVerified ? (
        <div className="space-y-3 rounded-md border border-reminder/40 bg-reminder/10 p-3 text-xs">
          <p className="text-foreground">
            {emailPasswordEnabled
              ? `Please verify your email address (${currentUser.email}) before accepting this accountability invitation.`
              : `Please sign in with a verified Google account to accept this accountability invitation.`}
          </p>
          {emailPasswordEnabled ? (
            <Button asChild variant="outline" size="sm" className="mira-row text-xs">
              <Link href="/verify-email">Check verification status</Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={handleSwitchAccount}
              className="mira-row gap-1.5 text-xs"
            >
              <LogOut className="size-3.5" />
              {signingOut ? "Signing out…" : "Switch account"}
            </Button>
          )}
        </div>
      ) : !emailMatches ? (
        <div className="space-y-3 rounded-md border border-overdue/35 bg-overdue/10 p-3 text-xs">
          <p className="leading-relaxed text-foreground">
            This invitation was sent to{" "}
            <span className="mono-tabular font-medium">
              {preview.invitedEmailMasked}
            </span>
            , but you are currently signed in as{" "}
            <span className="mono-tabular font-medium">
              {currentUser.email}
            </span>
            .
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={signingOut}
            onClick={handleSwitchAccount}
            className="mira-row gap-1.5 text-xs"
          >
            <LogOut className="size-3.5" />
            {signingOut ? "Signing out…" : "Switch account to accept"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5 pt-1">
          <Button
            type="button"
            disabled={isPending}
            onClick={handleAccept}
            className="mira-row w-full gap-1.5 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Accepting…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Accept &amp; View Ledger
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
