// Governance library index (read-only). Surfaces every documentation
// artifact — policies, procedures, checklists, manuals, reference docs,
// templates, design guide, DD methodology — as the single UI-reference
// surface (ADR-0108). GET /api/library lists summaries; GET
// /api/library/[docId] returns the raw document text. Authenticated like
// every other read route.
import { authenticate } from "../../../lib/auth.ts";
import { listLibrary, type LibraryCategory } from "../../../lib/library.ts";
import { ok } from "../../../lib/envelope.ts";

const CATEGORIES: LibraryCategory[] = ["checklist", "manual", "policy", "procedure", "reference", "template", "design", "dd"];

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const docs = listLibrary();
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, docs.filter((d) => d.category === c).length]),
  );
  return ok(docs, 200, { count: docs.length, ...byCategory });
}
