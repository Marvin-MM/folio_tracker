"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { sanitizeCallbackUrl } from "@/lib/redirect";

interface GoogleAuthButtonProps {
  callbackURL: string;
  googleEnabled: boolean;
  label?: string;
}

export function GoogleAuthButton({
  callbackURL,
  googleEnabled,
  label = "Continue with Google",
}: GoogleAuthButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    if (!googleEnabled) {
      setErrorMessage(
        "Google OAuth is not configured in this environment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
      );
      return;
    }

    setIsLoading(true);
    try {
      const safeCallback = sanitizeCallbackUrl(callbackURL);
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: safeCallback,
      });
      if (error) {
        setErrorMessage("Unable to sign in with Google. Please try again.");
      }
    } catch {
      setErrorMessage("Unable to sign in with Google. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="mira-row w-full justify-center gap-2 border-border bg-card text-foreground hover:bg-accent"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-3.5 shrink-0"
          >
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.24-.94 2.29-2 2.99v2.48h3.23c1.89-1.74 2.98-4.3 2.98-7.34 0-.35-.03-.7-.1-1.05Z"
            />
            <path
              fill="currentColor"
              d="M12.17 22c2.7 0 4.96-.9 6.61-2.43l-3.23-2.48c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.24v2.56A9.99 9.99 0 0 0 12.17 22Z"
            />
            <path
              fill="currentColor"
              d="M6.58 13.93A5.97 5.97 0 0 1 6.26 12c0-.67.12-1.32.32-1.93V7.51H3.24A10.02 10.02 0 0 0 2.17 12c0 1.61.39 3.14 1.07 4.49l3.34-2.56Z"
            />
            <path
              fill="currentColor"
              d="M12.17 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.87C17.12 2.96 14.87 2 12.17 2a9.99 9.99 0 0 0-8.93 5.51l3.34 2.56c.79-2.36 2.99-4.12 5.59-4.12Z"
            />
          </svg>
        )}
        <span>{label}</span>
      </Button>
      {errorMessage ? (
        <p role="alert" className="text-xs text-overdue">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
