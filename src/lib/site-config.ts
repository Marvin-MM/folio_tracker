import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const PRODUCTION_FALLBACK_URL = "https://folio.renult.xyz";
const DEV_FALLBACK_URL = "http://localhost:3000";

/**
 * Resolves the canonical origin for `metadataBase`, `robots.txt`, `sitemap.xml`,
 * canonical `<link>` tags, and Open Graph / Twitter cards.
 *
 * Priority:
 * 1. `NEXT_PUBLIC_SITE_URL`
 * 2. `BETTER_AUTH_URL`
 * 3. `https://folio.renult.xyz` in production (`http://localhost:3000` in dev/test)
 */
export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.NEXT_PUBLIC_SITE_URL?.trim() ||
    env.BETTER_AUTH_URL?.trim() ||
    (env.NODE_ENV === "production" ? PRODUCTION_FALLBACK_URL : DEV_FALLBACK_URL);

  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return env.NODE_ENV === "production"
      ? PRODUCTION_FALLBACK_URL
      : DEV_FALLBACK_URL;
  }
}

export const SITE_METADATA = {
  name: APP_NAME,
  title: `${APP_NAME} — Calm Tasks, Quiet Notes, Durable Reminders & Honest Habits`,
  shortDescription: APP_TAGLINE,
  description:
    "Folio is a calm, high-density productivity workspace combining personal tasks, markdown notes, natural-language quick capture, durable multi-channel reminders, shared projects with RBAC, real-calendar habit tracking, and an accountability circle.",
  keywords: [
    "Folio",
    "productivity workspace",
    "task manager",
    "markdown notes",
    "timed reminders",
    "habit tracker",
    "accountability circle",
    "shared projects",
    "PWA productivity app",
    "calm productivity",
  ],
} as const;

export function buildWebApplicationJsonLd(siteUrl: string = getSiteUrl()) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_METADATA.name,
    url: siteUrl,
    description: SITE_METADATA.description,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript. Installable as a PWA.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Personal tasks with Inbox, Today, Upcoming, and ⌘K natural-language quick capture",
      "Quiet and timed markdown notes with tagging, pinning, and instant search",
      "Durable hybrid reminders across in-app, PWA Web Push, and email",
      "Shared projects with owner, editor, and viewer role-based access control",
      "Real-calendar 28-31 day habit matrix with elapsed-to-date analytics and task sync",
      "Accountability Circle with configurable owner-timezone commenting windows",
    ],
  };
}
