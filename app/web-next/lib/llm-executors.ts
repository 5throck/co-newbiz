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
    const raw = await complete(
      [
        systemMessage("s9.dd_tailor"),
        { role: "user", content: `도메인: ${domain}\n산업: ${ctx.industry}\n프로젝트: ${ctx.projectId}` },
      ],
      { temperature: 0.4, maxTokens: 1400, agent: promptAgent("s9.dd_tailor") },
    );
    const drafts = parseDrafts(raw);
    if (drafts.length > 0) return drafts;
    throw new Error("LLM tailor 응답을 항목 배열로 해석하지 못했습니다.");
  };
}
