import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FolioLanding } from "@/components/landing/folio-landing";
import { StandaloneRootGuard } from "@/components/landing/standalone-root-guard";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/constants";
import {
  buildWebApplicationJsonLd,
  getSiteUrl,
  SITE_METADATA,
} from "@/lib/site-config";
import {
  isEmailPasswordAuthEnabled,
  isGoogleOAuthConfigured,
} from "@/server/auth";
import { getOptionalSession } from "@/server/dal/auth-guard";

export const metadata: Metadata = {
  title: SITE_METADATA.title,
  description: SITE_METADATA.description,
  alternates: {
    canonical: "/",
  },
};

async function AuthenticatedHomeRedirect() {
  const session = await getOptionalSession();
  if (session && !session.user.isSuspended) {
    redirect(DEFAULT_AUTHENTICATED_PATH);
  }
  return null;
}

export default function HomePage() {
  const jsonLd = buildWebApplicationJsonLd(getSiteUrl());

  return (
    <>
      <Suspense fallback={null}>
        <AuthenticatedHomeRedirect />
      </Suspense>
      <StandaloneRootGuard />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <FolioLanding
        googleEnabled={isGoogleOAuthConfigured()}
        emailPasswordEnabled={isEmailPasswordAuthEnabled()}
      />
    </>
  );
}
