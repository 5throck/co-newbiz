// @version 1.0.0
/**
 * Landing resolution for the `/` redirect stub (ADR-0091 role–screen
 * split, 2026-11-27).
 *
 * Two layers, matching the carrier-resolve test's shape:
 *   1. resolveLandingPath — the full role → landing mapping. The auth
 *      model (db/lib/accounts.ts UserRole) has exactly three roles:
 *      "admin" | "analyst" | "viewer". There is NO read_only_admin role
 *      in the model, and /admin/** is guarded by AdminGuard to exactly
 *      role === "admin" (a viewer opening /admin gets an in-place
 *      access-denied page, not a redirect) — so admin is the single
 *      admin-console role and the mapping is one equality. A null role
 *      (unauthenticated visit) keeps the pre-2026-11-27 behaviour:
 *      /deals, which runs its own unauthenticated gate.
 *   2. Static page contract — app/page.tsx must stay a server component
 *      that resolves the RSC session and redirects (the redirect fires
 *      before any HTML is served); a stray "use client" would serve a
 *      flash of the wrong screen. Deep links (`next`) never reach `/` —
 *      the login page pushes to `next` before the fallback `/` — so the
 *      helper takes no `next` and the login flow is untouched.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveLandingPath } from "../../app/web-next/lib/landing.ts";
import type { UserRole } from "../../db/lib/accounts.ts";

describe("resolveLandingPath", () => {
  test("admin → /admin (시스템 대시보드 is the admin landing screen, ADR-0091)", () => {
    expect(resolveLandingPath("admin")).toBe("/admin");
  });

  test("analyst → /deals (검토/안건 보드 landing unchanged)", () => {
    expect(resolveLandingPath("analyst")).toBe("/deals");
  });

  test("viewer → /deals (viewer cannot open /admin at all — AdminGuard denies in place)", () => {
    expect(resolveLandingPath("viewer")).toBe("/deals");
  });

  test("null (unauthenticated) → /deals — the pre-2026-11-27 behaviour is preserved", () => {
    expect(resolveLandingPath(null)).toBe("/deals");
  });

  test("exhaustive over the UserRole union: admin is the ONLY role landing on /admin", () => {
    // UserRole is "admin" | "analyst" | "viewer" (db/lib/accounts.ts:38).
    // If a role is ever added (e.g. a hypothetical read_only_admin), this
    // table must be revisited explicitly — landing is a product decision,
    // not a default.
    const allRoles: UserRole[] = ["admin", "analyst", "viewer"];
    const landing = Object.fromEntries(allRoles.map((r) => [r, resolveLandingPath(r)]));
    expect(landing).toEqual({ admin: "/admin", analyst: "/deals", viewer: "/deals" });
  });
});

describe("root page contract (app/page.tsx)", () => {
  const source = readFileSync(new URL("../../app/web-next/app/page.tsx", import.meta.url), "utf8");

  test("stays a server component — no 'use client'", () => {
    expect(source.includes('"use client"')).toBe(false);
  });

  test("resolves the RSC session and redirects through resolveLandingPath", () => {
    expect(source.includes("getRscSession")).toBe(true);
    expect(source.includes("resolveLandingPath")).toBe(true);
    expect(source.includes("redirect(")).toBe(true);
  });
});
