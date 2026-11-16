// @version 1.0.0
/**
 * ADR-0199 — business-report section extraction over SYNTHETIC fixtures (one per real DART heading style), the
 * extractor-version cache retry, and tolerant-but-strict citation validation.
 */
import { test, expect, describe, beforeAll, afterAll, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "bf-br-extract-"));
const DB_PATH = join(TMP, "t.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const cache = await import("../../db/repositories/dart-evidence-cache.repository.ts");
const br = await import("../../app/web-next/lib/brownfield-business-report.ts");

resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);
afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const P = "정밀 단조 부품을 자동차 및 선박 엔진 제조사에 공급하며 국내 시장 점유율은 상위권입니다.";
const wrap = (...heads: string[]) =>
  `사업보고서 목 차 II. 사업의 내용 ${heads.map((h) => `${h} ${P}`).join(" ")} III. 재무에 관한 사항 끝`;

// Full-width form built at runtime (ASCII -> U+FF01..; space -> U+3000) so no homoglyph literals live in the source.
const fw = (t: string): string =>
  t.replace(/[ -~]/g, (c) => (c === " " ? String.fromCharCode(0x3000) : String.fromCharCode(c.charCodeAt(0) + 0xfee0)));
const STYLES: Array<[string, string[], string[]]> = [
  ["numbered", ["2. 주요 제품 및 서비스", "3. 생산설비", "4. 연구개발활동", "5. 지적재산권"], []],
  ["korean letter", ["가. 주요 제품 및 서비스", "나. 생산설비", "다. 연구개발활동", "라. 지적재산권"], []],
  ["roman numerals", ["Ⅱ. 주요 제품", "Ⅲ. 생산설비", "Ⅳ. 연구개발활동", "Ⅴ. 지적재산권"], []],
  ["paren forms", ["2) 주요 제품 및 서비스", "(3) 생산설비", "4) 연구개발활동", "(5) 지적재산권"], []],
  ["bracketed name", ["2. [주요 제품 및 서비스]", "3. (생산설비)", "4. [연구개발활동]", "5. <지적재산권>"], []],
  ["full-width", ["2. 주요 제품 및 서비스", "3. 생산설비", "4. 연구개발활동", "5. 지적재산권"].map(fw), []],
  [
    "raw-material + facilities",
    ["2. 주요 제품과 서비스", "3. 원재료 및 생산설비", "4. 연구개발활동", "5. 중요한 지적재산권"],
    [],
  ],
];

describe("extractBusinessReportSections heading styles", () => {
  for (const [name, heads] of STYLES) {
    test(name, () => {
      const s = br.extractBusinessReportSections(wrap(...heads));
      expect(Object.keys(s).sort()).toEqual(["facilities", "ip", "main_products", "rnd"]);
      expect(s.rnd?.text).toContain("정밀 단조");
    });
  }

  test("body-text mentions and a table of contents do not start a section", () => {
    const s = br.extractBusinessReportSections(
      "목차 2. 주요 제품 및 서비스 3. 생산설비 4. 연구개발활동 본문 당사의 연구개발활동은 활발하며 생산설비도 충분합니다.",
    );
    expect(s).toEqual({});
  });
});

describe("stale no_sections cache is retried by a newer extractor version", () => {
  const RCEPT = "20260318009999";
  test("br-1 no_sections row is ignored; a br-2 fetch extracts and caches", async () => {
    expect(br.BUSINESS_REPORT_EXTRACTOR_VERSION).not.toBe("br-1");
    db.query(
      "INSERT INTO dart_disclosure (rcept_no, corp_code, corp_name, report_nm, rcept_dt, fetched_at) VALUES (?, '00000001', 'x', '사업보고서', '20260318', ?)",
    ).run(RCEPT, "2026-11-16T00:00:00.000Z");
    cache.insertBusinessReportExtract(db, {
      rceptNo: RCEPT,
      extractorVersion: "br-1",
      status: "no_sections",
      sourceChars: 100,
      now: "2026-11-16T00:00:00.000Z",
    });
    expect(cache.needsBusinessReportFetch(db, RCEPT, br.BUSINESS_REPORT_EXTRACTOR_VERSION)).toBe(true);
    let calls = 0;
    const fetchText = async (r: string) => {
      calls++;
      return { available: true, rcept_no: r, text: wrap("2. 주요 제품 및 서비스", "4. 연구개발활동") };
    };
    const res = await br.ensureBusinessReportExtract(db, RCEPT, fetchText, "2026-11-16T01:00:00.000Z");
    expect(res.status).toBe("fetched");
    expect(res.extract?.status).toBe("extracted");
    expect(calls).toBe(1);
    const again = await br.ensureBusinessReportExtract(db, RCEPT, fetchText, "2026-11-16T02:00:00.000Z");
    expect(again.status).toBe("cached");
    expect(calls).toBe(1);
  });
});

describe("validateCitations", () => {
  const RC = "20260318001708";
  const text =
    "당사는 정밀 단조 기술을 보유하고 있으며, 연구개발비용은 매출액 대비 3.2%(전기 2.9%) 입니다. 특허 15건 등록.";
  const ctx = {
    rceptNo: RC,
    sections: { rnd: { heading_raw: "연구개발활동", text, chars: text.length, truncated: false } },
    disclosures: [{ rcept_no: "20260101000001", report_nm: "주요사항보고서(유상증자결정)" }],
    profileText: "회사 강점: 정밀 단조 기술 보유",
  };
  const bc = (ref: string, quote: string) => ({ kind: "business_report", ref, quote });
  let warn: ReturnType<typeof spyOn>;
  beforeAll(() => {
    warn = spyOn(console, "error").mockImplementation(() => {});
  });

  const accepts: Array<[string, ReturnType<typeof bc>]> = [
    ["exact", bc(`${RC}:rnd`, "정밀 단조 기술을 보유하고 있으며")],
    ["extra whitespace", bc(`${RC}:rnd`, "정밀   단조  기술을\n보유하고 있으며")],
    ["full-width digits/parens", bc(`${RC}:rnd`, fw("연구개발비용은 매출액 대비 3.2%(전기 2.9%)"))],
    ["punctuation dropped", bc(`${RC}:rnd`, "당사는 정밀 단조 기술을 보유하고 있으며 연구개발비용은")],
    ["ref case/space/hash", bc(` ## ${RC} : RND `, "정밀 단조 기술을 보유하고 있으며")],
  ];
  for (const [name, c] of accepts)
    test(`accepts ${name}`, () => {
      const out = br.validateCitations([c], ctx);
      expect(out).toHaveLength(1);
      expect(out[0]?.ref).toBe(`${RC}:rnd`);
    });

  const rejects: Array<[string, unknown]> = [
    ["non-substring", bc(`${RC}:rnd`, "당사는 세계 최대의 단조 기술을 보유하고 있습니다")],
    ["too short", bc(`${RC}:rnd`, "단조 기술")],
    ["unknown section", bc(`${RC}:ip`, "정밀 단조 기술을 보유하고 있으며")],
    ["wrong rcept_no", bc("20260318000000:rnd", "정밀 단조 기술을 보유하고 있으며")],
    ["web kind from model", { kind: "web", ref: "https://x.example", quote: "정밀 단조 기술을 보유하고 있으며" }],
    ["short disclosure-title quote", { kind: "disclosure", ref: "20260101000001", quote: "주요사항보고서" }],
  ];
  for (const [name, c] of rejects)
    test(`rejects ${name}`, () => {
      expect(br.validateCitations([c as never], ctx)).toEqual([]);
    });

  test("rejections are logged server-side with a reason and never the quote text", () => {
    warn.mockClear();
    br.validateCitations(
      [
        bc(`${RC}:rnd`, "당사는 세계 최대의 단조 기술을 보유하고 있습니다"),
        bc(`${RC}:ip`, "정밀 단조 기술을 보유하고 있으며"),
      ],
      ctx,
    );
    const lines: string[] = warn.mock.calls.map((a: unknown[]) => String(a[0]));
    expect(lines.some((l: string) => l.includes("reason=mismatch"))).toBe(true);
    expect(lines.some((l: string) => l.includes("reason=unknown_ref"))).toBe(true);
    expect(lines.join("\n")).not.toContain("세계 최대");
  });
});

describe("fetchDisclosureText prefers the main document entry over an attachment listed first", () => {
  test("<rcept_no>.xml wins over <rcept_no>_00760.xml (audit-report attachment)", async () => {
    const { execFileSync } = await import("node:child_process");
    const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
    const dir = join(TMP, "zip");
    mkdirSync(dir);
    const R = "20260320000821";
    writeFileSync(join(dir, `${R}_00760.xml`), "<DOC>감사보고서 첨부 본문</DOC>");
    writeFileSync(join(dir, `${R}.xml`), "<DOC>사업의 내용 본문</DOC>");
    execFileSync("zip", ["-q", "t.zip", `${R}_00760.xml`, `${R}.xml`], { cwd: dir });
    const zip = readFileSync(join(dir, "t.zip"));
    process.env.DART_API_KEY = ["dart", "extract", "key"].join("-");
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(zip, { status: 200 })) as unknown as typeof fetch;
    try {
      const { fetchDisclosureText } = await import("../../app/web-next/lib/dart-client.ts");
      const res = await fetchDisclosureText(R);
      expect(res.text).toContain("사업의 내용 본문");
      expect(res.text).not.toContain("감사보고서 첨부");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("validateCitationsDetailed rejection codes", () => {
  test("reports the reason of every dropped citation", () => {
    const text = "정밀 단조 기술을 보유하고 있으며 연구개발 인력이 다수입니다";
    const ctx = {
      rceptNo: "20260318001708",
      sections: { rnd: { heading_raw: "x", text, chars: text.length, truncated: false } },
      disclosures: [],
      profileText: null,
    };
    const r = br.validateCitationsDetailed(
      [
        { kind: "business_report", ref: "20260318001708:rnd", quote: "세계 최대의 단조 기술을 보유" },
        { kind: "business_report", ref: "20260318001708:rnd", quote: "단조" },
        { kind: "business_report", ref: "20260318001708:ip", quote: "정밀 단조 기술을 보유하고 있으며" },
        { kind: "business_report", ref: "20260318001708:rnd", quote: "정밀 단조 기술을 보유하고 있으며" },
      ],
      ctx,
    );
    expect(r.rejected).toEqual(["mismatch", "too_short", "unknown_ref"]);
    expect(r.valid).toHaveLength(1);
  });
});

describe("evidence windows (engine-derived citations)", () => {
  const rnd =
    "연구개발활동 당사는 노후 설비의 수명연장 진단과 예지정비 기술을 개발하고 있으며 진동 센서 데이터를 이용한 고장 예측 모델을 연구소에서 운영합니다. " +
    "또한 급수가열기 최적설계를 통한 수명 향상 과제를 수행하고 있습니다. ".repeat(3);
  const ip = `지적재산권 ${"국내특허 특허 제 10-2234479호 등록 특허 제 10-2256414호 등록 특허 제 10-2266676호 등록 ".repeat(8)}`;
  const mk = (text: string) => ({ heading_raw: "x", text, chars: text.length, truncated: false });
  const sections = { rnd: mk(rnd), ip: mk(ip) };
  const crit = {
    id: "c1",
    label: "노후 설비 수명연장 진단 및 예지정비 기술",
    description: "S3 필요 역량 평가 기준. 고장 예측 진단",
  };

  test("keywords drop S3 boilerplate and stop words", () => {
    const k = br.criterionKeywords(crit.label, crit.description);
    expect(k).toContain("예지정비");
    expect(k).not.toContain("역량");
    expect(k).not.toContain("s3");
  });

  test("a matching window is chosen from the rnd section; the patent-number list is skipped", () => {
    const w = br.buildEvidenceWindows(sections, crit);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.section === "rnd")).toBe(true);
    expect(w[0]?.text).toContain("예지정비");
    expect(br.buildEvidenceWindows({ ip: mk(ip) }, crit)).toEqual([]);
  });

  test("the derived citation quote is a verbatim substring of its section", () => {
    const w = br.buildEvidenceWindows(sections, crit)[0] as ReturnType<typeof br.buildEvidenceWindows>[number];
    const c = br.windowCitation("20260318001708", w);
    expect(c).toMatchObject({ kind: "business_report", ref: "20260318001708:rnd" });
    expect(rnd).toContain(c.quote);
    expect(
      br.validateCitations([c], { rceptNo: "20260318001708", sections, disclosures: [], profileText: null }),
    ).toHaveLength(1);
  });

  test("the prompt budget is respected and numbers continue after the web sources", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...crit, id: `c${i}` }));
    const sel = br.selectPromptWindows(sections, many, 3000);
    const chars = [...sel.values()].reduce((n, ws) => n + ws.reduce((m, w) => m + w.text.length, 0), 0);
    expect(chars).toBeLessThanOrEqual(3000 + br.WINDOW_CHARS * 10); // shrinks to 1 per criterion at the floor
    expect([...sel.values()].every((ws) => ws.length <= 1)).toBe(true);
    const block = br.businessReportWindowsBlock(
      "20260318001708",
      new Map([["c1", sel.get("c0") ?? []]]),
      new Map([["c1", 2]]),
    );
    expect(block).toContain("c1:\n  [3] (");
  });
});
