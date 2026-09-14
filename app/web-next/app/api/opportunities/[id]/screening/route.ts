// S3 시너지·전략적 적합성 (screening gate) — 기회별 산출물 조회.
//   GET : 시너지 점수·근거, screening 진행 권고(매력도+시너지).
// 시너지 점수는 S3 화면(/synergy)의 분석 완료 시에만 기록된다. 별도의
// "적합성 판정"(POST kind:"fit")은 2026-09-15 제거했다 — S4 진출방식
// 추천(track-advisory.ts)과 같은 원천 신호를 다시 계산하는 중복 계층이라는
// 판단에 따라 opportunity-screening.ts에서 정리했다.
import { loadScreeningState } from "../../../../../lib/opportunity-screening.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const state = loadScreeningState(id);
  if (!state) return notFound();
  return ok(state, 200);
}
