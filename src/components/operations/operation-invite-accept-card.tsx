"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Loader2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { acceptTokenOperationInviteAction } from "@/actions/operations";
import { Button } from "@/components/ui/button";
import {
  hardNavigateAfterSignOut,
  performSecureSignOut,
} from "@/lib/client-sign-out";
import { getBrowserQueryClient } from "@/lib/query/query-client";
import { workspaceQueryKeys } from "@/lib/query/query-keys";
import type { OperationInvitePreview } from "@/server/services/operation-share-service";

interface OperationInviteAcceptCardProps {
  token: string;
  preview: OperationInvitePreview;
  emailPasswordEnabled: boolean;
  currentUser: {
    email: string;
    name: string;
    emailVerified: boolean;
  } | null;
}

export function OperationInviteAcceptCard({
  token,
  preview,
  emailPasswordEnabled,
  currentUser,
}: OperationInviteAcceptCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  const callbackUrl = `/invite/operation/${encodeURIComponent(token)}`;

  if (preview.status !== "valid") {
    const titleByStatus: Record<Exclude<OperationInvitePreview["status"], "valid">, string> = {
      expired: "Invitation expired",
      already_used: "Invitation already used",
      not_found: "Invitation not found",
    };

    const bodyByStatus: Record<Exclude<OperationInvitePreview["status"], "valid">, string> = {
      expired:
        "This operation invitation link passed its 7-day window. Ask the blueprint owner to send a fresh invite.",
      already_used:
        "This single-use invitation has already been accepted, declined, or revoked.",
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
            <Link href={currentUser ? "/app/operations" : "/login"}>
              {currentUser ? "Go to Operations" : "Sign in to Folio"}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleAccept = () => {
    startTransition(async () => {
      const result = await acceptTokenOperationInviteAction({ token });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await getBrowserQueryClient().invalidateQueries({
        queryKey: workspaceQueryKeys.all,
      });
      toast.success(`Access granted to "${preview.operationTitle}".`);
      router.push(`/app/operations/${result.data.operationId}`);
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
      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-collab">
          <BookOpenCheck className="size-3.5" />
          Operation Invitation · {preview.role}
        </span>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {preview.operationTitle}
        </h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">
            {preview.inviterName}
          </strong>{" "}
          invited{" "}
          <span className="mono-tabular font-medium text-foreground">
            {preview.targetEmailHint}
          </span>{" "}
          as a{" "}
          <span className="font-medium capitalize text-foreground">
            {preview.role}
          </span>
          .{" "}
          {preview.role === "collaborator"
            ? "You will be able to run steps, publish new versions, and resolve step flags."
            : "You will be able to view steps, start your own saved runs, and flag outdated steps."}
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
            Please verify your email address ({currentUser.email}) before
            accepting this invitation.
          </p>
          <Button asChild variant="outline" size="sm" className="mira-row text-xs">
            <Link href="/verify-email">Check verification status</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Signed in as{" "}
            <span className="mono-tabular font-medium text-foreground">
              {currentUser.email}
            </span>
          </p>
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
                Accept &amp; Open Operation
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={signingOut}
            onClick={handleSwitchAccount}
            className="mira-row w-full gap-1.5 text-xs text-muted-foreground"
          >
            <LogOut className="size-3.5" />
            {signingOut ? "Signing out…" : "Switch account"}
          </Button>
        </div>
      )}
    </div>
  );
}
