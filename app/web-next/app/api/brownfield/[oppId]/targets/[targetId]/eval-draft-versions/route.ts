// GET /api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions?category=&limit=&include=payload — draft versions of
// one candidate, newest first (`versions[0]` = latest per category, the S1 shape), each with `confirmed_count` = the
// verdicts that cite it (ADR-0199 A5). `include=payload` returns the parsed payloads (the comparison table). Same read
// gate as the candidate list; an unknown or out-of-scope candidate is 404.
import { getDb } from "../../../../../../../../../db/client.ts";
import {
  confirmedCountByVersion,
  EVAL_DRAFT_CATEGORIES,
  listVersions,
  type DraftVersionRow,
  type EvalDraftCategory,
} from "../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?").get(targetId, oppId))
    return notFound();
  const url = new URL(request.url);
  const cat = url.searchParams.get("category");
  if (cat !== null && !(EVAL_DRAFT_CATEGORIES as readonly string[]).includes(cat))
    return badRequest("invalid_request", `category must be one of: ${EVAL_DRAFT_CATEGORIES.join(" | ")}.`);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return badRequest("invalid_request", "limit must be an integer 1..100.");
  const includePayload = url.searchParams.get("include") === "payload";
  const rows = listVersions(db, targetId, {
    category: (cat as EvalDraftCategory | null) ?? undefined,
    limit,
    includePayload,
  });
  const counts = confirmedCountByVersion(
    db,
    rows.map((r) => r.id),
  );
  const versions = rows.map((r) => {
    const { payload, ...summary } = r as DraftVersionRow;
    return {
      ...summary,
      confirmed_count: counts.get(r.id) ?? 0,
      ...(includePayload ? { payload: JSON.parse(payload) as unknown } : {}),
    };
  });
  return ok({ target_id: targetId, versions }, 200, { count: versions.length });
}
