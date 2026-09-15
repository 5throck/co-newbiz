// External research helpers for S2/S3 pipelines.
//  - tavilySearch: web search via TAVILY_API_KEY (global reports, broker
//    notes, statistics sites, news). Returns [] when the key is absent —
//    callers degrade to LLM-knowledge-only with "출처 미확보" marking.
//  - dart helpers live in dart-client.ts.

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

import { loadRootEnvPipelineKeys } from "./llm.ts";

// 테스트 시임 — 실제 Tavily 키가 설정된 환경에서도 회귀 테스트를 단일하게
// (네트워크 호출 없이) 만든다. dd-checklist-tailor의 executor factory와 같은
// 취지다. 프로덕션 코드는 이 함수를 호출하지 않는다.
let testOverride: { configured: boolean; sources: WebSource[] } | null = null;
export function setWebResearchOverrideForTests(override: { configured: boolean; sources: WebSource[] } | null): void {
  testOverride = override;
}

export function isWebResearchConfigured(): boolean {
  if (testOverride) return testOverride.configured;
  loadRootEnvPipelineKeys();
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

interface TavilyDetailedResult {
  sources: WebSource[];
  /** Tavily HTTP 432 — 플랜의 사용 한도 초과(과금/쿼터 문제, "검색 결과 0건"과는
   * 원인이 다르다). 호출자가 다른 폴백(LLM 자체 지식 등)을 고를 수 있게 구분해
   * 전달한다. */
  quotaExceeded: boolean;
}

async function tavilySearchDetailed(query: string, opts: { maxResults?: number } = {}): Promise<TavilyDetailedResult> {
  loadRootEnvPipelineKeys();
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return { sources: [], quotaExceeded: false };
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: opts.maxResults ?? 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // 침묵 대신 원인을 남긴다 — 중단된 웹 리서치가 "근거 없음"과 구분되어야 한다.
      console.error(`tavily search HTTP ${res.status} for query: ${query.slice(0, 80)}`);
      return { sources: [], quotaExceeded: res.status === 432 };
    }
    const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    const sources = (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 400) }));
    return { sources, quotaExceeded: false };
  } catch (err) {
    console.error("tavily search failed:", err instanceof Error ? err.message : err);
    return { sources: [], quotaExceeded: false };
  }
}

export async function tavilySearch(query: string, opts: { maxResults?: number } = {}): Promise<WebSource[]> {
  return (await tavilySearchDetailed(query, opts)).sources;
}

interface ResearchSourcesDetailed {
  sources: WebSource[];
  quotaExceeded: boolean;
}

/** researchSources와 동일하지만, 쿼터 초과(HTTP 432)를 "검색 결과 0건"과
 * 구분해서 돌려준다 — 쿼터 초과일 때만 LLM 자체 지식 폴백으로 갈지 호출자가
 * 정할 수 있게 한다. */
export async function researchSourcesDetailed(queries: string[], limit = 10): Promise<ResearchSourcesDetailed> {
  if (testOverride) return { sources: testOverride.sources.slice(0, limit), quotaExceeded: false };
  const results = await Promise.all(queries.map((q) => tavilySearchDetailed(q, { maxResults: 4 })));
  const seen = new Set<string>();
  const merged: WebSource[] = [];
  let quotaExceeded = false;
  for (const r of results) {
    if (r.quotaExceeded) quotaExceeded = true;
    for (const s of r.sources) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      if (merged.length < limit) merged.push(s);
    }
  }
  return { sources: merged, quotaExceeded };
}

/** Run several queries and merge results (deduped by URL), max `limit` items. */
export async function researchSources(queries: string[], limit = 10): Promise<WebSource[]> {
  return (await researchSourcesDetailed(queries, limit)).sources;
}
