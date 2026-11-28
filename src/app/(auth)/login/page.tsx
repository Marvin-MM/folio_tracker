import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeCallbackUrl } from "@/lib/redirect";
import {
  isEmailPasswordAuthEnabled,
  isGoogleOAuthConfigured,
} from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Folio to manage your tasks, quiet markdown notes, durable reminders, and real-calendar habits.",
  alternates: {
    canonical: "/login",
  },
};

interface LoginPageProps {
  searchParams: Promise<{
    callbackURL?: string;
    reset?: string;
    verified?: string;
    error?: string;
  }>;
}

function AuthCardSkeleton() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-4 w-52" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

async function LoginPageContent({ searchParams }: LoginPageProps) {
  const [params, existingSession] = await Promise.all([
    searchParams,
    getOptionalSession(),
  ]);
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);
  if (existingSession && !existingSession.user.isSuspended) {
    redirect(callbackURL);
  }

  const emailPasswordEnabled = isEmailPasswordAuthEnabled();

  return (
    <LoginForm
      callbackURL={callbackURL}
      googleEnabled={isGoogleOAuthConfigured()}
      emailPasswordEnabled={emailPasswordEnabled}
      resetSuccess={emailPasswordEnabled && params.reset === "success"}
      verifiedSuccess={emailPasswordEnabled && params.verified === "1"}
      suspendedError={
        params.error === "suspended" || Boolean(existingSession?.user.isSuspended)
      }
    />
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <LoginPageContent searchParams={searchParams} />
    </Suspense>
  );
}
