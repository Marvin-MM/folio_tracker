import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ExploreDirectoryView } from "@/components/operations/explore-directory-view";
import { PublicChrome } from "@/components/operations/public-chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { getOptionalSession } from "@/server/dal/auth-guard";
import { getCachedPublicExploreOperations } from "@/server/dal/public-operations-cache";

export const metadata: Metadata = {
  title: "Explore Operations",
  description:
    "Discover public operation blueprints, recipes, workouts, DIY guides, and engineering runbooks you can execute right in your browser or fork into Folio.",
  alternates: {
    canonical: "/explore",
  },
};

function ExploreSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-12 border-b border-border" />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

async function ExploreOperationsContent() {
  await connection();
  const [operations, session] = await Promise.all([
    getCachedPublicExploreOperations({ sort: "recent" }),
    getOptionalSession(),
  ]);
  const isAuthenticated = Boolean(session && !session.user.isSuspended);

  return (
    <PublicChrome
      activeNav="explore"
      isAuthenticated={isAuthenticated}
      callbackPath="/explore"
    >
      <ExploreDirectoryView operations={operations} />
    </PublicChrome>
  );
}

export default function ExploreOperationsPage() {
  return (
    <Suspense fallback={<ExploreSkeleton />}>
      <ExploreOperationsContent />
    </Suspense>
  );
}
