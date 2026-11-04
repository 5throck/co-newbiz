// k-dart dart-client pure-logic tests (k-dart P1~P5 고도화, 2026-09-01).
// 네트워크 비의존 — 계정 별칭 정규화·합산 검증·ZIP 방어·캐시 무결성 로직만 검증.
// 2026-11-04: fetchFinancials 연도별 CFS→BFS 폴백 검증 추가 (design
// 2026-11-04-dart-fsdiv-per-year-fallback §4) — globalThis.fetch 스텁으로 URL의
// bsns_year/fs_div 파라미터에 라우팅한다(dartFetch가 전역 fetch를 직접 호출하므로
// 별도 주입 시점은 없다). 스텁 응답은 JSON content-type이어야 한다(dartFetch는
// HTML 응답에 백오프 재시도한다).
import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import {
  normalizeAccountName,
  checkSummation,
  parseCorpXml,
  fetchFinancials,
} from "../../app/web-next/lib/dart-client.ts";

describe("k-dart dart-client (pure logic)", () => {
  test("normalizeAccountName: 별칭 → 표준 계정명", () => {
    expect(normalizeAccountName("수익(매출액)")).toBe("매출액");
    expect(normalizeAccountName("판매와관리비")).toBe("판매비와관리비");
    expect(normalizeAccountName("판관비")).toBe("판매비와관리비");
    expect(normalizeAccountName("매출액")).toBe("매출액"); // 표준명 통과
    expect(normalizeAccountName(" 알 수 없는 계정 ")).toBe("알 수 없는 계정"); // 미등록은 trim만
  });

  test("checkSummation: 자산 = 부채 + 자본 (±1%)", () => {
    expect(
      checkSummation([
        { name: "자산총계", value: 100 },
        { name: "부채총계", value: 60 },
        { name: "자본총계", value: 40 },
      ]),
    ).toBe(true);
    // 0.8% 오차 — 허용
    expect(
      checkSummation([
        { name: "자산총계", value: 100 },
        { name: "부채총계", value: 60 },
        { name: "자본총계", value: 39.2 },
      ]),
    ).toBe(true);
    // 5% 오차 — 실패
    expect(
      checkSummation([
        { name: "자산총계", value: 100 },
        { name: "부채총계", value: 60 },
        { name: "자본총계", value: 35 },
      ]),
    ).toBe(false);
    // 항목 불완전 — 판정 불가(null)
    expect(checkSummation([{ name: "자산총계", value: 100 }])).toBe(null);
    expect(
      checkSummation([
        { name: "자산총계", value: 0 },
        { name: "부채총계", value: 1 },
        { name: "자본총계", value: 1 },
      ]),
    ).toBe(null);
  });

  test("parseCorpXml: ZIP이 아니면 0행 (slip/bomb 방어 진입)", () => {
    expect(parseCorpXml(Buffer.from("<!DOCTYPE html><html></html>"))).toEqual([]);
    expect(parseCorpXml(Buffer.alloc(0))).toEqual([]);
  });

  test("parseCorpXml: 과대 압축비(bomb) 차단", () => {
    // 완전한 ZIP(중앙 디렉터리+EOCD 포함)에서 중앙 디렉터리가 선언하는 압축비가
    // 100x 초과인 시나리오 — 2026-11-02부터 크기의 진실은 중앙 디렉터리에 있다.
    const { deflateRawSync } = require("node:zlib") as typeof import("node:zlib");
    const data = deflateRawSync(Buffer.from("<root></root>", "utf-8"));
    const buf = buildZip([{ name: "CORPCODE.xml", data, usizeOverride: 1_000_000 }]); // csize ~15B vs 1MB = 압축비 폭발
    expect(parseCorpXml(buf)).toEqual([]);
  });

  test("parseCorpXml: 정상 deflate ZIP 파싱", () => {
    // zlib deflate로 CORPCODE 유사 XML을 압축한 단일파일 ZIP(로컬+중앙 디렉터리+EOCD) 구성
    const { deflateRawSync } = require("node:zlib") as typeof import("node:zlib");
    const xml =
      "<root><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list></root>";
    const data = deflateRawSync(Buffer.from(xml, "utf-8"));
    const buf = buildZip([{ name: "CORPCODE.xml", data }]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].corp_code).toBe("00126380");
    expect(rows[0].corp_name).toBe("삼성전자");
    expect(rows[0].stock_code).toBe("005930");
  });
});

/* ── fetchFinancials: 연도별 CFS→BFS 폴백 + fsDiv 출처 표기 (v1.3.0, design §4) ──
 * T1 혼합 윈도우(수산아이앤티 재현), T2 순수 CFS 효율, T3 순수 BFS 유지,
 * T4 같은 연도 CFS/BFS 혼입 부재, T5 000-무원계정은 미스 취급.
 * 연도는 fetchFinancials와 같은 식(latest = 올해-1)으로 계산해 연도가 지나도
 * 깨지지 않는다 — 라우팅 키는 "bsns_year:fs_div"이다. */
describe("fetchFinancials: 연도별 CFS→BFS 폴백", () => {
  const savedKey = process.env.DART_API_KEY;
  const savedFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];

  const latest = new Date().getFullYear() - 1; // fetchFinancials와 동일한 최근 완결 사업연도
  const yNewest = String(latest);
  const yMid = String(latest - 1);
  const yOldest = String(latest - 2);

  type BlockSpec = { status: string; list?: Array<{ account_nm?: string; thstrm_amount?: string }> };

  /** 합산 검증(자산 = 부채+자본)을 통과하는 표준 계정 집합 — 7계정. */
  const accountRows = (): BlockSpec => ({
    status: "000",
    list: [
      { account_nm: "매출액", thstrm_amount: "100000" },
      { account_nm: "매출원가", thstrm_amount: "60000" },
      { account_nm: "영업이익", thstrm_amount: "30000" },
      { account_nm: "당기순이익", thstrm_amount: "20000" },
      { account_nm: "자산총계", thstrm_amount: "100000" },
      { account_nm: "부채총계", thstrm_amount: "60000" },
      { account_nm: "자본총계", thstrm_amount: "40000" },
    ],
  });

  /** URL의 bsns_year/fs_div로 라우팅하는 fetch 스텁 — 미등록 조합은 status 013.
   *  JSON content-type 필수(dartFetch는 HTML 응답에 백오프 재시도한다). */
  const stubFinancialRoutes = (table: Record<string, BlockSpec>) => {
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        fetchedUrls.push(url);
        const params = new URL(url).searchParams;
        const spec = table[`${params.get("bsns_year")}:${params.get("fs_div")}`] ?? { status: "013" };
        const body = spec.list ? { status: spec.status, list: spec.list } : { status: spec.status };
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
      },
      { preconnect: (_url: string | URL) => {} },
    ) as typeof fetch;
  };

  beforeEach(() => {
    // 키는 존재만 하면 된다 — fetch는 스텁이므로 패킷이 프로세스 밖으로 나가지 않는다.
    // 조합 조립으로 시크릿 스캐너가 자격증명형 리터럴을 보지 않게 한다.
    process.env.DART_API_KEY = ["dart", "test", "key"].join("-");
    fetchedUrls.length = 0;
  });

  afterAll(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.DART_API_KEY;
    else process.env.DART_API_KEY = savedKey;
  });

  test("T1 — 혼합 윈도우: CFS 부분 성공만으로 BFS 연도가 누락되지 않는다 (수산아이앤티 재현)", async () => {
    // 최근 완결 연도는 개별(BFS)만, 중간 연도도 개별만, 최오래 연도만 연결(CFS) 제출 —
    // 라이브 케이스(CFS ≤2023, OFS 2024/2025)와 동일한 형태.
    stubFinancialRoutes({
      [`${yOldest}:CFS`]: accountRows(),
      [`${yMid}:CFS`]: { status: "013" },
      [`${yNewest}:CFS`]: { status: "013" },
      [`${yOldest}:BFS`]: { status: "013" },
      [`${yMid}:BFS`]: accountRows(),
      [`${yNewest}:BFS`]: accountRows(),
    });
    const out = await fetchFinancials("00577016", { years: 3 });

    expect(out.found).toBe(true);
    const years = new Set(out.items.map((i) => i.year));
    expect(years.has(yMid)).toBe(true); // 구코드는 이 연도들이 통째로 비어 있었다
    expect(years.has(yNewest)).toBe(true);

    // 연도별 출처 — 최오래 연도 CFS, 나머지 BFS (items[].fsDiv가 정본)
    for (const item of out.items.filter((i) => i.year === yOldest)) expect(item.fsDiv).toBe("CFS");
    for (const item of out.items.filter((i) => i.year === yMid || i.year === yNewest)) expect(item.fsDiv).toBe("BFS");
    expect(out.yearly?.find((b) => b.year === yMid)?.fsDiv).toBe("BFS"); // yearly에도 같은 자리에서 도장
    expect(out.yearly?.find((b) => b.year === yOldest)?.fsDiv).toBe("CFS");

    // 집계 — 기준이 갈리면 mixed
    expect(out.fsDiv).toBe("mixed");
    expect(out.fsDivLabel).toBe("연결·개별 혼합 (연도별 기준 상이)");
    expect(out.year).toBe(yNewest); // 최신 채택 연도
    expect(out.integrity).toBe("ok");
    // lastError 규율 — 부분 성공 회차는 에러 문자열을 갖지 않는다(013이 mid-success에서
    // lastError를 덮어쓰던 구코드의 결함).
    expect(out.error).toBeUndefined();
  });

  test("T2 — 순수 CFS: 모든 연도가 연결이면 집계 CFS, BFS 호출 0회", async () => {
    stubFinancialRoutes({
      [`${yOldest}:CFS`]: accountRows(),
      [`${yMid}:CFS`]: accountRows(),
      [`${yNewest}:CFS`]: accountRows(),
    });
    const out = await fetchFinancials("00126380", { years: 3 });
    expect(out.found).toBe(true);
    expect(out.fsDiv).toBe("CFS");
    expect(out.fsDivLabel).toBe("연결재무제표");
    for (const item of out.items) expect(item.fsDiv).toBe("CFS");
    expect(fetchedUrls.some((u) => u.includes("fs_div=BFS"))).toBe(false); // 효율 — 폴백 호출 없음
  });

  test("T3 — 순수 BFS: CFS 전면 미스면 집계 BFS — 기존 윈도우 동작 보존", async () => {
    stubFinancialRoutes({
      [`${yOldest}:BFS`]: accountRows(),
      [`${yMid}:BFS`]: accountRows(),
      [`${yNewest}:BFS`]: accountRows(),
    }); // CFS는 미등록 → 기본 013
    const out = await fetchFinancials("00577016", { years: 3 });
    expect(out.found).toBe(true);
    expect(out.fsDiv).toBe("BFS");
    expect(out.fsDivLabel).toBe("개별재무제표");
    expect(fetchedUrls.some((u) => u.includes("fs_div=BFS"))).toBe(true);
  });

  test("T4 — 같은 연도 혼입 부재: CFS 000(무원계정)이면 그 연도는 BFS만 채택 (T5 포함)", async () => {
    // CFS는 status 000이지만 원하는 계정이 0건(원계정 아닌 행만) — 폴백 관점의 미스.
    // BFS는 같은 연도에서 정상. 하나의 연도가 두 기준을 섞으면 안 된다.
    stubFinancialRoutes({
      [`${yNewest}:CFS`]: {
        status: "000",
        list: [
          { account_nm: "이자수익", thstrm_amount: "500" }, // WANTED_ACCOUNTS 밖
          { account_nm: "기타비영업수익", thstrm_amount: "300" }, // WANTED_ACCOUNTS 밖
        ],
      },
      [`${yNewest}:BFS`]: accountRows(),
    });
    const out = await fetchFinancials("00577016", { years: 1 });

    expect(out.found).toBe(true);
    expect(out.items.length).toBeGreaterThan(0);
    for (const item of out.items) {
      expect(item.fsDiv).toBe("BFS"); // CFS가 이기는 경우는 CFS가 실제 값을 내줄 때뿐
      expect(item.year).toBe(yNewest);
    }
    // 계정+연도당 정확히 1건 — CFS/BFS 중복 행이 없다 (구조적으로 혼입 불가)
    const counts = new Map<string, number>();
    for (const item of out.items) {
      const k = `${item.year}:${item.name}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    // T5 — 000-무원계정은 미스로 취급됐다: 그 연도의 BFS가 실제로 호출됐다
    expect(fetchedUrls.some((u) => u.includes(`bsns_year=${yNewest}`) && u.includes("fs_div=BFS"))).toBe(true);
    expect(out.fsDiv).toBe("BFS");
    expect(out.yearly?.[0]?.fsDiv).toBe("BFS");
  });
});

/* ── 완전한 ZIP 픽처스 빌더 — 로컬 헤더+데이터+중앙 디렉터리+EOCD (dart-corp-zip.test.ts의
 *    스트리밍/위조-PK 픽처스와 별개로 이 파일은 보통 ZIP만 필요) ── */
function crc32(b: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    let c = (crc ^ b[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: Array<{ name: string; data: Buffer; method?: number; usizeOverride?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 8;
    const nameB = Buffer.from(f.name, "latin1");
    const local = Buffer.alloc(30 + nameB.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    nameB.copy(local, 30);
    locals.push(local, f.data);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc32(f.data), 16);
    cd.writeUInt32LE(f.data.length, 20);
    cd.writeUInt32LE(f.usizeOverride ?? f.data.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameB.copy(cd, 46);
    centrals.push(cd);
    offset += local.length + f.data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
