#!/usr/bin/env bun
// @version 1.0.0
/**
 * Shadow-traffic comparator — ADR-0069/0070 Phase 4 (design doc §6).
 *
 * Fires the same GET request at both stacks (Hono, CO_NEWBIZ_API_BASE_URL
 * or localhost:8787 by default; Next.js, SHADOW_NEXT_BASE_URL or
 * localhost:3001) using the same bearer token, and diffs the JSON bodies.
 * Volatile fields (meta.as_of, any ISO timestamp) are normalized before
 * comparing — this tool checks structural/data parity, not wall-clock
 * timing. GET-only by design: Phase 4 is a read-side confidence-building
 * exercise, not a place to double-fire writes against two backends that
 * already share one database (design doc §6 Phase 4).
 *
 * Usage:
 *   CO_NEWBIZ_API_TOKEN=<token> bun scripts/co-newbiz/shadow-compare.ts [--project-id <id>]
 *
 * Exit code 0 if every compared endpoint matches after normalization,
 * 1 if any diverges — suitable for a CI/scheduled-job gate once Phase 4
 * graduates from manual runs to a recurring check.
 */

const HONO_BASE = process.env.CO_NEWBIZ_API_BASE_URL ?? "http://localhost:8787";
const NEXT_BASE = process.env.SHADOW_NEXT_BASE_URL ?? "http://localhost:3001";
const TOKEN = process.env.CO_NEWBIZ_API_TOKEN;

if (!TOKEN) {
  console.error("CO_NEWBIZ_API_TOKEN is required (a write-scoped or read-scoped token — every endpoint here is GET).");
  process.exit(1);
}

const args = process.argv.slice(2);
const projectIdIdx = args.indexOf("--project-id");
const projectId = projectIdIdx >= 0 ? args[projectIdIdx + 1] : null;

interface Endpoint {
  path: string;
  requiresProject?: boolean;
}

// One representative GET per source route file (design doc §4's mapping
// table) — not exhaustive of all 34+ endpoints, but covers every module
// that has its own auth/query logic, so a regression in any shared code
// path (lib/auth.ts, lib/envelope.ts, lib/project-visibility.ts) surfaces
// here regardless of which specific endpoint exercises it.
const ENDPOINTS: Endpoint[] = [
  { path: "/api/projects" },
  { path: "/api/glossary" },
  { path: "/api/series" },
  { path: "/api/data-changes" },
  { path: "/api/assumptions" },
  { path: "/api/watch" },
  { path: "/api/notifications" },
  { path: "/api/interpretations" },
  { path: "/api/portfolio-scorecard" },
  { path: "/api/admin/users" },
  { path: "/api/admin/audit-log" },
  { path: "/api/admin/schedule-jobs" },
  { path: "/api/admin/data-sources" },
  { path: "/api/admin/retention" },
  { path: "/api/projects/:id", requiresProject: true },
  { path: "/api/projects/:id/rag", requiresProject: true },
  { path: "/api/projects/:id/runs", requiresProject: true },
  { path: "/api/projects/:id/dd-findings", requiresProject: true },
  { path: "/api/projects/:id/antitrust", requiresProject: true },
  { path: "/api/projects/:id/incentives", requiresProject: true },
  { path: "/api/projects/:id/liabilities", requiresProject: true },
  { path: "/api/projects/:id/sites", requiresProject: true },
  { path: "/api/projects/:id/partners", requiresProject: true },
  { path: "/api/projects/:id/permits", requiresProject: true },
  { path: "/api/projects/:id/value-chain-links", requiresProject: true },
  { path: "/api/projects/:id/value-chain/topology", requiresProject: true },
  { path: "/api/projects/:id/chain-sensitivities", requiresProject: true },
  { path: "/api/projects/:id/screening-longlist", requiresProject: true },
  { path: "/api/projects/:id/partner-dd-findings", requiresProject: true },
  { path: "/api/projects/:id/pmi/key-talent", requiresProject: true },
  { path: "/api/projects/:id/pmi/synergy-certifications", requiresProject: true },
  { path: "/api/projects/:id/deal-shape-evaluations", requiresProject: true },
  { path: "/api/projects/:id/incentive-deadlines", requiresProject: true },
  { path: "/api/projects/:id/dimension-inputs", requiresProject: true },
  { path: "/api/projects/:id/scorecard", requiresProject: true },
  { path: "/api/projects/:id/members", requiresProject: true },
  { path: "/api/projects/:id/classification", requiresProject: true },
];

// Fields whose values are expected to differ run-to-run (timestamps) or
// carry no comparable content across two independently-computed responses.
const VOLATILE_KEYS = new Set(["as_of"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = normalize(v);
    }
    return out;
  }
  if (typeof value === "string" && ISO_TIMESTAMP.test(value)) return "<timestamp>";
  return value;
}

async function fetchJson(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  let mismatches = 0;
  let compared = 0;
  let skipped = 0;

  for (const ep of ENDPOINTS) {
    if (ep.requiresProject && !projectId) {
      skipped++;
      continue;
    }
    const path = ep.requiresProject ? ep.path.replace(":id", projectId!) : ep.path;
    const [hono, next] = await Promise.all([fetchJson(HONO_BASE, path), fetchJson(NEXT_BASE, path)]);
    compared++;

    const statusMatch = hono.status === next.status;
    const bodyMatch = deepEqual(normalize(hono.body), normalize(next.body));

    if (statusMatch && bodyMatch) {
      console.log(`  OK   ${path} (${hono.status})`);
    } else {
      mismatches++;
      console.log(`  DIFF ${path}`);
      if (!statusMatch) console.log(`       status: hono=${hono.status} next=${next.status}`);
      if (!bodyMatch) {
        console.log(`       hono: ${JSON.stringify(normalize(hono.body)).slice(0, 300)}`);
        console.log(`       next: ${JSON.stringify(normalize(next.body)).slice(0, 300)}`);
      }
    }
  }

  console.log(`\n${compared} compared, ${mismatches} mismatch(es), ${skipped} skipped (need --project-id).`);
  if (mismatches > 0) process.exit(1);
}

main();
