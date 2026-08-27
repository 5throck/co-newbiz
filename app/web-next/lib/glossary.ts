// Port of app/server/glossary.ts's load/find logic (unchanged) — separated
// from the route handlers so both app/api/glossary/route.ts and
// app/api/glossary/[term]/route.ts share the same in-memory cache.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import * as yaml from "js-yaml";

// import.meta.dirname-based, not process.cwd()-based (the original
// approach broke under `bun test`, where cwd is the repo root, not
// app/web-next — same root cause as proc-resolve.ts's ADR-0071/Phase-6
// fix). Falls back to a cwd walk-up if dirname is ever unavailable
// (Turbopack dynamic-import edge case, see proc-resolve.ts's comment).
function findGlossaryDir(): string {
  if (import.meta.dirname) {
    // this file: app/web-next/lib/glossary.ts -> up 3 (lib, web-next, app) to repo root
    return resolvePath(import.meta.dirname, "..", "..", "..", "glossary");
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "glossary");
    if (existsSync(candidate)) return candidate;
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the glossary/ directory from cwd=${process.cwd()} (import.meta.dirname was unavailable).`);
}

export { findGlossaryDir };

export interface GlossaryTerm {
  key: string;
  ko: string;
  en: string;
  definition_ko: string;
  why_it_matters_ko: string;
  category: string;
  aliases?: string[];
  related?: string[];
  used_in?: string[];
  owner?: string;
}

let cache: GlossaryTerm[] | null = null;

export function loadGlossary(): GlossaryTerm[] {
  if (cache) return cache;
  const dir = findGlossaryDir();
  const terms: GlossaryTerm[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const doc = yaml.load(readFileSync(join(dir, file), "utf8")) as
      | { terms?: Record<string, Record<string, unknown>> }
      | undefined;
    for (const [key, raw] of Object.entries(doc?.terms ?? {})) {
      terms.push({
        key,
        ko: String(raw.ko ?? ""),
        en: String(raw.en ?? ""),
        definition_ko: String(raw.definition_ko ?? ""),
        why_it_matters_ko: String(raw.why_it_matters_ko ?? ""),
        category: String(raw.category ?? ""),
        aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : undefined,
        related: Array.isArray(raw.related) ? raw.related.map(String) : undefined,
        used_in: Array.isArray(raw.used_in) ? raw.used_in.map(String) : undefined,
        owner: raw.owner ? String(raw.owner) : undefined,
      });
    }
  }
  cache = terms;
  return terms;
}

export function findTerm(query: string): GlossaryTerm | null {
  const terms = loadGlossary();
  const needle = query.trim().toLowerCase();
  return (
    terms.find((t) => t.key.toLowerCase() === needle) ??
    terms.find((t) => t.en.toLowerCase() === needle) ??
    terms.find((t) => t.ko === query.trim()) ??
    terms.find((t) => t.aliases?.some((a) => a.toLowerCase() === needle)) ??
    null
  );
}

/** Drop the in-memory cache so the next loadGlossary() re-reads the YAML files
 * (called after glossary-write.ts registers a new term). */
export function invalidateGlossaryCache(): void {
  cache = null;
}
