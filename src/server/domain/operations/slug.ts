const DAY_MS = 24 * 60 * 60 * 1000;

export function slugifyOperationTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return base || "operation";
}

export function appendSlugSuffix(baseSlug: string, suffix: string): string {
  const cleanSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "1";
  const trimmedBase = baseSlug.slice(0, 64 - cleanSuffix.length - 1).replace(/-+$/g, "");
  return `${trimmedBase || "operation"}-${cleanSuffix}`;
}

export interface OperationStalenessInfo {
  isStale: boolean;
  daysSinceVerified: number | null;
  reviewDueAtMs: number | null;
}

export function computeOperationStaleness(params: {
  reviewCycleDays: number | null;
  lastVerifiedAt: number | null;
  createdAt: number;
  nowMs?: number;
}): OperationStalenessInfo {
  const nowMs = params.nowMs ?? Date.now();
  const anchorMs = params.lastVerifiedAt ?? params.createdAt;
  const elapsedMs = Math.max(0, nowMs - anchorMs);
  const daysSinceVerified = Math.floor(elapsedMs / DAY_MS);

  if (!params.reviewCycleDays || params.reviewCycleDays <= 0) {
    return {
      isStale: false,
      daysSinceVerified: params.lastVerifiedAt ? daysSinceVerified : null,
      reviewDueAtMs: null,
    };
  }

  const reviewDueAtMs = anchorMs + params.reviewCycleDays * DAY_MS;
  return {
    isStale: nowMs >= reviewDueAtMs,
    daysSinceVerified,
    reviewDueAtMs,
  };
}
