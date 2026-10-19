// llm-executors — the LLM-backed implementations for the two documented
// executor seams (registered at server bootstrap, instrumentation.ts):
//
//   makeLlmBusinessCaseExecutor() — CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm.
//     Persistence stays DETERMINISTIC: the default executor runs first (it
//     owns business_case_model/line + valuation_simulation rows and the
//     seeded, reproducible numbers — boundary: quantitative results are
//     computed, never generated). The LLM then enriches ONLY the returned
//     markdown prose around those computed facts; on any LLM failure the
//     deterministic text passes through unchanged.
//
//   makeLlmDdTailorExecutor() — CO_NEWBIZ_DD_TAILOR_AGENTS=llm.
//     The model proposes industry-tailored checklist items for a domain.
//     Honesty constraint (ADR-0099 §6, binding): the model is told never to
//     invent sources, so source_url stays null and source_reliability 'C' —
//     visibly unsourced, approvable only on its own merits. A future
//     WebSearch-backed upgrade is the path to real provenance, not prompt
//     engineering here.
import { complete, isLlmConfigured } from "./llm.ts";
import {
  defaultExecutor as bcDefaultExecutor,
  type BusinessCaseStep,
  type BusinessCaseStepExecutor,
} from "./business-case-generator.ts";
import type { DdTailorExecutor, TailorItemDraft } from "./dd-checklist-tailor.ts";
import { systemMessage, promptAgent } from "./prompts.ts";

function llmUnavailable(): Error {
  return new Error("LLM provider is not configured (CO_NEWBIZ_LLM_PROVIDER/API_KEY/MODEL).");
}

// ── Business case prose enrichment ──────────────────────────────────────────

const BC_AGENT_KEY: Record<BusinessCaseStep, string> = {
  growth_projection: "financial-analyst",
  valuation_model: "valuation-agent",
  distributional_valuation: "quant-methodologist",
  scenario_risk_assessment: "quant-methodologist",
};

const BC_STEP_ROLE: Record<BusinessCaseStep, string> = {
  growth_projection: "재무 분석가(financial-analyst)",
  valuation_model: "밸류에이션 전문가(valuation-agent)",
  distributional_valuation: "정량 방법론 전문가(quant-methodologist)",
  scenario_risk_assessment: "정량 방법론 전문가(quant-methodologist)",
};

export function makeLlmBusinessCaseExecutor(): BusinessCaseStepExecutor {
  const base = bcDefaultExecutor();
  return async (step, ctx) => {
    const deterministic = await base(step, ctx); // persistence + computed numbers
    if (!isLlmConfigured()) throw llmUnavailable();
    try {
      const prose = await complete(
        [
          systemMessage("s8.business_case_prose"),
          { role: "user", content: `단계/역할: ${BC_STEP_ROLE[step]}\n시나리오: ${ctx.scenario}\n\n[확정 수치 블록]\n${deterministic}` },
        ],
        { temperature: 0.4, maxTokens: 800, agent: promptAgent("s8.business_case_prose", { key: BC_AGENT_KEY[step] }) },
      );
      return prose.trim() || deterministic;
    } catch {
      // LLM 실패 시에도 사업성 분석은 결정론적 산출물로 완결된다 — 체인이 죽지 않는다.
      return deterministic;
    }
  };
}

// ── DD checklist tailoring ──────────────────────────────────────────────────

export function parseDrafts(raw: string): TailorItemDraft[] {
  const jsonText = raw.replace(/```(?:json)?/g, "").trim();
  const start = jsonText.indexOf("[");
  const end = jsonText.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const drafts: TailorItemDraft[] = [];
  for (const item of parsed) {
    const label = typeof (item as { item_label?: unknown }).item_label === "string" ? (item as { item_label: string }).item_label.trim() : "";
    if (!label) continue; // never persist an empty proposal
    const rationale = typeof (item as { rationale?: unknown }).rationale === "string" ? (item as { rationale: string }).rationale.trim() : "";
    drafts.push({
      itemLabel: label.slice(0, 500),
      rationale: rationale.slice(0, 2000),
      // ADR-0099 §6: the LLM is never trusted to cite — sources stay empty.
      sourceUrl: null,
      sourceReliability: "C",
    });
  }
  return drafts.slice(0, 10);
}

export function makeLlmDdTailorExecutor(): DdTailorExecutor {
  return async (domain, ctx) => {
    if (!isLlmConfigured()) throw llmUnavailable();
    const userPrompt = `도메인: ${domain}\n산업: ${ctx.industry}\n프로젝트: ${ctx.projectId}`;
    const raw = await complete(
      [
        systemMessage("s9.dd_tailor"),
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.4, maxTokens: 1400, agent: promptAgent("s9.dd_tailor") },
    );
    let drafts = parseDrafts(raw);
    if (drafts.length === 0) throw new Error("LLM tailor 응답을 항목 배열로 해석하지 못했습니다.");
    // 2026-10-19 decider report ("산업 맞춤 제안이 영어로 작성"): the model ignored the
    // Korean instruction on the first pass. The test is HANGUL-MAJORITY on the LABEL
    // alone — the Korean industry name inside an English sentence
    // ("Assess ... in 휴머노이드 로봇 ...") must NOT pass, and a Korean rationale does
    // not rescue an English label (the label is the visible one-liner). TWO repair
    // retries; a reply that still refuses Korean fails the tailor loudly (the person
    // retries) instead of shipping English items the decider already rejected.
    const labelKorean = (d: { itemLabel: string }): boolean => {
      const hangul = (d.itemLabel.match(/[가-힣]/g) ?? []).length;
      const latin = (d.itemLabel.match(/[A-Za-z]/g) ?? []).length;
      return hangul >= latin;
    };
    const repairOnce = async (rejectedText: string, attempt: number) => {
      const repair = await complete(
        [
          systemMessage("s9.dd_tailor"),
          {
            role: "user" as const,
            content: [
              `이전 응답이 한국어 규칙에 맞지 않아 기각되었습니다 (기각 ${attempt}회) — item_label을 반드시 한국어로 재작성하세요. rationale도 한국어로 쓰세요. 고유명사·규격명(예: ISO 45001)만 원어 병기합니다.`,
              "기각된 이전 응답:",
              rejectedText.slice(0, 1500),
              "수정된 JSON 배열만 출력하세요 (설명·코드펜스 금지). item_label은 JSON 숫자·영문 문자열이 아니라 한국어 문장입니다.",
            ].join("\n"),
          },
        ],
        { temperature: 0.2 + attempt * 0.1, maxTokens: 1400, agent: promptAgent("s9.dd_tailor") },
      );
      return parseDrafts(repair);
    };
    if (!drafts.every(labelKorean)) {
      let rejectedText = raw;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const repaired = await repairOnce(rejectedText, attempt);
        if (repaired.length === 0) throw new Error("LLM tailor 재시도 응답을 항목 배열로 해석하지 못했습니다.");
        if (repaired.every(labelKorean)) { drafts = repaired; break; }
        rejectedText = JSON.stringify(repaired.map((d) => ({ item_label: d.itemLabel, rationale: d.rationale })));
        if (attempt === 2 && !repaired.every(labelKorean)) {
          throw new Error("LLM tailor 응답이 두 번의 재시도 후에도 한국어로 작성되지 않았습니다 — 다시 생성을 실행하세요.");
        }
      }
    }
    return drafts;
  };
}
