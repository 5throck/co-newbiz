// @version 1.0.0
/**
 * S6 evaluation-target direction — pure tests (design
 * 2026-11-17-s6-universe-direction-review §4.1, §4.3, §5.2, §8 items 1-3).
 * Catalog builder, validator and support line run on fixtures with no DB and no
 * network.
 */
import { describe, expect, test } from "bun:test";
import {
  buildUniverseEvidenceCatalog,
  deriveNumbers,
  type UniverseS1Resolution,
} from "../../app/web-next/lib/brownfield-universe.ts";
import {
  buildSupportLine,
  catalogPromptLines,
  criteriaProjection,
  deterministicDirection,
  directionCounts,
  type EvidenceItem,
  normalizeDirection,
  worstGrade,
} from "../../app/web-next/lib/universe-direction.ts";

const MATRIX = {
  industryLabel: "원자력 발전소",
  anchor: { total: 39.88 },
  competitive: { structure: "과점 구조" },
  consistency: { bottomUpCagr: 0.0073, topDownCagr: 0.05, source: { label: "IEA" } },
  externalForecast: { sourceLabel: "IEA 보고서", targetYear: 2030, marketSize: 48.5, cagr: 0.052 },
  baseline2026: { KR: { SEG1: 10, SEG2: 5 } },
  cagrBase: { KR: { SEG1: 0.05, SEG2: 0.03 } },
  segments: [
    { code: "SEG1", label: "핵심부품" },
    { code: "SEG2", label: "검사장비" },
  ],
  regions: [
    { code: "KR", weight: 60 },
    { code: "US", weight: 40 },
  ],
  chainGrade: { grade: "C", statisticalHops: 0 },
  chainDirection: { position: "midstream" },
  qualitative: { opportunityFactors: ["원전 재가동 수요"], riskFactors: ["규제 지연 — CAGR 0.73% 둔화"] },
  sectionConfidence: [{ section: "정성 분석", grade: "B-" }],
};

function s1Of(
  matrix: unknown,
  grade: string | null = "U",
  resolution: "pinned" | "unset" = "pinned",
): UniverseS1Resolution {
  return {
    resolution,
    pinDiscarded: false,
    row: {
      id: "VER7",
      version_no: 7,
      payload: JSON.stringify({ matrix }),
      data_confidence_grade: grade,
      chain_hops: 0,
      confidence_basis: null,
      industry_id: "IND1",
    },
  };
}

const STAGE_ROWS = [
  { metric_key: "operating_margin", value: 18.5, revision_no: 2, period_label: "2026" },
  { metric_key: "gross_margin", value: 30, revision_no: 1, period_label: "2026" },
];
const REGISTER = (rows: Array<{ capability: string; necessity: string }>): string => JSON.stringify({ rows });

const full = () => buildUniverseEvidenceCatalog(s1Of(MATRIX), STAGE_ROWS, null);
const kinds = (c: EvidenceItem[]) => c.map((i) => i.kind);
const idOf = (c: EvidenceItem[], kind: string, n = 0) => c.filter((i) => i.kind === kind)[n].id;

describe("buildUniverseEvidenceCatalog (§4.1)", () => {
  test("ids, kinds, refs and grades follow the fixed kind order", () => {
    const c = full();
    expect(kinds(c)).toEqual([
      "s1_identity",
      "s1_anchor",
      "s1_trend_cagr",
      "s1_topdown_cagr",
      "s1_external_forecast",
      "s1_projection",
      "s1_competitive",
      "s1_chain",
      "s1_region_mix",
      "s1_segments",
      "s1_opportunity_factor",
      "s1_risk_factor",
      "stage_financial",
      "stage_financial",
    ]);
    expect(c.map((i) => i.id)).toEqual(c.map((_, n) => `E${n + 1}`));
    expect(c[0]).toMatchObject({ ref: "S1 v7", version_id: "VER7", grade: "U" });
    expect(c[0].fact).toBe("Industry definition: 원자력 발전소 (pinned v7)");
    expect(c[1].fact).toBe("Anchor market size $39.88B (2026, global)");
    expect(c[7].grade).toBe("C"); // chain grade, not the version grade
    expect(c[10].grade).toBe("B-"); // qualitative section grade
    expect(c.find((i) => i.kind === "s1_projection")?.ref).toBe("S1 v7 (computed)");
    expect(c.find((i) => i.kind === "stage_financial")).toMatchObject({ grade: null, version_id: null });
  });

  test("numbers carry percent/fraction equivalents and 0/1/2-decimal roundings; years are captured", () => {
    const c = full();
    const trend = c.find((i) => i.kind === "s1_trend_cagr");
    expect(trend?.fact).toBe("Trend-extension CAGR 0.73% (past growth extended, bottom-up)");
    expect(trend?.numbers).toContain(0.73);
    expect(trend?.numbers).toContain(0.0073);
    const ext = c.find((i) => i.kind === "s1_external_forecast");
    expect(ext?.years).toEqual([2030]);
    expect(ext?.numbers).toContain(5.2);
    expect(c[1].numbers).toContain(39.9);
    expect(c[1].numbers).toContain(40);
    expect(deriveNumbers("CAGR 12.5%")).toContain(0.125);
  });

  test("citeable_in maps to the field vocabulary; CAGR and projection items are basis/support only", () => {
    const c = full();
    for (const kind of ["s1_trend_cagr", "s1_topdown_cagr", "s1_external_forecast", "s1_projection"]) {
      expect(c.find((i) => i.kind === kind)?.citeable_in).toEqual(["basis", "support"]);
    }
    expect(c[0].citeable_in).toEqual(["scope", "basis"]);
    expect(c.find((i) => i.kind === "s1_chain")?.citeable_in).toContain("value_chain");
    expect(c.find((i) => i.kind === "s1_competitive")?.citeable_in).not.toContain("scope");
  });

  test("absence: no payload field → no item; zero stage rows → the gap item", () => {
    const c = buildUniverseEvidenceCatalog(s1Of({ industryLabel: "X", anchor: { total: 5 } }), [], null);
    expect(kinds(c)).toEqual(["s1_identity", "s1_anchor", "stage_financial_gap"]);
    expect(c[2]).toMatchObject({ fact: "Value-chain stage financials: no data", grade: null });
    expect(buildUniverseEvidenceCatalog(s1Of({}, null, "unset"), [], null)).toEqual([]);
  });

  test("s3_capability: required first, at most 5, citeable in priority and basis only", () => {
    const rows = [
      ...["o1", "o2", "o3"].map((n) => ({ capability: n, necessity: "optional" })),
      ...["r1", "r2", "r3", "r4"].map((n) => ({
        capability: n,
        necessity: n === "r4" ? "partial_essential" : "essential",
      })),
    ];
    const c = buildUniverseEvidenceCatalog(s1Of(null, null, "unset"), [], REGISTER(rows));
    expect(c.map((i) => i.fact)).toEqual([
      "S3 required capability: r1 (required)",
      "S3 required capability: r2 (required)",
      "S3 required capability: r3 (required)",
      "S3 required capability: r4 (required)",
      "S3 required capability: o1 (optional)",
    ]);
    expect(c[0].citeable_in).toEqual(["priority", "basis"]);
    expect(c[0]).toMatchObject({ ref: "S3 capability register", grade: null });
  });

  test("prompt lines are `[E#] ref · fact · confidence grade`", () => {
    expect(catalogPromptLines(full())[0]).toBe(
      "[E1] S1 v7 · Industry definition: 원자력 발전소 (pinned v7) · confidence U",
    );
  });
});

/** A small catalog for the validator cases. */
const cat = () => full();

function dir(over: Record<string, unknown> = {}) {
  return {
    headline: { text: "원자력 발전소 미드스트림 부품 기업을 롱리스트로 본다", refs: ["E1"] },
    scope: {
      industry: { text: "원자력 발전소 부품 업종", refs: ["E1"] },
      region: { text: "한국 60% 미국 40% 지역 믹스를 따른다", refs: ["E9"] },
      size: { text: "기준 시장규모 $39.9B 안의 기업", refs: ["E2"] },
    },
    value_chain: { text: "미드스트림 기자재 공급 단계", refs: ["E8"] },
    prioritise: [{ type: "중견 부품 공급사", why: "과점 구조에서 진입 여지가 있다", refs: ["E7"] }],
    exclude: [{ type: "완제품 조립사", why: "미드스트림 밖이다", refs: ["E8"] }],
    basis: { text: "성장률 0.73% 와 규모를 함께 본다", refs: ["E2", "E3"] },
    ...over,
  };
}

describe("normalizeDirection (§5.2)", () => {
  test("a clean draft passes with zero checks, a worst-grade chip and cited-only evidence", () => {
    const v = normalizeDirection(dir(), cat());
    expect(v).not.toBeNull();
    expect(v?.origin).toBe("ai");
    expect(directionCounts(v!.checks)).toEqual({ emptied_fields: 0, dropped_refs: 0, clamped: 0 });
    expect(v?.scope.size.text).toBe("기준 시장규모 $39.9B 안의 기업");
    expect(v?.grade).toBe("U"); // worst of U (E1,E2,E3), C (E8), B- ... E9 (region mix, grade U)
    const ids = v!.evidence.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    expect(ids).toContain("E1");
    expect(ids).not.toContain("E6"); // the projection is neither cited nor on the support line
  });

  test("unknown keys are dropped and lists/refs are capped", () => {
    const v = normalizeDirection(
      dir({
        evil: "x",
        prioritise: Array.from({ length: 5 }, (_, i) => ({
          type: `유형${i}`,
          why: "이유",
          refs: ["E7", "E7", "E8", "E9", "E10", "E11"],
        })),
      }),
      cat(),
    );
    expect(v?.prioritise).toHaveLength(3);
    expect(v?.prioritise[0].refs).toEqual(["E7", "E8", "E9", "E10"]);
    expect(v?.checks.clamped.some((c) => c.field === "prioritise" && c.from === 5 && c.to === 3)).toBeTrue();
    expect(JSON.stringify(v)).not.toContain("evil");
  });

  test("text is clamped at the last word boundary and the clamp is recorded", () => {
    const long = `${"가나다 ".repeat(40)}끝`;
    const v = normalizeDirection(dir({ headline: { text: long, refs: ["E1"] } }), cat());
    expect(v!.headline.text.length).toBeLessThanOrEqual(90);
    expect(v!.headline.text.endsWith("가나다")).toBeTrue();
    expect(v!.checks.clamped.find((c) => c.field === "headline")?.from).toBe(long.length);
  });

  test("unknown and non-citeable refs are dropped with a reason", () => {
    const v = normalizeDirection(
      dir({
        scope: {
          industry: { text: "부품 업종", refs: ["E99", "E3", "E1"] },
          region: { text: "", refs: [] },
          size: { text: "", refs: [] },
        },
      }),
      cat(),
    );
    expect(v?.scope.industry.refs).toEqual(["E1"]);
    expect(v?.checks.dropped_refs).toEqual([
      { field: "scope.industry", ref: "E99", reason: "unknown_ref" },
      { field: "scope.industry", ref: "E3", reason: "not_citeable" },
    ]);
  });

  test("a growth item cited in scope is not citeable (growth can never become a scope criterion)", () => {
    const c = cat();
    const v = normalizeDirection(
      dir({
        scope: {
          industry: { text: "성장 업종", refs: [idOf(c, "s1_trend_cagr")] },
          region: { text: "", refs: [] },
          size: { text: "", refs: [] },
        },
      }),
      c,
    );
    expect(v?.checks.dropped_refs[0].reason).toBe("not_citeable");
    expect(v?.scope.industry.unverified).toBeTrue();
  });

  test("numbers trace against the field's OWN refs only", () => {
    const c = cat();
    // 18.5 lives in E13 (stage financial); citing E2 (anchor) must not trace it.
    const wrong = normalizeDirection(dir({ value_chain: { text: "영업이익률 18.5% 단계", refs: ["E2"] } }), c);
    expect(wrong?.value_chain.text).toBe("");
    expect(wrong?.checks.untraced_numbers).toEqual([{ field: "value_chain", token: "18.5" }]);
    const right = normalizeDirection(
      dir({ value_chain: { text: "영업이익률 18.5% 단계", refs: [idOf(c, "stage_financial")] } }),
      c,
    );
    expect(right?.value_chain.text).toBe("영업이익률 18.5% 단계");
  });

  test("tracing rules: rounding ok, unit conversion not, years literal, exempt tokens pass", () => {
    const c = cat();
    const ok = (text: string, refs: string[]) =>
      normalizeDirection(dir({ headline: { text, refs: [] }, basis: { text, refs } }), c)?.basis.text;
    expect(ok("규모 $39.9B", ["E2"])).toBe("규모 $39.9B"); // rounded to shown precision
    expect(ok("약 398억 달러", ["E2"])).toBe(""); // unit conversion is not traced
    expect(ok("2030년 전망", [idOf(c, "s1_external_forecast")])).toBe("2030년 전망");
    expect(ok("2031년 전망", [idOf(c, "s1_external_forecast")])).toBe(""); // year not in the item
    expect(ok("v7 hops 0 후보 3개", ["E1"])).toBe("v7 hops 0 후보 3개"); // exempt tokens
    expect(ok("성장률 5.2%", [idOf(c, "s1_external_forecast")])).toBe("성장률 5.2%");
    expect(ok("성장률 -0.73%", [idOf(c, "s1_trend_cagr")])).toBe("성장률 -0.73%"); // sign-insensitive
    expect(ok("12% 성장", ["E1"])).toBe(""); // 12 with a unit is a quantity, not a count
  });

  test("forbidden phrases empty the field and are recorded; adjectival 제외한 passes", () => {
    const c = cat();
    const bad = normalizeDirection(
      dir({
        headline: { text: "기업을 롱리스트로 본다", refs: ["E1"] },
        scope: {
          industry: { text: "시장 규모를 근거로 설정했다", refs: ["E1"] },
          region: { text: "중국을 제외한 지역", refs: ["E9"] },
          size: { text: "S1 산출물 기준", refs: ["E2"] },
        },
      }),
      c,
    );
    expect(bad?.scope.industry.text).toBe("");
    expect(bad?.scope.region.text).toBe("중국을 제외한 지역");
    expect(bad?.scope.size.text).toBe("");
    expect(bad?.checks.forbidden_phrases.map((f) => f.field)).toEqual(["scope.industry", "scope.size"]);
    expect(directionCounts(bad!.checks).emptied_fields).toBe(2);
  });

  test("capability terms fail in scope and exclude but pass in prioritise", () => {
    const c = buildUniverseEvidenceCatalog(
      s1Of(MATRIX),
      STAGE_ROWS,
      REGISTER([{ capability: "정밀 가공", necessity: "essential" }]),
    );
    const cap = idOf(c, "s3_capability");
    const v = normalizeDirection(
      dir({
        scope: {
          industry: { text: "KEPIC 인증 보유 기업", refs: ["E1"] },
          region: { text: "", refs: [] },
          size: { text: "", refs: [] },
        },
        prioritise: [{ type: "정밀 가공 이미 수행", why: "S3 갭의 역량을 채운다", refs: [cap] }],
        exclude: [{ type: "실적 없는 기업", why: "미드스트림 밖", refs: ["E8"] }],
        headline: { text: "부품 기업을 본다", refs: ["E1"] },
      }),
      c,
    );
    expect(v?.scope.industry.text).toBe("");
    expect(v?.exclude).toEqual([]);
    // The prioritise entry fails only on the S\d source-naming rule, so keep a clean variant too.
    const ok = normalizeDirection(
      dir({
        prioritise: [{ type: "정밀 가공 이미 수행", why: "필요 역량의 공백을 채운다", refs: [cap] }],
        headline: { text: "부품 기업을 본다", refs: ["E1"] },
      }),
      c,
    );
    expect(ok?.prioritise).toHaveLength(1);
    // The same capability item is not citeable in exclude.
    const ex = normalizeDirection(dir({ exclude: [{ type: "조립사", why: "범위 밖", refs: [cap] }] }), c);
    expect(ex?.checks.dropped_refs.some((d) => d.field === "exclude[0]" && d.reason === "not_citeable")).toBeTrue();
  });

  test("unverified: zero valid refs, or the model's own 검증 필요, is kept; empty fields are not flagged", () => {
    const v = normalizeDirection(
      dir({
        value_chain: { text: "미드스트림 단계", refs: [] },
        basis: { text: "수익성은 검증 필요", refs: ["E2"] },
        headline: { text: "부품 기업을 본다", refs: ["E1"] },
        scope: { industry: { text: "", refs: [] }, region: { text: "", refs: [] }, size: { text: "", refs: [] } },
      }),
      cat(),
    );
    expect(v?.value_chain.unverified).toBeTrue();
    expect(v?.basis.unverified).toBeTrue();
    expect(v?.basis.text).toContain("검증 필요");
    expect(v?.headline.unverified).toBeFalse();
    expect(v?.scope.industry.unverified).toBeFalse();
  });

  test("grade is the worst grade among kept refs; null grades are skipped", () => {
    expect(worstGrade(["A", "C-", "B", null])).toBe("C-");
    expect(worstGrade([null, null])).toBeNull();
    const c = buildUniverseEvidenceCatalog(s1Of(MATRIX, "B"), STAGE_ROWS, null);
    const v = normalizeDirection(
      dir({
        value_chain: { text: "미드스트림", refs: [idOf(c, "s1_chain")] },
        scope: {
          industry: { text: "부품 업종", refs: ["E1"] },
          region: { text: "", refs: [] },
          size: { text: "", refs: [] },
        },
        headline: { text: "부품 기업", refs: ["E1"] },
        prioritise: [],
        exclude: [],
        basis: { text: "", refs: [] },
      }),
      c,
    );
    expect(v?.grade).toBe("C"); // chain grade C is worse than the version grade B
  });

  test("validity: headline or one scope field must survive; otherwise null", () => {
    expect(normalizeDirection({ basis: { text: "요약", refs: ["E1"] } }, cat())).toBeNull();
    expect(normalizeDirection(null, cat())).toBeNull();
    expect(
      normalizeDirection({ headline: { text: "" }, scope: { size: { text: "기준 $39.9B", refs: ["E2"] } } }, cat()),
    ).not.toBeNull();
    expect(normalizeDirection({ headline: { text: "S1 산출물", refs: ["E1"] } }, cat())).toBeNull(); // emptied → nothing survives
  });
});

describe("buildSupportLine (§4.3)", () => {
  test("growth source priority: external forecast > top-down > trend", () => {
    const c = full();
    const seg = buildSupportLine(c);
    expect(seg.map((s) => s.key)).toEqual(["size", "growth", "profitability"]);
    expect(seg[0]).toMatchObject({ kind: "anchor", value: "$39.88B (2026)", ref: "E2" });
    expect(seg[1]).toMatchObject({ kind: "external_forecast", value: "5.2%", ref: idOf(c, "s1_external_forecast") });
    const noExt = buildUniverseEvidenceCatalog(s1Of({ ...MATRIX, externalForecast: undefined }), [], null);
    expect(buildSupportLine(noExt)[1].kind).toBe("topdown_cagr");
    const trendOnly = buildUniverseEvidenceCatalog(
      s1Of({ ...MATRIX, externalForecast: undefined, consistency: { bottomUpCagr: 0.0073, topDownCagr: undefined } }),
      [],
      null,
    );
    expect(buildSupportLine(trendOnly)[1]).toMatchObject({ kind: "trend_cagr", value: "0.73%" });
  });

  test("no CAGR item → growth is unrecorded with no ref and no value", () => {
    const c = buildUniverseEvidenceCatalog(s1Of({ industryLabel: "X", anchor: { total: 5 } }), [], null);
    expect(buildSupportLine(c)[1]).toEqual({
      key: "growth",
      label: "Growth rate",
      kind: "unrecorded",
      value: "",
      ref: "",
      grade: null,
    });
  });

  test("stage profitability: the margin metric when rows exist, the gap item (unverified) when not", () => {
    expect(buildSupportLine(full())[2]).toMatchObject({ kind: "stage_financial", value: "operating_margin=18.5" });
    const gap = buildUniverseEvidenceCatalog(s1Of({ industryLabel: "X", anchor: { total: 5 } }), [], null);
    expect(buildSupportLine(gap)[2]).toMatchObject({
      kind: "unverified",
      value: "",
      ref: idOf(gap, "stage_financial_gap"),
    });
  });

  test("no outlook words or thresholds appear anywhere in the support line", () => {
    expect(JSON.stringify(buildSupportLine(full()))).not.toMatch(/growing|declining|flat|slowing|outlook/i);
  });

  test("S3-only catalog has no support line", () => {
    const c = buildUniverseEvidenceCatalog(
      s1Of(null, null, "unset"),
      [],
      REGISTER([{ capability: "정밀 가공", necessity: "essential" }]),
    );
    expect(buildSupportLine(c)).toEqual([]);
  });
});

describe("deterministic fallback and projection", () => {
  test("deterministic view: every direction field empty, support + support-item evidence only", () => {
    const v = deterministicDirection(full());
    expect(v.origin).toBe("deterministic");
    expect(v.headline).toEqual({ text: "", refs: [], unverified: false });
    expect(v.prioritise).toEqual([]);
    expect(v.grade).toBeNull();
    expect(v.evidence.map((e) => e.kind).sort()).toEqual(["s1_anchor", "s1_external_forecast", "stage_financial"]);
  });

  test("criteria projection keeps scope text and blanks viability/rationale", () => {
    const v = normalizeDirection(dir(), cat());
    expect(criteriaProjection(v!)).toEqual({
      industry: "원자력 발전소 부품 업종",
      region: "한국 60% 미국 40% 지역 믹스를 따른다",
      size: "기준 시장규모 $39.9B 안의 기업",
      viability: "",
      rationale: "",
    });
  });
});
