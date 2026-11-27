import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { buildWebApplicationJsonLd, getSiteUrl } from "@/lib/site-config";

describe("SEO & PWA configuration", () => {
  it("resolves canonical site URL cleanly across production and local environments", () => {
    expect(
      getSiteUrl({
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://folio.renult.xyz/extra",
      })
    ).toBe("https://folio.renult.xyz");

    expect(
      getSiteUrl({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://folio.renult.xyz/",
      })
    ).toBe("https://folio.renult.xyz");

    expect(getSiteUrl({ NODE_ENV: "production" })).toBe(
      "https://folio.renult.xyz"
    );
    expect(getSiteUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3000"
    );
  });

  it("blocks private app, API, and invite token routes in robots.txt and sitemap.xml", async () => {
    const robotsConfig = robots();
    const rules = Array.isArray(robotsConfig.rules)
      ? robotsConfig.rules[0]
      : robotsConfig.rules;

    expect(rules?.disallow).toEqual(
      expect.arrayContaining(["/app/", "/api/", "/invite/", "/offline"])
    );
    expect(robotsConfig.sitemap).toMatch(/\/sitemap\.xml$/);

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/explore"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/login"))).toBe(true);
    expect(urls.some((u) => u.includes("/app/"))).toBe(false);
    expect(urls.some((u) => u.includes("/invite/"))).toBe(false);
    expect(urls.some((u) => u.includes("/api/"))).toBe(false);
  });

  it("publishes complete PWA manifest with any+maskable icons, standalone mode, and shortcuts", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/app/inbox");
    expect(m.background_color).toBe("#F9F8F6");
    expect(m.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/icon-192.png",
          sizes: "192x192",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-512.png",
          sizes: "512x512",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-512-maskable.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
      ])
    );
    expect(m.shortcuts?.map((s) => s.url)).toEqual([
      "/app/today",
      "/app/habits",
      "/app/notes",
      "/app/reminders",
    ]);
  });

  it("builds valid schema.org WebApplication JSON-LD", () => {
    const schema = buildWebApplicationJsonLd("https://folio.renult.xyz");
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("WebApplication");
    expect(schema.url).toBe("https://folio.renult.xyz");
    expect(schema.featureList.length).toBeGreaterThanOrEqual(5);
  });
});
