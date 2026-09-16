// S7 사전 검토(chk-target-screening) 공용 헬퍼 — 클라이언트 세이프(순수 함수만,
// DB import 없음). 서버 저장 로직은 lib/brownfield-targets.ts 참조.

// 판정 척도(사용자 결정, 2026-09-16) — 충족/미충족 2단과 해당없음·예외는
// 스크리닝 판정에 맞지 않아 폐기하고, 근거 강도를 반영한 5단으로 세분화한다.
// "insufficient(근거 부족)"를 정식 판정으로 넣어 LLM이 근거가 얇은 항목을
// 생략하는 대신 반드시 무언가를 답하게 한다 — 커버리지와 정직함을 동시에.
export const SCREENING_VERDICT_KEYS = ["confirmed", "probable", "partial", "unfulfilled", "insufficient"] as const;
export type ScreeningVerdict = (typeof SCREENING_VERDICT_KEYS)[number] | "pending";

export const SCREENING_VERDICT_KO: Record<string, string> = {
  confirmed: "충족 (근거 명확)",
  probable: "충족 (추정)",
  partial: "부분 충족",
  unfulfilled: "미충족",
  insufficient: "근거 부족",
  pending: "미판정",
};

/** 구버전 척도(pass/fail/na/waived/pending)를 새 척도로 정규화한다 — 기존에
 * 저장된 screening_json을 깨지 않고 척도를 전환하기 위함(읽기 시점 정규화). */
export function normalizeVerdict(v: string | undefined | null): ScreeningVerdict {
  if (!v) return "pending";
  switch (v) {
    case "pass": return "confirmed";
    case "fail": return "unfulfilled";
    case "na":
    case "waived": return "insufficient";
    default:
      return (SCREENING_VERDICT_KEYS as readonly string[]).includes(v) ? (v as ScreeningVerdict) : "pending";
  }
}

// 사전 검토 Part 1(knock-out) 항목 — t-01~t-05. 추천안 도출 기준. Part 2
// (t-06~t-09)는 권장 평가 기준이라 추천 여부를 바꾸지 않는다.
export const KNOCKOUT_IDS = new Set(["t-01", "t-02", "t-03", "t-04", "t-05"]);

/** 위원회 추천안 — 확정 판정(및 미확정 제안)을 Part 1 기준으로 4단으로 도출한다
 * (사용자 결정, 2026-09-16: 위원회의 역할은 판정 결과를 바탕으로 추천 여부를
 * 결정하는 것). 결정론 규칙이므로 위원회 LLM 심의를 대체하지 않는다.
 *   제외 검토      — Part 1에 미충족이 하나라도 있음
 *   보류 — 근거 부족 — Part 1에 근거 부족/미판정이 남음 (추가 확인 필요)
 *   조건부 추천    — Part 1에 부분 충족이 있고 나머지는 충족
 *   추천           — Part 1 전 항목 충족(명확/추정) */
export function precheckRecommendation(states: Record<string, string>): { label: string; cls: string } {
  let fail = false;
  let open = false;
  let partial = false;
  for (const id of KNOCKOUT_IDS) {
    const v = normalizeVerdict(states[id]);
    if (v === "unfulfilled") fail = true;
    if (v === "pending" || v === "insufficient") open = true;
    if (v === "partial") partial = true;
  }
  if (fail) return { label: "제외 검토", cls: "status-red" };
  if (open) return { label: "보류 — 근거 부족", cls: "status-amber" };
  if (partial) return { label: "조건부 추천", cls: "status-amber" };
  return { label: "추천", cls: "status-green" };
}

/** 판정 select의 칩 색상 — 충족 계열 초록, 부분·근거부족 주황/중립, 미충족 빨강. */
export function screeningVerdictChipClass(v: string | undefined): string {
  switch (normalizeVerdict(v)) {
    case "confirmed":
    case "probable": return "status-green";
    case "partial": return "status-amber";
    case "unfulfilled": return "status-red";
    case "insufficient": return "";
    default: return "status-not-started";
  }
}
