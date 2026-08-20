// @version 1.0.0
/**
 * co-newbiz API server — docs/api-spec.md (Wave 5.6A).
 *
 * Hono app + Bun.serve entry. `buildApp()` is exported separately so tests
 * exercise routes through app.request() without binding a port.
 *
 * Wave 5.6A scope: api-spec §2 (auth/tokens), §3 (projects/membership/
 * classification), §5 (RAG/approval/compliance/waivers/interpretations/
 * procedures), §7 (watch/notifications/glossary), §8 (admin console), §9
 * (envelope). §4 analysis runs/simulations and §6 M&A topic reads are
 * deferred to a later sub-PR — the engines run through the CLI today and
 * need an async job surface, not a synchronous handler.
 *
 * If app/web/dist exists (Wave 5.6B build output) it is served as the SPA
 * with an index.html fallback for client-side routes.
 */

import { Hono } from "hono";
import { existsSync } from "node:fs";
import { serveStatic } from "hono/bun";
import { authRoutes } from "./auth.ts";
import { tokenRoutes } from "./tokens.ts";
import { projectRoutes } from "./projects.ts";
import { governanceRoutes } from "./governance.ts";
import { monitoringRoutes } from "./monitoring.ts";
import { glossaryRoutes } from "./glossary.ts";
import { adminRoutes } from "./admin.ts";
import type { AppEnv } from "./middleware.ts";

export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.route("/", authRoutes);
  app.route("/", tokenRoutes);
  app.route("/", projectRoutes);
  app.route("/", governanceRoutes);
  app.route("/", monitoringRoutes);
  app.route("/", glossaryRoutes);
  app.route("/", adminRoutes);

  if (existsSync("app/web/dist")) {
    app.use("*", serveStatic({ root: "app/web/dist" }));
    app.get("*", serveStatic({ path: "app/web/dist/index.html" }));
  }

  return app;
}

export const app = buildApp();

if (import.meta.main) {
  const port = Number(process.env.CO_NEWBIZ_PORT ?? 8787);
  Bun.serve({ port, fetch: app.fetch });
  console.log(`co-newbiz API listening on http://localhost:${port}`);
}
