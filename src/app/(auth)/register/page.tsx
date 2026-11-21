import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { sanitizeCallbackUrl } from "@/lib/redirect";
import { isGoogleOAuthConfigured } from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";

export const metadata: Metadata = {
  title: "Create account",
};

interface RegisterPageProps {
  searchParams: Promise<{
    callbackURL?: string;
  }>;
}

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams;
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);
  const existingSession = await getOptionalSession();
  if (existingSession) {
    redirect(callbackURL);
  }

  return (
    <RegisterForm
      callbackURL={callbackURL}
      googleEnabled={isGoogleOAuthConfigured()}
    />
  );
}
