import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { handleRateLimitedAuthPost } from "@/server/http/auth-rate-limit-handler";
import { InMemoryPermissionCache } from "@/server/providers/redis/permission-cache";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";

describe("Redis Providers — RateLimiter (429), PermissionCache & UnreadCounterCache", () => {
  it("enforces sliding-window threshold and returns structured HTTP 429 with Retry-After headers", async () => {
    let clock = 1_700_000_000_000;
    const limiter = new InMemoryRateLimiter({
      now: () => clock,
      policies: {
        auth: {
          maxRequests: 3,
          windowMs: 10 * 60 * 1000,
          upstashWindow: "10 m",
        },
      },
    });

    const makeAuthRequest = () =>
      new NextRequest("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.42",
        },
        body: JSON.stringify({
          email: "victim@example.com",
          password: "wrong-password",
        }),
      });

    const okDelegate = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });

    // First 3 requests pass within the 10-minute window
    for (let i = 0; i < 3; i++) {
      const res = await handleRateLimitedAuthPost(
        makeAuthRequest(),
        limiter,
        okDelegate
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(2 - i));
    }

    // 4th request breaches threshold -> HTTP 429 with structured JSON + Retry-After
    const blocked = await handleRateLimitedAuthPost(
      makeAuthRequest(),
      limiter,
      okDelegate
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");

    const body = (await blocked.json()) as {
      ok: boolean;
      error: { code: string; retryAfterSeconds: number };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);

    // Advance past the 10-minute sliding window -> allowed again
    clock += 10 * 60 * 1000 + 1_000;
    const recovered = await handleRateLimitedAuthPost(
      makeAuthRequest(),
      limiter,
      okDelegate
    );
    expect(recovered.status).toBe(200);
  });

  it("caches project roles with 300s TTL and supports immediate invalidation", async () => {
    let clock = 1_700_000_000_000;
    const cache = new InMemoryPermissionCache(() => clock);

    expect(await cache.getRole("p1", "u1")).toBeNull();
    await cache.setRole("p1", "u1", "editor");
    expect(await cache.getRole("p1", "u1")).toBe("editor");

    await cache.invalidateRole("p1", "u1");
    expect(await cache.getRole("p1", "u1")).toBeNull();

    // TTL expiration after 300s
    await cache.setRole("p1", "u1", "viewer");
    clock += 300_001;
    expect(await cache.getRole("p1", "u1")).toBeNull();
  });

  it("tracks unread notification counters accurately across increment, decrement, and reset", async () => {
    const cache = new InMemoryUnreadCounterCache();

    await cache.set("u1", 2);
    await cache.increment("u1", 1);
    expect(await cache.get("u1")).toBe(3);

    await cache.decrement("u1", 1);
    expect(await cache.get("u1")).toBe(2);

    await cache.reset("u1");
    expect(await cache.get("u1")).toBe(0);

    // Never drops below zero
    await cache.decrement("u1", 5);
    expect(await cache.get("u1")).toBe(0);
  });
});
