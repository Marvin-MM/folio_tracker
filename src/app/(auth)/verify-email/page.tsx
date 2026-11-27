import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";
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

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
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
