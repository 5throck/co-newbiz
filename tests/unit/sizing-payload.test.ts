// ADR-0180 slice 1 — the shared market_sizing_version payload readers.
// The pipeline writes {methodology, matrix: {anchor, regions, …},
// stepSummaries}; the legacy/test shape is the top-level {anchor, regions,
// scope}. Both must read, malformed input must degrade to null — the whole
// entry-market flow was inert on real data until this module existed.
import { describe, expect, test } from "bun:test";
import {
  readSizingAnchorTotal,
  readSizingDeclaredScope,
  readSizingRegions,
} from "../../app/web-next/lib/sizing-payload.ts";

// The REAL pipeline shape (mirrors lib/market-sizing-pipeline.ts:1066 and the
// live db/data/co-newbiz.sqlite rows).
const NESTED = JSON.stringify({
  methodology: "systematic-market-sizing v1.2.0",
  matrix: {
    industryLabel: "t",
    anchor: { sources: [{ label: "s", estimate: 2, asOf: "2026-06" }], total: 2.4 },
    regions: [
      { code: "china", label: "중국", weight: 30, mix: { demo: 35, quarry: 25 } },
      { code: "we", label: "서유럽", weight: 18 },
      { bad: "row" },
    ],
    segments: [],
  },
  stepSummaries: [],
});

// The legacy top-level shape the ADR-0179 tests (and fixtures) use.
const TOPLEVEL = JSON.stringify({
  anchor: { sources: [], total: 800 },
  regions: [{ code: "we", label: "서유럽", weight: 100 }],
  scope: { regions: ["we", "ee"], segments: [], unit_basis: "usd_m_year" },
});

describe("readSizingAnchorTotal", () => {
  test("reads the nested pipeline shape (matrix.anchor.total)", () => {
    expect(readSizingAnchorTotal(NESTED)).toBe(2.4);
  });
  test("reads the legacy top-level shape", () => {
    expect(readSizingAnchorTotal(TOPLEVEL)).toBe(800);
  });
  test("null/empty/unparsable payloads yield null, never a throw", () => {
    for (const p of [null, undefined, "", "not json", "[1,2]", JSON.stringify({ matrix: "x" }), JSON.stringify({ anchor: { total: -5 } }), JSON.stringify({ anchor: { total: "2" } })]) {
      expect(readSizingAnchorTotal(p as string | null)).toBeNull();
    }
  });
});

describe("readSizingDeclaredScope", () => {
  test("top-level scope wins; matrix.scope is accepted for future scoped sizings", () => {
    expect(readSizingDeclaredScope(TOPLEVEL)).toEqual({ regions: ["we", "ee"], segments: [], unit_basis: "usd_m_year" });
    const nestedScoped = JSON.stringify({ matrix: { scope: { regions: ["we"], segments: ["seg-a"], unit_basis: null } } });
    expect(readSizingDeclaredScope(nestedScoped)).toEqual({ regions: ["we"], segments: ["seg-a"], unit_basis: null });
  });
  test("no scope anywhere (every live row today) yields null; malformed regions are not a scope", () => {
    expect(readSizingDeclaredScope(NESTED)).toBeNull();
    expect(readSizingDeclaredScope(JSON.stringify({ scope: { regions: [] } }))).toBeNull();
    expect(readSizingDeclaredScope(JSON.stringify({ scope: { regions: ["we", 3] } }))).toBeNull();
    expect(readSizingDeclaredScope(null)).toBeNull();
  });
});

describe("readSizingRegions", () => {
  test("reads matrix.regions, drops malformed rows, keeps the optional mix", () => {
    const regions = readSizingRegions(NESTED);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({ code: "china", label: "중국", weight: 30, mix: { demo: 35, quarry: 25 } });
    expect(regions[1]).toEqual({ code: "we", label: "서유럽", weight: 18 });
  });
  test("top-level regions read too; missing regions yield []", () => {
    expect(readSizingRegions(TOPLEVEL)).toEqual([{ code: "we", label: "서유럽", weight: 100 }]);
    expect(readSizingRegions(null)).toEqual([]);
    expect(readSizingRegions(JSON.stringify({ regions: "x" }))).toEqual([]);
  });
});
