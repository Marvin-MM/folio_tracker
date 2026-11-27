import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { OperationInviteAcceptCard } from "@/components/operations/operation-invite-accept-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/constants";
import { auth, isEmailPasswordAuthEnabled } from "@/server/auth";
import { operationShareService } from "@/server/services/operation-share-service";

export const metadata: Metadata = {
  title: "Operation Invitation",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

interface OperationInvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function OperationInvitePage({
  params,
}: OperationInvitePageProps) {
  const { token } = await params;
  const [preview, session] = await Promise.all([
    operationShareService.previewTokenInvite(token),
    auth.api.getSession({ headers: await headers() }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 md:px-6">
        <Link
          href={session ? "/app/operations" : "/login"}
          className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-foreground"
        >
          <BrandMark />
          <span>{APP_NAME}</span>
        </Link>
        <ThemeToggle compact />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <OperationInviteAcceptCard
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
        </div>
      </main>

      <footer className="border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">
        <span>{APP_NAME} · Private Operation Collaboration</span>
      </footer>
    </div>
  );
}
