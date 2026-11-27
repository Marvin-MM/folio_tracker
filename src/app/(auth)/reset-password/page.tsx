import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { isEmailPasswordAuthEnabled } from "@/server/auth";


export const metadata: Metadata = {
  title: "Reset password",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  if (!isEmailPasswordAuthEnabled()) {
    redirect("/login");
  }

  const params = await searchParams;
  const token =
    typeof params.token === "string" && params.token.trim()
      ? params.token.trim()
      : null;

  return <ResetPasswordForm token={token} />;
}
