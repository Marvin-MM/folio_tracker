import type { Metadata } from "next";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";
import { sanitizeCallbackUrl } from "@/lib/redirect";

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

  return (
    <VerifyEmailCard
      initialEmail={params.email ?? null}
      callbackURL={callbackURL}
      verified={params.verified === "1"}
      errorCode={params.error ?? null}
    />
  );
}
