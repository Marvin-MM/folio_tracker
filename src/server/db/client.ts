import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type AppDatabase = LibSQLDatabase<typeof schema>;
export type AppTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0];
export type DbExecutor = AppDatabase | AppTransaction;

export interface DbClientOptions {
  url?: string;
  authToken?: string;
  syncUrl?: string;
  syncInterval?: number;
}

export interface DbConnection {
  client: Client;
  db: AppDatabase;
  enableForeignKeys: () => Promise<void>;
  pragmasReady: Promise<void>;
}

export function createDbConnection(options: DbClientOptions = {}): DbConnection {
  const url =
    options.url ?? process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken =
    options.authToken ?? (process.env.TURSO_AUTH_TOKEN || undefined);
  const syncUrl =
    options.syncUrl ?? (process.env.TURSO_SYNC_URL?.trim() || undefined);
  const envSyncInterval = Number(process.env.TURSO_SYNC_INTERVAL ?? "60");
  const syncInterval =
    options.syncInterval ??
    (Number.isFinite(envSyncInterval) && envSyncInterval > 0
      ? envSyncInterval
      : 60);

  const isLocalFile = url.startsWith("file:");
  const client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
    ...(isLocalFile && syncUrl ? { syncUrl, syncInterval } : {}),
    // Local file SQLite uses a single serialized connection so concurrent
    // writes never trigger @libsql/client's multi-handle SQLITE_BUSY pool bug
    // and per-connection PRAGMAs stay consistent; `withDbRetry` handles
    // transient TRANSACTION_ACTIVE contention asynchronously.
    ...(isLocalFile ? { concurrency: 1 } : {}),
  });

  const db = drizzle(client, { schema });

  const enableForeignKeys = async () => {
    await client.execute("PRAGMA foreign_keys = ON;");
    if (isLocalFile) {
      // Enable WAL for concurrent readers and tune local SQLite page cache & mmap
      // for sub-millisecond reads/writes; keep busy_timeout=0 so local libSQL
      // synchronous FFI never stalls the Node.js event loop (async `withDbRetry`
      // handles transient SQLITE_BUSY contention non-blockingly).
      await client.execute("PRAGMA journal_mode = WAL;");
      await client.execute("PRAGMA synchronous = NORMAL;");
      await client.execute("PRAGMA cache_size = -64000;");
      await client.execute("PRAGMA temp_store = MEMORY;");
      await client.execute("PRAGMA mmap_size = 268435456;");
    }
  };

  const pragmasReady: Promise<void> =
    isLocalFile || url === ":memory:"
      ? enableForeignKeys().catch(() => {
          // Initial connection pragma failure will surface on first query
        })
      : Promise.resolve();

  return { client, db, enableForeignKeys, pragmasReady };
}

const globalForDb = globalThis as unknown as {
  __folioDbConnection?: DbConnection;
};

function getSingletonConnection(): DbConnection {
  if (!globalForDb.__folioDbConnection) {
    globalForDb.__folioDbConnection = createDbConnection();
  }
  return globalForDb.__folioDbConnection;
}

export const dbConnection = getSingletonConnection();
export const libsqlClient = dbConnection.client;
export const db: AppDatabase = dbConnection.db;
