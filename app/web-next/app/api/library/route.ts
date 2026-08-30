// Governance library index (read-only). Surfaces the axis-A artifacts —
// gate checklists, operating manuals, policies/regulations — as UI-reference
// data. GET /api/library lists summaries; GET /api/library/[docId] returns
// the raw document text. Authenticated like every other read route.
import { authenticate } from "../../../lib/auth.ts";
import { listLibrary } from "../../../lib/library.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const docs = listLibrary();
  return ok(docs, 200, {
    count: docs.length,
    checklists: docs.filter((d) => d.category === "checklist").length,
    manuals: docs.filter((d) => d.category === "manual").length,
    policies: docs.filter((d) => d.category === "policy").length,
  });
}
