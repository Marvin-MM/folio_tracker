import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CreatorProfileView } from "@/components/operations/creator-profile-view";
import { PublicChrome } from "@/components/operations/public-chrome";
import { auth } from "@/server/auth";
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

export default async function CreatorProfilePage({
  params,
}: CreatorProfilePageProps) {
  const { handle } = await params;
  const [profile, session] = await Promise.all([
    getCachedPublicCreatorProfile(handle),
    auth.api.getSession({ headers: await headers() }),
  ]);

  if (!profile) {
    notFound();
  }

  const viewerUserId = session?.user?.id ?? null;
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
