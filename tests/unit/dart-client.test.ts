// k-dart dart-client pure-logic tests (k-dart P1~P5 고도화, 2026-09-01).
// 네트워크 비의존 — 계정 별칭 정규화·합산 검증·ZIP 방어·캐시 무결성 로직만 검증.
import { test, expect, describe } from "bun:test";
import { normalizeAccountName, checkSummation, parseCorpXml } from "../../app/web-next/lib/dart-client.ts";

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
