import { Ratelimit } from "@upstash/ratelimit";
import type { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";
import { getRedisBackend } from "./client";

export type RateLimitBucket = "auth" | "project_invite" | "test_push";

export interface RateLimitPolicy {
  maxRequests: number;
  windowMs: number;
  upstashWindow: `${number} ${"s" | "m" | "h"}`;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitBucket, RateLimitPolicy> = {
  auth: {
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
    upstashWindow: "10 m",
  },
  project_invite: {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
    upstashWindow: "1 h",
  },
  test_push: {
    maxRequests: 5,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(bucket: RateLimitBucket, identifier: string): Promise<RateLimitResult>;
}

export function buildRateLimitHeaders(
  result: RateLimitResult
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(result.resetAtMs),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(Math.max(1, result.retryAfterSeconds));
  }

  return headers;
}

/**
 * Deterministic sliding-window RateLimiter for unit tests and graceful offline fallback.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly policies: Record<RateLimitBucket, RateLimitPolicy>;

  constructor(options?: {
    now?: () => number;
    policies?: Partial<Record<RateLimitBucket, RateLimitPolicy>>;
  }) {
    this.now = options?.now ?? (() => Date.now());
    this.policies = {
      ...RATE_LIMIT_POLICIES,
      ...options?.policies,
    };
  }

  async limit(
    bucket: RateLimitBucket,
    identifier: string
  ): Promise<RateLimitResult> {
    const policy = this.policies[bucket];
    const nowMs = this.now();
    const windowStart = nowMs - policy.windowMs;
    const key = `rl:${bucket}:${identifier}`;

    const timestamps = (this.windows.get(key) ?? []).filter(
      (ts) => ts > windowStart
    );

    if (timestamps.length >= policy.maxRequests) {
      const oldest = timestamps[0] ?? nowMs;
      const resetAtMs = oldest + policy.windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAtMs - nowMs) / 1000)
      );
      this.windows.set(key, timestamps);
      return {
        allowed: false,
        limit: policy.maxRequests,
        remaining: 0,
        resetAtMs,
        retryAfterSeconds,
      };
    }

    timestamps.push(nowMs);
    this.windows.set(key, timestamps);
    const oldest = timestamps[0] ?? nowMs;
    const resetAtMs = oldest + policy.windowMs;

    return {
      allowed: true,
      limit: policy.maxRequests,
      remaining: Math.max(0, policy.maxRequests - timestamps.length),
      resetAtMs,
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.windows.clear();
  }
}

/**
 * Atomic Lua sliding-window RateLimiter for local Redis (`ioredis`).
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_req = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window_ms)
local count = redis.call('ZCARD', key)

if count >= max_req then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest_score = oldest[2] and tonumber(oldest[2]) or now
  return {0, 0, oldest_score + window_ms}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window_ms)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest_score = oldest[2] and tonumber(oldest[2]) or now
return {1, max_req - (count + 1), oldest_score + window_ms}
`;

export class IoRedisRateLimiter implements RateLimiter {
  constructor(
    private readonly client: IORedis,
    private readonly fallback: RateLimiter = new InMemoryRateLimiter()
  ) {}

  async limit(
    bucket: RateLimitBucket,
    identifier: string
  ): Promise<RateLimitResult> {
    const policy = RATE_LIMIT_POLICIES[bucket];
    const nowMs = Date.now();
    const key = `folio:rl:${bucket}:${identifier}`;
    const member = `${nowMs}:${Math.random().toString(36).slice(2, 10)}`;

    try {
      if (this.client.status === "wait") {
        await this.client.connect();
      }
      const raw = (await this.client.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(nowMs),
        String(policy.windowMs),
        String(policy.maxRequests),
        member
      )) as [number, number, number];

      const allowed = Number(raw[0]) === 1;
      const remaining = Math.max(0, Number(raw[1]));
      const resetAtMs = Number(raw[2]) || nowMs + policy.windowMs;
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

      return {
        allowed,
        limit: policy.maxRequests,
        remaining,
        resetAtMs,
        retryAfterSeconds,
      };
    } catch {
      return this.fallback.limit(bucket, identifier);
    }
  }
}

/**
 * Production Upstash REST sliding-window RateLimiter (`@upstash/ratelimit`).
 */
export class UpstashRateLimiter implements RateLimiter {
  private readonly limiters: Record<RateLimitBucket, Ratelimit>;

  constructor(
    redis: UpstashRedis,
    private readonly fallback: RateLimiter = new InMemoryRateLimiter()
  ) {
    this.limiters = {
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          RATE_LIMIT_POLICIES.auth.maxRequests,
          RATE_LIMIT_POLICIES.auth.upstashWindow
        ),
        prefix: "folio:rl:auth",
      }),
      project_invite: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          RATE_LIMIT_POLICIES.project_invite.maxRequests,
          RATE_LIMIT_POLICIES.project_invite.upstashWindow
        ),
        prefix: "folio:rl:invite",
      }),
      test_push: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          RATE_LIMIT_POLICIES.test_push.maxRequests,
          RATE_LIMIT_POLICIES.test_push.upstashWindow
        ),
        prefix: "folio:rl:test_push",
      }),
    };
  }

  async limit(
    bucket: RateLimitBucket,
    identifier: string
  ): Promise<RateLimitResult> {
    try {
      const res = await this.limiters[bucket].limit(identifier);
      const retryAfterSeconds = res.success
        ? 0
        : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
      return {
        allowed: res.success,
        limit: res.limit,
        remaining: res.remaining,
        resetAtMs: res.reset,
        retryAfterSeconds,
      };
    } catch {
      return this.fallback.limit(bucket, identifier);
    }
  }
}

export function createRateLimiter(): RateLimiter {
  const backend = getRedisBackend();
  const memoryFallback = new InMemoryRateLimiter();
  if (backend.kind === "upstash") {
    return new UpstashRateLimiter(backend.client, memoryFallback);
  }
  if (backend.kind === "local_redis") {
    return new IoRedisRateLimiter(backend.client, memoryFallback);
  }
  return memoryFallback;
}

export const defaultRateLimiter: RateLimiter = createRateLimiter();
