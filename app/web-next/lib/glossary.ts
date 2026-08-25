// Port of app/server/glossary.ts's load/find logic (unchanged) — separated
// from the route handlers so both app/api/glossary/route.ts and
// app/api/glossary/[term]/route.ts share the same in-memory cache.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

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
  // process.cwd() is app/web-next when run via `next dev`/`next start` from
  // that directory — glossary/ lives two levels up, at the repo root, same
  // relative relationship app/server has via its own process.cwd().
  const dir = join(process.cwd(), "..", "..", "glossary");
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
