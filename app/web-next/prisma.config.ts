// Phase 1 scaffold (ADR-0069, Proposed). Prisma 7 config — connection
// details live here, not in schema.prisma's datasource block (that field
// was removed in Prisma 7; see the migration note this file's header
// links to in schema.prisma).
import { defineConfig } from "prisma/config";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7's CLI does not auto-load .env for the config file itself (only
// for migrate/generate steps downstream) — load it explicitly here so
// datasource.url below is populated when `prisma db pull` reads this file.
if (!process.env.DATABASE_URL) {
  const { readFileSync } = await import("node:fs");
  const envText = readFileSync(new URL("./.env", import.meta.url), "utf-8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"\n]*)"?$/);
    if (m) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    adapter: async () => new PrismaBetterSQLite3({ url: process.env.DATABASE_URL! }),
  },
});
