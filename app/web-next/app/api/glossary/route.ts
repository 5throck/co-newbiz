// Port of app/server/glossary.ts GET /api/glossary + admin registration POST
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../lib/envelope.ts";
import { addGlossaryTermToCache, loadGlossary, type GlossaryTerm } from "../../../lib/glossary.ts";
import { renderGlossaryDataModule } from "../../../lib/glossary-generate.ts";
import { findGlossaryDuplicates, isGlossaryWriteBlocked } from "../../../lib/glossary-form.ts";

class GlossaryWriteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const CATEGORY_FILE: Record<string, string> = {
  business: "business.yaml",
  financial: "financial.yaml",
  legal: "legal.yaml",
  technical: "technical.yaml",
  industry: "industry.yaml",
  unit: "technical.yaml",
};

async function registerTermRuntime(input: {
  key: string;
  ko: string;
  en: string;
  definition_ko: string;
  why_it_matters_ko: string;
  category: string;
  owner: string;
  aliases?: string[];
}): Promise<{ key: string; file: string; regenerated: boolean }> {
  const key = input.key.trim();
  if (!key) throw new GlossaryWriteError("invalid_request", "key is required.");
  // Input caps (AI-2nd review): oversized payloads and odd characters never
  // reach the YAML files. Key charset mirrors the existing keys (Latin words,
  // acronyms with -_+, Hangul keys like 인도) per glossary/_schema.yaml naming.
  const KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _+-]*$/u;
  const MAX_FIELD_LENGTH = 2000;
  if (!KEY_PATTERN.test(key)) {
    throw new GlossaryWriteError("invalid_request", "key must start with a letter or digit and use only letters, digits, spaces, and _ + -.");
  }
  for (const [field, value] of Object.entries({ ko: input.ko, en: input.en, definition_ko: input.definition_ko, why_it_matters_ko: input.why_it_matters_ko, owner: input.owner })) {
    if (value.length > MAX_FIELD_LENGTH) {
      throw new GlossaryWriteError("invalid_request", `${field} must be at most ${MAX_FIELD_LENGTH} characters.`);
    }
  }
  if ((input.aliases?.length ?? 0) > 20) {
    throw new GlossaryWriteError("invalid_request", "at most 20 aliases are allowed.");
  }
  if (!input.ko.trim() || !input.en.trim() || !input.definition_ko.trim()) {
    throw new GlossaryWriteError("invalid_request", "ko, en, and definition_ko are required.");
  }
  if (!input.why_it_matters_ko.trim()) {
    throw new GlossaryWriteError("why_it_matters_required", "why_it_matters_ko is required (a definition alone does not say why the term matters here).");
  }
  const file = CATEGORY_FILE[input.category.trim()];
  if (!file) throw new GlossaryWriteError("invalid_category", `category must be one of ${Object.keys(CATEGORY_FILE).join(", ")}.`);
  // Server-side repeat of the client duplicate check (spec §5.3): keys, ko/en
  // terms and aliases, case- and space-insensitive.
  const existing = loadGlossary();
  const dupHits = findGlossaryDuplicates(
    { key, ko: input.ko, en: input.en, aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean) },
    existing,
  );
  if (dupHits.length > 0) {
    const detail = dupHits
      .map((d) => `${d.field} '${d.value}' clashes with existing term '${d.entryKey}' (${d.entryField})`)
      .join("; ");
    throw new GlossaryWriteError("duplicate_term", `Duplicate glossary identity: ${detail}. Merge into the existing term instead of re-registering.`);
  }

  const importRuntime = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const fs = await importRuntime("node:fs");
  const path = await importRuntime("node:path");
  const yaml = await importRuntime("js-yaml");

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "glossary");
    if (fs.existsSync(candidate)) {
      dir = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const entry: Omit<GlossaryTerm, "key"> = {
    ko: input.ko.trim(),
    en: input.en.trim(),
    definition_ko: input.definition_ko.trim(),
    why_it_matters_ko: input.why_it_matters_ko.trim(),
    category: input.category.trim(),
    owner: input.owner.trim() || "glossary-curator",
    ...(input.aliases?.length ? { aliases: input.aliases.map((a) => a.trim()).filter(Boolean) } : {}),
  };
  const fullPath = path.join(dir, file);
  if (fs.existsSync(fullPath)) {
    // JSON_SCHEMA on both directions so a numeric-looking string round-trips
    // identically (the generator reads the same files with JSON_SCHEMA).
    const doc = yaml.load(fs.readFileSync(fullPath, "utf8"), { schema: yaml.JSON_SCHEMA }) as { version?: string; last_updated?: string; terms?: Record<string, unknown> } | null;
    fs.writeFileSync(fullPath, yaml.dump({ ...(doc ?? {}), last_updated: new Date().toISOString().slice(0, 10), terms: { ...(doc?.terms ?? {}), [key]: entry } }, { lineWidth: 120, schema: yaml.JSON_SCHEMA }), "utf8");
  } else {
    fs.appendFileSync(fullPath, yaml.dump({ version: "1.0.0", last_updated: new Date().toISOString().slice(0, 10), terms: { [key]: entry } }, { lineWidth: 120, schema: yaml.JSON_SCHEMA }), "utf8");
  }
  addGlossaryTermToCache({ key, ...entry });

  // Regenerate the static projection (same output as `bun run glossary:generate`)
  // so the UI tooltip, /api/glossary and MCP lookup_term pick the term up. Only
  // possible where the source tree exists (dev/local); deployed builds never get
  // here. A regeneration failure must NOT skip the audit row — the YAML write
  // already happened, so the failure is swallowed and reported as regenerated:
  // false for the operator to re-run `bun run glossary:generate`.
  const generatedPath = path.join(path.dirname(dir), "app", "web-next", "lib", "glossary-data.generated.ts");
  let regenerated = false;
  if (fs.existsSync(generatedPath)) {
    try {
      const all: Array<Record<string, unknown>> = [];
      for (const f of (fs.readdirSync(dir) as string[]).filter((n) => n.endsWith(".yaml") && !n.startsWith("_")).sort()) {
        const parsed = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"), { schema: yaml.JSON_SCHEMA }) as { terms?: Record<string, Record<string, unknown>> } | null;
        for (const [k, v] of Object.entries(parsed?.terms ?? {})) all.push({ key: k, ...v });
      }
      fs.writeFileSync(generatedPath, renderGlossaryDataModule(all), "utf8");
      regenerated = true;
    } catch (err) {
      console.error("[glossary] generated-module regeneration failed after a successful YAML write; run `bun run glossary:generate`.", err);
    }
  }
  return { key, file, regenerated };
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const terms = loadGlossary();
  return ok(terms.map((t) => ({ key: t.key, ko: t.ko, en: t.en, category: t.category, aliases: t.aliases ?? [] })), 200, {
    count: terms.length,
    writable: !isGlossaryWriteBlocked(),
  });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role !== "admin") {
    return forbidden("role_required", "Glossary registration is an admin operation (glossary-curator review applies).");
  }
  if (isGlossaryWriteBlocked()) {
    return forbidden("glossary_write_disabled", "Glossary terms are added through the repository in a deployed build; registration is disabled here.");
  }
  const body = (await request.json().catch(() => null)) as
    | {
      key?: string;
      ko?: string;
      en?: string;
      definition_ko?: string;
      why_it_matters_ko?: string;
      category?: string;
      owner?: string;
      aliases?: string[];
    }
    | null;
  try {
    const result = await registerTermRuntime({
      key: body?.key ?? "",
      ko: body?.ko ?? "",
      en: body?.en ?? "",
      definition_ko: body?.definition_ko ?? "",
      why_it_matters_ko: body?.why_it_matters_ko ?? "",
      category: body?.category ?? "",
      owner: body?.owner ?? "",
      aliases: Array.isArray(body?.aliases) ? body.aliases : undefined,
    });
    appendAudit(getDb(), { actor: auth.auth.userId, action: "glossary_register", target: result.key, now: new Date().toISOString() });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof GlossaryWriteError) {
      return badRequest(err.code, err.message);
    }
    return badRequest("glossary_write_failed", err instanceof Error ? err.message : "Glossary registration failed.");
  }
}
