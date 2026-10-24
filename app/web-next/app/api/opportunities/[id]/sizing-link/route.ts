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
import { readSizingAnchorTotal } from "../../../../../lib/sizing-payload.ts";
import { latestCompletedVersionNo, lazyAutoLinkOnRead, sizingLinkProvenance } from "../../../../../lib/sizing-auto-link.ts";

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
  // Lazy auto-link on the read path (2026-10-17 follow-up): pre-existing
  // opportunities that predate the auto-link hooks get linked on first GET
  // when the rules allow (no stored link, no manual lineage, industry has a
  // COMPLETED analysis). Degrades silently — never blocks the read.
  if (!opp.analysisId || !opp.versionId) lazyAutoLinkOnRead(db, opportunityId, new Date().toISOString());
  const fresh = db
    .query("SELECT sizing_analysis_id AS analysisId, sizing_version_id AS versionId FROM opportunity WHERE id = ?")
    .get(opportunityId) as { analysisId: string | null; versionId: string | null } | undefined;
  if (!fresh) return undefined;
  const link = fresh.analysisId && fresh.versionId ? { analysis_id: fresh.analysisId, version_id: fresh.versionId } : null;
  let reference: SizingLinkReference | null = null;
  if (link) {
    const v = db
      .query("SELECT version_no, payload, data_confidence_grade AS grade FROM market_sizing_version WHERE id = ? AND analysis_id = ?")
      .get(link.version_id, link.analysis_id) as { version_no: number; payload: string; grade: string | null } | undefined;
    if (v) {
      // Tolerant payload read (untrusted JSON) via the shared shape-compatible
      // reader (ADR-0180 slice 1): an unparsable payload yields a null anchor
      // value, never a read failure — the scope extraction itself is the
      // ADR-0179 slice-2 tolerant extractor.
      const anchorValue = readSizingAnchorTotal(v.payload);
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
  return { link, reference, link_provenance: sizingLinkProvenance(db, opportunityId), newer_version_available: newerVersionAvailable(db, opportunityId) };
}

/** Display-side freshness hint (auto-link addition): TRUE when the
 *  opportunity's industry has a completed version NEWER than the linked one
 *  — surfaced as '더 최신 S1 버전 있음' on a frozen (manual) link; auto links
 *  follow on the next completion, so the hint is false right after a refresh
 *  run. Tolerant: no industry/analysis → false. */
function newerVersionAvailable(db: ReturnType<typeof getDb>, opportunityId: string): boolean {
  const latest = latestCompletedVersionNo(db, opportunityId);
  const current = db
    .query("SELECT mv.version_no AS v FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?")
    .get(opportunityId) as { v: number | null } | undefined;
  return latest != null && current?.v != null && current.v < latest;
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
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "Sizing-link inputs require the analyst role or higher." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "Not a sizing-link change request.");
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
  if (!versionId) return badRequest("invalid_request", "version_id or an analysis_id+version_id pair is required.");
  // Strict validation: the analysis must exist and the version must BELONG to
  // it (invalid = 400, never dropped). version_id alone derives the analysis
  // id from the version row itself.
  const version = db.query("SELECT analysis_id FROM market_sizing_version WHERE id = ?").get(versionId) as
    | { analysis_id: string }
    | undefined;
  if (!version) return badRequest("invalid_request", "No such sizing version exists.");
  const resolvedAnalysisId = analysisId ?? version.analysis_id;
  if (analysisId && analysisId !== version.analysis_id)
    return badRequest("invalid_request", "The version does not belong to the given analysis.");
  const analysis = db.query("SELECT id FROM market_sizing_analysis WHERE id = ?").get(resolvedAnalysisId);
  if (!analysis) return badRequest("invalid_request", "No such sizing analysis exists.");
  const at = new Date().toISOString();
  db.transaction(() => {
    db.run("UPDATE opportunity SET sizing_analysis_id = ?, sizing_version_id = ? WHERE id = ?", [resolvedAnalysisId, versionId, id]);
    appendAudit(db, { actor: ctx.userId, action: "opportunity_sizing_link.write", target: `${id}#sizing-link@${callPathOf(ctx)}`, now: at });
  })();
  return ok(readSizingLink(db, id), 200);
}
