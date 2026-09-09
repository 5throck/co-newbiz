// DART (전자공시시스템) client — k-dart 스킬 v2.1.0 구현 (ADR: k-dart P1~P5 고도화).
// 회사 조회(폴백 체인 + 교차검증) · 재무제표(계정 확장·합산 검증·연결/개별 폴백) ·
// 공시 검색 프리셋 · 지분 안정성 시그널 · 공시 원문 입수.
// 모든 호출은 dartFetch() 경유 — 동시성 캡·백오프·일 호출 예산 (P5).
// DART_API_KEY 미구성 시 graceful degradation (호출자가 웹 리서치로 강등).

export interface DartFinancials {
  corpCode: string;
  corpName?: string;
  found: boolean;
  year?: string;
  /** 연결(CFS) 실패 시 개별(BFS)로 폴백한 경우 폴백 여부 (P2-6) */
  fsDiv?: "CFS" | "BFS";
  fsDivLabel?: string;
  /** 합산 검증 결과 — 정상 null, 비일치 "warning" (P2-5) */
  integrity?: "ok" | "warning" | null;
  integrityNotes?: string[];
  /** 개별 재무 항목 (연도별 조회 시 항목마다 year 태그) */
  items: Array<{ name: string; value: number; unit: string; year?: string }>;
  /** 연도별 재무 요약 — 연도가 있는 조회에서 채워진다 */
  yearly?: Array<{ year: string; items: Array<{ name: string; value: number; unit: string }> }>;
  reportUrl?: string;
  raw?: unknown;
  error?: string;
}

const BASE = "https://opendart.fss.or.kr/api";

import { loadRootEnvPipelineKeys } from "./llm.ts";

function apiKey(): string | null {
  loadRootEnvPipelineKeys();
  const key = process.env.DART_API_KEY?.trim();
  return key || null;
}

export function isDartConfigured(): boolean {
  return apiKey() !== null;
}

/* ── P5-10: 공용 fetch 래퍼 — 동시성 세마포어(≤5) · 지수 백오프 · 일 호출 예산 ── */

const MAX_CONCURRENCY = 5;
const DAILY_BUDGET = 15_000; // OpenDART 일 20,000건 제한의 안전분 75%
let active = 0;
let dayStamp = new Date().toISOString().slice(0, 10);
let callCount = 0;

const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENCY) { active++; return; }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  active++;
}

function releaseSlot(): void {
  active--;
  const next = waitQueue.shift();
  if (next) next();
}

export function dartBudgetUsed(): { day: string; calls: number; budget: number } {
  return { day: dayStamp, calls: callCount, budget: DAILY_BUDGET };
}

interface DartFetchOptions {
  timeoutMs?: number;
  accept?: "json" | "any";
}

/** 모든 OpenDART 호출의 단일 관문 — 세마포어·일 예산·백오프(429 또는 status 020). */
export async function dartFetch(url: string, opts: DartFetchOptions = {}): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) { dayStamp = today; callCount = 0; }
  if (callCount >= DAILY_BUDGET) throw new Error(`DART 일 호출 예산 초과 (${DAILY_BUDGET}건) — 내일 재시도하세요.`);

  for (let attempt = 0; attempt < 3; attempt++) {
    await acquireSlot();
    try {
      callCount++;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      // HTML 응답 = 차단/오류 페이지 — 백오프 후 재시도 가치가 있다.
      const contentType = res.headers.get("content-type") ?? "";
      if (opts.accept !== "any" && !contentType.includes("json") && res.status === 200) {
        if (attempt < 2) { await backoff(attempt); continue; }
      }
      if (res.status === 429 && attempt < 2) { await backoff(attempt); continue; }
      return res;
    } finally {
      releaseSlot();
    }
  }
  throw new Error("DART 요청 제한 초과 — 백오프 후에도 실패했습니다.");
}

/** OpenDART JSON 응답 전용 파서 — HTML 차단 페이지를 명확한 오류로 변환, status 020 백오프. */
async function dartJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await dartFetch(url, { timeoutMs });
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("DART_HTML_BLOCKED");
  const json = JSON.parse(text) as T & { status?: string; message?: string };
  // 020: 요청 제한 초과 — 재시도 한 번 더 허용(dartFetch의 백오프와 별도).
  if (json.status === "020") throw new Error("DART_RATE_LIMITED");
  return json;
}

async function backoff(attempt: number): Promise<void> {
  const ms = 1_500 * 2 ** attempt; // 1.5s → 3s
  await new Promise((r) => setTimeout(r, ms));
}

/* ── corp_code 목록 캐시 — 메모리 + 디스크(db/data/dart-corpcode-cache.json) ── */

export interface CorpRow { corp_code: string; corp_name: string; stock_code?: string }
export interface CorpRowsResult { rows: CorpRow[]; stale: boolean; error: string | null; results: CorpRow[] }

let corpRowsCache: CorpRow[] | null = null;

function between(s: string, a: string, b: string): string {
  const i0 = s.indexOf(a);
  if (i0 === -1) return "";
  const i1 = s.indexOf(b, i0 + a.length);
  return i1 === -1 ? "" : s.slice(i0 + a.length, i1);
}

function cacheFile(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { dirname, join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  let dir = /*turbopackIgnore: true*/ process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "db", "data");
    if (existsSync(candidate)) return join(candidate, "dart-corpcode-cache.json");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(/*turbopackIgnore: true*/ process.cwd(), "db", "data", "dart-corpcode-cache.json");
}

/** P5-11: 캐시 무결성 — 행 수·형식 검증 후 유효한 캐시만 반환. */
function readCache(): { fetched_at: string; rows: CorpRow[] } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const parsed = JSON.parse(readFileSync(cacheFile(), "utf-8")) as { fetched_at: string; rows: unknown };
    if (!Array.isArray(parsed.rows) || parsed.rows.length < 1_000) return null; // 정상 덤프는 11만행 수준
    const rows = (parsed.rows as CorpRow[]).filter((r) => typeof r?.corp_code === "string" && typeof r?.corp_name === "string");
    return rows.length === parsed.rows.length ? { fetched_at: parsed.fetched_at, rows } : null;
  } catch {
    return null;
  }
}

function writeCache(rows: CorpRow[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { dirname, join } = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const path = cacheFile();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ fetched_at: new Date().toISOString(), row_count: rows.length, rows }));
  } catch { /* 캐시 기록 실패는 치명적이지 않다 */ }
}

/** P5-11: ZIP slip/bomb 방어 — 크기 상한(50MB)·압축비 상한(100x), 첫 파일의 XML만 추출. */
export function parseCorpXml(buf: Buffer): CorpRow[] {
  const MAX_ZIP = 50 * 1024 * 1024;
  const MAX_RATIO = 100;
  if (buf.length > MAX_ZIP) return [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { inflateRawSync } = require("node:zlib") as typeof import("node:zlib");
  if (!(buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b)) return [];
  let xml = "";
  const sig = (i: number) => buf[i] === 0x50 && buf[i + 1] === 0x4b;
  for (let i = 0; i < buf.length - 4 && !xml; i++) {
    if (!(sig(i) && buf[i + 2] === 0x03 && buf[i + 3] === 0x04)) continue;
    const compressionMethod = buf.readUInt16LE(i + 8);
    let compressedSize = buf.readUInt32LE(i + 18);
    const uncompressedSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const fileName = buf.subarray(i + 30, i + 30 + nameLen).toString("utf-8");
    if (fileName.includes("/") || fileName.includes("..")) return []; // slip 방지 — 단일 파일 덤프만 허용
    const dataStart = i + 30 + nameLen + extraLen;
    if (compressedSize === 0) {
      // 스트리밍 ZIP(data descriptor) — 로컬 헤더에 크기 미기록. 다음 시그니처까지를 데이터로 간주.
      let next = -1;
      for (let j = dataStart; j < buf.length - 4; j++) {
        if (sig(j) && (buf[j + 2] === 0x03 || buf[j + 2] === 0x01)) { next = j; break; }
      }
      if (next === -1) next = buf.length;
      compressedSize = Math.min(next - dataStart, MAX_ZIP);
    }
    if (compressedSize <= 0 || compressedSize > MAX_ZIP) return [];
    if (uncompressedSize > 0 && uncompressedSize / compressedSize > MAX_RATIO) return []; // 압축비 이상 = bomb 의심
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    xml = compressionMethod === 8 ? inflateRawSync(data, { maxOutputLength: MAX_ZIP }).toString("utf-8") : data.toString("utf-8");
  }
  const rows: CorpRow[] = [];
  for (const row of xml.split("<list>").slice(1)) {
    const name = between(row, "<corp_name>", "</corp_name>");
    const code = between(row, "<corp_code>", "</corp_code>");
    const stock = between(row, "<stock_code>", "</stock_code>");
    if (code && name) rows.push({ corp_code: code, corp_name: name, stock_code: stock || undefined });
  }
  return rows;
}

// 고유번호 디렉터리는 변경이 드물다 — 30일 TTL (만료돼도 stale-while-revalidate로 검색 유지)
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function loadCorpRows(opts: { forceRefresh?: boolean } = {}): Promise<CorpRowsResult> {
  if (!opts.forceRefresh && corpRowsCache) return { rows: corpRowsCache, stale: false, error: null, results: [] };
  const cache = readCache();
  const fresh = !!cache && Date.now() - Date.parse(cache.fetched_at) < CACHE_TTL_MS;
  if (!opts.forceRefresh && cache && fresh) { corpRowsCache = cache.rows; return { rows: cache.rows, stale: false, error: null, results: [] }; }
  const key = apiKey();
  if (!key) return { rows: cache?.rows ?? [], stale: !!cache, error: "DART_API_KEY 미구성", results: [] };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { existsSync, mkdtempSync, rmSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { join } = require("node:path") as typeof import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "dart-"));
  let downloadError = "DART 응답 파싱 실패";
  try {
        // 주의 — 엔드포인트는 corpCode.xml(.zip이 아님; .zip은 HTML 차단 페이지 반환).
    const res = await dartFetch(`${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`, { timeoutMs: 60_000, accept: "any" });
    if (!res.ok) {
      downloadError = `DART HTTP ${res.status}`;
    } else {
      const rows = parseCorpXml(Buffer.from(await res.arrayBuffer()));
      if (rows.length > 0) { writeCache(rows); corpRowsCache = rows; return { rows, stale: false, error: null, results: [] }; }
      downloadError = "DART 응답이 HTML 페이지입니다 — 접속이 일시적으로 제한되었을 수 있습니다.";
    }
  } catch (err) {
    downloadError = err instanceof Error ? err.message : String(err);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (cache) { corpRowsCache = cache.rows; return { rows: cache.rows, stale: true, error: `${downloadError} — 기존 캐시로 검색합니다.`, results: [] }; }
  return { rows: [], stale: false, error: `${downloadError} — 잠시 후 재시도하거나 비상장 입력 모드를 사용하세요.`, results: [] };
}

export async function findCorpCode(companyName: string): Promise<string | null> {
  if (!apiKey()) return null;
  const { rows } = await loadCorpRows();
  if (rows.length === 0) return null;
  const q = companyName.trim();
  return rows.find((r) => r.corp_name === q)?.corp_code ?? rows.find((r) => r.corp_name.includes(q))?.corp_code ?? null;
}

export async function searchCorpCodesWithMeta(query: string, limit = 8): Promise<CorpRowsResult & { results: CorpRow[] }> {
  const key = apiKey();
  if (!key) return { rows: [], stale: false, error: "DART_API_KEY 미구성", results: [] };
  const q = query.trim();
  if (!q) return { rows: [], stale: false, error: null, results: [] };

  // 목록 캐시(전체 고유번호)가 있으면 메모리에서 이름 매칭 — 호출 예산을 소모하지 않는다.
  const { rows: bulk, stale, error: bulkError } = await loadCorpRows();
  if (bulk.length > 0) {
    const exact = bulk.filter((r) => r.corp_name === q);
    const partial = bulk.filter((r) => r.corp_name !== q && r.corp_name.includes(q));
    const results = [...exact, ...partial].slice(0, limit);
    if (results.length > 0) return { rows: [], stale, error: stale ? bulkError : null, results };
  }

  // 캐시 부재·무결과 시 list.json 공시 목록의 필러 이름으로 보완 검색 (best-effort).
  const results: CorpRow[] = [];
  const seen = new Set<string>();
  let lastStatus = "";
  for (const corpCls of ["Y", "K", "E"]) {
    try {
      const json = await dartJson<{ status?: string; total_page?: number; list?: Array<{ corp_code?: string; corp_name?: string }> }>(
        `${BASE}/list.json?crtfc_key=${encodeURIComponent(key)}&corp_cls=${corpCls}&page_no=1&page_count=100`,
      );
      lastStatus = json.status ?? "";
      if (json.status !== "000" || !Array.isArray(json.list)) break;
      for (const r of json.list) {
        const name = (r.corp_name ?? "").trim();
        const code = (r.corp_code ?? "").trim();
        if (!name || !code || seen.has(code)) continue;
        seen.add(code);
        if (name.includes(q)) results.push({ corp_code: code, corp_name: name });
        if (results.length >= limit) break;
      }
    } catch { /* 공시 목록 보완 검색 실패는 치명적이지 않다 */ }
  }
  if (results.length === 0 && lastStatus && lastStatus !== "000") {
    return { rows: [], stale, error: `DART 검색 결과가 없습니다 (status ${lastStatus})`, results: [] };
  }
  return { rows: [], stale, error: stale ? bulkError : null, results };
}

export async function searchCorpCodes(query: string, limit = 8): Promise<CorpRow[]> {
  return (await searchCorpCodesWithMeta(query, limit)).results;
}

/**
 * P1-2: corp_code 폴백 체인의 단일 진입점.
 * 체인: ① 목록 캐시 검색 → ② corpCode.xml 재시도 → ③ 웹 폴백(naviCrpCik/corpCode 패턴)
 * → 각 단계 결과는 company.json 역조회로 교차 검증한다.
 */
export interface CorpResolution {
  corpCode: string | null;
  corpName: string | null;
  resolvedVia: "bulk" | "web" | "none";
  validated: boolean | null;
  note?: string;
}

export async function resolveCorpCode(name: string): Promise<CorpResolution> {
  const q = name.trim();
  if (!q) return { corpCode: null, corpName: null, resolvedVia: "none", validated: null };
  // ① bulk 목록
  const bulk = await searchCorpCodesWithMeta(q, 5);
  const bulkHit = bulk.results.find((r) => r.corp_name === q) ?? bulk.results[0];
  if (bulkHit) {
    const v = await validateCorpCode(bulkHit.corp_code, q);
    if (v.validated !== false) return { corpCode: bulkHit.corp_code, corpName: v.corpName ?? bulkHit.corp_name, resolvedVia: "bulk", validated: v.validated };
  }
  // ③ 웹 폴백 ( corp-code-fallback 순환 참조 방지 — 동적 import )
  const { webFallbackCorpCodes } = await import("./corp-code-fallback.ts");
  const candidates = await webFallbackCorpCodes(q, 5);
  const validated = candidates.find((c) => c.validated === true);
  if (validated) return { corpCode: validated.corp_code, corpName: validated.corp_name ?? q, resolvedVia: "web", validated: true };
  return { corpCode: null, corpName: null, resolvedVia: "none", validated: false, note: `폴백 후보 ${candidates.length}건이 검증 통과 못함` };
}

/**
 * corp_code 역검증(교차 검증) — OpenDART 기업개황(company.json)으로 코드가
 * 실제로 존재하는 회사인지, 이름과 일치하는지 확인한다.
 * DART 자체가 응답하지 않으면 validated=null로 반환해 호출자가 다른 검증
 * 경로(다중 소스 일치 등)를 쓰도록 한다.
 */
export interface CorpProfileValidation {
  validated: boolean | null;
  corpName?: string;
}
export async function validateCorpCode(corpCode: string, expectName?: string): Promise<CorpProfileValidation> {
  const key = apiKey();
  if (!key) return { validated: null };
  try {
    const json = await dartJson<{ status?: string; corp_name?: string }>(
      `${BASE}/company.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}`,
      15_000,
    );
    if (json.status !== "000" || !json.corp_name) return { validated: false };
    const name = json.corp_name.trim();
    if (expectName) {
      const e = expectName.trim();
      return { validated: name === e || name.includes(e) || e.includes(name), corpName: name };
    }
    return { validated: true, corpName: name };
  } catch {
    return { validated: null };
  }
}

/* ── P2: 재무제표 — 계정 확장·별칭 정규화 · 합산 검증 · CFS→BFS 폴백 ── */

/** K-IFRS 계정 별칭 → 표준 계정명 정규화 (P2-4). lib/company-financials.ts의
 * 파생 별칭과 정합을 유지한다 — 여기서 정규화하지 못한 변형명(영업이익(손실) 등)은
 * WANTED_ACCOUNTS 화이트리스트에서 drop되어 파생 단계에 도달하지 않는다. */
const ACCOUNT_ALIASES: Record<string, string> = {
  "수익(매출액)": "매출액",
  "영업수익": "매출액",
  "매출과판매비와관리비": "판매비와관리비",
  "판매와관리비": "판매비와관리비",
  "판관비": "판매비와관리비",
  "영업손익": "영업이익",
  "영업이익(손실)": "영업이익",
  "당기순이익(손실)": "당기순이익",
  "반기순이익": "당기순이익",
  "분기순이익": "당기순이익",
  "법인세비용차감전순이익": "세전이익",
  // 주의: "지배기업 소유주지분 순이익/자본"은 의도적으로 정규화하지 않는다 —
  // 총계 행이 이미 존재할 때 소계(비지배지분 제외)가 먼저 나오면 first-wins
  // 중복 제거가 총계를 소계로 대체할 수 있다.
};

const WANTED_ACCOUNTS = [
  "매출액", "매출원가", "판매비와관리비", "영업이익", "당기순이익",
  "자산총계", "부채총계", "자본총계",
];

export function normalizeAccountName(raw: string): string {
  const t = raw.trim();
  return ACCOUNT_ALIASES[t] ?? t;
}

/** P2-5: 합산 검증 — 자산총계 = 부채총계 + 자본총계 (±1% 허용). */
export function checkSummation(items: Array<{ name: string; value: number }>): boolean | null {
  const by = new Map(items.map((i) => [i.name, i.value]));
  const a = by.get("자산총계"); const l = by.get("부채총계"); const e = by.get("자본총계");
  if (a === undefined || l === undefined || e === undefined || a === 0) return null;
  return Math.abs(a - (l + e)) / Math.abs(a) <= 0.01;
}

/** Latest-year single-company full financial statements (reprt_code 11011). */
export async function fetchFinancials(corpCode: string, opts: { years?: number } = {}): Promise<DartFinancials> {
  const key = apiKey();
  const out: DartFinancials = { corpCode, found: false, items: [], yearly: [] };
  if (!key) { out.error = "DART_API_KEY 미구성"; return out; }
  const latest = new Date().getFullYear() - 1; // latest complete business year
  const yearsToFetch = Math.min(Math.max(opts.years ?? 1, 1), 5);
  let anyFound = false;
  let lastError: string | undefined;
  const integrityNotes: string[] = [];

  // 연결(CFS) 우선 — 연도별로 개별(BFS) 폴백이 발생하면 fsDiv로 표기 (P2-6).
  for (const fsDiv of ["CFS", "BFS"] as const) {
    if (anyFound && fsDiv === "BFS") break; // 연결로 성공했으면 개별 폴백 불필요
    out.items = [];
    out.yearly = [];
    anyFound = false;
    for (let y = 0; y < yearsToFetch; y++) {
      const year = latest - y;
      try {
        // fnlttSinglAcntAll은 api_key를 인식하지 못한다(HTML 오류 페이지 반환) — crttc_key 필수.
        const json = await dartJson<{ status?: string; list?: Array<{ account_nm?: string; thstrm_amount?: string; thstrm_nm?: string }> }>(
          `${BASE}/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}&bsns_year=${year}&reprt_code=11011&fs_div=${fsDiv}`,
        );
        if (json.status !== "000" || !Array.isArray(json.list)) {
          lastError = `DART ${json.status ?? "ERR"} — ${year}년 사업보고서 미제출 또는 코드 오류`;
          continue;
        }
        // All 엔드포인트는 공시 섹션마다 같은 계정명을 반복한다(값이 다를 수 있음) —
        // 첫 건(최상위 재무제표 순서)만 채택해 항목별 1개 값을 보장한다.
        const seenAccounts = new Set<string>();
        const byName = new Map<string, number>();
        const yearlyItems: Array<{ name: string; value: number; unit: string; year: string }> = [];
        for (const l of json.list) {
          const std = normalizeAccountName(l.account_nm ?? "");
          if (!WANTED_ACCOUNTS.includes(std) || !l.thstrm_amount) continue;
          if (seenAccounts.has(std)) continue;
          seenAccounts.add(std);
          const item = { name: std, value: Number(l.thstrm_amount), unit: "KRW", year: String(year) };
          byName.set(std, item.value);
          yearlyItems.push(item);
        }
        // P2-5: 합산 검증
        const sum = checkSummation([...byName.entries()].map(([name, value]) => ({ name, value })));
        if (sum === false) integrityNotes.push(`${year}: 자산총계 ≠ 부채총계+자본총계 (±1% 초과) — 해당 연도 수치 신뢰도 하향`);
        if (yearlyItems.length > 0) {
          anyFound = true;
          out.yearly!.push({ year: String(year), items: yearlyItems });
          out.items.push(...yearlyItems);
          if (!out.year) out.year = String(year);
          out.reportUrl = `https://dart.fss.or.kr/dsab007/main.do?option=corp&corp_code=${corpCode}`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "DART 조회 실패";
      }
    }
    if (anyFound) { out.fsDiv = fsDiv; out.fsDivLabel = fsDiv === "CFS" ? "연결재무제표" : "개별재무제표"; break; }
  }
  out.found = anyFound;
  if (integrityNotes.length > 0) { out.integrity = "warning"; out.integrityNotes = integrityNotes; } else { out.integrity = anyFound ? "ok" : null; }
  if (!anyFound) out.error = lastError ?? "DART 조회 실패 — corp_code를 확인하세요";
  return out;
}

/* ── P3-7: 공시 검색 프리셋 — S7 규제 스크리닝·S9 실사 증적 수집 ── */

export interface DisclosurePreset {
  key: "recent" | "amendment" | "audit" | "capital";
  label: string;
}

export const DISCLOSURE_PRESETS: DisclosurePreset[] = [
  { key: "recent", label: "최근 공시" },
  { key: "amendment", label: "정정공시" },
  { key: "audit", label: "감사 관련" },
  { key: "capital", label: "자본변동" },
];

export interface DisclosureRow {
  rcept_no: string;
  corp_name: string;
  report_nm: string;
  rcept_dt: string;
  preset: DisclosurePreset["key"];
}

/** 공시 제목 키워드 프리셋 — list.json의 report_nm 필터링 (OpenDART bbs_tp 조합 대비 관대함). */
const PRESET_KEYWORDS: Record<DisclosurePreset["key"], string[]> = {
  recent: [],
  amendment: ["정정"],
  audit: ["감사", "부적격", "의견"],
  capital: ["자본금", "유상증자", "감자", "전환사채", "주식매수선택권"],
};

export async function searchDisclosures(
  corpCode: string,
  preset: DisclosurePreset["key"] = "recent",
  limit = 20,
): Promise<{ found: boolean; disclosures: DisclosureRow[]; error?: string }> {
  const key = apiKey();
  if (!key) return { found: false, disclosures: [], error: "DART_API_KEY 미구성" };
  try {
    const disclosures: DisclosureRow[] = [];
    const keywords = PRESET_KEYWORDS[preset];
    // list.json은 corp_code 지정 시 조회 기간(bgn_de/end_de)이 필수다 — 최근 12개월.
    const end = new Date();
    const bgn = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    for (let pageNo = 1; pageNo <= 5 && disclosures.length < limit; pageNo++) {
      const json = await dartJson<{ status?: string; list?: Array<{ rcept_no?: string; corp_name?: string; report_nm?: string; rcept_dt?: string }> }>(
        `${BASE}/list.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}&bgn_de=${fmt(bgn)}&end_de=${fmt(end)}&page_no=${pageNo}&page_count=100`,
      );
      if (json.status !== "000" || !Array.isArray(json.list)) break;
      for (const r of json.list) {
        const nm = (r.report_nm ?? "").trim();
        if (keywords.length > 0 && !keywords.some((k) => nm.includes(k))) continue;
        disclosures.push({
          rcept_no: r.rcept_no ?? "",
          corp_name: (r.corp_name ?? "").trim(),
          report_nm: nm,
          rcept_dt: r.rcept_dt ?? "",
          preset,
        });
        if (disclosures.length >= limit) break;
      }
    }
    return { found: disclosures.length > 0, disclosures };
  } catch (err) {
    return { found: false, disclosures: [], error: err instanceof Error ? err.message : "공시 검색 실패" };
  }
}

/* ── P3-8: 지분 안정성 시그널 — 대량보유 상황보고 요약 (S7 스코어카드 입력) ── */

export interface ShareholderSignal {
  available: boolean;
  summary: string;
  holders: Array<{ holder: string; ratio: number; change?: string; report_dt?: string }>;
  error?: string;
}

export async function getShareholderSignal(corpCode: string): Promise<ShareholderSignal> {
  const key = apiKey();
  if (!key) return { available: false, summary: "DART 미구성", holders: [], error: "DART_API_KEY 미구성" };
  try {
    const json = await dartJson<{ status?: string; list?: Array<{ holder_nm?: string; stkqy_irds_stkrt?: string; change_cause?: string; rpt_dtm?: string }> }>(
      `${BASE}/majorshareholders.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corpCode)}`,
    );
    const rows = (json.list ?? []).filter((h) => h.holder_nm);
    if (json.status !== "000" || rows.length === 0) {
      return { available: false, summary: "대량보유 보고 없음 — 지분 구조 이슈 없음(5% 룰 기준)", holders: [] };
    }
    const holders = rows.slice(0, 5).map((h) => ({
      holder: (h.holder_nm ?? "").trim(),
      ratio: Number(h.stkqy_irds_stkrt ?? 0),
      change: h.change_cause?.trim() || undefined,
      report_dt: h.rpt_dtm?.slice(0, 8) || undefined,
    }));
    const top = holders[0];
    const summary = `최대 대량보유자 ${top.holder} ${top.ratio}% — 보고 ${holders.length}건`;
    return { available: true, summary, holders };
  } catch (err) {
    return { available: false, summary: "조회 실패", holders: [], error: err instanceof Error ? err.message : "지분 조회 실패" };
  }
}

/* ── P4-9: 공시 원문 입수 — document.xml(ZIP 내 XML) 텍스트 추출. HWP 바이너리는 미지원(OCR 후속). ── */

export interface DisclosureText {
  available: boolean;
  rcept_no: string;
  text?: string;
  truncated?: boolean;
  error?: string;
}

const MAX_DOCUMENT = 20 * 1024 * 1024;

export async function fetchDisclosureText(rceptNo: string): Promise<DisclosureText> {
  const key = apiKey();
  if (!key) return { available: false, rcept_no: rceptNo, error: "DART_API_KEY 미구성" };
  try {
    const res = await dartFetch(`${BASE}/document.xml?crtfc_key=${encodeURIComponent(key)}&rcept_no=${encodeURIComponent(rceptNo)}`, { timeoutMs: 60_000, accept: "any" });
    if (!res.ok) return { available: false, rcept_no: rceptNo, error: `DART HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!(buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b)) {
      return { available: false, rcept_no: rceptNo, error: "원문이 ZIP이 아닙니다(HWP 바이너리 등) — OCR 후속 경로 필요" };
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { inflateRawSync } = require("node:zlib") as typeof import("node:zlib");
    let xml = "";
    const sig = (i: number) => buf[i] === 0x50 && buf[i + 1] === 0x4b;
    for (let i = 0; i < buf.length - 4 && !xml; i++) {
      if (!(sig(i) && buf[i + 2] === 0x03 && buf[i + 3] === 0x04)) continue;
      const compressionMethod = buf.readUInt16LE(i + 8);
      let compressedSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const dataStart = i + 30 + nameLen + extraLen;
      if (compressedSize === 0) {
        // 스트리밍 ZIP(data descriptor) — 로컬 헤더에 크기 미기록. 다음 시그니처까지를 데이터로 간주.
        let next = -1;
        for (let j = dataStart; j < buf.length - 4; j++) {
          if (sig(j) && (buf[j + 2] === 0x03 || buf[j + 2] === 0x01)) { next = j; break; }
        }
        if (next === -1 || next - dataStart > MAX_DOCUMENT) continue;
        compressedSize = next - dataStart;
      }
      if (compressedSize > MAX_DOCUMENT) continue;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      try {
        xml = compressionMethod === 8
          ? inflateRawSync(data, { maxOutputLength: MAX_DOCUMENT }).toString("utf-8")
          : data.toString("utf-8");
      } catch { /* 다음 로컬 파일 헤더 시도 */ }
    }
    if (!xml) return { available: false, rcept_no: rceptNo, error: "XML 원문 추출 실패" };
    // XML 태그 제거 — 원문 텍스트만 남긴다 (상한 500k 문자).
    const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500_000);
    return { available: text.length > 0, rcept_no: rceptNo, text, truncated: text.length >= 500_000 };
  } catch (err) {
    return { available: false, rcept_no: rceptNo, error: err instanceof Error ? err.message : "원문 조회 실패" };
  }
}
