import type { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";
import { getRedisBackend } from "./client";

export const UNREAD_COUNTER_TTL_SECONDS = 300;

export interface UnreadCounterCache {
  get(userId: string): Promise<number | null>;
  set(userId: string, count: number): Promise<void>;
  increment(userId: string, delta?: number): Promise<void>;
  decrement(userId: string, delta?: number): Promise<void>;
  reset(userId: string): Promise<void>;
}

function buildKey(userId: string): string {
  return `unread_notifications:${userId}`;
}

export class InMemoryUnreadCounterCache implements UnreadCounterCache {
  private readonly store = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async get(userId: string): Promise<number | null> {
    const entry = this.store.get(buildKey(userId));
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(buildKey(userId));
      return null;
    }
    return entry.value;
  }

  async set(userId: string, count: number): Promise<void> {
    this.store.set(buildKey(userId), {
      value: Math.max(0, count),
      expiresAt: this.now() + UNREAD_COUNTER_TTL_SECONDS * 1000,
    });
  }

  async increment(userId: string, delta = 1): Promise<void> {
    const current = await this.get(userId);
    if (current === null) return;
    await this.set(userId, current + delta);
  }

  async decrement(userId: string, delta = 1): Promise<void> {
    const current = await this.get(userId);
    if (current === null) return;
    await this.set(userId, Math.max(0, current - delta));
  }

  async reset(userId: string): Promise<void> {
    await this.set(userId, 0);
  }
}

export class IoRedisUnreadCounterCache implements UnreadCounterCache {
  constructor(
    private readonly client: IORedis,
    private readonly fallback: UnreadCounterCache = new InMemoryUnreadCounterCache()
  ) {}

  async get(userId: string): Promise<number | null> {
    try {
      if (this.client.status === "wait") await this.client.connect();
      const raw = await this.client.get(buildKey(userId));
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    } catch {
      return this.fallback.get(userId);
    }
  }

  async set(userId: string, count: number): Promise<void> {
    const safe = Math.max(0, count);
    try {
      if (this.client.status === "wait") await this.client.connect();
      await this.client.set(
        buildKey(userId),
        String(safe),
        "EX",
        UNREAD_COUNTER_TTL_SECONDS
      );
    } catch {
      await this.fallback.set(userId, safe);
    }
  }

  async increment(userId: string, delta = 1): Promise<void> {
    try {
      if (this.client.status === "wait") await this.client.connect();
      const key = buildKey(userId);
      const exists = await this.client.exists(key);
      if (exists) {
        await this.client.incrby(key, delta);
        await this.client.expire(key, UNREAD_COUNTER_TTL_SECONDS);
      }
    } catch {
      await this.fallback.increment(userId, delta);
    }
  }

  async decrement(userId: string, delta = 1): Promise<void> {
    try {
      if (this.client.status === "wait") await this.client.connect();
      const key = buildKey(userId);
      const exists = await this.client.exists(key);
      if (exists) {
        const next = await this.client.decrby(key, delta);
        if (next < 0) {
          await this.client.set(key, "0", "EX", UNREAD_COUNTER_TTL_SECONDS);
        } else {
          await this.client.expire(key, UNREAD_COUNTER_TTL_SECONDS);
        }
      }
    } catch {
      await this.fallback.decrement(userId, delta);
    }
  }

  async reset(userId: string): Promise<void> {
    await this.set(userId, 0);
  }
}

export class UpstashUnreadCounterCache implements UnreadCounterCache {
  constructor(
    private readonly client: UpstashRedis,
    private readonly fallback: UnreadCounterCache = new InMemoryUnreadCounterCache()
  ) {}

  async get(userId: string): Promise<number | null> {
    try {
      const raw = await this.client.get<number>(buildKey(userId));
      if (raw === null || raw === undefined) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    } catch {
      return this.fallback.get(userId);
    }
  }

  async set(userId: string, count: number): Promise<void> {
    const safe = Math.max(0, count);
    try {
      await this.client.set(buildKey(userId), safe, {
        ex: UNREAD_COUNTER_TTL_SECONDS,
      });
    } catch {
      await this.fallback.set(userId, safe);
    }
  }

  async increment(userId: string, delta = 1): Promise<void> {
    try {
      const key = buildKey(userId);
      const exists = await this.client.exists(key);
      if (exists) {
        await this.client.incrby(key, delta);
        await this.client.expire(key, UNREAD_COUNTER_TTL_SECONDS);
      }
    } catch {
      await this.fallback.increment(userId, delta);
    }
  }

  async decrement(userId: string, delta = 1): Promise<void> {
    try {
      const key = buildKey(userId);
      const exists = await this.client.exists(key);
      if (exists) {
        const next = await this.client.decrby(key, delta);
        if (next < 0) {
          await this.client.set(key, 0, { ex: UNREAD_COUNTER_TTL_SECONDS });
        } else {
          await this.client.expire(key, UNREAD_COUNTER_TTL_SECONDS);
        }
      }
    } catch {
      await this.fallback.decrement(userId, delta);
    }
  }

  async reset(userId: string): Promise<void> {
    await this.set(userId, 0);
  }
}

export function createUnreadCounterCache(): UnreadCounterCache {
  const backend = getRedisBackend();
  const fallback = new InMemoryUnreadCounterCache();
  if (backend.kind === "upstash") {
    return new UpstashUnreadCounterCache(backend.client, fallback);
  }
  if (backend.kind === "local_redis") {
    return new IoRedisUnreadCounterCache(backend.client, fallback);
  }
  return fallback;
}

export const defaultUnreadCounterCache: UnreadCounterCache =
  createUnreadCounterCache();
