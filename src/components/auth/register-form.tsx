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

interface RegisterFormProps {
  callbackURL: string;
  googleEnabled: boolean;
}

export function RegisterForm({
  callbackURL,
  googleEnabled,
}: RegisterFormProps) {
  const router = useRouter();
  const safeCallback = sanitizeCallbackUrl(callbackURL);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    setIsSubmitting(true);

    try {
      const detectedTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const normalizedEmail = email.trim().toLowerCase();

      const verifyCallback = `/verify-email?verified=1&callbackURL=${encodeURIComponent(
        safeCallback
      )}`;

      const { error } = await authClient.signUp.email({
        name: name.trim(),
        email: normalizedEmail,
        password,
        timezone: detectedTimezone,
        callbackURL: verifyCallback,
      });

      if (error) {
        // Non-enumerating failure messaging for existing emails vs invalid inputs
        if (error.status === 422 || error.code === "USER_ALREADY_EXISTS") {
          router.push(
            `/verify-email?email=${encodeURIComponent(
              normalizedEmail
            )}&callbackURL=${encodeURIComponent(safeCallback)}`
          );
          return;
        }
        setErrorMessage(
          "Unable to create account. Check your details and try again."
        );
        return;
      }

      router.push(
        `/verify-email?email=${encodeURIComponent(
          normalizedEmail
        )}&callbackURL=${encodeURIComponent(safeCallback)}`
      );
    } catch {
      setErrorMessage("Unable to create account right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const loginHref =
    safeCallback !== "/app/inbox"
      ? `/login?callbackURL=${encodeURIComponent(safeCallback)}`
      : "/login";

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="space-y-1">
        <h1 className="text-base font-semibold leading-none tracking-tight text-foreground">
          Create account
        </h1>
        <CardDescription className="text-xs text-muted-foreground">
          Start organizing tasks, notes, and timed reminders.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <GoogleAuthButton
          callbackURL={safeCallback}
          googleEnabled={googleEnabled}
          label="Sign up with Google"
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
            <Label htmlFor="register-name" className="text-xs">
              Name
            </Label>
            <Input
              id="register-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="Ada Lovelace"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mira-row bg-background"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-email" className="text-xs">
              Email
            </Label>
            <Input
              id="register-email"
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
            <Label htmlFor="register-password" className="text-xs">
              Password
            </Label>
            <Input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
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
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center border-t border-border pt-4 text-xs text-muted-foreground">
        <span>
          Already have an account?{" "}
          <Link
            href={loginHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
