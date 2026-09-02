// k-dart dart-client pure-logic tests (k-dart P1~P5 고도화, 2026-09-01).
// 네트워크 비의존 — 계정 별칭 정규화·합산 검증·ZIP 방어·캐시 무결성 로직만 검증.
import { test, expect, describe } from "bun:test";
import {
  normalizeAccountName,
  checkSummation,
  parseCorpXml,
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
    expect(checkSummation([
      { name: "자산총계", value: 100 },
      { name: "부채총계", value: 60 },
      { name: "자본총계", value: 40 },
    ])).toBe(true);
    // 0.8% 오차 — 허용
    expect(checkSummation([
      { name: "자산총계", value: 100 },
      { name: "부채총계", value: 60 },
      { name: "자본총계", value: 39.2 },
    ])).toBe(true);
    // 5% 오차 — 실패
    expect(checkSummation([
      { name: "자산총계", value: 100 },
      { name: "부채총계", value: 60 },
      { name: "자본총계", value: 35 },
    ])).toBe(false);
    // 항목 불완전 — 판정 불가(null)
    expect(checkSummation([{ name: "자산총계", value: 100 }])).toBe(null);
    expect(checkSummation([{ name: "자산총계", value: 0 }, { name: "부채총계", value: 1 }, { name: "자본총계", value: 1 }])).toBe(null);
  });

  test("parseCorpXml: ZIP이 아니면 0행 (slip/bomb 방어 진입)", () => {
    expect(parseCorpXml(Buffer.from("<!DOCTYPE html><html></html>"))).toEqual([]);
    expect(parseCorpXml(Buffer.alloc(0))).toEqual([]);
  });

  test("parseCorpXml: 과대 압축비(bomb) 차단", () => {
    // 최소 ZIP 로컬 헤더를 수작업 구성 — 압축비 100x 초과 시나리오
    const buf = Buffer.alloc(64);
    buf.write("PK", 0, "latin1");
    buf.writeUInt16LE(8, 8); // method = deflate
    buf.writeUInt32LE(1000, 18); // compressedSize
    buf.writeUInt32LE(1_000_000, 22); // uncompressedSize = 1000x > 100x 상한
    buf.writeUInt16LE(4, 26); // nameLen
    buf.writeUInt16LE(0, 28);
    buf.write("test", 30, "latin1");
    expect(parseCorpXml(buf)).toEqual([]);
  });

  test("parseCorpXml: 정상 deflate ZIP 파싱", () => {
    // zlib deflate로 CORPCODE 유사 XML을 압축한 단일파일 ZIP 구성
    const { deflateRawSync } = require("node:zlib") as typeof import("node:zlib");
    const xml = "<root><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list></root>";
    const data = deflateRawSync(Buffer.from(xml, "utf-8"));
    const name = "CORPCODE.xml";
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // PK 로컬 파일 서명
    header.writeUInt16LE(8, 8); // method = deflate
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(xml.length, 22);
    header.writeUInt16LE(name.length, 26);
    const buf = Buffer.concat([header, Buffer.from(name, "latin1"), data]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].corp_code).toBe("00126380");
    expect(rows[0].corp_name).toBe("삼성전자");
    expect(rows[0].stock_code).toBe("005930");
  });
});
