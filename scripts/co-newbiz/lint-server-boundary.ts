#!/usr/bin/env bun
// @version 1.1.0
/**
 * ADR-0070 Decision boundary check — the mechanical guard the ADR called
 * for and that was accepted (2026-08-26) with this exact gap open: without
 * it, ADR-0070's "single enforcement point" guarantee rests on convention
 * alone, which is the same failure mode ADR-0011 was originally written to
 * make architecturally impossible (see docs/adr/0070-mcp-enforcement-point-under-nextjs.md).
 *
 * v1.1.0 (DEC-20261122-01, ADR-0070 amendment): the gate is re-homed as a
 * BLOCKING check in scripts/co-newbiz/audit-variant.ts (the original
 * scripts/audit.ts wiring of audit.ts 2.15.0 was silently destroyed by the
 * 2026-08-29 upgrade wave 4d6793e6; Core Script Standardization forbids
 * re-wiring it there) and Rule 2 moves from zero-violation to ALLOWLIST
 * mode: ADR-0070's boundary is amended to sanction exactly one enumerated,
 * read-only, session-gated, SQL-identical class of page-layer data access —
 * the five carrier flat-route pages over the pre-project opportunity
 * registry (review finding F-1 / PR #862). Server Actions remain
 * prohibited absolutely (Rule 1 unchanged).
 *
 * Two rules, both over app/web-next/**\/*.{ts,tsx}:
 *   1. A file with a `"use server"` directive must not import the Prisma
 *      client (or db/client.ts's bun:sqlite handle, or db/lib|repositories
 *      — the same actual data-access surface, whichever ORM/driver a file
 *      happens to reach for). Server Actions calling into data access is
 *      exactly the bypass path ADR-0070 §Decision-1 prohibits.
 *      ABSOLUTE — the allowlist does not apply to this rule.
 *   2. A file under app/web-next/app/** (the App Router tree — page.tsx,
 *      layout.tsx, and every route.ts) that imports the Prisma client (or
 *      db/client.ts, db/lib/*, db/repositories/*) must live specifically
 *      under app/api/** — UNLESS the file is in SANCTIONED_PAGE_ALLOWLIST
 *      (exactly the five carrier flat-route pages) AND every data-access
 *      import in it belongs to the frozen module set {db/client.ts (getDb),
 *      lib/carrier-resolve.ts, lib/rsc-session.ts} — any db/lib/**,
 *      db/repositories/**, or @prisma/client import in an allowlisted page
 *      is a violation — AND the file contains no write-SQL shape (INSERT
 *      INTO / UPDATE␠ / DELETE FROM / PRAGMA / ATTACH). A data-access
 *      import in app/web-next/app/** outside app/api/** from a file not in
 *      the allowlist remains a violation. Growing the allowlist or the
 *      module set requires a recorded DEC (docs/decisions/); removal is the
 *      revert path.
 *
 * Not a Next.js/ESLint plugin (no ESLint config exists in app/web-next yet
 * — see this file's own commit for why a standalone script was chosen
 * over standing up a full ESLint toolchain for one rule). Blocking wiring:
 * scripts/co-newbiz/audit-variant.ts (spawned by scripts/audit.ts §27 —
 * exit non-zero maps to a Fail), per DEC-20261122-01 gate re-homing.
 *
 * Usage: bun scripts/co-newbiz/lint-server-boundary.ts
 * Exit 0 = clean, 1 = violations found (printed to stderr).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB_NEXT_ROOT = join(import.meta.dirname, "..", "..", "app", "web-next");

const DATA_ACCESS_IMPORT_RE =
  /from\s+["']([^"']*(?:@prisma\/client|\/db\/client\.ts|\/db\/lib\/|\/db\/repositories\/)[^"']*)["']/g;
const USE_SERVER_RE = /^\s*["']use server["']\s*;?\s*$/m;
/** Any `lib/**` import — allowlisted pages may only import the frozen lib modules. */
const LIB_IMPORT_RE = /from\s+["'][^"']*\/lib\/([^"']+)["']/g;
/** Write-SQL shapes — the sanctioned class is read-only (DEC CR-4). */
const WRITE_SQL_RE = /\b(INSERT\s+INTO|UPDATE\s|DELETE\s+FROM|PRAGMA|ATTACH)\b/;

/**
 * The closed allowlist (DEC-20261122-01 Determination 2): exactly the five
 * carrier flat-route pages, each resolving the pre-project opportunity
 * registry through resolveCarriers() behind getRscSession(). Growing this
 * list or the frozen module set requires a recorded DEC.
 */
const SANCTIONED_PAGE_ALLOWLIST: ReadonlySet<string> = new Set([
  "app/market/page.tsx",
  "app/opportunities/page.tsx",
  "app/synergy/page.tsx",
  "app/greenfield/page.tsx",
  "app/brownfield/page.tsx",
]);

/**
 * The frozen module set (DEC-20261122-01): the only modules an allowlisted
 * page may reach data access through — getDb (db/client.ts) for the read
 * handle, carrier-resolve/rsc-session for the sanctioned query + session
 * gate. db/lib/**, db/repositories/**, and @prisma/client are outside it
 * by definition (the write/audit engine must never enter the page layer).
 */
const FROZEN_LIB_MODULES: ReadonlySet<string> = new Set(["carrier-resolve.ts", "rsc-session.ts"]);

interface Violation {
  file: string;
  rule: "server-action-data-access" | "data-access-outside-api" | "allowlist-frozen-module-set" | "allowlist-write-sql";
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
    const dataAccessImports = [...source.matchAll(DATA_ACCESS_IMPORT_RE)].map((m) => m[1]);
    const hasUseServer = USE_SERVER_RE.test(source);

    if (hasUseServer && dataAccessImports.length > 0) {
      violations.push({
        file: relPath,
        rule: "server-action-data-access",
        detail: `"use server" file also imports data access (${dataAccessImports.join(", ")}) — Server Actions must never touch the database (ADR-0070 Decision 1).`,
      });
    }

    // Rule 2 only applies inside the App Router tree (pages/layouts/route
    // handlers) — app/web-next/lib/** and app/web-next/components/** are
    // shared server-only implementation code for that tree, not part of
    // it, and legitimately import data access (see the header comment).
    if (dataAccessImports.length > 0 && relPath.startsWith("app/")) {
      const isUnderApi = relPath.startsWith("app/api/");
      const allowlisted = SANCTIONED_PAGE_ALLOWLIST.has(relPath);
      if (!isUnderApi && !allowlisted) {
        violations.push({
          file: relPath,
          rule: "data-access-outside-api",
          detail: `imports data access (${dataAccessImports.join(", ")}) from a page/layout outside app/api/** — Route Handlers are the sole ADR-0070-equivalent boundary; a page/layout must fetch through them, not query data directly (allowlist per DEC-20261122-01 covers only the five carrier pages).`,
        });
      } else if (!isUnderApi && allowlisted) {
        // Allowlist constraints: frozen module set + read-only shapes.
        // db/client.ts (getDb) is the only data-access import allowed; any
        // db/lib/**, db/repositories/**, or @prisma/client import here is a
        // violation even though the file itself is allowlisted.
        const outsideFrozen = dataAccessImports.filter((spec) => !/\/db\/client\.ts/.test(spec));
        if (outsideFrozen.length > 0) {
          violations.push({
            file: relPath,
            rule: "allowlist-frozen-module-set",
            detail: `allowlisted page imports data access outside the frozen module set (${outsideFrozen.join(", ")}) — only db/client.ts (getDb), lib/carrier-resolve.ts, lib/rsc-session.ts are sanctioned (DEC-20261122-01).`,
          });
        }
        for (const m of [...source.matchAll(LIB_IMPORT_RE)]) {
          const base = m[1].split("/").pop() ?? m[1];
          if (!FROZEN_LIB_MODULES.has(base)) {
            violations.push({
              file: relPath,
              rule: "allowlist-frozen-module-set",
              detail: `allowlisted page imports a non-frozen lib module (lib/${m[1]}) — the frozen module set is {lib/carrier-resolve.ts, lib/rsc-session.ts} (DEC-20261122-01).`,
            });
          }
        }
        const writeShape = WRITE_SQL_RE.exec(source);
        if (writeShape) {
          violations.push({
            file: relPath,
            rule: "allowlist-write-sql",
            detail: `allowlisted page carries a write-SQL shape (${writeShape[0].trim()}) — the sanctioned class is read-only (DEC-20261122-01 CR-4).`,
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `[PASS] ADR-0070 boundary check (allowlist mode, DEC-20261122-01): ${files.length} file(s) scanned under app/web-next, ${SANCTIONED_PAGE_ALLOWLIST.size} sanctioned page(s), 0 violations.`,
    );
    return;
  }

  console.error(
    `[FAIL] ADR-0070 boundary check: ${violations.length} violation(s) across ${files.length} file(s) scanned.\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}\n    [${v.rule}] ${v.detail}`);
  }
  process.exit(1);
}

main();
