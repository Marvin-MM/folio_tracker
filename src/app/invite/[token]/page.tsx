import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { InviteAcceptCard } from "@/components/projects/invite-accept-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/constants";
import { auth } from "@/server/auth";
import { projectInviteService } from "@/server/services/project-invite-service";

export const metadata: Metadata = {
  title: "Project Invitation",
};

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const [preview, session] = await Promise.all([
    projectInviteService.previewInvitationByToken(token),
    auth.api.getSession({ headers: await headers() }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 md:px-6">
        <Link
          href={session ? "/app/inbox" : "/login"}
          className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-foreground"
        >
          <BrandMark />
          <span>{APP_NAME}</span>
        </Link>
        <ThemeToggle compact />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <InviteAcceptCard
            token={token}
            preview={preview}
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
        </div>
      </main>

      <footer className="border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">
        <span>{APP_NAME} · Secure project collaboration</span>
      </footer>
    </div>
  );
}
