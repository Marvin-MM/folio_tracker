"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

interface ResetPasswordFormProps {
  token: string | null;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!token) {
      setErrorMessage(
        "This password reset link is missing or expired. Request a new one."
      );
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.resetPassword({
        token,
        newPassword,
      });

      if (error) {
        setErrorMessage(
          "This reset link is invalid or has expired. Please request a fresh link."
        );
        return;
      }

      router.push("/login?reset=success");
    } catch {
      setErrorMessage("Unable to reset password right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base font-semibold tracking-tight">
          Choose a new password
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Updating your password automatically signs out all active sessions.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!token ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-overdue/30 bg-overdue/10 p-3 text-xs text-overdue"
          >
            <p className="font-medium">Invalid or expired reset link</p>
            <p>Request a new password reset email to continue.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs">
                New password
              </Label>
              <Input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mira-row bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs">
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
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
                  Updating password…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        )}
      </CardContent>

      <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted-foreground">
        <Link
          href="/forgot-password"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Request a new reset link
        </Link>
      </CardFooter>
    </Card>
  );
}
