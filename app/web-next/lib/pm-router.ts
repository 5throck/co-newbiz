// pm-router (ADR-0128 2단계) — 런타임 PM 에이전트. 사용자 질의를 분류해
// 수행 에이전트(단일) 또는 에이전트 체인(복합)을 결정하고, 결과를 취합한다.
// 분류 자체도 에이전트 실행이며(pm) 런 장부에 기록된다. LLM 미설정 시
// 결정론 규칙만으로 동작한다 — "LLM 없이도 완전 기능" 원칙 유지.
import { completeOrFallback, type AgentCallMeta } from "./llm.ts";
import { AGENT_REGISTRY } from "./agent-registry.generated.ts";

export interface PmDecision {
  mode: "single" | "chain";
  /** 체인 모드일 때 체인 id (agent-chains.ts의 CHAINS 키). */
  chain?: "opportunity_evaluation";
  /** 단일 모드일 때 수행 에이전트 키. */
  agentKey?: string;
  /** PM이 파악한 작업 설명 (provenance 표시용). */
  task: string;
  /** 분류 근거 (llm | rules). */
  classifiedBy: "llm" | "rules";
}

interface RouteContext {
  opportunityId?: string;
  projectId?: string;
  industryName?: string;
}

/** 결정론 규칙 — LLM 분류 실패·미설정 시의 기본 판정. */
function classifyByRules(query: string, ctx: RouteContext): PmDecision {
  const q = query.toLowerCase();
  const hasOpp = !!ctx.opportunityId;
  const isChain = hasOpp && /(평가|분석|종합|리뷰|assess|evaluate|review)/.test(q);

  if (isChain) {
    return { mode: "chain", chain: "opportunity_evaluation", task: "기회 종합 평가 체인 (요인→매력도→적합성→종합)", classifiedBy: "rules" };
  }
  if (/마력도|매력도|attractiveness/.test(q)) {
    return { mode: "single", agentKey: "risk-officer", task: "매력도 평가 초안", classifiedBy: "rules" };
  }
  if (/(시너지|적합성|synergy|fit)/.test(q)) {
    return { mode: "single", agentKey: "risk-officer", task: "시너지·적합성 관점 분석", classifiedBy: "rules" };
  }
  if (/(시장|규모|산업|cagr|market)/.test(q)) {
    return { mode: "single", agentKey: "market-intelligence-agent", task: "시장·산업 관점 분석", classifiedBy: "rules" };
  }
  if (/(인허가|규제|법|permit|legal|regulat)/.test(q)) {
    return { mode: "single", agentKey: "legal-counsel", task: "법무·규제 관점 분석", classifiedBy: "rules" };
  }
  if (/(인증|certif)/.test(q)) {
    return { mode: "single", agentKey: "certification-agent", task: "인증 관점 분석", classifiedBy: "rules" };
  }
  if (/(재무|밸류에이션|valuation|irr|wacc|dcf)/.test(q)) {
    return { mode: "single", agentKey: "valuation-agent", task: "재무·밸류에이션 관점 분석", classifiedBy: "rules" };
  }
  if (/(인수|m&a|deal|구조|jv)/.test(q)) {
    return { mode: "single", agentKey: "brownfield-agent", task: "인수·딜 구조 관점 분석", classifiedBy: "rules" };
  }
  if (/(신규|자체 진출|greenfield)/.test(q)) {
    return { mode: "single", agentKey: "greenfield-agent", task: "자체 진출 관점 분석", classifiedBy: "rules" };
  }
  // 기본: 리스크 관점 재검증 (risk-officer가 이 플랫폼의 기본 검토 시선).
  return { mode: "single", agentKey: "risk-officer", task: "종합 검토 의견", classifiedBy: "rules" };
}

export async function routeTask(query: string, ctx: RouteContext): Promise<PmDecision> {
  const roster = AGENT_REGISTRY.filter((a) =>
    ["risk-officer", "process-governance-manager", "market-intelligence-agent", "legal-counsel",
      "certification-agent", "valuation-agent", "financing-agent", "brownfield-agent", "greenfield-agent",
      "commercial-dd-agent", "group-review-agent"].includes(a.key),
  )
    .map((a) => `${a.key}: ${a.role.slice(0, 80)}`)
    .join("\n");

  const res = await completeOrFallback(
    [
      {
        role: "system" as const,
        content:
          "당신은 신규사업 검토 플랫폼의 PM 에이전트입니다. 사용자 질의를 가장 적임 에이전트에 배정하는 것이 역할입니다. " +
          "JSON만 반환합니다. 배정 가능 에이전트:\n" + roster,
      },
      {
        role: "user" as const,
        content:
          `사용자 질의: ${query}\n\n` +
          `JSON으로 판정하세요: {"mode":"single|chain","agentKey":"위 목록의 키 또는 chain 모드면 생략","chain":"opportunity_evaluation|","task":"작업 설명 한 문장"}\n` +
          `규칙: 기회 종합 평가·다면 분석 요청이면 chain=opportunity_evaluation. 하나의 관점이면 single.`,
      },
    ],
    () => JSON.stringify({ mode: "fallback" }),
    {
      temperature: 0,
      maxTokens: 400,
      agent: { key: "pm", purpose: "질의 분류 — 수행 에이전트 배정", contextType: ctx.opportunityId ? "opportunity" : ctx.projectId ? "project" : undefined, contextId: ctx.opportunityId ?? ctx.projectId },
    } as { temperature: number; maxTokens: number; agent?: AgentCallMeta },
  );

  const decision = classifyByRules(query, ctx);
  // LLM이 성공하고 유효한 판정을 내렸으면 그것을 따른다 — 실패·모호 시 규칙 판정.
  if (res.source === "llm") {
    try {
      const parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1)) as {
        mode?: string; agentKey?: string; chain?: string; task?: string;
      };
      if (parsed.mode === "chain") {
        return { mode: "chain", chain: "opportunity_evaluation", task: parsed.task ?? decision.task, classifiedBy: "llm" };
      }
      if (parsed.mode === "single" && parsed.agentKey && AGENT_REGISTRY.some((a) => a.key === parsed.agentKey)) {
        return { mode: "single", agentKey: parsed.agentKey, task: parsed.task ?? decision.task, classifiedBy: "llm" };
      }
    } catch { /* 규칙 판정 사용 */ }
  }
  return decision;
}
