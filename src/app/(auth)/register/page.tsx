import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/constants";
import { sanitizeCallbackUrl } from "@/lib/redirect";
import {
  isEmailPasswordAuthEnabled,
  isGoogleOAuthConfigured,
} from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";

export const metadata: Metadata = {
  title: "Create account",
};

interface RegisterPageProps {
  searchParams: Promise<{
    callbackURL?: string;
  }>;
}

function RegisterCardSkeleton() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

async function RegisterPageContent({ searchParams }: RegisterPageProps) {
  const [params, existingSession] = await Promise.all([
    searchParams,
    getOptionalSession(),
  ]);
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);

  if (!isEmailPasswordAuthEnabled()) {
    const target =
      callbackURL !== DEFAULT_AUTHENTICATED_PATH
        ? `/login?callbackURL=${encodeURIComponent(callbackURL)}`
        : "/login";
    redirect(target);
  }

  if (existingSession && !existingSession.user.isSuspended) {
    redirect(callbackURL);
  }

  return (
    <RegisterForm
      callbackURL={callbackURL}
      googleEnabled={isGoogleOAuthConfigured()}
    />
  );
}

export default function RegisterPage({ searchParams }: RegisterPageProps) {
  return (
    <Suspense fallback={<RegisterCardSkeleton />}>
      <RegisterPageContent searchParams={searchParams} />
    </Suspense>
  );
}
