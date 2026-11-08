// 매력도 재평가 가시성 규칙 — React 의존이 없는 순수 모듈이라 루트 tsc(jsx 미설정)와
// 단위 테스트가 컴포넌트(.tsx)를 거치지 않고 직접 import한다.

export type AttractivenessStatus = "identified" | "assessed" | "selected" | "dropped";

/**
 * 이 기회에 재평가 토글을 보여줄지 — 쓰기 권한이 있고 (a) 평가(assessed) 상태이거나
 * (b) 선택(selected) 상태이되 S4 진출방식 결정이 아직 확정되지 않았고 프로젝트로 승격되지
 * 않았을 때(2026-11-08 소유자 결정). 선택 후 S4 확정·승격, 그리고 dropped는 숨긴다.
 * 재채점된 selected 기회는 S4 진출방식 추천의 입력을 바꾸므로 S4 확정 전까지만 허용한다.
 * s4Confirmed = 현재 확정 결정(route_decision.is_current=1, ADR-0135) — API의 route_confirmed.
 */
export function canReEvaluateAttractiveness(
  status: AttractivenessStatus,
  canAct: boolean,
  ctx: { s4Confirmed?: boolean; hasProject?: boolean } = {},
): boolean {
  if (!canAct) return false;
  if (status === "assessed") return true;
  return status === "selected" && !ctx.s4Confirmed && !ctx.hasProject;
}
