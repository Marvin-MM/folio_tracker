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
}

export interface DbConnection {
  client: Client;
  db: AppDatabase;
  enableForeignKeys: () => Promise<void>;
}

export function createDbConnection(options: DbClientOptions = {}): DbConnection {
  const url =
    options.url ?? process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken =
    options.authToken ?? (process.env.TURSO_AUTH_TOKEN || undefined);

  const client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });

  const db = drizzle(client, { schema });

  const enableForeignKeys = async () => {
    await client.execute("PRAGMA foreign_keys = ON;");
  };

  if (url.startsWith("file:") || url === ":memory:") {
    void enableForeignKeys().catch(() => {
      // Initial connection pragma failure will surface on first query
    });
  }

  return { client, db, enableForeignKeys };
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
