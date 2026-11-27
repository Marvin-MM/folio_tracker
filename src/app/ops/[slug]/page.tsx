import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GuestOperationRunner } from "@/components/operations/guest-operation-runner";
import { PublicChrome } from "@/components/operations/public-chrome";
import { auth } from "@/server/auth";
import { NotFoundError } from "@/server/dal/errors";
import { resolveOperationAccess } from "@/server/dal/operation-auth";
import { operationsSocialRepository } from "@/server/dal/operations-social";
import { getCachedPublicOperationBySlug } from "@/server/dal/public-operations-cache";

interface PublicOperationPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicOperationPageProps): Promise<Metadata> {
  const [{ slug }, { token }] = await Promise.all([params, searchParams]);

  // Never index or leak metadata for unlisted token URLs
  if (token) {
    return {
      title: "Unlisted Operation",
      robots: {
        index: false,
        follow: false,
        nocache: true,
      },
    };
  }

  const operation = await getCachedPublicOperationBySlug(slug);
  if (!operation) {
    return {
      title: "Operation Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: operation.title,
    description:
      operation.summary ||
      `${operation.title} — ${operation.version.steps.length}-step operation blueprint on Folio.`,
    alternates: {
      canonical: `/ops/${operation.slug}`,
    },
    openGraph: {
      title: operation.title,
      description:
        operation.summary ||
        `${operation.version.steps.length}-step operation blueprint on Folio.`,
      url: `/ops/${operation.slug}`,
      type: "article",
    },
  };
}

export default async function PublicOperationPage({
  params,
  searchParams,
}: PublicOperationPageProps) {
  const [{ slug }, { token }, session] = await Promise.all([
    params,
    searchParams,
    auth.api.getSession({ headers: await headers() }),
  ]);

  const sessionUserId = session?.user?.id ?? null;
  const cleanToken = typeof token === "string" && token.trim() ? token.trim() : null;

  // Path 1: Unlisted token access (direct Turso RBAC + timing-safe hash check, ZERO cache)
  if (cleanToken) {
    let access;
    try {
      access = await resolveOperationAccess({
        slug,
        sessionUserId,
        unlistedToken: cleanToken,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        notFound();
      }
      throw error;
    }

    const dto = await operationsSocialRepository.getUnlistedOperationDtoById(
      access.operation.id
    );
    if (!dto) {
      notFound();
    }

    return (
      <PublicChrome
        activeNav="operation"
        isAuthenticated={Boolean(sessionUserId)}
        callbackPath={`/ops/${dto.slug}?token=${encodeURIComponent(cleanToken)}`}
      >
        <GuestOperationRunner
          operation={dto}
          isAuthenticated={Boolean(sessionUserId)}
          isOwner={access.role === "owner"}
          unlistedToken={cleanToken}
        />
      </PublicChrome>
    );
  }

  // Path 2: Public blueprint (native Next.js 16 `'use cache'`)
  const dto = await getCachedPublicOperationBySlug(slug);
  if (!dto) {
    notFound();
  }

  return (
    <PublicChrome
      activeNav="operation"
      isAuthenticated={Boolean(sessionUserId)}
      callbackPath={`/ops/${dto.slug}`}
    >
      <GuestOperationRunner
        operation={dto}
        isAuthenticated={Boolean(sessionUserId)}
        isOwner={sessionUserId === dto.creator.id}
      />
    </PublicChrome>
  );
}
