import type { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";
import { PROJECT_ROLES, type ProjectRole } from "@/server/db/schema";
import { getRedisBackend } from "./client";

export const PERMISSION_CACHE_TTL_SECONDS = 300;

export type CachedProjectRole = ProjectRole | "none";

export interface PermissionCache {
  getRole(
    projectId: string,
    userId: string
  ): Promise<CachedProjectRole | null>;
  setRole(
    projectId: string,
    userId: string,
    role: CachedProjectRole
  ): Promise<void>;
  invalidateRole(projectId: string, userId: string): Promise<void>;
}

function buildKey(projectId: string, userId: string): string {
  return `project_role:${projectId}:${userId}`;
}

function parseCachedRole(raw: unknown): CachedProjectRole | null {
  if (raw === "none") return "none";
  if (
    typeof raw === "string" &&
    (PROJECT_ROLES as readonly string[]).includes(raw)
  ) {
    return raw as ProjectRole;
  }
  return null;
}

export class InMemoryPermissionCache implements PermissionCache {
  private readonly store = new Map<
    string,
    { value: CachedProjectRole; expiresAt: number }
  >();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async getRole(
    projectId: string,
    userId: string
  ): Promise<CachedProjectRole | null> {
    const key = buildKey(projectId, userId);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setRole(
    projectId: string,
    userId: string,
    role: CachedProjectRole
  ): Promise<void> {
    this.store.set(buildKey(projectId, userId), {
      value: role,
      expiresAt: this.now() + PERMISSION_CACHE_TTL_SECONDS * 1000,
    });
  }

  async invalidateRole(projectId: string, userId: string): Promise<void> {
    this.store.delete(buildKey(projectId, userId));
  }

  clear(): void {
    this.store.clear();
  }
}

export class IoRedisPermissionCache implements PermissionCache {
  constructor(
    private readonly client: IORedis,
    private readonly fallback: PermissionCache = new InMemoryPermissionCache()
  ) {}

  async getRole(
    projectId: string,
    userId: string
  ): Promise<CachedProjectRole | null> {
    try {
      if (this.client.status === "wait") await this.client.connect();
      const raw = await this.client.get(buildKey(projectId, userId));
      return parseCachedRole(raw);
    } catch {
      return this.fallback.getRole(projectId, userId);
    }
  }

  async setRole(
    projectId: string,
    userId: string,
    role: CachedProjectRole
  ): Promise<void> {
    try {
      if (this.client.status === "wait") await this.client.connect();
      await this.client.set(
        buildKey(projectId, userId),
        role,
        "EX",
        PERMISSION_CACHE_TTL_SECONDS
      );
    } catch {
      await this.fallback.setRole(projectId, userId, role);
    }
  }

  async invalidateRole(projectId: string, userId: string): Promise<void> {
    await this.fallback.invalidateRole(projectId, userId);
    try {
      if (this.client.status === "wait") await this.client.connect();
      await this.client.del(buildKey(projectId, userId));
    } catch {
      // Fallback already invalidated
    }
  }
}

export class UpstashPermissionCache implements PermissionCache {
  constructor(
    private readonly client: UpstashRedis,
    private readonly fallback: PermissionCache = new InMemoryPermissionCache()
  ) {}

  async getRole(
    projectId: string,
    userId: string
  ): Promise<CachedProjectRole | null> {
    try {
      const raw = await this.client.get<string>(buildKey(projectId, userId));
      return parseCachedRole(raw);
    } catch {
      return this.fallback.getRole(projectId, userId);
    }
  }

  async setRole(
    projectId: string,
    userId: string,
    role: CachedProjectRole
  ): Promise<void> {
    try {
      await this.client.set(buildKey(projectId, userId), role, {
        ex: PERMISSION_CACHE_TTL_SECONDS,
      });
    } catch {
      await this.fallback.setRole(projectId, userId, role);
    }
  }

  async invalidateRole(projectId: string, userId: string): Promise<void> {
    await this.fallback.invalidateRole(projectId, userId);
    try {
      await this.client.del(buildKey(projectId, userId));
    } catch {
      // Fallback already invalidated
    }
  }
}

export function createPermissionCache(): PermissionCache {
  const backend = getRedisBackend();
  const fallback = new InMemoryPermissionCache();
  if (backend.kind === "upstash") {
    return new UpstashPermissionCache(backend.client, fallback);
  }
  if (backend.kind === "local_redis") {
    return new IoRedisPermissionCache(backend.client, fallback);
  }
  return fallback;
}

export const defaultPermissionCache: PermissionCache = createPermissionCache();
