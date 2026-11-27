import type { Metadata } from "next";
import { headers } from "next/headers";
import { ExploreDirectoryView } from "@/components/operations/explore-directory-view";
import { PublicChrome } from "@/components/operations/public-chrome";
import { auth } from "@/server/auth";
import { getCachedPublicExploreOperations } from "@/server/dal/public-operations-cache";

export const metadata: Metadata = {
  title: "Explore Operations",
  description:
    "Discover public operation blueprints, recipes, workouts, DIY guides, and engineering runbooks you can execute right in your browser or fork into Folio.",
  alternates: {
    canonical: "/explore",
  },
};

export default async function ExploreOperationsPage() {
  const [operations, session] = await Promise.all([
    getCachedPublicExploreOperations({ sort: "recent" }),
    auth.api.getSession({ headers: await headers() }),
  ]);

  return (
    <PublicChrome
      activeNav="explore"
      isAuthenticated={Boolean(session?.user)}
      callbackPath="/explore"
    >
      <ExploreDirectoryView operations={operations} />
    </PublicChrome>
  );
}
