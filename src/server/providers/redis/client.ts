import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

export type RedisBackend =
  | { kind: "upstash"; client: UpstashRedis }
  | { kind: "local_redis"; client: IORedis }
  | { kind: "memory" };

const globalForRedis = globalThis as unknown as {
  __folioRedisBackend?: RedisBackend;
};

function initializeBackend(): RedisBackend {
  // Always keep unit tests completely isolated in-memory unless explicitly injected
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return { kind: "memory" };
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (upstashUrl && upstashToken) {
    return {
      kind: "upstash",
      client: new UpstashRedis({
        url: upstashUrl,
        token: upstashToken,
      }),
    };
  }

  const localRedisUrl = process.env.REDIS_URL?.trim();
  if (localRedisUrl) {
    const client = new IORedis(localRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_500,
    });

    // Attach silent error handler so transient local Redis restarts never crash Node
    client.on("error", () => {
      // Handled per-operation via graceful in-memory fallback
    });

    return {
      kind: "local_redis",
      client,
    };
  }

  return { kind: "memory" };
}

export function getRedisBackend(): RedisBackend {
  if (!globalForRedis.__folioRedisBackend) {
    globalForRedis.__folioRedisBackend = initializeBackend();
  }
  return globalForRedis.__folioRedisBackend;
}
