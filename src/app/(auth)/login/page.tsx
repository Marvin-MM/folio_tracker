import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { sanitizeCallbackUrl } from "@/lib/redirect";
import { isGoogleOAuthConfigured } from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";

export const metadata: Metadata = {
  title: "Sign in",
};

interface LoginPageProps {
  searchParams: Promise<{
    callbackURL?: string;
    reset?: string;
    verified?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);
  const existingSession = await getOptionalSession();
  if (existingSession) {
    redirect(callbackURL);
  }

  return (
    <LoginForm
      callbackURL={callbackURL}
      googleEnabled={isGoogleOAuthConfigured()}
      resetSuccess={params.reset === "success"}
      verifiedSuccess={params.verified === "1"}
    />
  );
}
