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
 *
 * Static serving is registered BEFORE the route modules on purpose: every
 * route module below applies its own auth middleware with `.use("*", ...)`,
 * and mounting a sub-app at `app.route("/", subApp)` makes that "*" match
 * the WHOLE app, not just the sub-app's own paths — registered later, it
 * would intercept "/" and every static asset before the SPA ever serves.
 * The static handlers here are plain GET routes on their own path patterns
 * (never "/api/*"), so they end the chain for those paths without reaching
 * the auth-gated routers at all.
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

const SPA_DIST = "app/web/dist";

export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const hasSpa = existsSync(SPA_DIST);

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  if (hasSpa) {
    // One middleware, registered before every auth-gated router, so it is
    // the only thing that ever sees a non-API path: static assets under
    // /assets, the SPA shell for everything else (including client-side
    // routes like /projects/:id, which have no server-side route of their
    // own). Any /api/* path calls next() untouched.
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      if (c.req.path.startsWith("/assets/")) return serveStatic({ root: SPA_DIST })(c, next);
      return serveStatic({ path: `${SPA_DIST}/index.html` })(c, next);
    });
  }

  app.route("/", authRoutes);
  app.route("/", tokenRoutes);
  app.route("/", projectRoutes);
  app.route("/", governanceRoutes);
  app.route("/", monitoringRoutes);
  app.route("/", glossaryRoutes);
  app.route("/", adminRoutes);

  return app;
}

export const app = buildApp();

if (import.meta.main) {
  const port = Number(process.env.CO_NEWBIZ_PORT ?? 8787);
  Bun.serve({ port, fetch: app.fetch });
  console.log(`co-newbiz API listening on http://localhost:${port}`);
}
