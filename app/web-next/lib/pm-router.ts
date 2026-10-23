// pm-router (ADR-0128 2단계) — 런타임 PM 에이전트. 사용자 질의를 분류해
// 수행 에이전트(단일) 또는 에이전트 체인(복합)을 결정하고, 결과를 취합한다.
// 분류 자체도 에이전트 실행이며(pm) 런 장부에 기록된다. LLM 미설정 시
// 결정론 규칙만으로 동작한다 — "LLM 없이도 완전 기능" 원칙 유지.
// ADR-0183 D1 — 허용 목록·규칙의 에이전트 대상·LLM 분류 로스터는 더 이상
// 코드에 두지 않고 pm-catalog.generated.ts(3 SSOT 조인 투영)에서 유도한다.
// 라우팅 로직(규칙 우선 → LLM 폴백)은 유지한다.
import { completeOrFallback, type ClassifiedBy } from "./llm.ts";
import { AGENT_REGISTRY, AGENT_KEYS } from "./agent-registry.generated.ts";
import { PM_CATALOG, type PmCatalogEntry } from "./pm-catalog.generated.ts";
import { promptSystem, promptAgent, type PromptKey } from "./prompts.ts";

export interface PmDecision {
  mode: "single" | "chain";
  /** 체인 모드일 때 체인 id (agent-chains.ts의 CHAINS 키). */
  chain?: "opportunity_evaluation";
  /** 단일 모드일 때 수행 에이전트 키. */
  agentKey?: string;
  /** PM이 파악한 작업 설명 (provenance 표시용). */
  task: string;
  /** 분류 근거 — 라우터는 "rules" | "llm"만 생산하고, "catalog"은 단계 산출물
   * provenance용으로 후속 로우가 표면화한다 (ADR-0183 D2). */
  classifiedBy: ClassifiedBy;
}

interface RouteContext {
  opportunityId?: string;
  projectId?: string;
  industryName?: string;
}

/** 카탈로그에서 유도한 라우팅 허용 목록 — 프롬프트를 보유한 에이전트(동적 항목 제외).
 * 결정론 규칙의 대상과 LLM 분류 로스터 양쪽의 데이터 소스다 (ADR-0183 D1). */
const CATALOG_ROSTER: string[] = [...new Set(Object.values(PM_CATALOG).flatMap((e: PmCatalogEntry) => (e.agentKey ? [e.agentKey] : [])))].sort();

// 카탈로그 데이터의 정합성 보장 — 유도된 모든 에이전트 키가 로스터에 등록되어 있어야
// 한다(생성기도 검증하지만, 번들 로드 시점 이중 방어).
for (const key of CATALOG_ROSTER) {
  if (!AGENT_KEYS.has(key)) throw new Error(`pm-router: catalog agent '${key}' is not in the agents/ roster (ADR-0128).`);
}

/** 규칙의 에이전트 대상은 카탈로그 항목(앵커 프롬프트)의 agentKey에서 온다.
 * 카탈로그에 자연 매핑 프롬프트가 없는 규칙(null)만 리터럴 폴백을 남긴다 —
 * 양쪽 모두 런타임 관문(ADR-0183 D2)이 로스터 등록을 강제한다. */
function catalogAgent(promptKey: PromptKey | null, fallback: string): string {
  return (promptKey ? PM_CATALOG[promptKey]?.agentKey : undefined) ?? fallback;
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
    return { mode: "single", agentKey: catalogAgent("s3.attractiveness_recommendation", "risk-officer"), task: "매력도 평가 초안", classifiedBy: "rules" };
  }
  if (/(시너지|적합성|synergy|fit)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s4.synergy_ic", "risk-officer"), task: "시너지·적합성 관점 분석", classifiedBy: "rules" };
  }
  if (/(시장|규모|산업|cagr|market)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s1.sizing_ask_json", "market-intelligence-agent"), task: "시장·산업 관점 분석", classifiedBy: "rules" };
  }
  if (/(인허가|규제|법|permit|legal|regulat)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s10.site_regulatory_draft", "legal-counsel"), task: "법무·규제 관점 분석", classifiedBy: "rules" };
  }
  if (/(인증|certif)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent(null, "certification-agent"), task: "인증 관점 분석", classifiedBy: "rules" };
  }
  if (/(재무|밸류에이션|valuation|irr|wacc|dcf)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s8.business_case_adoption", "valuation-agent"), task: "재무·밸류에이션 관점 분석", classifiedBy: "rules" };
  }
  if (/(인수|m&a|deal|구조|jv)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s7.screening_draft", "brownfield-agent"), task: "인수·딜 구조 관점 분석", classifiedBy: "rules" };
  }
  if (/(신규|자체 진출|greenfield)/.test(q)) {
    return { mode: "single", agentKey: catalogAgent("s5.greenfield_recommendation", "greenfield-agent"), task: "자체 진출 관점 분석", classifiedBy: "rules" };
  }
  // 기본: 리스크 관점 재검증 (risk-officer가 이 플랫폼의 기본 검토 시선).
  return { mode: "single", agentKey: catalogAgent("opportunity.gate_brief", "risk-officer"), task: "종합 검토 의견", classifiedBy: "rules" };
}

export async function routeTask(query: string, ctx: RouteContext): Promise<PmDecision> {
  const roster = CATALOG_ROSTER
    .map((key) => {
      const entry = AGENT_REGISTRY.find((a) => a.key === key);
      return `${key}: ${entry?.role.slice(0, 80) ?? ""}`;
    })
    .join("\n");

  const res = await completeOrFallback(
    [
      { role: "system" as const, content: promptSystem("pm.query_classify") + roster },
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
      agent: promptAgent("pm.query_classify", { contextType: ctx.opportunityId ? "opportunity" : ctx.projectId ? "project" : undefined, contextId: ctx.opportunityId ?? ctx.projectId }),
    },
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
