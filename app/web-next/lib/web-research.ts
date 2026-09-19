// External research helpers for S2/S3 pipelines and the S6/S7 pre-check.
// Provider chain (2026-09-16, 사용자 결정 — "추가적인 웹 검색엔진으로
// DuckDuckGo"):
//   1. Tavily — primary, when TAVILY_API_KEY is set. LLM-oriented rich content.
//   2. DuckDuckGo — free fallback, when Tavily is unconfigured / quota-exceeded
//      (HTTP 432) / returned zero results. No official API — the HTML endpoint
//      is parsed best-effort (markup change or rate-limit → empty results, the
//      flow is never blocked). Disable with WEB_SEARCH_DDG_ENABLED=false.
// Callers degrade to LLM-knowledge-only with "출처 미확보" marking only when
// every provider yields nothing.
//  - dart helpers live in dart-client.ts.

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

import { loadRootEnvPipelineKeys } from "./llm.ts";

// 테스트 시임 — 실제 검색 키가 설정된 환경에서도 회귀 테스트를 단일하게
// (네트워크 호출 없이) 만든다. dd-checklist-tailor의 executor factory와 같은
// 취지다. 프로덕션 코드는 이 함수를 호출하지 않는다.
let testOverride: { configured: boolean; sources: WebSource[] } | null = null;
export function setWebResearchOverrideForTests(override: { configured: boolean; sources: WebSource[] } | null): void {
  testOverride = override;
}

/** DuckDuckGo 폴백 스위치 — 기본 활성. WEB_SEARCH_DDG_ENABLED=false|0|off 로 끈다. */
export function isDdgEnabled(): boolean {
  const v = process.env.WEB_SEARCH_DDG_ENABLED;
  return !(v && ["false", "0", "off"].includes(v.trim().toLowerCase()));
}

export function isWebResearchConfigured(): boolean {
  if (testOverride) return testOverride.configured;
  loadRootEnvPipelineKeys();
  return Boolean(process.env.TAVILY_API_KEY?.trim()) || isDdgEnabled();
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

// ── DuckDuckGo 폴백 (공식 API 부재 — HTML 엔드포인트 best-effort 파싱) ──

/** DDG html 엔드포인트 마크업에서 결과를 뽑는 순수 파서(테스트 가능성). 결과
 * 링크는 result__a, 스니펫은 result__snippet — 순서대로 짝짓는다. 링크 href는
 * //duckduckgo.com/l/?uddg=<encoded>&rut=... 리다이렉트 형태라 uddg를 디코딩해
 * 실제 출처 URL을 복원한다. 광고·내부 링크(http(s) 외)는 버린다. */
export function parseDdgResults(html: string, limit = 10): WebSource[] {
  const decodeEntities = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
  const links = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  const out: WebSource[] = [];
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const rawHref = links[i][1];
    const title = stripTags(decodeEntities(links[i][2])).replace(/\s+/g, " ").trim();
    if (!title) continue;
    let url = rawHref;
    try {
      const abs = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
      const u = new URL(abs);
      url = u.searchParams.get("uddg") ?? u.toString();
    } catch {
      // 상대 경로 등 파싱 불가한 href — 원문을 남기고 https 필터에서 걸러진다.
    }
    if (!/^https?:\/\//.test(url)) continue;
    const snippet = snippets[i] ? stripTags(decodeEntities(snippets[i][1])).replace(/\s+/g, " ").trim().slice(0, 400) : "";
    out.push({ title, url, snippet });
  }
  return out;
}

async function ddgSearchDetailed(query: string, opts: { maxResults?: number } = {}): Promise<{ sources: WebSource[] }> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        // 기본 UA(fetch)는 차단되기 쉽다 — 브라우저 UA가 필요하다.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ko,en;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`ddg search HTTP ${res.status} for query: ${query.slice(0, 80)}`);
      return { sources: [] };
    }
    return { sources: parseDdgResults(await res.text(), opts.maxResults ?? 5) };
  } catch (err) {
    console.error("ddg search failed:", err instanceof Error ? err.message : err);
    return { sources: [] };
  }
}

interface ResearchSourcesDetailed {
  sources: WebSource[];
  quotaExceeded: boolean;
}

/** 여러 쿼리를 제공자 체인으로 실행하고 결과를 URL 기준 dedupe해 `limit`개로
 * 합친다. Tavily(키 있을 때) 먼저, 결과가 비었거나 쿼터 초과(432)면 DuckDuckGo
 * 폴백. 쿼터 초과 플래그는 Tavily에서만 세팅된다 — DDG는 쿼터 개념이 없다. */
export async function researchSourcesDetailed(queries: string[], limit = 10): Promise<ResearchSourcesDetailed> {
  if (testOverride) return { sources: testOverride.sources.slice(0, limit), quotaExceeded: false };
  loadRootEnvPipelineKeys();
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const seen = new Set<string>();
  const merged: WebSource[] = [];
  const push = (s: WebSource) => {
    if (seen.has(s.url) || merged.length >= limit) return;
    seen.add(s.url);
    merged.push(s);
  };
  let quotaExceeded = false;
  if (tavilyKey) {
    const results = await Promise.all(queries.map((q) => tavilySearchDetailed(q, { maxResults: 4 })));
    for (const r of results) {
      if (r.quotaExceeded) quotaExceeded = true;
      for (const s of r.sources) push(s);
    }
  }
  if (isDdgEnabled() && (merged.length === 0 || quotaExceeded)) {
    // 폴백 개시 가시성 — 성공은 조용히 지나가므로 운영자가 체인 동작을 알 수
    // 없다. 개시 시 쿼리 수와 회수 결과를 한 줄로 남긴다(2026-09-19).
    console.info(`[web-research] ddg fallback engaged — ${queries.length} query(ies), tavily quotaExceeded=${quotaExceeded}`);
    for (const q of queries) {
      if (merged.length >= limit) break;
      const r = await ddgSearchDetailed(q, { maxResults: 4 });
      if (r.sources.length === 0) console.info(`[web-research] ddg returned 0 results for: ${q.slice(0, 60)}`);
      for (const s of r.sources) push(s);
    }
  }
  return { sources: merged, quotaExceeded };
}

/** Run several queries and merge results (deduped by URL), max `limit` items. */
export async function researchSources(queries: string[], limit = 10): Promise<WebSource[]> {
  return (await researchSourcesDetailed(queries, limit)).sources;
}
