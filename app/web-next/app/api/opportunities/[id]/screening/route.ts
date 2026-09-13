// S3 시너지·전략적 적합성 (screening gate) — 기회별 산출물 조회/생성.
//   GET  : 시너지 점수·근거, 적합성 판단, screening 진행 권고
//   POST : { kind: "fit" } — 적합성 판정 실행 (analyst+).
//          시너지 점수는 S3 화면(/synergy)의 분석 완료 시에만 기록된다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { loadScreeningState, runFitAnalysis } from "../../../../../lib/opportunity-screening.ts";

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
  // 시너지 점수는 S3 시너지·전략적 적합성 화면(/synergy)의 회사 단위 분석이
  // 완료됐을 때만 기록된다 — 이 엔드포인트의 인라인 추정으로는 반영하지 않는다
  // (사용자 결정: 근거 수준이 다른 점수가 같은 컬럼에 섞이지 않게 한다).
  if (body?.kind === "synergy") {
    return badRequest(
      "synergy_requires_s3",
      "시너지 평가는 S3 시너지·전략적 적합성 화면(/synergy)에서 분석을 실행해야 반영됩니다.",
    );
  }
  if (body?.kind !== "fit") {
    return badRequest("invalid_request", 'kind은 "fit"만 지원합니다 — 시너지는 S3 화면(/synergy)에서 분석하세요.');
  }
  const opp = loadOpp(id);
  if (!opp) return notFound();

  const r = await runFitAnalysis(opp);
  appendAudit(getDb(), { actor: auth.auth.userId, action: "screening_run", target: `${id}:fit:${r.source}`, now: new Date().toISOString() });
  return ok({ kind: "fit", ...r }, 200);
}
