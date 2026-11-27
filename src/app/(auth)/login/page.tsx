import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
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
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackURL = sanitizeCallbackUrl(params.callbackURL);
  const existingSession = await getOptionalSession();
  if (existingSession) {
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
    />
  );
}
