// Port of app/server/glossary.ts GET /api/glossary + admin registration POST
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../lib/envelope.ts";
import { loadGlossary } from "../../../lib/glossary.ts";
import { GlossaryWriteError, registerTerm } from "../../../lib/glossary-write.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const terms = loadGlossary();
  return ok(terms.map((t) => ({ key: t.key, ko: t.ko, en: t.en, category: t.category })), 200, { count: terms.length });
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
    const result = registerTerm({
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
