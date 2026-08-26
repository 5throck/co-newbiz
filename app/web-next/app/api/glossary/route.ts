// Port of app/server/glossary.ts GET /api/glossary
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";
import { loadGlossary } from "../../../lib/glossary.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const terms = loadGlossary();
  return ok(terms.map((t) => ({ key: t.key, ko: t.ko, en: t.en, category: t.category })), 200, { count: terms.length });
}
