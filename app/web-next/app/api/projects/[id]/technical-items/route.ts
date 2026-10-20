// GET/PUT /api/projects/[id]/technical-items — S9 기술 렌즈 항목(T2~T5) 판정
// (2026-10-20 decider round 4: 판정 주전장은 S9 실사·검증, S8은 파생 반영).
//
// GET: the stored person verdicts from the opportunity.technical_item_verdicts_json
// sidecar (migration 0157), one entry per judged item key. PUT: analyst+ PERSON
// write (boundary #2 — agents never record lens verdicts); replaces the verdict
// for the given item key, audited under the caller. The lens JSON itself is
// untouched (sidecar storage — S3 re-saves cannot drop a verdict).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  mergeTechnicalItemVerdicts,
  parseTechnicalItemVerdicts,
  serializeTechnicalItemVerdicts,
  validateTechnicalItemVerdictInput,
  TechnicalItemValidationError,
  type TechnicalItemVerdict,
} from "../../../../../lib/technical-item-verdicts.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";

function resolveOpportunityId(db: ReturnType<typeof getDb>, projectId: string): string | null {
  const row = db
    .query("SELECT source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { source_opportunity_id: string | null } | undefined;
  return row?.source_opportunity_id ?? null;
}

function storedVerdicts(db: ReturnType<typeof getDb>, oppId: string): TechnicalItemVerdict[] {
  return parseTechnicalItemVerdicts(
    (db.query("SELECT technical_item_verdicts_json AS j FROM opportunity WHERE id = ?").get(oppId) as { j: string | null } | undefined)?.j,
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  const db = getDb();
  const oppId = resolveOpportunityId(db, (await params).id);
  if (!oppId) return notFound();
  return ok({ items: storedVerdicts(db, oppId) }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "기술 항목 판정 기록은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const oppId = resolveOpportunityId(db, id);
  if (!oppId) return notFound();
  const body = (await request.json().catch(() => null)) as { itemKey?: unknown; verdict?: unknown; note?: unknown } | null;
  if (!body) return badRequest("invalid_request", "본문이 비어 있습니다.");
  try {
    const v = validateTechnicalItemVerdictInput({ itemKey: body.itemKey, verdict: body.verdict, note: body.note });
    const stamped: TechnicalItemVerdict = { ...v, by: auth.auth.userId, at: new Date().toISOString() };
    const merged = mergeTechnicalItemVerdicts(storedVerdicts(db, oppId), stamped);
    db.run("UPDATE opportunity SET technical_item_verdicts_json = ? WHERE id = ?", [serializeTechnicalItemVerdicts(merged), oppId]);
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "technical_item.recorded",
      target: `${oppId}:${stamped.itemKey}:${stamped.verdict}`,
      now: stamped.at,
    });
    return ok({ verdict: stamped }, 201);
  } catch (err) {
    if (err instanceof TechnicalItemValidationError) return badRequest("invalid_request", err.message);
    console.error("technical-items PUT failed", err);
    return fail(500, "internal_error", "판정 저장에 실패했습니다.");
  }
}
