// @version 1.0.0
/**
 * Glossary routes — docs/api-spec.md §7, FR-SYS-04 (Wave 5.6A).
 *
 * One lookup endpoint backing both consumers of the glossary: the UI's
 * dashed-underline tooltip popover and the MCP `lookup_term` tool. Matching
 * is case-insensitive over key / ko / en / aliases. Content is workspace-
 * internal (not project data) but still behind authentication.
 *
 * Term files are loaded once and cached — glossary/*.yaml only changes on
 * deploy, and a tooltip must not parse YAML on every hover.
 */

import { Hono } from "hono";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv } from "./middleware.ts";

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

function loadGlossary(): GlossaryTerm[] {
  if (cache) return cache;
  const dir = join(process.cwd(), "glossary");
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

function findTerm(query: string): GlossaryTerm | null {
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

export const glossaryRoutes = new Hono<AppEnv>();
glossaryRoutes.use("*", requireAuth);

/** GET /api/glossary — all keys (for the UI's term-highlight pass). */
glossaryRoutes.get("/api/glossary", (c) => {
  const terms = loadGlossary();
  return ok(c, terms.map((t) => ({ key: t.key, ko: t.ko, en: t.en, category: t.category })), 200, { count: terms.length });
});

/** GET /api/glossary/:term — key / ko / en / alias lookup for tooltips + MCP. */
glossaryRoutes.get("/api/glossary/:term", (c) => {
  const term = findTerm(decodeURIComponent(c.req.param("term")));
  if (!term) return notFound(c, "Term not found in the glossary.");
  return ok(c, term);
});
