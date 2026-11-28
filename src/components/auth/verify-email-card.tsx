"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { sanitizeCallbackUrl } from "@/lib/redirect";

interface VerifyEmailCardProps {
  initialEmail: string | null;
  callbackURL: string;
  verified: boolean;
  errorCode: string | null;
}

export function VerifyEmailCard({
  initialEmail,
  callbackURL,
  verified,
  errorCode,
}: VerifyEmailCardProps) {
  const safeCallback = sanitizeCallbackUrl(callbackURL);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [isResending, setIsResending] = useState(false);
  const [resentMessage, setResentMessage] = useState<string | null>(null);

  const handleResend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setIsResending(true);
    setResentMessage(null);
    try {
      await authClient.sendVerificationEmail({
        email: trimmed,
        callbackURL: `/verify-email?verified=1&callbackURL=${encodeURIComponent(
          safeCallback
        )}`,
      });
    } catch {
      // Non-enumerating: always show generic confirmation
    } finally {
      setIsResending(false);
      setResentMessage(
        "If an unverified account exists for that email, a fresh verification link has been sent."
      );
    }
  };

  if (verified) {
    return (
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-done">
            <CheckCircle2 className="size-4" />
            <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
              Email verified
            </h1>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Your email address is confirmed and ready to use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="mira-row w-full">
            <Link href={safeCallback}>Continue to workspace</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Mail className="size-4" />
          <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
            Verify your email
          </h1>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          Check your inbox and follow the verification link before signing in.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {errorCode ? (
          <div
            role="alert"
            className="rounded-md border border-overdue/30 bg-overdue/10 px-3 py-2 text-xs text-overdue"
          >
            That verification link is invalid or expired. Send a new one below.
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="verify-email-input" className="text-xs">
            Email address
          </Label>
          <Input
            id="verify-email-input"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mira-row bg-background"
          />
        </div>

        {resentMessage ? (
          <p
            role="status"
            className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            {resentMessage}
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          disabled={isResending || !email.trim()}
          onClick={handleResend}
          className="mira-row w-full border-border"
        >
          {isResending ? (
            <>
              <Loader2 className="mr-2 size-3.5 animate-spin" />
              Sending…
            </>
          ) : (
            "Resend verification email"
          )}
        </Button>
      </CardContent>

      <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted-foreground">
        <Link
          href={`/login?callbackURL=${encodeURIComponent(safeCallback)}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
