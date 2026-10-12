#!/usr/bin/env bun
/**
 * @version 1.2.0
 */
// sync-library-projection.ts — refreshes app/web-next/lib/library.generated.ts from
// its source files. SSOT is the source documents (checklists/, procedures/, docs/);
// this script only re-reads them. It refreshes entries that already exist in the
// projection: `content` for every entry, and for checklists also version, item_count
// (LIBRARY_DOCS + LIBRARY_CONTENT) and LIBRARY_CHECKLIST_ITEMS. It never adds or
// removes a document — a new library document still needs its entry added by hand.
// It also embeds the S9 workspace scope overlay (ADR-0160 addendum b,
// checklists/_overlays/greenfield-workspace-scope.yaml) as LIBRARY_WORKSPACE_OVERLAY,
// so an overlay edit without a regenerated projection fails --check.
// v1.2.0 also embeds the brownfield overlay (ADR-0162,
// checklists/_overlays/brownfield-workspace-scope.yaml) as
// LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY under the same drift check.
//
// Usage:
//   bun scripts/co-newbiz/sync-library-projection.ts           # rewrite the projection
//   bun scripts/co-newbiz/sync-library-projection.ts --check   # exit 1 if it is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const ROOT = join(import.meta.dir, "..", "..");
const OUT = join(ROOT, "app", "web-next", "lib", "library.generated.ts");
const CHECK = process.argv.includes("--check");

const normalize = (s: string) => s.replace(/\r\n/g, "\n");

const src = readFileSync(OUT, "utf-8");
const mod = await import(OUT);
const DOCS: any[] = mod.LIBRARY_DOCS;
const CONTENT: Record<string, any> = mod.LIBRARY_CONTENT;
const ITEMS: Record<string, any[]> = mod.LIBRARY_CHECKLIST_ITEMS;

const missing: string[] = [];
for (const [id, entry] of Object.entries(CONTENT)) {
  const path = join(ROOT, entry.file);
  if (!existsSync(path)) {
    missing.push(`${id} (${entry.file})`);
    continue;
  }
  entry.content = readFileSync(path, "utf-8");
}

for (const id of Object.keys(ITEMS)) {
  const entry = CONTENT[id];
  if (!entry || !existsSync(join(ROOT, entry.file))) continue;
  const doc = yaml.load(entry.content) as { version: string; items: Array<Record<string, unknown>> };
  const items = doc.items.map((i) => ({
    id: i.id,
    text: i.text,
    mandatory: i.mandatory,
    waiver_eligible: i.waiver_eligible,
  }));
  ITEMS[id] = items;
  entry.version = doc.version;
  entry.item_count = items.length;
  const summary = DOCS.find((d) => d.id === id);
  if (summary) {
    summary.version = doc.version;
    summary.item_count = items.length;
  }
}

function loadOverlay(name: string): unknown {
  const file = join(ROOT, "checklists", "_overlays", name);
  const doc = existsSync(file) ? yaml.load(readFileSync(file, "utf-8"), { schema: yaml.JSON_SCHEMA }) : null;
  if (!doc) console.warn(`[warn] overlay missing: ${file} (projection carries null — every item applies as-is)`);
  return doc ?? null;
}
const OVERLAY = loadOverlay("greenfield-workspace-scope.yaml");
const BF_OVERLAY = loadOverlay("brownfield-workspace-scope.yaml");

const head = src.slice(0, src.indexOf("export const LIBRARY_DOCS"));
const next =
  head +
  `export const LIBRARY_DOCS: LibraryDocSummary[] = ${JSON.stringify(DOCS, null, 2)};\n\n` +
  `export const LIBRARY_CONTENT: Record<string, LibraryDocContent> = ${JSON.stringify(CONTENT, null, 2)};\n\n` +
  `export const LIBRARY_CHECKLIST_ITEMS: Record<string, ChecklistItemDef[]> = ${JSON.stringify(ITEMS, null, 2)};\n\n` +
  `// Source: checklists/_overlays/greenfield-workspace-scope.yaml (read by lib/greenfield-subtrack.ts; null = no overlay, fail-closed to A).\n` +
  `export const LIBRARY_WORKSPACE_OVERLAY: unknown = ${JSON.stringify(OVERLAY, null, 2)};\n\n` +
  `// Source: checklists/_overlays/brownfield-workspace-scope.yaml (read by lib/brownfield-subtrack.ts; null = no overlay, fail-closed to A).\n` +
  `export const LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY: unknown = ${JSON.stringify(BF_OVERLAY, null, 2)};\n`;

for (const m of missing) console.warn(`[warn] source file missing, entry left as is: ${m}`);

if (normalize(next) === normalize(src)) {
  console.log("library.generated.ts is up to date.");
} else if (CHECK) {
  console.error("library.generated.ts is stale — run: bun scripts/co-newbiz/sync-library-projection.ts");
  process.exit(1);
} else {
  writeFileSync(OUT, next);
  console.log("library.generated.ts refreshed.");
}
