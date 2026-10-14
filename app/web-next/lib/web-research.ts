// External research helpers for S2/S3 pipelines and the S6/S7 pre-check.
// Provider chain (2026-09-16, 사용자 결정 — "추가적인 웹 검색엔진으로
// DuckDuckGo"):
//   1. Tavily — primary, when TAVILY_API_KEY is set. LLM-oriented rich content.
//   2. Brave Search / Serper (2026-10-14) — optional JSON APIs, each skipped when its key
//      (BRAVE_SEARCH_API_KEY / SERPER_API_KEY) is absent.
//   3. DuckDuckGo — free fallback, when Tavily is unconfigured / quota-exceeded
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
import { hasPlaywrightOverrideForTests, playwrightSearchDetailed } from "./playwright-search.ts";

// 테스트 시임 — 실제 검색 키가 설정된 환경에서도 회귀 테스트를 단일하게
// (네트워크 호출 없이) 만든다. dd-checklist-tailor의 executor factory와 같은
// 취지다. 프로덕션 코드는 이 함수를 호출하지 않는다.
let testOverride: { configured: boolean; sources: WebSource[] } | null = null;
export function setWebResearchOverrideForTests(override: { configured: boolean; sources: WebSource[] } | null): void {
  testOverride = override;
  resetWebResearchStateForTests();
}

/** DuckDuckGo 폴백 스위치 — 기본 활성. WEB_SEARCH_DDG_ENABLED=false|0|off 로 끈다. */
export function isDdgEnabled(): boolean {
  const v = process.env.WEB_SEARCH_DDG_ENABLED;
  return !(v && ["false", "0", "off"].includes(v.trim().toLowerCase()));
}

export function isWebResearchConfigured(): boolean {
  if (testOverride) return testOverride.configured;
  loadRootEnvPipelineKeys();
  return Boolean(process.env.TAVILY_API_KEY?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || process.env.SERPER_API_KEY?.trim()) || isDdgEnabled();
}

// ── Per-provider diagnostics and circuit breaker (2026-10-14) ──

export type ProviderName = "tavily" | "brave" | "serper" | "ddg" | "playwright";
export type ProviderStatus = "ok" | "empty" | "quota_exceeded" | "blocked" | "http_error" | "no_key" | "disabled" | "unavailable";
export interface ProviderDiag {
  name: ProviderName;
  status: ProviderStatus;
  http?: number;
  /** True when the provider was skipped because its circuit breaker is open (a recent quota/blocked failure). */
  circuitOpen?: boolean;
}

const PROVIDER_LABEL: Record<ProviderName, string> = { tavily: "Tavily", brave: "Brave Search", serper: "Serper", ddg: "DuckDuckGo", playwright: "Playwright" };
const CIRCUIT_MS = 10 * 60 * 1000;
const circuits = new Map<ProviderName, { until: number; status: ProviderStatus; http?: number }>();
let nowFn: () => number = () => Date.now();
let providerOverride: SearchProvider[] | null = null;

/** Test hook: clears breakers, the clock and injected providers. */
export function resetWebResearchStateForTests(): void {
  circuits.clear();
  nowFn = () => Date.now();
  providerOverride = null;
}
export function setWebResearchClockForTests(fn: (() => number) | null): void { nowFn = fn ?? (() => Date.now()); }
export function setWebProvidersForTests(list: SearchProvider[] | null): void { providerOverride = list; }

export function isProviderCircuitOpen(name: ProviderName, at: number = nowFn()): boolean {
  const c = circuits.get(name);
  if (!c) return false;
  if (at >= c.until) { circuits.delete(name); return false; }
  return true;
}
function openCircuit(name: ProviderName, status: ProviderStatus, http?: number): void {
  circuits.set(name, { until: nowFn() + CIRCUIT_MS, status, http });
}

/** A provider that is configured but currently cannot serve (as opposed to simply having no key or finding nothing). */
export function isProviderFailure(s: ProviderStatus): boolean {
  return s === "quota_exceeded" || s === "blocked" || s === "http_error" || s === "unavailable";
}

export function providerCauseLabel(d: ProviderDiag): string {
  const n = PROVIDER_LABEL[d.name];
  if (d.status === "quota_exceeded") return `${n} 쿼터 초과${d.http ? `(${d.http})` : ""}`;
  if (d.status === "blocked") return `${n} 봇 차단`;
  if (d.status === "http_error") return `${n} 오류${d.http ? `(HTTP ${d.http})` : ""}`;
  if (d.status === "unavailable") return `${n} 실행 불가(Chrome 없음 또는 기동 실패)`;
  return n;
}

/** Causes of every failed provider, e.g. "Tavily 쿼터 초과(432), DuckDuckGo 봇 차단". Empty when none failed. */
export function providerFailureCauses(providers: ProviderDiag[]): string[] {
  return providers.filter((p) => isProviderFailure(p.status)).map(providerCauseLabel);
}
/** No provider could serve and at least one failed (so "no results" is really "search unavailable"). */
export function allProvidersUnavailable(providers: ProviderDiag[]): boolean {
  return providers.length > 0 && providers.some((p) => isProviderFailure(p.status)) && !providers.some((p) => p.status === "ok" || p.status === "empty");
}
export const SEARCH_KEY_ACTION = "Tavily 한도 확인 또는 다른 검색 키 설정(BRAVE_SEARCH_API_KEY, SERPER_API_KEY)";

const STATUS_RANK: Record<ProviderStatus, number> = { ok: 0, empty: 1, no_key: 2, disabled: 2, http_error: 3, unavailable: 3, blocked: 4, quota_exceeded: 5 };
/** Merge diagnostics from several calls: ok wins, otherwise the most severe failure is kept. */
export function mergeProviderDiags(into: ProviderDiag[], more: ProviderDiag[]): ProviderDiag[] {
  for (const d of more) {
    const i = into.findIndex((x) => x.name === d.name);
    if (i < 0) { into.push({ ...d }); continue; }
    const cur = into[i];
    if (cur.status === "ok") continue;
    if (d.status === "ok" || STATUS_RANK[d.status] > STATUS_RANK[cur.status]) into[i] = { ...d };
  }
  return into;
}

interface ProviderOutcome { sources: WebSource[]; status: ProviderStatus; http?: number }
export interface SearchProvider {
  name: ProviderName;
  /** "no_key" / "disabled" when it cannot run at all, otherwise null. */
  unavailable(): "no_key" | "disabled" | null;
  search(query: string, maxResults: number): Promise<ProviderOutcome>;
  /** Optional batch form: one browser session for several queries (Playwright). Used instead of per-query search(). */
  searchMany?(queries: string[], maxResults: number): Promise<ProviderOutcome>;
}

const failFor = (status: number): ProviderStatus => (status === 432 || status === 429 || status === 402 ? "quota_exceeded" : "http_error");

const tavilyProvider: SearchProvider = {
  name: "tavily",
  unavailable: () => { loadRootEnvPipelineKeys(); return process.env.TAVILY_API_KEY?.trim() ? null : "no_key"; },
  async search(query, maxResults) {
    const r = await tavilySearchDetailed(query, { maxResults });
    return { sources: r.sources, status: r.quotaExceeded ? "quota_exceeded" : r.sources.length ? "ok" : r.httpStatus ? "http_error" : "empty", http: r.quotaExceeded ? 432 : r.httpStatus };
  },
};

const braveProvider: SearchProvider = {
  name: "brave",
  unavailable: () => { loadRootEnvPipelineKeys(); return process.env.BRAVE_SEARCH_API_KEY?.trim() ? null : "no_key"; },
  async search(query, maxResults) {
    const key = process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
    try {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": key }, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { sources: [], status: failFor(res.status), http: res.status };
      const json = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      const sources = (json.web?.results ?? []).filter((r) => r.url).map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.description ?? "").slice(0, 400) }));
      return { sources, status: sources.length ? "ok" : "empty" };
    } catch (err) {
      console.error("brave search failed:", err instanceof Error ? err.message : err);
      return { sources: [], status: "http_error" };
    }
  },
};

const serperProvider: SearchProvider = {
  name: "serper",
  unavailable: () => { loadRootEnvPipelineKeys(); return process.env.SERPER_API_KEY?.trim() ? null : "no_key"; },
  async search(query, maxResults) {
    const key = process.env.SERPER_API_KEY?.trim() ?? "";
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "content-type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ q: query, num: maxResults, gl: "kr", hl: "ko" }), signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { sources: [], status: failFor(res.status), http: res.status };
      const json = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
      const sources = (json.organic ?? []).filter((r) => r.link).map((r) => ({ title: r.title ?? r.link!, url: r.link!, snippet: (r.snippet ?? "").slice(0, 400) }));
      return { sources, status: sources.length ? "ok" : "empty" };
    } catch (err) {
      console.error("serper search failed:", err instanceof Error ? err.message : err);
      return { sources: [], status: "http_error" };
    }
  },
};

const ddgProvider: SearchProvider = {
  name: "ddg",
  unavailable: () => (isDdgEnabled() ? null : "disabled"),
  search: (query, maxResults) => ddgSearchDetailed(query, { maxResults }),
};

/** Playwright opt-out: WEB_SEARCH_PLAYWRIGHT_ENABLED=false|0|off. Default on, except under test unless the override is set. */
export function isPlaywrightProviderEnabled(): boolean {
  const v = process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
  if (v && ["false", "0", "off"].includes(v.trim().toLowerCase())) return false;
  if (process.env.NODE_ENV === "test" && !hasPlaywrightOverrideForTests()) return false;
  return true;
}

// Headless Chrome is heavy: never run two browsers at once (the holding check calls the chain per row).
let playwrightQueue: Promise<unknown> = Promise.resolve();
const playwrightProvider: SearchProvider = {
  name: "playwright",
  unavailable: () => (isPlaywrightProviderEnabled() ? null : "disabled"),
  search: (query, maxResults) => playwrightProvider.searchMany!([query], maxResults),
  searchMany(queries, maxResults) {
    const run = playwrightQueue.then(() => playwrightSearchDetailed(queries, maxResults));
    playwrightQueue = run.catch(() => undefined);
    return run;
  },
};

/** Chain order: Tavily → Brave → Serper → DuckDuckGo, then (opt-in per call) Playwright headless. */
function providerChain(withPlaywright: boolean): SearchProvider[] {
  const base = providerOverride ?? [tavilyProvider, braveProvider, serperProvider, ddgProvider];
  return withPlaywright && !base.some((p) => p.name === "playwright") ? [...base, playwrightProvider] : base;
}

interface TavilyDetailedResult {
  sources: WebSource[];
  /** Tavily HTTP 432 — plan usage limit exceeded (a billing/quota problem, different from "zero results"). */
  quotaExceeded: boolean;
  /** Last non-OK HTTP status, when the call failed with one. */
  httpStatus?: number;
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
      console.error(`tavily search HTTP ${res.status} for query: ${query.slice(0, 80)}`);
      return { sources: [], quotaExceeded: res.status === 432, httpStatus: res.status };
    }
    const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    const sources = (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 400) }));
    return { sources, quotaExceeded: false };
  } catch (err) {
    console.error("tavily search failed:", err instanceof Error ? err.message : err);
    return { sources: [], quotaExceeded: false, httpStatus: 0 };
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

/** DDG serves a bot-challenge page (HTTP 200 or 202) instead of results: markers "anomaly"/"challenge" with no result link. */
export function isDdgChallengePage(html: string, status = 200): boolean {
  const hasResults = /result__a|result-link/.test(html);
  if (hasResults) return false;
  return status === 202 || /anomaly|challenge|captcha|unusual traffic/i.test(html);
}

/** Parser for the lite endpoint (table layout, `result-link` anchors, `result-snippet` cells). Attribute order is not assumed. */
export function parseDdgLiteResults(html: string, limit = 10): WebSource[] {
  const strip = (x: string) => x.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) => /result-link/.test(m[1]));
  const snippets = [...html.matchAll(/<td[^>]*class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/g)];
  const out: WebSource[] = [];
  for (let i = 0; i < anchors.length && out.length < limit; i++) {
    const hrefM = anchors[i][1].match(/href=["']([^"']+)["']/);
    if (!hrefM) continue;
    let url = hrefM[1].replace(/&amp;/g, "&");
    try {
      const u = new URL(url.startsWith("//") ? `https:${url}` : url);
      url = u.searchParams.get("uddg") ?? u.toString();
    } catch { /* unparsable href is dropped by the http filter below */ }
    const title = strip(anchors[i][2]);
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({ title, url, snippet: snippets[i] ? strip(snippets[i][1]).slice(0, 400) : "" });
  }
  return out;
}

const DDG_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function ddgSearchDetailed(query: string, opts: { maxResults?: number } = {}): Promise<ProviderOutcome> {
  const max = opts.maxResults ?? 5;
  let blocked = false;
  let http: number | undefined;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": DDG_UA, "Accept-Language": "ko,en;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 202) {
      console.error(`ddg search HTTP ${res.status} for query: ${query.slice(0, 80)}`);
      http = res.status;
    } else {
      const html = await res.text();
      const found = parseDdgResults(html, max);
      if (found.length > 0) return { sources: found, status: "ok" };
      if (isDdgChallengePage(html, res.status)) blocked = true;
      else return { sources: [], status: "empty" };
    }
  } catch (err) {
    console.error("ddg search failed:", err instanceof Error ? err.message : err);
    return { sources: [], status: "http_error" };
  }
  // The html endpoint is blocked or errored: try the lite endpoint once.
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { "User-Agent": DDG_UA, "Accept-Language": "ko,en;q=0.8", "content-type": "application/x-www-form-urlencoded" },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });
    const html = res.ok || res.status === 202 ? await res.text() : "";
    const found = html ? parseDdgLiteResults(html, max) : [];
    if (found.length > 0) return { sources: found, status: "ok" };
    if (html && !isDdgChallengePage(html, res.status) && !blocked) return { sources: [], status: "empty" };
    if (!res.ok && res.status !== 202 && !blocked) return { sources: [], status: "http_error", http: res.status };
    return { sources: [], status: "blocked" };
  } catch (err) {
    console.error("ddg lite failed:", err instanceof Error ? err.message : err);
    return blocked ? { sources: [], status: "blocked" } : { sources: [], status: "http_error", http };
  }
}

interface ResearchSourcesDetailed {
  sources: WebSource[];
  quotaExceeded: boolean;
  /** Per-provider outcome of this call (chain order). */
  providers: ProviderDiag[];
}

/** Run every query through one provider; the first quota/blocked answer stops the remaining queries. */
async function runProvider(p: SearchProvider, queries: string[], maxQueries?: number): Promise<{ sources: WebSource[]; diag: ProviderDiag }> {
  const sources: WebSource[] = [];
  let worst = "empty" as ProviderStatus;
  let http: number | undefined;
  let anyOk = false;
  const note = (o: ProviderOutcome) => {
    for (const s of o.sources) sources.push(s);
    if (o.status === "ok") anyOk = true;
    else if (STATUS_RANK[o.status] > STATUS_RANK[worst]) { worst = o.status; http = o.http; }
  };
  if (p.searchMany) {
    note(await p.searchMany(queries.slice(0, maxQueries ?? queries.length), 8));
  } else {
    for (const q of queries) {
      const o = await p.search(q, 4);
      note(o);
      if (o.status === "quota_exceeded" || o.status === "blocked") break;
    }
  }
  const hardFail = worst === "quota_exceeded" || worst === "blocked" || worst === "unavailable";
  if (hardFail) openCircuit(p.name, worst, http);
  const status: ProviderStatus = anyOk ? "ok" : worst;
  return { sources, diag: { name: p.name, status, ...(http !== undefined ? { http } : {}) } };
}

/** 여러 쿼리를 제공자 체인(Tavily → Brave → Serper → DuckDuckGo)으로 실행하고 결과를 URL 기준
 * dedupe해 `limit`개로 합친다. 앞 제공자가 결과를 못 냈거나 쿼터 초과면 다음으로 넘어간다.
 * 쿼터 초과·봇 차단은 10분간 해당 제공자를 건너뛴다(회로 차단). 결과의 providers에 제공자별
 * 상태가 담겨, 호출자가 "결과 0건"과 "검색 불가"를 구분할 수 있다. */
export interface ResearchOptions {
  /** Append the Playwright headless provider after the others (only tried when they returned nothing). Default false. */
  playwright?: boolean;
  /** Epoch ms after which Playwright is not started (the caller's own deadline). */
  deadlineAt?: number;
  /** Cap on queries sent to Playwright per call (a browser session is slow). Default 1. */
  playwrightQueries?: number;
}
const PLAYWRIGHT_MIN_REMAINING_MS = 8_000;

export async function researchSourcesDetailed(queries: string[], limit = 10, opts: ResearchOptions = {}): Promise<ResearchSourcesDetailed> {
  if (testOverride) return { sources: testOverride.sources.slice(0, limit), quotaExceeded: false, providers: [] };
  const seen = new Set<string>();
  const merged: WebSource[] = [];
  const providers: ProviderDiag[] = [];
  let quotaExceeded = false;
  for (const p of providerChain(opts.playwright === true)) {
    const off = p.unavailable();
    if (off) { providers.push({ name: p.name, status: off }); continue; }
    if (isProviderCircuitOpen(p.name)) {
      const c = circuits.get(p.name)!;
      providers.push({ name: p.name, status: c.status, ...(c.http !== undefined ? { http: c.http } : {}), circuitOpen: true });
      if (c.status === "quota_exceeded") quotaExceeded = true;
      continue;
    }
    if (p.name === "playwright") {
      // Last resort: only when nothing was found and there is time left for a browser session.
      if (merged.length > 0) continue;
      if (opts.deadlineAt !== undefined && opts.deadlineAt - nowFn() < PLAYWRIGHT_MIN_REMAINING_MS) continue;
    } else if (merged.length > 0 && !quotaExceeded) { continue; }
    if (p.name === "ddg") console.info(`[web-research] ddg fallback engaged — ${queries.length} query(ies), quotaExceeded=${quotaExceeded}`);
    const r = await runProvider(p, queries, p.name === "playwright" ? (opts.playwrightQueries ?? 1) : undefined);
    providers.push(r.diag);
    if (r.diag.status === "quota_exceeded") quotaExceeded = true;
    for (const s of r.sources) {
      if (seen.has(s.url) || merged.length >= limit) continue;
      seen.add(s.url);
      merged.push(s);
    }
  }
  return { sources: merged, quotaExceeded, providers };
}

/** Run several queries and merge results (deduped by URL), max `limit` items. */
export async function researchSources(queries: string[], limit = 10): Promise<WebSource[]> {
  return (await researchSourcesDetailed(queries, limit)).sources;
}
