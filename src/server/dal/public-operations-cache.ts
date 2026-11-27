import { cacheLife, cacheTag, revalidateTag, updateTag } from "next/cache";
import type { OperationDomain } from "@/server/db/schema";
import type {
  PublicCreatorProfileDto,
  PublicOperationCardDto,
  PublicOperationDetailDto,
} from "@/server/domain/operations";
import {
  operationsSocialRepository,
  type ExploreSortOption,
} from "./operations-social";

export const PUBLIC_EXPLORE_CACHE_TAG = "public-explore";

export function publicOpCacheTag(slug: string): string {
  return `public-op:${slug}`;
}

export function publicProfileCacheTag(handle: string): string {
  return `public-profile:${handle.trim().toLowerCase()}`;
}

/**
 * Native Next.js 16 `'use cache'` public Explore directory reader.
 * Strictly returns stripped public DTOs ONLY (zero private data / zero PII).
 */
export async function getCachedPublicExploreOperations(params: {
  domain?: OperationDomain;
  query?: string;
  sort?: ExploreSortOption;
} = {}): Promise<PublicOperationCardDto[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_EXPLORE_CACHE_TAG);

  return operationsSocialRepository.listPublicExploreOperations({
    domain: params.domain,
    query: params.query,
    sort: params.sort ?? "recent",
    limit: 60,
  });
}

/**
 * Native Next.js 16 `'use cache'` public operation reader keyed by slug.
 * Unlisted and Private operations NEVER pass through this function.
 */
export async function getCachedPublicOperationBySlug(
  slug: string
): Promise<PublicOperationDetailDto | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_EXPLORE_CACHE_TAG);
  cacheTag(publicOpCacheTag(slug));

  return operationsSocialRepository.getPublicOperationBySlug(slug);
}

/**
 * Native Next.js 16 `'use cache'` creator profile reader keyed by handle.
 */
export async function getCachedPublicCreatorProfile(
  handle: string
): Promise<PublicCreatorProfileDto | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_EXPLORE_CACHE_TAG);
  cacheTag(publicProfileCacheTag(handle));

  return operationsSocialRepository.getPublicCreatorProfileByHandle(handle);
}

function safeUpdateTag(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    // No-op outside Next.js Server Action request store (e.g. Vitest unit runs)
  }
}

function safeRevalidateTag(tag: string): void {
  try {
    revalidateTag(tag, "max");
  } catch {
    // No-op outside Next.js server store
  }
}

/**
 * Invalidates public Next.js `'use cache'` tags immediately on mutations
 * (uses `updateTag` inside Server Actions for read-your-own-writes consistency,
 * or `revalidateTag(..., "max")` from Route Handlers / background workers).
 */
export function invalidatePublicOperationTags(
  params: {
    slug?: string | null;
    previousSlug?: string | null;
    ownerHandle?: string | null;
    previousHandle?: string | null;
  },
  mode: "action" | "background" = "action"
): void {
  const fn = mode === "action" ? safeUpdateTag : safeRevalidateTag;
  fn(PUBLIC_EXPLORE_CACHE_TAG);
  if (params.slug) fn(publicOpCacheTag(params.slug));
  if (params.previousSlug && params.previousSlug !== params.slug) {
    fn(publicOpCacheTag(params.previousSlug));
  }
  if (params.ownerHandle) fn(publicProfileCacheTag(params.ownerHandle));
  if (params.previousHandle && params.previousHandle !== params.ownerHandle) {
    fn(publicProfileCacheTag(params.previousHandle));
  }
}
