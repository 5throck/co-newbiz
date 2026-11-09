// committee-agents — the pluggable member-executor seam for committee
// deliberation (ADR-0097 §5, owner decision 10 / ADR-0196 amendment
// 2026-11-09). Committee meetings run only when the LLM is actually
// available:
//
//   - LLM (the only real-meeting path): registered at server bootstrap via
//     setCallAgentFactory() when an LLM provider is configured. This module
//     deliberately contains no LLM client and no API key handling.
//   - Deterministic (the role-templated position emitter): NO longer a
//     silent fallback. It is reachable only through explicit injection —
//     the opts.callAgent seam (tests, dry-run tooling) or the CLI
//     --deterministic flag.
//
// When no factory is registered, getCommitteeCallAgent() throws the
// llm_required guidance instead of silently emitting template positions.
//
// One engine, two consumers: the steering-committee session and the /meeting
// ad-hoc mode both call getCommitteeCallAgent() (ADR-0097 §7).

import type { AgentCallResult, CallAgent } from "./agent-orchestrator.ts";
import { isCommitteeResponsive } from "./committee-flags.ts";

interface RoleTemplate {
  domain: string;
  stance: string;
  recommendation: "go" | "hold" | "kill";
  confidence: number;
  vetoDissent?: boolean;
  /** ADR-0104 5criteria × 1-3, per-seat scorecard input (deterministic
      placeholder, same reproducibility guarantee as confidence/recommendation
      above — a real LLM seat would derive these from the actual artifacts). */
  criteriaScores: Record<string, number>;
}
const NEUTRAL_SCORES: Record<string, number> = {
  control_need: 2,
  capability_criticality: 2,
  market_uncertainty: 2,
  integration_capacity: 2,
  speed_to_capability: 2,
};

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
    criteriaScores: NEUTRAL_SCORES,
  },
  "greenfield-agent": {
    domain: "트랙 도메인 전문가 (Greenfield)",
    stance: "자체 역량 구축 관점에서 역량 확보 속도와 내재화 리스크를 검토한다.",
    recommendation: "go",
    confidence: 75,
    criteriaScores: NEUTRAL_SCORES,
  },
  "industry-lead": {
    domain: "산업 도메인 (cross-validation — 저자와 다른 도메인의 2차 검토)",
    stance: "산업 구조·경쟁 강도·가치사슬 연계 신뢰도 관점에서 시장 전제를 재검증한다.",
    recommendation: "go",
    confidence: 72,
    criteriaScores: NEUTRAL_SCORES,
  },
  "region-lead": {
    domain: "지역 도메인 (cross-validation)",
    stance: "대상 지역 규제·인센티브·인증 경로의 지역 특수성을 검토한다.",
    recommendation: "go",
    confidence: 68,
    criteriaScores: NEUTRAL_SCORES,
  },
  "market-intelligence-agent": {
    domain: "정량 엄밀성 (S4 라우트·시장)",
    stance: "가치사슬 연계 기반 수요 추정의 신뢰도 상한과 단위 환산을 점검한다.",
    recommendation: "go",
    confidence: 70,
    criteriaScores: NEUTRAL_SCORES,
  },
  "valuation-agent": {
    domain: "정량 엄밀성 (S6/S7 대상 이슈 economics)",
    stance: "밸류에이션 전제·품의(quality of earnings)·시너지 중복 계상 여부를 점검한다.",
    recommendation: "go",
    confidence: 65,
    criteriaScores: NEUTRAL_SCORES,
  },
  "group-review-agent": {
    domain: "그룹 관점 (portfolio fit — entity 관점과 구분되는 그룹 차원 검토)",
    stance: "포트폴리오 적합성, 그룹 내 거래 컴플라이언스, 동시 진행 제안 간 자본 배분 우선순위를 점검한다.",
    recommendation: "go",
    confidence: 68,
    criteriaScores: NEUTRAL_SCORES,
  },
  // Standing functional-expert seats (ADR-0097 Amendment 2026-09-04):
  // financing / site & facility / legal / HR & labor / IR / patent-IP.
  // None carries vetoDissent — the red-team privilege stays risk-officer's.
  "financing-agent": {
    domain: "기능 전문가 (자금 조달 — financing structure)",
    stance:
      "부채/자기자본 구조, 프로젝트 파이낸스, 정부 기금·보조금, 재무 커버넌트 하한(하락 시나리오 기준)을 점검한다.",
    recommendation: "go",
    confidence: 68,
    criteriaScores: NEUTRAL_SCORES,
  },
  "site-facility-agent": {
    domain: "기능 전문가 (대관 — site & facility)",
    stance: "입지 선정, 산업단지 지정 적격성, 시설 투자 규모, 임대/신축 선택의 유연성 가치를 점검한다.",
    recommendation: "go",
    confidence: 66,
    criteriaScores: NEUTRAL_SCORES,
  },
  "legal-counsel": {
    domain: "기능 전문가 (법률 — legal)",
    stance: "규제·인허가 경로, 계약 구조, 지배구조 변경 시 인증 이전 가능성을 법적 근거 문서 기준으로 점검한다.",
    recommendation: "go",
    confidence: 70,
    criteriaScores: NEUTRAL_SCORES,
  },
  "hr-integration-agent": {
    domain: "기능 전문가 (인사/노무 — HR & labor)",
    stance: "경영진 보상 변동 조항, 임금·복리후생 형평, 노동관계 승계와 인력 리스크를 점검한다.",
    recommendation: "go",
    confidence: 67,
    criteriaScores: NEUTRAL_SCORES,
  },
  "ir-agent": {
    domain: "기능 전문가 (IR — investor relations)",
    stance: "투자자 커뮤니케이션이 검증된 근거와 일치하는지, 공시 규율과 시장 인식 리스크를 점검한다.",
    recommendation: "go",
    confidence: 64,
    criteriaScores: NEUTRAL_SCORES,
  },
  "ip-agent": {
    domain: "기능 전문가 (특허 — patent/IP)",
    stance:
      "특허 랜드스케이프, FTO( Freedom to Operate ) 검색 범위의 한계, IP 가치 주장과 영업비밀 보호 태세를 점검한다.",
    recommendation: "go",
    confidence: 65,
    criteriaScores: NEUTRAL_SCORES,
  },
  "risk-officer": {
    domain: "레드팀 (낙관 편향 감사 — design v1.0 kill-criteria 권한)",
    stance: "낙관 편향·하락 시나리오·킬 기준 충족 여부를 기본값으로 의심한다.",
    recommendation: "kill",
    confidence: 80,
    vetoDissent: true,
    criteriaScores: {
      control_need: 3,
      capability_criticality: 3,
      market_uncertainty: 3,
      integration_capacity: 1,
      speed_to_capability: 1,
    },
  },
  // Fallback for ad-hoc (/meeting) members without a template.
  default: {
    domain: "위원",
    stance: "검토/안건에 대해 독립적으로 입장을 검토한다.",
    recommendation: "hold",
    confidence: 60,
    criteriaScores: NEUTRAL_SCORES,
  },
};

/**
 * ADR-0196 responsive-rounds tail fields. A template seat has a fixed stance,
 * so it answers nobody by name and never changes its mind: an empty
 * responds_to and stance_changed=false keep the tail shape identical to an LLM
 * seat's, so no-LLM deployments and boundary tests see the same contract.
 * Emitted only when CO_NEWBIZ_COMMITTEE_RESPONSIVE is on (flag off keeps the
 * stored position text byte-identical).
 */
const RESPONSIVE_TAIL = { responds_to: [], stance_changed: false, issues: [] } as const;

function positionFor(agentKey: string, prompt: string): AgentCallResult {
  const responsive = isCommitteeResponsive();
  const t = ROLE_TEMPLATES[agentKey] ?? ROLE_TEMPLATES.default;
  // Deterministic: derived only from (agentKey, prompt) — no Date, no random.
  const topic = prompt.split("\n").find((l) => l.trim().length > 0 && !l.startsWith("당신은")) ?? prompt;
  const md = [
    `### [${t.domain}] ${agentKey}`,
    "",
    t.stance,
    "",
    `검토/안건: ${topic.trim()}`,
    "",
    t.vetoDissent
      ? "판단: 하락 시나리오와 킬 기준 관점에서 현재 검토/안건은 승인할 수 없다(veto dissent). 다른 위원의 근거가 프록시 불확실성과 하락 리스크를 실제로 상쇄한다는 검증 없이는 입장을 변경하지 않는다."
      : "판단: 현재 제출된 전제 범위 내에서는 진행(go)이 타당하다고 판단한다. 다만 레드팀 의견을 검토 후 최종 입장을 확정한다.",
    "",
    `<!--position-meta:${JSON.stringify({ recommendation: t.recommendation, veto_dissent: t.vetoDissent === true, confidence: t.confidence, seat: agentKey, criteria_scores: t.criteriaScores, ...(responsive ? RESPONSIVE_TAIL : {}) })}-->`,
  ].join("\n");
  return {
    positionMd: md,
    confidence: t.confidence,
    recommendation: t.recommendation,
    vetoDissent: t.vetoDissent,
    criteriaScores: t.criteriaScores,
    ...(responsive ? { respondsTo: [], stanceChanged: false, issues: [] } : {}),
  };
}

type CallAgentFactory = () => CallAgent;

let factory: CallAgentFactory | null = null;

/**
 * The seam: the LLM-backed implementation registers a factory here at server
 * bootstrap (instrumentation.ts, when the provider is configured). Nothing
 * else in this module needs to change — the session engine and /meeting are
 * agnostic to which strategy is active.
 */
export function setCallAgentFactory(next: CallAgentFactory | null): void {
  factory = next;
}

/**
 * Whether the seats (and the ADR-0196 chair passes) reach the LLM: the
 * bootstrap seam registered a factory. Tests never register the real
 * factory, so chair passes stay deterministic there.
 */
export function committeeSeatsUseLlm(): boolean {
  return factory !== null;
}

/**
 * Owner decision 10 (2026-11-09, ADR-0196 amendment): committee meetings run
 * only when the LLM is actually available. Without a configured provider,
 * convening must STOP with this guidance instead of silently running
 * template positions.
 */
export const COMMITTEE_LLM_GUIDANCE =
  "Committee deliberation needs a configured LLM provider. Configure it, or convene a hybrid/human_only session for human-led review, or pass an explicit callAgent for an injected deterministic run.";

/** Thrown by getCommitteeCallAgent when no provider is configured. */
export class CommitteeLlmRequiredError extends Error {
  readonly code = "llm_required";
  constructor() {
    super(COMMITTEE_LLM_GUIDANCE);
  }
}

/** Whether an LLM-backed callAgent can actually be constructed right now. */
export function committeeLlmAvailable(): boolean {
  return factory !== null;
}

/**
 * The local, dependency-free role-templated implementation (industry /
 * region / quant / red team / domain expert). No external LLM, fully
 * reproducible. NOT a silent fallback — reachable only via explicit
 * injection (tests, dry-run tooling, the CLI --deterministic flag).
 */
export function deterministicCallAgent(): CallAgent {
  return (agentKey, prompt) => Promise.resolve(positionFor(agentKey, prompt));
}

export function getCommitteeCallAgent(): CallAgent {
  if (factory !== null) return factory();
  throw new CommitteeLlmRequiredError();
}
