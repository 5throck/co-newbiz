// Phase 1 scaffold (ADR-0069, Proposed). Prisma 7 config — connection
// details live here, not in schema.prisma's datasource block (that field
// was removed in Prisma 7; see the migration note this file's header
// links to in schema.prisma).
import { defineConfig } from "prisma/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { parseEnvValue } from "../../scripts/lib/env-value.ts";

// Unified single-env layout (design 2026-11-13-env-single-source, amendment
// 2026-11-19): the repo-root .env is the SSOT and DATABASE_URL lives there.
// Prisma 7's CLI does not auto-load .env for the config file itself (only
// for migrate/generate steps downstream) — load files explicitly here so
// datasource.url below is populated when `prisma db pull` reads this file.
// The app-local ./.env is read first as an operator-local compatibility
// fallback ONLY (a leftover unmigrated copy keeps its historical precedence);
// if it is absent — the expected state — the walk to ../../.env supplies the
// value. Explicit process.env values always win in both loads (no-override);
// missing files are silent (DATABASE_URL may come from spawn env, e.g. CI).
if (!process.env.DATABASE_URL) {
  const { existsSync, readFileSync } = await import("node:fs");
  const loadEnvFile = (url: URL): void => {
    if (!existsSync(url)) return;
    const envText = readFileSync(url, "utf-8");
    for (const line of envText.split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = parseEnvValue(m[2], m[1]);
    }
  };
  loadEnvFile(new URL("./.env", import.meta.url));
  loadEnvFile(new URL("../../.env", import.meta.url));
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
