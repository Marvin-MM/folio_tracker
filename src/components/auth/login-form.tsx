"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
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
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { sanitizeCallbackUrl } from "@/lib/redirect";

interface LoginFormProps {
  callbackURL: string;
  googleEnabled: boolean;
  emailPasswordEnabled: boolean;
  resetSuccess?: boolean;
  verifiedSuccess?: boolean;
}

export function LoginForm({
  callbackURL,
  googleEnabled,
  emailPasswordEnabled,
  resetSuccess = false,
  verifiedSuccess = false,
}: LoginFormProps) {
  const router = useRouter();
  const safeCallback = sanitizeCallbackUrl(callbackURL);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailPasswordEnabled) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
        callbackURL: safeCallback,
      });

      if (error) {
        // Generic, non-enumerating error copy regardless of whether email exists or is unverified
        setErrorMessage(
          "Invalid email or password, or your email address has not been verified yet."
        );
        return;
      }

      router.push(safeCallback);
      router.refresh();
    } catch {
      setErrorMessage(
        "Unable to sign in right now. Please try again in a moment."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!emailPasswordEnabled) {
    return (
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="space-y-1">
          <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
            Sign in
          </h1>
          <CardDescription className="text-xs text-muted-foreground">
            Continue with your Google account to access your workspace.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <GoogleAuthButton
            callbackURL={safeCallback}
            googleEnabled={googleEnabled}
            hideConfigHint
          />
          <p className="text-balance text-center text-[11px] text-muted-foreground">
            New to Folio? Your workspace is created automatically on first sign-in.
          </p>
        </CardContent>
      </Card>
    );
  }

  const registerHref =
    safeCallback !== "/app/inbox"
      ? `/register?callbackURL=${encodeURIComponent(safeCallback)}`
      : "/register";

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-1">
        <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
          Sign in
        </h1>
        <CardDescription className="text-xs text-muted-foreground">
          Enter your credentials to access your workspace.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {resetSuccess ? (
          <div
            role="status"
            className="rounded-md border border-done/30 bg-done/10 px-3 py-2 text-xs text-done"
          >
            Password updated. All previous sessions were signed out.
          </div>
        ) : null}

        {verifiedSuccess ? (
          <div
            role="status"
            className="rounded-md border border-done/30 bg-done/10 px-3 py-2 text-xs text-done"
          >
            Email verified. You can sign in now.
          </div>
        ) : null}

        <GoogleAuthButton
          callbackURL={safeCallback}
          googleEnabled={googleEnabled}
        />

        <div className="relative flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            or email
          </span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="login-email" className="text-xs">
              Email
            </Label>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mira-row bg-background"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-xs">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mira-row bg-background"
            />
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-md border border-overdue/30 bg-overdue/10 px-3 py-2 text-xs text-overdue"
            >
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="mira-row w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted-foreground">
        <span>
          New here?{" "}
          <Link
            href={registerHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
