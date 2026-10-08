// @version 1.0.0
/**
 * inventory.ts — LLM call-site inventory check (Wave B-2, design §11).
 *
 * Scans app/web-next for direct calls to the lib/llm.ts entry points and
 * compares them with tests/eval/call-sites.yaml. A call site passes only when
 * its file is mapped to an eval suite, or carries an explicit exemption with a
 * reason. A new call site (more sites in a file than recorded, or an unlisted
 * file) fails; so does a stale entry whose file no longer calls the LLM.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { z } from "zod";
import { ROOT } from "./loader.ts";

export const WEB_DIR = join(ROOT, "app", "web-next");
export const INVENTORY_FILE = join(ROOT, "tests", "eval", "call-sites.yaml");
export const SUITE_NAMES = ["rag", "kill", "antitrust", "review-ai2", "stage-reco", "committee", "dd-tailor", "business-case"] as const;

const CALL_RE = /(^|[^.\w])(complete|completeOrFallback|completeStructured|completeDetailed)\(/g;
const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "__tests__"]);

const Entry = z
  .object({
    file: z.string(),
    sites: z.number().int().positive(),
    suites: z.array(z.enum(SUITE_NAMES)).optional(),
    exempt: z.string().min(10).optional(),
    /** B-1 JSON-parsing call sites: why they still parse JSON by hand (migration to completeStructured deferred). */
    json_parse_migration: z.string().min(10).optional(),
  })
  .strict()
  .refine((e) => (e.suites?.length ?? 0) > 0 !== (e.exempt !== undefined), "exactly one of suites / exempt");
const InventoryFile = z.object({ call_sites: z.array(Entry) }).strict();
export type InventoryEntry = z.infer<typeof Entry>;

function walk(dir: string, out: string[]): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) walk(join(dir, d.name), out);
    } else if (/\.tsx?$/.test(d.name) && !/\.(test|spec)\.tsx?$/.test(d.name) && !d.name.endsWith(".d.ts")) out.push(join(dir, d.name));
  }
}

/** file (repo-relative) → number of direct call sites. lib/llm.ts itself is the implementation and is excluded. */
export function scanCallSites(webDir: string = WEB_DIR): Map<string, number> {
  const files: string[] = [];
  walk(webDir, files);
  const found = new Map<string, number>();
  for (const f of files.sort()) {
    const rel = relative(ROOT, f);
    if (rel === "app/web-next/lib/llm.ts") continue;
    const src = readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const n = [...src.matchAll(CALL_RE)].length;
    if (n > 0) found.set(rel, n);
  }
  return found;
}

export function readInventory(file: string = INVENTORY_FILE): InventoryEntry[] {
  return existsSync(file) ? InventoryFile.parse(yamlLoad(readFileSync(file, "utf-8"))).call_sites : [];
}

/** Returns human-readable problems; empty = inventory is complete. */
export function checkInventory(found: Map<string, number> = scanCallSites(), entries: InventoryEntry[] = readInventory()): string[] {
  const problems: string[] = [];
  const byFile = new Map(entries.map((e) => [e.file, e]));
  for (const [file, n] of found) {
    const e = byFile.get(file);
    if (!e) problems.push(`${file}: ${n} LLM call site(s) with no eval suite and no exemption — add it to tests/eval/call-sites.yaml`);
    else if (e.sites !== n) problems.push(`${file}: ${n} call site(s) found, inventory records ${e.sites} — a call site was added or removed; map it to a suite or exempt it`);
  }
  for (const e of entries) if (!found.has(e.file)) problems.push(`${e.file}: inventory entry is stale (no LLM call site in the file)`);
  return problems;
}

if (import.meta.main) {
  const problems = checkInventory();
  if (problems.length > 0) {
    console.error(`LLM call-site inventory FAILED:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`LLM call-site inventory OK (${scanCallSites().size} files).`);
}
