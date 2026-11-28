"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
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

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Intentionally swallow to prevent account enumeration
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  };

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-1">
        <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
          Reset password
        </h1>
        <CardDescription className="text-xs text-muted-foreground">
          Enter your email address and we will send a password reset link.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {submitted ? (
          <div
            role="status"
            className="space-y-2 rounded-md border border-border bg-background p-3 text-xs text-foreground"
          >
            <p className="font-medium">Check your inbox</p>
            <p className="text-muted-foreground">
              If an account matches that email address, password reset
              instructions have been dispatched.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email" className="text-xs">
                Email
              </Label>
              <Input
                id="forgot-email"
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

            <Button
              type="submit"
              disabled={isSubmitting || !email.trim()}
              className="mira-row w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Sending link…
                </>
              ) : (
                "Send reset link"
              )}
            </Button>
          </form>
        )}
      </CardContent>

      <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Return to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
