// @version 1.0.0
// price-evidence — web-search evidence drafts for the target-costing market
// price anchor (design 2026-09-18-target-costing-price-anchor; ADR-0118/0141
// draft pattern: PROPOSALS ONLY, nothing persisted, confirmation is human).
//
// Rules baked into the extractor (and mirrored by the s8.price_evidence
// prompt): a candidate price without an explicit currency AND unit is not a
// price; a candidate without a source URL is dropped before it can be shown;
// zero candidates means "확인 안 됨" — a missing price is reported as missing,
// never fabricated. The deterministic fallback keeps the flow unblocked on
// hosts without search keys or LLM configuration.

import { completeOrFallback, isLlmConfigured, type LlmMessage } from "./llm.ts";
import { systemMessage } from "./prompts.ts";
import { isWebResearchConfigured, researchSourcesDetailed, type WebSource } from "./web-research.ts";

export interface PriceProposal {
  unit_price: number;
  currency: string;
  unit: string;
  source_url: string;
  source_name: string;
  quote: string;
  confidence: "high" | "medium" | "low";
}

export interface PriceDraftResult {
  proposals: PriceProposal[];
  queries: string[];
  /** Why the draft is empty (확인 안 됨 사유) — empty string when proposals exist. */
  note: string;
  source: "llm" | "fallback";
}

/** Query variants — s7 screening_draft's query design precedent: subject +
 * short label, three angles, never one long sentence. */
export function priceQueries(subject: string): string[] {
  const s = subject.trim() || "신규사업 제품";
  return [`${s} 단가`, `${s} 출고가 견적`, `${s} 시장가격`];
}

function httpUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

function parseProposals(text: string): PriceProposal[] {
  let parsed: unknown;
  try {
    const start = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const jsonStart = arrayStart !== -1 && (arrayStart < start || start === -1) ? arrayStart : start;
    if (jsonStart === -1) return [];
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    parsed = JSON.parse(text.slice(jsonStart, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { proposals?: unknown }).proposals) ? (parsed as { proposals: unknown[] }).proposals : [];
  const out: PriceProposal[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const unitPrice = Number(r.unit_price);
    const currency = typeof r.currency === "string" ? r.currency.trim() : "";
    const unit = typeof r.unit === "string" ? r.unit.trim() : "";
    const sourceUrl = r.source_url;
    // A price without an explicit currency AND unit is not a price; a
    // candidate without a source URL is dropped — both before display.
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    if (!currency || !unit) continue;
    if (!httpUrl(sourceUrl)) continue;
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    const confidence = r.confidence === "high" || r.confidence === "medium" || r.confidence === "low" ? r.confidence : "low";
    const dedupeKey = `${sourceUrl}|${unitPrice}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      unit_price: unitPrice,
      currency,
      unit,
      source_url: sourceUrl,
      source_name: typeof r.source_name === "string" && r.source_name.trim() ? r.source_name.trim() : new URL(sourceUrl).hostname,
      quote,
      confidence,
    });
  }
  return out;
}

function evidenceBlock(sources: WebSource[]): string {
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n본문: ${s.snippet.slice(0, 600)}`)
    .join("\n\n");
}

/** Draft price proposals from web-search evidence. PROPOSALS ONLY — the
 *  caller persists nothing; confirmation lands through the existing
 *  target-costing POST with the human as the actor. */
export async function draftPriceEvidence(opts: { subject: string; company?: string | null }): Promise<PriceDraftResult> {
  const subject = opts.company?.trim() ? `${opts.company.trim()} ${opts.subject.trim()}`.trim() : opts.subject.trim();
  const queries = priceQueries(subject);

  if (!isWebResearchConfigured()) {
    return { proposals: [], queries, note: "웹검색이 구성되지 않았습니다(TAVILY_API_KEY 없음, DDG 비활성) — 가격을 수동으로 입력하세요.", source: "fallback" };
  }

  const { sources } = await researchSourcesDetailed(queries, 12);
  if (sources.length === 0) {
    return { proposals: [], queries, note: "검색 결과가 0건입니다 — 근거 없는 가격은 생성하지 않습니다. 수동 입력 또는 다른 표현으로 재검색하세요.", source: "fallback" };
  }

  if (!isLlmConfigured()) {
    return { proposals: [], queries, note: "LLM이 구성되지 않아 검색 결과에서 가격을 추출하지 못했습니다 — 검색 결과를 확인해 수동 입력하세요.", source: "fallback" };
  }

  const messages: LlmMessage[] = [
    systemMessage("s8.price_evidence"),
    {
      role: "user" as const,
      content: [
        `대상: ${subject}`,
        "",
        "웹 검색 결과:",
        evidenceBlock(sources),
        "",
        '위 근거만 사용해 시장가격 후보를 JSON으로 반환하세요: {"proposals":[{"unit_price":숫자,"currency":"KRW","unit":"EA","source_url":"https://...","source_name":"출처명","quote":"근거 인용문","confidence":"high|medium|low"}]}. 규칙: 통화와 단위가 명시된 가격만 후보로 인정하고, 출처 URL이 없는 후보는 제외하며, 근거가 없으면 {"proposals":[]}를 반환합니다.',
      ].join("\n"),
    },
  ];

  const llmRes = await completeOrFallback(messages, () => "", {
    maxTokens: 1200,
    agent: { key: "quant-methodologist", purpose: "S8 타겟코스팅 가격 증거 추출 (web evidence → price proposals)" },
  });

  const proposals = llmRes.source === "llm" ? parseProposals(llmRes.text) : [];
  if (proposals.length === 0) {
    return {
      proposals: [],
      queries,
      note: `근거가 확인된 가격 후보가 없습니다(확인 안 됨). 검색 ${sources.length}건을 검토했으나 통화·단위·출처가 명시된 가격을 찾지 못했습니다 — 수동 입력 또는 재검색하세요.`,
      source: llmRes.source === "llm" ? "llm" : "fallback",
    };
  }
  return { proposals: proposals.slice(0, 6), queries, note: "", source: "llm" };
}
