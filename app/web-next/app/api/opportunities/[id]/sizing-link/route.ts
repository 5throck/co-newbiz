// GET/PUT /api/opportunities/[id]/sizing-link — ADR-0179 amendment slice A
// (2026-10-17, design §12.1): the explicit opportunity -> S1 market-sizing
// link. PUT is HUMAN-ONLY (boundary #2): a person (analyst+) pins the S1
// analysis and its sizing version whose declared scope becomes the anchor's
// scope by construction; bearer / MCP-principal / agent callers get 403
// human_only (registered in HUMAN_ONLY_ROUTES). GET is open to anyone who can
// see the opportunity. Validation is strict: a nonexistent analysis or a
// version that does not belong to it is a 400 invalid_request, never silently
// dropped; clearing sends both ids null (NULL = unlinked). Audit:
// opportunity_sizing_link.write, target "<id>#sizing-link@<via>".
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { extractSizingVersionScope } from "../../../../../lib/anchor-scope.ts";

export interface SizingLinkReference {
  analysis_id: string;
  version_id: string;
  version_no: number;
  scope: ReturnType<typeof extractSizingVersionScope>;
  anchor_value_krw_m: number | null;
  confidence_grade: string | null;
  href: string;
}

/** The reference payload the target-scope editor renders: the linked
 *  analysis/version ids plus the version's declared scope
 *  (extractSizingVersionScope on the payload — tolerant, null when unscoped),
 *  the anchor value from the matrix payload, the data-confidence grade and the
 *  S1 screen href. Null reference = unlinked. Unknown opportunity -> undefined. */
export function readSizingLink(db: ReturnType<typeof getDb>, opportunityId: string) {
  const opp = db
    .query("SELECT sizing_analysis_id AS analysisId, sizing_version_id AS versionId FROM opportunity WHERE id = ?")
    .get(opportunityId) as { analysisId: string | null; versionId: string | null } | undefined;
  if (!opp) return undefined;
  const link = opp.analysisId && opp.versionId ? { analysis_id: opp.analysisId, version_id: opp.versionId } : null;
  let reference: SizingLinkReference | null = null;
  if (link) {
    const v = db
      .query("SELECT version_no, payload, data_confidence_grade AS grade FROM market_sizing_version WHERE id = ? AND analysis_id = ?")
      .get(link.version_id, link.analysis_id) as { version_no: number; payload: string; grade: string | null } | undefined;
    if (v) {
      // Tolerant payload read (untrusted JSON): an unparsable matrix yields
      // a null anchor value, never a read failure — the scope extraction
      // itself is the ADR-0179 slice-2 tolerant extractor.
      let anchorValue: number | null = null;
      try {
        const matrix = JSON.parse(v.payload) as { anchor?: { total?: unknown } };
        anchorValue = typeof matrix?.anchor?.total === "number" ? matrix.anchor.total : null;
      } catch {
        anchorValue = null;
      }
      reference = {
        analysis_id: link.analysis_id,
        version_id: link.version_id,
        version_no: v.version_no,
        scope: extractSizingVersionScope(v.payload),
        anchor_value_krw_m: anchorValue,
        confidence_grade: v.grade,
        href: `/deals/${encodeURIComponent(opportunityId)}/s1`,
      };
    }
  }
  return { link, reference };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const state = readSizingLink(db, id);
  if (state === undefined) return notFound();
  return ok(state, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "S1 시장규모 분석 연결은 사람만 입력할 수 있습니다 (boundary #2) — 에이전트는 읽기만 가능합니다.");
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "sizing link 입력은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "sizing link 변경 요청이 아닙니다.");
  const b = body as Record<string, unknown>;
  if (b.analysis_id === null && b.version_id === null) {
    const at = new Date().toISOString();
    db.transaction(() => {
      db.run("UPDATE opportunity SET sizing_analysis_id = NULL, sizing_version_id = NULL WHERE id = ?", [id]);
      appendAudit(db, { actor: ctx.userId, action: "opportunity_sizing_link.write", target: `${id}#sizing-link@${callPathOf(ctx)}`, now: at });
    })();
    return ok({ link: null, reference: null }, 200);
  }
  const analysisId = typeof b.analysis_id === "string" ? b.analysis_id : null;
  const versionId = typeof b.version_id === "string" ? b.version_id : null;
  if (!versionId) return badRequest("invalid_request", "version_id 또는 analysis_id+version_id 짝이 필요합니다.");
  // Strict validation: the analysis must exist and the version must BELONG to
  // it (invalid = 400, never dropped). version_id alone derives the analysis
  // id from the version row itself.
  const version = db.query("SELECT analysis_id FROM market_sizing_version WHERE id = ?").get(versionId) as
    | { analysis_id: string }
    | undefined;
  if (!version) return badRequest("invalid_request", "존재하지 않는 sizing version입니다.");
  const resolvedAnalysisId = analysisId ?? version.analysis_id;
  if (analysisId && analysisId !== version.analysis_id)
    return badRequest("invalid_request", "version이 지정한 analysis에 속하지 않습니다.");
  const analysis = db.query("SELECT id FROM market_sizing_analysis WHERE id = ?").get(resolvedAnalysisId);
  if (!analysis) return badRequest("invalid_request", "존재하지 않는 sizing analysis입니다.");
  const at = new Date().toISOString();
  db.transaction(() => {
    db.run("UPDATE opportunity SET sizing_analysis_id = ?, sizing_version_id = ? WHERE id = ?", [resolvedAnalysisId, versionId, id]);
    appendAudit(db, { actor: ctx.userId, action: "opportunity_sizing_link.write", target: `${id}#sizing-link@${callPathOf(ctx)}`, now: at });
  })();
  return ok(readSizingLink(db, id), 200);
}
