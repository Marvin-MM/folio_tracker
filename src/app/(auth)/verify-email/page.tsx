import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/constants";
import { sanitizeCallbackUrl } from "@/lib/redirect";
import { isEmailPasswordAuthEnabled } from "@/server/auth";

export const metadata: Metadata = {
  title: "Verify email",
};

interface VerifyEmailPageProps {
  searchParams: Promise<{
    email?: string;
    callbackURL?: string;
    verified?: string;
    error?: string;
  }>;
}

function VerifyCardSkeleton() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

async function VerifyEmailContent({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);

  if (!isEmailPasswordAuthEnabled()) {
    const target =
      callbackURL !== DEFAULT_AUTHENTICATED_PATH
        ? `/login?callbackURL=${encodeURIComponent(callbackURL)}`
        : "/login";
    redirect(target);
  }

  return (
    <VerifyEmailCard
      initialEmail={params.email ?? null}
      callbackURL={callbackURL}
      verified={params.verified === "1"}
      errorCode={params.error ?? null}
    />
  );
}

export default function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  return (
    <Suspense fallback={<VerifyCardSkeleton />}>
      <VerifyEmailContent searchParams={searchParams} />
    </Suspense>
  );
}
