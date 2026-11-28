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

export function normalizePublicHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

export function publicOpCacheTag(slug: string): string {
  return `public-op:${slug.trim().toLowerCase()}`;
}

export function publicProfileCacheTag(handle: string): string {
  return `public-profile:${normalizePublicHandle(handle)}`;
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
 * Tagged strictly by its own slug (never `PUBLIC_EXPLORE_CACHE_TAG`) so
 * unrelated explore updates never thrash individual operation pages.
 */
export async function getCachedPublicOperationBySlug(
  slug: string
): Promise<PublicOperationDetailDto | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(publicOpCacheTag(slug));

  return operationsSocialRepository.getPublicOperationBySlug(slug);
}

/**
 * Native Next.js 16 `'use cache'` creator profile reader keyed by handle.
 * Tagged strictly by normalized handle (strip leading `@`) so unrelated
 * explore mutations never thrash cached creator profiles.
 */
export async function getCachedPublicCreatorProfile(
  handle: string
): Promise<PublicCreatorProfileDto | null> {
  "use cache";
  cacheLife("minutes");
  const normalized = normalizePublicHandle(handle);
  cacheTag(publicProfileCacheTag(normalized));

  return operationsSocialRepository.getPublicCreatorProfileByHandle(normalized);
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
 * Invalidates ONLY the exact public Next.js `'use cache'` tags impacted by a mutation.
 * - `affectsExplore`: set `true` ONLY when a public operation is created, edited,
 *   archived, deleted, forked, verified, or its creator's public visibility/profile changes.
 * - Private operations and private runs NEVER bust `PUBLIC_EXPLORE_CACHE_TAG`.
 */
export function invalidatePublicOperationTags(
  params: {
    slug?: string | null;
    previousSlug?: string | null;
    extraSlugs?: readonly string[];
    ownerHandle?: string | null;
    previousHandle?: string | null;
    extraHandles?: readonly (string | null | undefined)[];
    affectsExplore?: boolean;
  },
  mode: "action" | "background" = "action"
): void {
  const fn = mode === "action" ? safeUpdateTag : safeRevalidateTag;
  const tags = new Set<string>();

  if (params.affectsExplore) {
    tags.add(PUBLIC_EXPLORE_CACHE_TAG);
  }
  if (params.slug) {
    tags.add(publicOpCacheTag(params.slug));
  }
  if (params.previousSlug) {
    tags.add(publicOpCacheTag(params.previousSlug));
  }
  for (const extraSlug of params.extraSlugs ?? []) {
    if (extraSlug) tags.add(publicOpCacheTag(extraSlug));
  }

  const handles = [
    params.ownerHandle,
    params.previousHandle,
    ...(params.extraHandles ?? []),
  ];
  for (const rawHandle of handles) {
    if (!rawHandle) continue;
    const normalized = normalizePublicHandle(rawHandle);
    if (normalized) {
      tags.add(publicProfileCacheTag(normalized));
    }
  }

  for (const tag of tags) {
    fn(tag);
  }
}
