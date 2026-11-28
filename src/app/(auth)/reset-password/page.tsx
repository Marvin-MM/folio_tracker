import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmailPasswordAuthEnabled } from "@/server/auth";

export const metadata: Metadata = {
  title: "Reset password",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

function ResetCardSkeleton() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

async function ResetPasswordContent({ searchParams }: ResetPasswordPageProps) {
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

export default function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  return (
    <Suspense fallback={<ResetCardSkeleton />}>
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  );
}
