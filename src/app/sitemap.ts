import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-config";
import { operationsSocialRepository } from "@/server/dal/operations-social";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  let publicOps: Array<{ slug: string; updatedAt: number }> = [];
  try {
    publicOps = await operationsSocialRepository.listPublicOperationSlugs(200);
  } catch {
    publicOps = [];
  }

  return [
    {
      url: `${siteUrl}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/explore`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...publicOps.map((op) => ({
      url: `${siteUrl}/ops/${op.slug}`,
      lastModified: new Date(op.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
