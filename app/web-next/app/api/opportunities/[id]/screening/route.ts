// S3 시너지·전략적 적합성 (screening gate) — 기회별 산출물 조회/생성.
//   GET  : 시너지 점수·근거, 적합성 판단, screening 게이트 권고
//   POST : { kind: "synergy" | "fit" } — 해당 활동 실행 (analyst+)
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { loadScreeningState, runFitAnalysis, runSynergyAnalysis } from "../../../../../lib/opportunity-screening.ts";

type OppRow = { id: string; name: string; market_scope: string | null; attractiveness_score: number | null; synergy_score: number | null; rationale: string | null };

function loadOpp(id: string): OppRow | null {
  return getDb()
    .query("SELECT id, name, market_scope, attractiveness_score, synergy_score, rationale FROM opportunity WHERE id = ?")
    .get(id) as OppRow | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const state = loadScreeningState(id);
  if (!state) return notFound();
  return ok(state, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "S3 평가 실행은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  if (body?.kind !== "synergy" && body?.kind !== "fit") {
    return badRequest("invalid_request", 'kind은 "synergy" | "fit" 중 하나입니다.');
  }
  const opp = loadOpp(id);
  if (!opp) return notFound();

  if (body.kind === "synergy") {
    const r = await runSynergyAnalysis(opp);
    appendAudit(getDb(), { actor: auth.auth.userId, action: "screening_run", target: `${id}:synergy:${r.source}`, now: new Date().toISOString() });
    return ok({ kind: "synergy", ...r }, 200);
  }
  const r = await runFitAnalysis(opp);
  appendAudit(getDb(), { actor: auth.auth.userId, action: "screening_run", target: `${id}:fit:${r.source}`, now: new Date().toISOString() });
  return ok({ kind: "fit", ...r }, 200);
}
