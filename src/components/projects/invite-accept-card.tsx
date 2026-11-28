"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { AlertTriangle, CheckCircle2, Loader2, LogOut, Users } from "lucide-react";
import { toast } from "sonner";
import { acceptProjectInvitationAction } from "@/actions/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  hardNavigateAfterSignOut,
  performSecureSignOut,
} from "@/lib/client-sign-out";
import { getBrowserQueryClient } from "@/lib/query/query-client";
import { workspaceQueryKeys } from "@/lib/query/query-keys";
import type { InvitationPreviewResult } from "@/server/services/project-invite-service";

interface InviteAcceptCardProps {
  token: string;
  preview: InvitationPreviewResult;
  emailPasswordEnabled: boolean;
  currentUser: {
    email: string;
    name: string;
    emailVerified: boolean;
  } | null;
}

export function InviteAcceptCard({
  token,
  preview,
  emailPasswordEnabled,
  currentUser,
}: InviteAcceptCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const callbackPath = `/invite/${encodeURIComponent(token)}`;

  if (preview.status !== "valid") {
    const titleByStatus: Record<typeof preview.status, string> = {
      expired: "Invitation expired",
      revoked: "Invitation revoked",
      accepted: "Invitation already accepted",
      declined: "Invitation declined",
      not_found: "Invitation not found",
    };

    const bodyByStatus: Record<typeof preview.status, string> = {
      expired:
        "This 7-day invitation link has expired. Ask the project owner to send a fresh invite.",
      revoked: "The project owner revoked this invitation.",
      accepted:
        "This single-use invitation has already been claimed.",
      declined: "This invitation was declined.",
      not_found:
        "We could not find an active invitation matching this link.",
    };

    return (
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-overdue">
            <AlertTriangle className="size-4" />
            <CardTitle className="text-base font-semibold text-foreground">
              {titleByStatus[preview.status]}
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            {bodyByStatus[preview.status]}
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t border-border pt-4">
          <Button asChild variant="outline" className="mira-row w-full text-xs">
            <Link href={currentUser ? "/app/inbox" : "/login"}>
              {currentUser ? "Go to Inbox" : "Go to Sign in"}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const emailMatches = currentUser !== null && preview.viewerEmailMatches;

  const handleAccept = () => {
    startTransition(async () => {
      const result = await acceptProjectInvitationAction({ token });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await getBrowserQueryClient().invalidateQueries({
        queryKey: workspaceQueryKeys.all,
      });
      toast.success(`Joined "${preview.projectName}"!`);
      router.push(`/app/projects/${result.data.projectId}`);
      router.refresh();
    });
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      await performSecureSignOut();
      hardNavigateAfterSignOut(
        `/login?callbackURL=${encodeURIComponent(callbackPath)}`
      );
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className="gap-1 border-collab/40 bg-collab/10 text-[11px] font-normal text-collab"
          >
            <Users className="size-3" />
            Shared project invite
          </Badge>
          <span className="mono-tabular text-[10px] text-muted-foreground">
            Expires {formatInTimeZone(preview.expiresAt, "UTC", "MMM d, yyyy")}
          </span>
        </div>

        <CardTitle className="text-base font-semibold tracking-tight text-foreground">
          You&rsquo;ve been invited to join &ldquo;{preview.projectName}&rdquo;
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {preview.inviterName} invited{" "}
          <span className="mono-tabular text-foreground">
            {preview.invitedEmailMasked}
          </span>{" "}
          as{" "}
          <span className="font-medium capitalize text-foreground">
            {preview.role}
          </span>
          .
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="rounded-md border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
          {preview.role === "editor"
            ? "As an Editor, you can create, edit, assign, and complete shared project tasks and notes, plus set private personal reminders."
            : "As a Viewer, you have read-only access to project tasks, notes, and activity, and you can attach private personal reminders for yourself."}
        </div>

        {!currentUser ? (
          <div className="space-y-2">
            <Button asChild className="mira-row w-full text-xs">
              <Link
                href={`/login?callbackURL=${encodeURIComponent(callbackPath)}`}
              >
                {emailPasswordEnabled
                  ? "Sign in to accept"
                  : "Continue with Google to accept"}
              </Link>
            </Button>
            {emailPasswordEnabled ? (
              <Button
                asChild
                variant="outline"
                className="mira-row w-full border-border text-xs"
              >
                <Link
                  href={`/register?callbackURL=${encodeURIComponent(callbackPath)}`}
                >
                  Create account
                </Link>
              </Button>
            ) : null}
          </div>
        ) : !emailMatches ? (
          <div className="space-y-3">
            <div
              role="alert"
              className="rounded-md border border-reminder/40 bg-reminder/10 p-3 text-xs text-foreground"
            >
              <p className="font-medium">
                Signed in as {currentUser.email}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                This invitation was issued for{" "}
                <span className="mono-tabular font-medium text-foreground">
                  {preview.invitedEmailMasked}
                </span>
                . Switch accounts to accept it.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={switchingAccount}
              onClick={handleSwitchAccount}
              className="mira-row w-full gap-1.5 border-border text-xs"
            >
              {switchingAccount ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
              Switch account to accept
            </Button>
          </div>
        ) : !currentUser.emailVerified ? (
          <div className="space-y-2">
            <p className="rounded-md border border-reminder/40 bg-reminder/10 p-3 text-xs text-foreground">
              {emailPasswordEnabled
                ? "Verify your email address before accepting this invitation."
                : "Sign in with a verified Google account to accept this invitation."}
            </p>
            {emailPasswordEnabled ? (
              <Button asChild variant="outline" className="mira-row w-full text-xs">
                <Link
                  href={`/verify-email?email=${encodeURIComponent(
                    currentUser.email
                  )}&callbackURL=${encodeURIComponent(callbackPath)}`}
                >
                  Verify email
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={switchingAccount}
                onClick={handleSwitchAccount}
                className="mira-row w-full gap-1.5 border-border text-xs"
              >
                {switchingAccount ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogOut className="size-3.5" />
                )}
                Switch account
              </Button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            disabled={isPending}
            onClick={handleAccept}
            className="mira-row w-full gap-1.5 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Joining project…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Accept invitation as {preview.role}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
