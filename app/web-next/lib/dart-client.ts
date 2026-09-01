// DART (전자공시시스템) client for S3 시너지 정합성 — company lookup + financial
// statements for 상장사/외감기업. Requires DART_API_KEY; graceful degradation
// when absent (the synergy pipeline then relies on web research + LLM only).

export interface DartFinancials {
  corpCode: string;
  corpName?: string;
  found: boolean;
  year?: string;
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

/**
 * Resolve a company name to a DART corp code using the bulk corpCode.xml.zip
 * (the only public name→code mapping). Parses the ZIP's stored XML with
 * node:zlib raw inflate — no third-party dependency.
 */
export interface CorpRow { corp_code: string; corp_name: string }
export interface CorpRowsResult { rows: CorpRow[]; stale: boolean; error: string | null; results: CorpRow[] }

// COA 파싱 결과 캐시 — 프로세스 수명 메모리 + 디스크(db/data/dart-corpcode-cache.json).
// DART가 다운로드를 일시 차단해도 캐시된 목록으로 검색이 동작한다(stale-while-revalidate).
let corpRowsCache: CorpRow[] | null = null;

function between(s: string, a: string, b: string): string {
  const i0 = s.indexOf(a);
  if (i0 === -1) return "";
  const i1 = s.indexOf(b, i0 + a.length);
  return i1 === -1 ? "" : s.slice(i0 + a.length, i1);
}

function cacheFile(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const candidates = [join(process.cwd(), "db", "data"), join(process.cwd(), "..", "..", "db", "data")];
  for (const c of candidates) if (existsSync(c)) return join(c, "dart-corpcode-cache.json");
  return join(candidates[0], "dart-corpcode-cache.json");
}

function readCache(): { fetched_at: string; rows: CorpRow[] } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const parsed = JSON.parse(readFileSync(cacheFile(), "utf-8")) as { fetched_at: string; rows: CorpRow[] };
    return Array.isArray(parsed.rows) && parsed.rows.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(rows: CorpRow[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { dirname, join } = require("node:path") as typeof import("node:path");
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const path = cacheFile();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ fetched_at: new Date().toISOString(), rows }));
  } catch { /* 캐시 기록 실패는 치명적이지 않다 */ }
}

function parseCorpXml(buf: Buffer): CorpRow[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
  const { inflateRawSync } = require("node:zlib") as typeof import("node:zlib");
  if (!(buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b)) return [];
  let xml = "";
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const compressionMethod = buf.readUInt16LE(i + 8);
      const compressedSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const dataStart = i + 30 + nameLen + extraLen;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      xml = compressionMethod === 8 ? inflateRawSync(data).toString("utf-8") : data.toString("utf-8");
      break;
    }
  }
  const rows: CorpRow[] = [];
  for (const row of xml.split("<list>").slice(1)) {
    const name = between(row, "<corp_name>", "</corp_name>");
    const code = between(row, "<corp_code>", "</corp_code>");
    if (code && name) rows.push({ corp_code: code, corp_name: name });
  }
  return rows;
}

async function loadCorpRows(): Promise<CorpRowsResult> {
  if (corpRowsCache) return { rows: corpRowsCache, stale: false, error: null, results: [] };
  const cache = readCache();
  const fresh = !!cache && Date.now() - Date.parse(cache.fetched_at) < 24 * 60 * 60 * 1000;
  if (cache && fresh) { corpRowsCache = cache.rows; return { rows: cache.rows, stale: false, error: null, results: [] }; }
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
    const res = await fetch(`${BASE}/corpCode.xml.zip?crtfc_key=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(60_000),
    });
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
  const { rows, error } = await loadCorpRows();
  if (rows.length === 0) { if (error) console.error("dart corp search unavailable:", error); return null; }
  const q = companyName.trim();
  return rows.find((r) => r.corp_name === q)?.corp_code ?? rows.find((r) => r.corp_name.includes(q))?.corp_code ?? null;
}

export async function searchCorpCodesWithMeta(query: string, limit = 8): Promise<CorpRowsResult & { results: CorpRow[] }> {
  const key = apiKey();
  if (!key) return { rows: [], stale: false, error: "DART_API_KEY 미구성", results: [] };
  const q = query.trim();
  if (!q) return { rows: [], stale: false, error: null, results: [] };

  // OpenDART corpCode.xml.zip이 IP 차단되는 경우가 잦아, JSON 목록 API(list.json)로
  // 상장(Y)·외감(K/E) 전체를 페이지 순회하며 이름 포함 매칭한다.
  const results: CorpRow[] = [];
  const seen = new Set<string>();
  const exact: CorpRow[] = [];
  let lastStatus = "";

  for (const corpCls of ["Y", "K", "E"]) {
    let pageNo = 1;
    const maxPage = 30;
    while (pageNo <= maxPage) {
      try {
        const res = await fetch(
          `${BASE}/list.json?crtfc_key=${encodeURIComponent(key)}&corp_cls=${corpCls}&page_no=${pageNo}&page_count=100`,
          { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: AbortSignal.timeout(30_000) },
        );
        const json = (await res.json()) as {
          status?: string; message?: string; total_page?: number;
          list?: Array<{ corp_code?: string; corp_name?: string }>;
        };
        lastStatus = json.status ?? "";
        if (json.status !== "000" || !Array.isArray(json.list)) break;
        for (const r of json.list) {
          const name = (r.corp_name ?? "").trim();
          const code = (r.corp_code ?? "").trim();
          if (!name || !code || seen.has(code)) continue;
          seen.add(code);
          if (name === q) exact.push({ corp_code: code, corp_name: name });
          else if (name.includes(q)) results.push({ corp_code: code, corp_name: name });
        }
        const tp = typeof json.total_page === "number" ? json.total_page : 1;
        if (pageNo >= tp) break;
        pageNo++;
      } catch (err) {
        lastError(lastStatus, err);
        break;
      }
    }
  }

  function lastError(_s: string, _e: unknown) {
    lastStatus = "ERR";
  }

  const finalResults = [...exact, ...results].slice(0, limit);
  if (finalResults.length === 0 && exact === null) {
    return { rows: [], stale: false, error: `DART 검색 결과가 없습니다 (status ${lastStatus})`, results: [] };
  }
  return { rows: [], stale: false, error: null, results: finalResults.slice(0, limit) };
}

export async function searchCorpCodes(query: string, limit = 8): Promise<CorpRow[]> {
  return (await searchCorpCodesWithMeta(query, limit)).results;
}

/** Latest-year single-company full financial statements (reprt_code 11011). */
/** Latest-year single-company full financial statements (reprt_code 11011). */
export async function fetchFinancials(corpCode: string, opts: { years?: number } = {}): Promise<DartFinancials> {
  const key = apiKey();
  const out: DartFinancials = { corpCode, found: false, items: [], yearly: [] };
  if (!key) { out.error = "DART_API_KEY 미구성"; return out; }
  const wanted = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
  const latest = new Date().getFullYear() - 1; // latest complete business year
  const yearsToFetch = Math.min(Math.max(opts.years ?? 1, 1), 5);
  let anyFound = false;
  let lastError: string | undefined;

  for (let y = 0; y < yearsToFetch; y++) {
    const year = latest - y;
    try {
      const res = await fetch(
        `${BASE}/fnlttSinglAcntAll.json?corp_code=${encodeURIComponent(corpCode)}&bsns_year=${year}&reprt_code=11011&fs_div=CFS&api_key=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const json = (await res.json()) as {
        status?: string; list?: Array<{ account_nm?: string; thstrm_amount?: string; thstrm_nm?: string; currency?: string }>;
      };
      if (json.status !== "000" || !Array.isArray(json.list)) {
        lastError = `DART ${json.status ?? "ERR"} — ${year}년 사업보고서 미제출 또는 코드 오류`;
        continue;
      }
      const yearlyItems = json.list
        .filter((l) => wanted.includes(l.account_nm ?? "") && l.thstrm_amount)
        .map((l) => ({ name: l.account_nm!, value: Number(l.thstrm_amount), unit: "KRW", year: String(year) }));
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
  out.found = anyFound;
  if (!anyFound) out.error = lastError ?? "DART 조회 실패 — corp_code를 확인하세요";
  return out;
}
