// @version 1.0.0
/**
 * C-4 tripwire (design 2026-11-11-admin-security-and-board-fixes §4): every
 * Route Handler under app/web-next/app/api/admin/** must call requireAdmin.
 * The walk is recursive at runtime (readdirSync), so a NEW admin route is
 * picked up automatically — an admin route that handles requests but omits
 * the guard fails this test with a message naming the file. Same
 * static-source pattern as project-write-gating-static.test.ts.
 *
 * Scope note (per design): the assertion is presence of the call in the
 * file, not per-handler control flow — the review's intent is a tripwire
 * against a new unguarded route, kept $0 and deterministic.
 */
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ADMIN_API = join(import.meta.dirname, "../../app/web-next/app/api/admin");

function walkRoutes(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkRoutes(full, out);
    else if (entry === "route.ts") out.push(full);
  }
}

test("every admin API route file calls requireAdmin (C-4 tripwire)", () => {
  const routes: string[] = [];
  walkRoutes(ADMIN_API, routes);
  // Anti-vacuous guard: 38 admin routes today; a walk that accidentally
  // empties (path change, glob typo) must fail loudly, not pass.
  expect(routes.length).toBeGreaterThanOrEqual(30);

  const missingGuard: string[] = [];
  const missingAuthImport: string[] = [];
  for (const file of routes) {
    const rel = file.slice(ADMIN_API.length + 1);
    const src = readFileSync(file, "utf-8");
    if (!src.includes("requireAdmin(")) missingGuard.push(rel);
    // Every admin route resolves its caller through the shared auth lib
    // (authenticate from app/web-next/lib/auth.ts) before the guard.
    if (!/from "[./]+\/lib\/auth(\.ts)?"/.test(src)) missingAuthImport.push(rel);
  }
  expect(missingGuard.map((f) => `admin route without requireAdmin: ${f}`)).toEqual([]);
  expect(missingAuthImport.map((f) => `admin route without the shared /lib/auth import: ${f}`)).toEqual([]);
});
