// Glossary registration write path — backs POST /api/glossary (admin 콘솔
// 용어집 관리 섹션의 등록 워크플로). Terms live in glossary/*.yaml (the
// curated SSOT loaded by glossary.ts), so registration appends the new term
// to the file matching its category and drops the read cache.
//
// Schema contract: glossary/_schema.yaml — ko/en/definition_ko/
// why_it_matters_ko/category/owner are the required fields (why_it_matters_ko
// is the project-specific "so what" that _validate.ts enforces on the files).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { findGlossaryDir, invalidateGlossaryCache, loadGlossary } from "./glossary.ts";

export class GlossaryWriteError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Category enum per glossary/_schema.yaml; `unit` has no dedicated file yet,
// so unit terms land in technical.yaml (system/technical vocabulary file).
const CATEGORY_FILE: Record<string, string> = {
  business: "business.yaml",
  financial: "financial.yaml",
  legal: "legal.yaml",
  technical: "technical.yaml",
  industry: "industry.yaml",
  unit: "technical.yaml",
};

export interface RegisterTermInput {
  key: string;
  ko: string;
  en: string;
  definition_ko: string;
  why_it_matters_ko: string;
  category: string;
  owner: string;
  aliases?: string[];
}

export function registerTerm(input: RegisterTermInput): { key: string; file: string } {
  const key = input.key.trim();
  if (!key) throw new GlossaryWriteError("invalid_request", "key is required.");
  if (!input.ko.trim() || !input.en.trim() || !input.definition_ko.trim()) {
    throw new GlossaryWriteError("invalid_request", "ko, en, and definition_ko are required.");
  }
  // why_it_matters_ko is the schema's whole point — a definition without a
  // project-specific rationale is exactly what _schema.yaml rejects.
  if (!input.why_it_matters_ko.trim()) {
    throw new GlossaryWriteError("why_it_matters_required", "why_it_matters_ko is required (a definition alone does not say why the term matters here).");
  }
  const file = CATEGORY_FILE[input.category.trim()];
  if (!file) {
    throw new GlossaryWriteError("invalid_category", `category must be one of ${Object.keys(CATEGORY_FILE).join(", ")}.`);
  }
  if (loadGlossary().some((t) => t.key.toLowerCase() === key.toLowerCase())) {
    throw new GlossaryWriteError("duplicate_term", `A term with key '${key}' already exists (merge duplicates instead of re-registering).`);
  }

  const entry: Record<string, unknown> = {
    ko: input.ko.trim(),
    en: input.en.trim(),
    definition_ko: input.definition_ko.trim(),
    why_it_matters_ko: input.why_it_matters_ko.trim(),
    category: input.category.trim(),
    owner: input.owner.trim() || "glossary-curator",
  };
  if (input.aliases?.length) entry.aliases = input.aliases.map((a) => a.trim()).filter(Boolean);

  const path = join(findGlossaryDir(), file);
  if (existsSync(path)) {
    const doc = yaml.load(readFileSync(path, "utf8")) as { version?: string; last_updated?: string; terms?: Record<string, unknown> } | null;
    const terms = doc?.terms ?? {};
    terms[key] = entry;
    writeFileSync(
      path,
      yaml.dump({ ...(doc ?? {}), last_updated: new Date().toISOString().slice(0, 10), terms }, { lineWidth: 120 }),
      "utf8",
    );
  } else {
    // First term in a new category file — create it with the standard header.
    const header = { version: "1.0.0", last_updated: new Date().toISOString().slice(0, 10), terms: { [key]: entry } };
    appendFileSync(path, yaml.dump(header, { lineWidth: 120 }), "utf8");
  }
  invalidateGlossaryCache();
  return { key, file };
}
