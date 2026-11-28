import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { InviteAcceptCard } from "@/components/projects/invite-accept-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/lib/constants";
import { isEmailPasswordAuthEnabled } from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";
import { projectInviteService } from "@/server/services/project-invite-service";

export const metadata: Metadata = {
  title: "Project Invitation",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

function InviteCardSkeleton() {
  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-6">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

async function InvitePageContent({ params }: InvitePageProps) {
  const [{ token }, rawSession] = await Promise.all([
    params,
    getOptionalSession(),
  ]);
  const session = rawSession && !rawSession.user.isSuspended ? rawSession : null;
  const preview = await projectInviteService.previewInvitationByToken(
    token,
    session?.user.email ?? null
  );

  return (
    <InviteAcceptCard
      token={token}
      preview={preview}
      emailPasswordEnabled={isEmailPasswordAuthEnabled()}
      currentUser={
        session
          ? {
              email: session.user.email,
              name: session.user.name,
              emailVerified: session.user.emailVerified,
            }
          : null
      }
    />
  );
}

export default function InvitePage({ params }: InvitePageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 md:px-6">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-foreground"
        >
          <BrandMark />
          <span>{APP_NAME}</span>
        </Link>
        <ThemeToggle compact />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <Suspense fallback={<InviteCardSkeleton />}>
            <InvitePageContent params={params} />
          </Suspense>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">
        <span>{APP_NAME} · Secure project collaboration</span>
      </footer>
    </div>
  );
}
