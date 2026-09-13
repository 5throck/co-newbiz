// Seed a market-sizing analysis directly from an agent-researched SizingMatrix
// (e.g. an S1 agent-research pass run outside the LLM pipeline) — bypasses the
// 8-step pipeline entirely and lands the payload as a new version row, then
// marks the analysis 'completed'. Body is validated against a minimal shape
// of SizingMatrix (industryLabel/provenance/anchor/regions/baseline2026/
// cagrBase/chainGrade/chainDirection/qualitative/consistency/crossValidation/
// limitations required; all ADR-0077-and-later optional fields pass through
// untouched — this route does not attempt to fully re-validate the whole
// schema, only the fields the pipeline itself always produces).
//
// Note: this codebase does not depend on zod (see app/web-next/package.json
// and the sibling app/api/opportunities/route.ts, which validates by hand) —
// validation here follows that existing hand-rolled convention rather than
// introducing a new dependency for one route.
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import type { SizingMatrix } from "../../../../../../lib/market-sizing.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Minimal structural validation — matches the fields runSizingPipeline always sets. */
function validateMatrix(body: unknown): { ok: true; matrix: SizingMatrix } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: "Request body must be a JSON object." };
  const b = body;

  if (typeof b.industryLabel !== "string" || !b.industryLabel.trim()) {
    return { ok: false, message: "industryLabel (string) is required." };
  }
  if (b.provenance !== "frozen-research" && b.provenance !== "llm-estimate") {
    return { ok: false, message: "provenance must be 'frozen-research' or 'llm-estimate'." };
  }
  if (!isRecord(b.anchor) || !Array.isArray(b.anchor.sources) || typeof b.anchor.total !== "number") {
    return { ok: false, message: "anchor.{sources[],total} is required." };
  }
  if (!Array.isArray(b.regions) || b.regions.length === 0) {
    return { ok: false, message: "regions (non-empty array) is required." };
  }
  for (const r of b.regions) {
    if (!isRecord(r) || typeof r.code !== "string" || typeof r.label !== "string" || typeof r.weight !== "number" || !isRecord(r.mix)) {
      return { ok: false, message: "each region requires {code, label, weight, mix}." };
    }
  }
  if (!isRecord(b.baseline2026) || !isRecord(b.cagrBase)) {
    return { ok: false, message: "baseline2026 and cagrBase (region-keyed objects) are required." };
  }
  if (!isRecord(b.chainGrade) || typeof b.chainGrade.grade !== "string") {
    return { ok: false, message: "chainGrade.grade is required." };
  }
  if (!isRecord(b.chainDirection) || typeof b.chainDirection.position !== "string" || !Array.isArray(b.chainDirection.relatedIndustries)) {
    return { ok: false, message: "chainDirection.{position, relatedIndustries[]} is required." };
  }
  if (!isRecord(b.qualitative) || !Array.isArray(b.qualitative.opportunityFactors) || !Array.isArray(b.qualitative.riskFactors)) {
    return { ok: false, message: "qualitative.{opportunityFactors[], riskFactors[]} is required." };
  }
  if (!isRecord(b.consistency) || typeof b.consistency.bottomUpCagr !== "number" || typeof b.consistency.topDownCagr !== "number") {
    return { ok: false, message: "consistency.{bottomUpCagr, topDownCagr} (numbers) is required." };
  }
  if (!Array.isArray(b.crossValidation)) {
    return { ok: false, message: "crossValidation (array) is required." };
  }
  if (!Array.isArray(b.limitations)) {
    return { ok: false, message: "limitations (array) is required." };
  }

  return { ok: true, matrix: body as unknown as SizingMatrix };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "매트릭스 시드 등록은 analyst 역할 이상이어야 합니다.");

  const { id } = await params;
  const db = getDb();
  const analysis = db.query("SELECT id, industry_id FROM market_sizing_analysis WHERE id = ?").get(id) as
    | { id: string; industry_id: string }
    | null;
  if (!analysis) return notFound("분석을 찾을 수 없습니다.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json", "Request body must be JSON.");
  }

  const validated = validateMatrix(body);
  if (!validated.ok) return badRequest("invalid_matrix", validated.message);
  const matrix = validated.matrix;

  // ADR-0129 — reconcile against already-curated proxy_link demand-industry
  // edges so a seeded matrix's chainDirection.relatedIndustries doesn't
  // silently diverge from what a human already registered. Read-only: this
  // route never writes proxy_link rows, it only merges curated rows missing
  // from the incoming payload into relatedIndustries. Same query shape as
  // runSizingPipeline's curatedDemandIndustries (market-sizing-pipeline.ts).
  const curatedDemandIndustries = db
    .query(
      `SELECT p.id, p.relation, p.hop_distance,
              CASE WHEN p.from_industry_id = ? THEN p.to_industry_id ELSE p.from_industry_id END AS related_industry_id,
              i.name_ko AS related_industry_name
       FROM proxy_link p
       JOIN md_industry i
         ON i.id = (CASE WHEN p.from_industry_id = ? THEN p.to_industry_id ELSE p.from_industry_id END)
       WHERE (p.from_industry_id = ? OR p.to_industry_id = ?)
         AND p.status = 'active' AND p.relation IS NOT NULL`,
    )
    .all(analysis.industry_id, analysis.industry_id, analysis.industry_id, analysis.industry_id) as Array<{
      id: string;
      relation: string;
      hop_distance: number | null;
      related_industry_id: string;
      related_industry_name: string;
    }>;

  if (curatedDemandIndustries.length > 0) {
    const existingNames = new Set(matrix.chainDirection.relatedIndustries.map((r) => r.name));
    for (const c of curatedDemandIndustries) {
      if (existingNames.has(c.related_industry_name)) continue;
      matrix.chainDirection.relatedIndustries.push({
        relation: c.relation,
        name: c.related_industry_name,
        note: "이미 등록된 수요 산업",
      });
      existingNames.add(c.related_industry_name);
    }
  }

  const now = new Date().toISOString();
  const payload = JSON.stringify({ methodology: "s1-agent-research v1", matrix, stepSummaries: [] });
  const nextVersionNo =
    ((db.query("SELECT MAX(version_no) m FROM market_sizing_version WHERE analysis_id = ?").get(id) as { m: number | null }).m ?? 0) + 1;
  const versionId = ulid();

  db.transaction(() => {
    db.run(
      `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [versionId, id, nextVersionNo, payload, `v${nextVersionNo} — S1 에이전트 리서치 매트릭스 시드 등록`, ctx.userId, now],
    );
    db.run(
      "UPDATE market_sizing_analysis SET status = 'completed', completed_at = ? WHERE id = ?",
      [now, id],
    );
  })();

  appendAudit(db, { actor: ctx.userId, action: "market_sizing_analysis.seed", target: `${id}:v${nextVersionNo}`, now });

  return ok({ analysis_id: id, version_no: nextVersionNo, version_id: versionId }, 201, { seeded: true });
}
