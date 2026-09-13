// agent-chains (ADR-0128 3단계) — 복합 작업을 순차 에이전트 체인으로 실행.
// 각 단계는 기존 lib 함수를 재사용하고 agent 런 장부에 기록된다. 산출물은
// 모두 제안이며, 기록·결정은 여전히 인간 게이트 UI(경계 #2)를 통한다.
import { completeOrFallback, type AgentCallMeta } from "./llm.ts";

export interface ChainStepResult {
  step: number;
  agentKey: string;
  purpose: string;
  summary: string;
  source: "llm" | "synthesis";
}

export interface ChainResult {
  chain: string;
  steps: ChainStepResult[];
  answer: string;
}

type Ask = (
  agent: AgentCallMeta,
  system: string,
  user: string,
  fallback: () => string,
  maxTokens?: number,
) => Promise<{ text: string; source: "llm" | "synthesis" }>;

/** 완결된 기회 컨텍스트 (호출자가 로드해서 주입한다 — 체인은 순수하다). */
export interface OpportunityChainInput {
  opportunityId: string;
  name: string;
  marketScope: string | null;
  rationale: string | null;
  attractivenessScore: number | null;
  factors: { opportunity: string[]; risk: string[] };
}

/** opportunity_evaluation 체인: 요인 → 매력도 → 적합성 → PM 종합. */
export async function runOpportunityEvaluationChain(
  input: OpportunityChainInput,
  ask: Ask,
): Promise<ChainResult> {
  const steps: ChainStepResult[] = [];
  const ctxLine = `기회: ${input.name} (시장: ${input.marketScope ?? "미정"})\n근거: ${input.rationale ?? "없음"}`;

  // 1) market-intelligence-agent — 요인 분석 (요인이 비어 있으면 도출)
  let factors = input.factors;
  if (factors.opportunity.length === 0 && factors.risk.length === 0) {
    const res = await ask(
      { key: "market-intelligence-agent", purpose: "체인 1단계 — 기회/위험 요인 도출", contextType: "opportunity", contextId: input.opportunityId },
      "당신은 시장 인텔리전스 분석가입니다. 근거 안에서만 기회·위험 요인을 도출하세요. JSON만 반환합니다.",
      `JSON: {"opportunity":["..."],"risk":["..."]} — 각 2~4개.\n\n${ctxLine}`,
      () => JSON.stringify({ opportunity: ["근거 부족 — 분석가 확인 필요"], risk: ["근거 부족 — 분석가 확인 필요"] }),
      1200,
    );
    try {
      const parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1)) as { opportunity?: string[]; risk?: string[] };
      if (Array.isArray(parsed.opportunity) && Array.isArray(parsed.risk)) {
        factors = { opportunity: parsed.opportunity.map(String), risk: parsed.risk.map(String) };
      }
    } catch { /* 요인 도출 실패 — 기존 값 유지 */ }
    steps.push({ step: 1, agentKey: "market-intelligence-agent", purpose: "기회/위험 요인", summary: `기회 ${factors.opportunity.length}건 · 위험 ${factors.risk.length}건`, source: res.source });
  } else {
    steps.push({ step: 1, agentKey: "market-intelligence-agent", purpose: "기회/위험 요인", summary: `기존 기록 사용 — 기회 ${factors.opportunity.length}건 · 위험 ${factors.risk.length}건`, source: "synthesis" });
    steps[0].step = 1;
  }
  const factorsLine = `기회 요인: ${factors.opportunity.join(" / ") || "없음"}\n위험 요인: ${factors.risk.join(" / ") || "없음"}`;

  // 2) risk-officer — 매력도 관점
  const attr = await ask(
    { key: "risk-officer", purpose: "체인 2단계 — 매력도 관점 분석", contextType: "opportunity", contextId: input.opportunityId },
    "당신은 리스크 오피서입니다. 기저율·낙관 편향 관점에서 이 기회의 시장 매력도를 평가하세요. JSON만 반환합니다.",
    `JSON: {"view":"매력도 관점 평가 2~3문장","caution":"핵심 유의점 한 문장"}\n\n${ctxLine}\n${factorsLine}\n기록된 매력도 점수: ${input.attractivenessScore ?? "미평가"}`,
    () => JSON.stringify({ view: "결정론 폴백 — 매력도 관점 분석 미생성. 분석가 확정 필요.", caution: "점수 미평가 상태면 평가를 먼저 권장합니다." }),
    800,
  );
  steps.push({ step: 2, agentKey: "risk-officer", purpose: "매력도 관점", summary: extractShort(attr.text, attr.source), source: attr.source });

  // 3) process-governance-manager — 적합성 관점
  const fit = await ask(
    { key: "process-governance-manager", purpose: "체인 3단계 — 전략적 적합성 관점", contextType: "opportunity", contextId: input.opportunityId },
    "당신은 프로세스 거버넌스 매니저입니다. knock-out 관점(시장 축소·상품화, 규제, 자사 역량 괴리)에서 적합성을 평가하세요. JSON만 반환합니다.",
    `JSON: {"view":"적합성 관점 평가 2~3문장","verdict":"Go|Hold|Kill 제안","reason":"한 문장"}\n\n${ctxLine}\n${factorsLine}`,
    () => JSON.stringify({ view: "결정론 폴백 — 적합성 분석 미생성.", verdict: "Hold", reason: "자동 판단 근거 부족 — 분석가 판정 필요." }),
    800,
  );
  steps.push({ step: 3, agentKey: "process-governance-manager", purpose: "적합성 관점", summary: extractShort(fit.text, fit.source), source: fit.source });

  // 4) pm — 종합 (제안일 뿐, 결정 아님)
  const synth = await ask(
    { key: "pm", purpose: "체인 4단계 — 종합 제안 작성", contextType: "opportunity", contextId: input.opportunityId },
    "당신은 PM 에이전트입니다. 여러 에이전트의 관점을 충돌까지 포함해 종합합니다. 결정은 사람이 한다는 점을 명심하고, 제안으로만 서술하세요. JSON만 반환합니다.",
    `JSON: {"answer":"사용자에게 보여줄 종합 제안 (마크다운 허용, 5~8문장)","conflicts":"에이전트 간 입장 차이 요약 또는 '없음'"}\n\n` +
      `질의 컨텍스트:\n${ctxLine}\n${factorsLine}\n` +
      `매력도 관점: ${attr.text}\n적합성 관점: ${fit.text}`,
    () => JSON.stringify({ answer: "결정론 폴백 — 각 관점 분석을 확인한 뒤 분석가가 종합하세요.", conflicts: "폴백 상태" }),
    900,
  );
  steps.push({ step: 4, agentKey: "pm", purpose: "종합", summary: "에이전트 관점 종합", source: synth.source });

  let answer = "체인 종합 생성 실패 — 각 단계 결과를 확인하세요.";
  try {
    const parsed = JSON.parse(synth.text.slice(synth.text.indexOf("{"), synth.text.lastIndexOf("}") + 1)) as { answer?: string };
    if (parsed.answer) answer = parsed.answer;
  } catch { /* 기본 문구 유지 */ }
  return { chain: "opportunity_evaluation", steps, answer };
}

function extractShort(text: string, source: "llm" | "synthesis"): string {
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { view?: string };
    if (parsed.view) return parsed.view;
  } catch { /* 원문 반환 */ }
  return text.slice(0, 200) + (source === "llm" ? "" : " (폴백)");
}

/** ask 헬퍼 — llm.ts의 completeOrFallback에 agent 메타를 입혀주는 얇은 래퍼. */
export const chainAsk: Ask = async (agent, system, user, fallback, maxTokens) => {
  const res = await completeOrFallback(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    fallback,
    { maxTokens, agent },
  );
  return { text: res.text, source: res.source };
};
