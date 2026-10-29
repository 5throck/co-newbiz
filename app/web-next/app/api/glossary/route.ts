// Port of app/server/glossary.ts GET /api/glossary + admin registration POST
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../lib/envelope.ts";
import { addGlossaryTermToCache, loadGlossary, type GlossaryTerm } from "../../../lib/glossary.ts";

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
}): Promise<{ key: string; file: string }> {
  const key = input.key.trim();
  if (!key) throw new GlossaryWriteError("invalid_request", "key is required.");
  if (!input.ko.trim() || !input.en.trim() || !input.definition_ko.trim()) {
    throw new GlossaryWriteError("invalid_request", "ko, en, and definition_ko are required.");
  }
  if (!input.why_it_matters_ko.trim()) {
    throw new GlossaryWriteError("why_it_matters_required", "why_it_matters_ko is required (a definition alone does not say why the term matters here).");
  }
  const file = CATEGORY_FILE[input.category.trim()];
  if (!file) throw new GlossaryWriteError("invalid_category", `category must be one of ${Object.keys(CATEGORY_FILE).join(", ")}.`);
  if (loadGlossary().some((t) => t.key.toLowerCase() === key.toLowerCase())) {
    throw new GlossaryWriteError("duplicate_term", `A term with key '${key}' already exists (merge duplicates instead of re-registering).`);
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
    const doc = yaml.load(fs.readFileSync(fullPath, "utf8")) as { version?: string; last_updated?: string; terms?: Record<string, unknown> } | null;
    fs.writeFileSync(fullPath, yaml.dump({ ...(doc ?? {}), last_updated: new Date().toISOString().slice(0, 10), terms: { ...(doc?.terms ?? {}), [key]: entry } }, { lineWidth: 120 }), "utf8");
  } else {
    fs.appendFileSync(fullPath, yaml.dump({ version: "1.0.0", last_updated: new Date().toISOString().slice(0, 10), terms: { [key]: entry } }, { lineWidth: 120 }), "utf8");
  }
  addGlossaryTermToCache({ key, ...entry });
  return { key, file };
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const terms = loadGlossary();
  return ok(terms.map((t) => ({ key: t.key, ko: t.ko, en: t.en, category: t.category, aliases: t.aliases ?? [] })), 200, { count: terms.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role !== "admin") {
    return forbidden("role_required", "Glossary registration is an admin operation (glossary-curator review applies).");
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
