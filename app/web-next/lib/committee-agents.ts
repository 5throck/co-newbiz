// committee-agents — the pluggable member-executor seam for committee
// deliberation (ADR-0097 §5). Live LLM agent calls are environment-dependent,
// so the committee session engine takes its CallAgent strategy from here:
//
//   - "deterministic" (default): a local, dependency-free implementation that
//     emits a role-templated position per agent (industry / region / quant /
//     red team / domain expert). No external LLM, fully reproducible — the
//     same implementation the boundary-#2 regression tests drive end-to-end.
//   - "llm": the documented seam for a future LLM-backed implementation.
//     Supply it via setCallAgentFactory() (server-side bootstrap) — this
//     module deliberately contains no LLM client and no API key handling.
//
// One engine, two consumers: the steering-committee session and the /meeting
// ad-hoc mode both call getCommitteeCallAgent() (ADR-0097 §7).

import type { AgentCallResult, CallAgent } from "./agent-orchestrator.ts";

export type AgentMode = "deterministic" | "llm";

interface RoleTemplate {
  domain: string;
  stance: string;
  recommendation: "go" | "hold" | "kill";
  confidence: number;
  vetoDissent?: boolean;
}

/**
 * Role templates keyed by agent_key. The red-team seat (risk-officer) always
 * dissents toward kill with veto_dissent: true — that is the seat's job
 * (optimism-bias auditing, design v1.0), and it exercises the ADR-0096 §6
 * verbatim-dissent rule in every deterministic deliberation.
 */
const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  "brownfield-agent": {
    domain: "트랙 도메인 전문가 (Brownfield)",
    stance: "대상 기업·자산 결합 관점에서 실행 가능성과 통합 경로를 검토한다.",
    recommendation: "go",
    confidence: 75,
  },
  "greenfield-agent": {
    domain: "트랙 도메인 전문가 (Greenfield)",
    stance: "자체 역량 구축 관점에서 역량 확보 속도와 내재화 리스크를 검토한다.",
    recommendation: "go",
    confidence: 75,
  },
  "industry-lead": {
    domain: "산업 도메인 (cross-validation — 저자와 다른 도메인의 2차 검토)",
    stance: "산업 구조·경쟁 강도·프록시 체인 신뢰도 관점에서 시장 전제를 재검증한다.",
    recommendation: "go",
    confidence: 72,
  },
  "region-lead": {
    domain: "지역 도메인 (cross-validation)",
    stance: "대상 지역 규제·인센티브·인증 경로의 지역 특수성을 검토한다.",
    recommendation: "go",
    confidence: 68,
  },
  "market-intelligence-agent": {
    domain: "정량 엄밀성 (S4 라우트·시장)",
    stance: "프록시 산업 체인 기반 수요 추정의 신뢰도 상한과 단위 환산을 점검한다.",
    recommendation: "go",
    confidence: 70,
  },
  "valuation-agent": {
    domain: "정량 엄밀성 (S6/S7 대상 이슈 economics)",
    stance: "밸류에이션 전제·품의(quality of earnings)·시너지 중복 계상 여부를 점검한다.",
    recommendation: "go",
    confidence: 65,
  },
  "risk-officer": {
    domain: "레드팀 (낙관 편향 감사 — design v1.0 kill-criteria 권한)",
    stance: "낙관 편향·하락 시나리오·킬 기준 충족 여부를 기본값으로 의심한다.",
    recommendation: "kill",
    confidence: 80,
    vetoDissent: true,
  },
  // Fallback for ad-hoc (/meeting) members without a template.
  default: {
    domain: "위원",
    stance: "안건에 대해 독립적으로 입장을 검토한다.",
    recommendation: "hold",
    confidence: 60,
  },
};

function positionFor(agentKey: string, prompt: string): AgentCallResult {
  const t = ROLE_TEMPLATES[agentKey] ?? ROLE_TEMPLATES.default;
  // Deterministic: derived only from (agentKey, prompt) — no Date, no random.
  const topic = prompt.split("\n").find((l) => l.trim().length > 0 && !l.startsWith("당신은")) ?? prompt;
  const md = [
    `### [${t.domain}] ${agentKey}`,
    "",
    t.stance,
    "",
    `안건: ${topic.trim()}`,
    "",
    t.vetoDissent
      ? "판단: 하락 시나리오와 킬 기준 관점에서 현재 안건은 승인할 수 없다(veto dissent). 다른 위원의 근거가 프록시 불확실성과 하락 리스크를 실제로 상쇄한다는 검증 없이는 입장을 변경하지 않는다."
      : "판단: 현재 제출된 전제 범위 내에서는 진행(go)이 타당하다고 판단한다. 다만 레드팀 의견을 검토 후 최종 입장을 확정한다.",
    "",
    `<!--position-meta:${JSON.stringify({ recommendation: t.recommendation, veto_dissent: t.vetoDissent === true, confidence: t.confidence })}-->`,
  ].join("\n");
  return {
    positionMd: md,
    confidence: t.confidence,
    recommendation: t.recommendation,
    vetoDissent: t.vetoDissent,
  };
}

type CallAgentFactory = () => CallAgent;

let factory: CallAgentFactory | null = null;

/**
 * The seam: a future LLM-backed implementation registers a factory here at
 * server bootstrap. Nothing else in this module needs to change — the
 * session engine and /meeting are agnostic to which strategy is active.
 */
export function setCallAgentFactory(next: CallAgentFactory | null): void {
  factory = next;
}

export function getCommitteeCallAgent(): CallAgent {
  const mode = (process.env.CO_NEWBIZ_COMMITTEE_AGENTS ?? "deterministic") as AgentMode;
  if (mode === "llm" && factory !== null) return factory();
  // Default and fallback: the local deterministic implementation.
  return (agentKey, prompt) => Promise.resolve(positionFor(agentKey, prompt));
}
