// GET/PUT /api/projects/[id]/capability-dd — S9 브라운필드 필요 역량 판정
// (2026-10-19 decider direction; design 2026-10-19-brownfield-capability-dd-design.md).
//
// GET: the S3 필요 역량 register rows (parseGapRegister) merged with any stored
// person verdicts from the capability_dd_verdicts_json sidecar (migration 0154).
// PUT: analyst+ PERSON write (boundary #2 — agents never record DD verdicts);
// replaces the verdict for the given register row, validated against the live
// register row ids, audited under the caller. The register itself is untouched
// (sidecar storage — S3 re-saves cannot drop a DD verdict).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { parseGapRegister } from "../../../../../lib/capability-gap.ts";
import {
  mergeCapabilityDdVerdicts,
  parseCapabilityDdVerdicts,
  serializeCapabilityDdVerdicts,
  validateCapabilityDdInput,
  CapabilityDdValidationError,
  type CapabilityDdVerdict,
} from "../../../../../lib/capability-dd.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";

function resolveOpportunity(db: ReturnType<typeof getDb>, projectId: string): { id: string; json: string | null } | null {
  const row = db
    .query("SELECT source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { source_opportunity_id: string | null } | undefined;
  if (!row?.source_opportunity_id) return null;
  const opp = db
    .query("SELECT id, capability_gap_json AS json FROM opportunity WHERE id = ?")
    .get(row.source_opportunity_id) as { id: string; json: string | null } | undefined;
  return opp ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  const db = getDb();
  const opp = resolveOpportunity(db, (await params).id);
  if (!opp) return notFound();
  const rows = parseGapRegister(opp.json).rows.map((r: { id: string; capability: string; necessity: string; requiredNote: string }) => ({
    id: r.id,
    capability: r.capability,
    necessity: r.necessity,
    requiredNote: r.requiredNote,
  }));
  const verdicts = parseCapabilityDdVerdicts(
    (db.query("SELECT capability_dd_verdicts_json AS j FROM opportunity WHERE id = ?").get(opp.id) as { j: string | null } | undefined)?.j,
  );
  const byRow = new Map(verdicts.map((v) => [v.rowId, v]));
  return ok({
    rows: rows.map((r) => ({ ...r, verdict: byRow.get(r.id) ?? null })),
    pending: rows.filter((r) => !byRow.has(r.id)).length,
  }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "필요 역량 판정 기록은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const opp = resolveOpportunity(db, id);
  if (!opp) return notFound();
  const registerRows = parseGapRegister(opp.json).rows;
  const known = new Set(registerRows.map((r) => r.id));
  const body = (await request.json().catch(() => null)) as { row_id?: unknown; capability?: unknown; coverage?: unknown; note?: unknown } | null;
  if (!body) return badRequest("invalid_request", "본문이 비어 있습니다.");
  try {
    const v = validateCapabilityDdInput(
      { rowId: body.row_id, capability: body.capability ?? registerRows.find((r) => r.id === body.row_id)?.capability, coverage: body.coverage, note: body.note },
      known,
    );
    const stamped: CapabilityDdVerdict = { ...v, by: auth.auth.userId, at: new Date().toISOString() };
    const existing = parseCapabilityDdVerdicts(
      (db.query("SELECT capability_dd_verdicts_json AS j FROM opportunity WHERE id = ?").get(opp.id) as { j: string | null } | undefined)?.j,
    );
    const merged = mergeCapabilityDdVerdicts(existing, stamped, registerRows.map((r) => r.id));
    db.run("UPDATE opportunity SET capability_dd_verdicts_json = ? WHERE id = ?", [serializeCapabilityDdVerdicts(merged), opp.id]);
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "capability_dd.verdict_recorded",
      target: `${opp.id}:${stamped.rowId}:${stamped.coverage}`,
      now: stamped.at,
    });
    return ok({ verdict: stamped, pending: registerRows.filter((r) => r.id !== stamped.rowId && !merged.some((m) => m.rowId === r.id)).length }, 201);
  } catch (err) {
    if (err instanceof CapabilityDdValidationError) return badRequest("invalid_request", err.message);
    console.error("capability-dd PUT failed", err);
    return fail(500, "internal_error", "판정 저장에 실패했습니다.");
  }
}
