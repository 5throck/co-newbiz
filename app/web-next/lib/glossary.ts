// Port of app/server/glossary.ts's load/find logic (unchanged) — separated
// from the route handlers so both app/api/glossary/route.ts and
// app/api/glossary/[term]/route.ts share the same in-memory cache.
import { GLOSSARY_TERMS } from "./glossary-data.generated.ts";

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
  source?: string;
}

let cache: GlossaryTerm[] | null = null;

export function loadGlossary(): GlossaryTerm[] {
  if (cache) return cache;
  cache = [...GLOSSARY_TERMS];
  return cache;
}

export function addGlossaryTermToCache(term: GlossaryTerm): void {
  cache = [...loadGlossary().filter((t) => t.key.toLowerCase() !== term.key.toLowerCase()), term];
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
