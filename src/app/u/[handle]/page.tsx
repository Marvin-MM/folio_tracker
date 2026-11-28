import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CreatorProfileView } from "@/components/operations/creator-profile-view";
import { PublicChrome } from "@/components/operations/public-chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { getOptionalSession } from "@/server/dal/auth-guard";
import { getCachedPublicCreatorProfile } from "@/server/dal/public-operations-cache";
import { operationSocialService } from "@/server/services/operation-social-service";

interface CreatorProfilePageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({
  params,
}: CreatorProfilePageProps): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getCachedPublicCreatorProfile(handle);
  if (!profile) {
    return { title: "Creator Not Found" };
  }
  return {
    title: `${profile.creator.name} (@${profile.creator.handle})`,
    description:
      profile.creator.bio ??
      `Public operation blueprints shared by ${profile.creator.name} (@${profile.creator.handle}) on Folio.`,
    alternates: {
      canonical: `/u/${profile.creator.handle}`,
    },
  };
}

function CreatorProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-12 border-b border-border" />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-6">
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

async function CreatorProfileContent({ params }: CreatorProfilePageProps) {
  await connection();
  const [{ handle }, session] = await Promise.all([
    params,
    getOptionalSession(),
  ]);
  const profile = await getCachedPublicCreatorProfile(handle);

  if (!profile) {
    notFound();
  }

  const viewerUserId =
    session && !session.user.isSuspended ? session.user.id : null;
  const initialIsFollowing =
    viewerUserId && viewerUserId !== profile.creator.id
      ? await operationSocialService.isFollowing(viewerUserId, profile.creator.id)
      : false;

  return (
    <PublicChrome
      activeNav="profile"
      isAuthenticated={Boolean(viewerUserId)}
      callbackPath={`/u/${profile.creator.handle}`}
    >
      <CreatorProfileView
        profile={profile}
        viewerUserId={viewerUserId}
        initialIsFollowing={initialIsFollowing}
      />
    </PublicChrome>
  );
}

export default function CreatorProfilePage({ params }: CreatorProfilePageProps) {
  return (
    <Suspense fallback={<CreatorProfileSkeleton />}>
      <CreatorProfileContent params={params} />
    </Suspense>
  );
}
