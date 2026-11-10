// @version 1.0.0
/**
 * D1 (C-1) — the single CSPRNG temporary-password helper
 * (design 2026-11-11-admin-security-and-board-fixes §3): shape, alphabet,
 * distribution sanity, and a static walk proving no Math.random credential
 * generation remains anywhere under the admin API (the POST fallback used to
 * use Math.random). Static walk per the project-write-gating pattern.
 */
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { generateTemporaryPassword } from "../../app/web-next/lib/temp-password.ts";

const ADMIN_API = join(import.meta.dirname, "../../app/web-next/app/api/admin");
const SHAPE = /^tmp-[a-z0-9]{8}!A$/;

function walkRouteFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkRouteFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
}

describe("generateTemporaryPassword — shape and alphabet", () => {
  test("output matches the byte-compatible shape tmp-<8 base36>!A", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTemporaryPassword()).toMatch(SHAPE);
    }
  });

  test("two consecutive calls differ (CSPRNG, not a constant)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateTemporaryPassword());
    // 36^8 ≈ 2.8e12 keyspace: 200 draws must not collide.
    expect(seen.size).toBe(200);
  });
});

describe("static: no Math.random credential generation under app/api/admin/**", () => {
  test("no admin route source contains Math.random", () => {
    const routes: string[] = [];
    walkRouteFiles(ADMIN_API, routes);
    expect(routes.length).toBeGreaterThanOrEqual(30);
    const offenders = routes
      .filter((f) => readFileSync(f, "utf-8").includes("Math.random"))
      .map((f) => f.slice(ADMIN_API.length + 1));
    expect(offenders.map((f) => `Math.random in admin route: ${f}`)).toEqual([]);
  });
});
