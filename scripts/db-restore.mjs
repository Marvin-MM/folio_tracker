#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const backupPath = process.argv[2];
if (!backupPath) {
  console.error("Usage: node scripts/db-restore.mjs <backup-file>");
  process.exit(1);
}

const cwd = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(cwd, f);
  if (fs.existsSync(p) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(p);
    } catch {
      // Ignore malformed optional local env files
    }
  }
}

const url = process.env.TURSO_DATABASE_URL || "file:local.db";
if (!url.startsWith("file:")) {
  console.error("db:restore currently supports local file databases only (file:...).");
  console.error(`Current TURSO_DATABASE_URL=${url}`);
  process.exit(1);
}

const dbPath = path.resolve(cwd, url.replace(/^file:/, ""));
const src = path.resolve(cwd, backupPath);
if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
  console.error(`Backup file not found: ${src}`);
  process.exit(1);
}

// Sanity-check SQLite header magic bytes before overwriting local DB
const header = Buffer.alloc(16);
const fd = fs.openSync(src, "r");
try {
  fs.readSync(fd, header, 0, 16, 0);
} finally {
  fs.closeSync(fd);
}
if (!header.toString("utf8").startsWith("SQLite format 3")) {
  console.error(`Refusing to restore non-SQLite file: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.copyFileSync(src, dbPath);
for (const suffix of ["-wal", "-shm"]) {
  const side = `${src}${suffix}`;
  const dest = `${dbPath}${suffix}`;
  if (fs.existsSync(side)) fs.copyFileSync(side, dest);
  else if (fs.existsSync(dest)) fs.rmSync(dest);
}
console.log(`Restored ${src} -> ${dbPath}`);
