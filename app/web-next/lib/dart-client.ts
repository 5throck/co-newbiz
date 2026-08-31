// DART (전자공시시스템) client for S3 시너지 정합성 — company lookup + financial
// statements for 상장사/외감기업. Requires DART_API_KEY; graceful degradation
// when absent (the synergy pipeline then relies on web research + LLM only).

export interface DartFinancials {
  corpCode: string;
  corpName?: string;
  found: boolean;
  year?: string;
  items: Array<{ name: string; value: number; unit: string }>;
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
export async function findCorpCode(companyName: string): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins
    const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { tmpdir } = require("node:os") as typeof import("node:os");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { inflateRawSync } = require("node:zlib") as typeof import("node:zlib");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { join } = require("node:path") as typeof import("node:path");

    const tmp = mkdtempSync(join(tmpdir(), "dart-"));
    try {
      const res = await fetch(`${BASE}/corpCode.xml.zip?crtfc_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return null;
      const zipPath = join(tmp, "corpCode.zip");
      writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
      const buf = readFileSync(zipPath);
      // Minimal ZIP central-directory walk: local file header PK\x03\x04,
      // find the stored/deflated payload of the first file entry.
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
      // CORPCODE.xml rows: <list><corp_code>..</corp_code><corp_name>..</corp_name>...
      const rows = xml.split("<list>");
      for (const row of rows.slice(1)) {
        const name = row.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1] ?? "";
        const code = row.match(/<corp_code>([^<]+)<\/corp_code>/)?.[1] ?? "";
        if (code && name === companyName.trim()) return code;
      }
      // Loose contains-match fallback (first hit).
      for (const row of rows.slice(1)) {
        const name = row.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1] ?? "";
        const code = row.match(/<corp_code>([^<]+)<\/corp_code>/)?.[1] ?? "";
        if (code && name.includes(companyName.trim())) return code;
      }
      return null;
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch {
    return null;
  }
}

/** Latest-year single-company full financial statements (reprt_code 11011). */
export async function fetchFinancials(corpCode: string): Promise<DartFinancials> {
  const key = apiKey();
  const out: DartFinancials = { corpCode, found: false, items: [] };
  if (!key) { out.error = "DART_API_KEY 미구성"; return out; }
  const year = new Date().getFullYear() - 1; // latest complete business year
  try {
    const res = await fetch(
      `${BASE}/fnlttSinglAcntAll.json?corp_code=${encodeURIComponent(corpCode)}&bsns_year=${year}&reprt_code=11011&fs_div=CFS&api_key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const json = (await res.json()) as {
      status?: string; list?: Array<{ account_nm?: string; thstrm_amount?: string; thstrm_nm?: string; currency?: string }>;
    };
    if (json.status !== "000" || !Array.isArray(json.list)) {
      out.error = `DART ${json.status ?? "ERR"} — 사업보고서 미제출 또는 코드 오류`;
      return out;
    }
    const wanted = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
    out.found = true;
    out.year = String(year);
    out.items = json.list
      .filter((l) => wanted.includes(l.account_nm ?? "") && l.thstrm_amount)
      .map((l) => ({ name: l.account_nm!, value: Number(l.thstrm_amount), unit: "KRW" }));
    out.reportUrl = `https://dart.fss.or.kr/dsab007/main.do?option=corp&corp_code=${corpCode}`;
    return out;
  } catch (err) {
    out.error = err instanceof Error ? err.message : "DART 조회 실패";
    return out;
  }
}
