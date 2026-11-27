import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isEmailPasswordAuthEnabled } from "@/server/auth";


export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  if (!isEmailPasswordAuthEnabled()) {
    redirect("/login");
  }

  return <ForgotPasswordForm />;
}
