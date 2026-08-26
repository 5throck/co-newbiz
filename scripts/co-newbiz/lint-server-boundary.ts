#!/usr/bin/env bun
// @version 1.0.0
/**
 * ADR-0070 Decision boundary check — the mechanical guard the ADR called
 * for and that was accepted (2026-08-26) with this exact gap open: without
 * it, ADR-0070's "single enforcement point" guarantee rests on convention
 * alone, which is the same failure mode ADR-0011 was originally written to
 * make architecturally impossible (see docs/adr/0070-mcp-enforcement-point-under-nextjs.md).
 *
 * Two rules, both over app/web-next/**\/*.{ts,tsx}:
 *   1. A file with a `"use server"` directive must not import the Prisma
 *      client (or db/client.ts's bun:sqlite handle, or db/lib|repositories
 *      — the same actual data-access surface, whichever ORM/driver a file
 *      happens to reach for). Server Actions calling into data access is
 *      exactly the bypass path ADR-0070 §Decision-1 prohibits.
 *   2. A file under app/web-next/app/** (the App Router tree — page.tsx,
 *      layout.tsx, and every route.ts) that imports the Prisma client (or
 *      db/client.ts, db/lib/*, db/repositories/*) must live specifically
 *      under app/api/** — a page or layout doing its own direct data
 *      access, bypassing the Route Handler layer entirely, is the same
 *      "two divergent code paths to the same data" risk ADR-0011
 *      originally existed to prevent (a web-session request and an MCP
 *      request must hit the identical enforcement point). Deliberately
 *      scoped to app/web-next/app/** only: app/web-next/lib/** (e.g.
 *      lib/auth.ts, lib/project-visibility.ts) and app/web-next/components/**
 *      are shared implementation code for the Route Handler layer itself —
 *      always invoked FROM inside app/api/**, never reachable any other
 *      way — and are expected to import data access; flagging them would
 *      be a false positive, not a real boundary violation.
 *
 * Not a Next.js/ESLint plugin (no ESLint config exists in app/web-next yet
 * — see this file's own commit for why a standalone script was chosen
 * over standing up a full ESLint toolchain for one rule). Wire into CI /
 * scripts/audit.ts as a follow-up once this has run clean for a while;
 * shipped standalone first so it does not become a second thing blocking
 * on the first.
 *
 * Usage: bun scripts/co-newbiz/lint-server-boundary.ts
 * Exit 0 = clean, 1 = violations found (printed to stderr).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB_NEXT_ROOT = join(import.meta.dirname, "..", "..", "app", "web-next");

const DATA_ACCESS_IMPORT_RE = /from\s+["']([^"']*(?:@prisma\/client|\/db\/client\.ts|\/db\/lib\/|\/db\/repositories\/)[^"']*)["']/;
const USE_SERVER_RE = /^\s*["']use server["']\s*;?\s*$/m;

interface Violation {
  file: string;
  rule: "server-action-data-access" | "data-access-outside-api";
  detail: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
}

function main(): void {
  const files: string[] = [];
  walk(WEB_NEXT_ROOT, files);

  const violations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const relPath = relative(WEB_NEXT_ROOT, file).split(sep).join("/");
    const importMatch = DATA_ACCESS_IMPORT_RE.exec(source);
    const hasUseServer = USE_SERVER_RE.test(source);

    if (hasUseServer && importMatch) {
      violations.push({
        file: relPath,
        rule: "server-action-data-access",
        detail: `"use server" file also imports data access (${importMatch[1]}) — Server Actions must never touch the database (ADR-0070 Decision 1).`,
      });
    }

    // Rule 2 only applies inside the App Router tree (pages/layouts/route
    // handlers) — app/web-next/lib/** and app/web-next/components/** are
    // shared server-only implementation code for that tree, not part of
    // it, and legitimately import data access (see the header comment).
    if (importMatch && relPath.startsWith("app/")) {
      const isUnderApi = relPath.startsWith("app/api/");
      if (!isUnderApi) {
        violations.push({
          file: relPath,
          rule: "data-access-outside-api",
          detail: `imports data access (${importMatch[1]}) from a page/layout outside app/api/** — Route Handlers are the sole ADR-0070-equivalent boundary; a page/layout must fetch through them, not query data directly.`,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(`[PASS] ADR-0070 boundary check: ${files.length} file(s) scanned under app/web-next, 0 violations.`);
    return;
  }

  console.error(`[FAIL] ADR-0070 boundary check: ${violations.length} violation(s) across ${files.length} file(s) scanned.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}\n    [${v.rule}] ${v.detail}`);
  }
  process.exit(1);
}

main();
