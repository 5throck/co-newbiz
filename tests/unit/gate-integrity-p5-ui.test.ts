// ADR-0186 P5 UI view logic: KPI query/flatten helpers and the re-confirmation notice helpers; plus catalog parity.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  currentWeekStart, flattenValue, formatRate, kpiQueryProblem, kpiQueryString, mixRows, streakRows, weekCountRows,
} from "../../app/web-next/lib/gate-integrity-kpis-view.ts";
import { canTryClear, reconfirmErrorText, reconfirmItemHref, unmetFrom } from "../../app/web-next/lib/reconfirm-view.ts";

const WEB = join(import.meta.dirname, "..", "..", "app", "web-next");
const cat = (l: string) => JSON.parse(readFileSync(join(WEB, "locales", `${l}.json`), "utf8"));
const at = (c: unknown, k: string) => k.split(".").reduce<any>((n, p) => (n ? n[p] : undefined), c);

describe("KPI view helpers", () => {
  test("week start is the Monday of the week", () => {
    expect(currentWeekStart(new Date("2026-10-28T10:00:00Z"))).toBe("2026-10-26");
    expect(currentWeekStart(new Date("2026-11-01T23:00:00Z"))).toBe("2026-10-26");
  });
  test("query string makes `to` the end of the picked day and omits empty filters", () => {
    expect(kpiQueryString({ from: "2026-10-26", to: "2026-10-28", gate: "", minWrites: "" })).toBe("from=2026-10-26T00%3A00%3A00.000Z&to=2026-10-29T00%3A00%3A00.000Z");
    expect(kpiQueryString({ from: "2026-10-26", to: "2026-10-28", gate: "fs", minWrites: " 5 " })).toContain("gate=fs&min_writes=5");
  });
  test("problems", () => {
    expect(kpiQueryProblem({ from: "2026-10-29", to: "2026-10-28", gate: "", minWrites: "" })).toBe("range");
    expect(kpiQueryProblem({ from: "2026-10-26", to: "2026-10-28", gate: "", minWrites: "-1" })).toBe("minWrites");
    expect(kpiQueryProblem({ from: "2026-10-26", to: "2026-10-28", gate: "", minWrites: "10" })).toBeNull();
  });
  test("rate formatting and null rate", () => {
    expect(formatRate(0.1234)).toBe("12.3%");
    expect(formatRate(null)).toBe("-");
  });
  test("flatten nests and summarises arrays", () => {
    expect(flattenValue({ a: 1, b: { c: null, d: [1, 2] } })).toEqual([{ key: "a", value: 1 }, { key: "b.c", value: null }, { key: "b.d", value: 2 }]);
  });
  test("G1 / G6 / G12 shapes", () => {
    const g1 = mixRows({ by_gate: { fs: { total: 4, go: 3, hold: 1, kill: 0, go_share: 0.75 } }, prior_4_weeks_by_gate: { fs: { total: 2, go_share: 0.5 } } });
    expect(g1).toEqual([{ gate: "fs", total: 4, go: 3, hold: 1, kill: 0, goShare: 0.75, priorTotal: 2, priorGoShare: 0.5 }]);
    expect(weekCountRows({ by_family_code_week: { wacc: { c1: { "2026-10-26": 2, "2026-10-19": 1 } } } })).toEqual([
      { family: "wacc", code: "c1", week: "2026-10-19", count: 1 }, { family: "wacc", code: "c1", week: "2026-10-26", count: 2 },
    ]);
    expect(streakRows({ by_family: { waiver: { streak_days: 15, writes_in_streak: 12, qualifies_14_days: true } } })).toEqual([{ family: "waiver", streakDays: 15, writes: 12, qualifies: true }]);
    expect(mixRows(null)).toEqual([]);
  });
});

describe("re-confirmation helpers", () => {
  test("item links", () => {
    expect(reconfirmItemHref("PRJ-1", "wacc_confirmed")).toBe("/projects/PRJ-1/wacc");
    expect(reconfirmItemHref("PRJ-1", "ic_countersign")).toBe("/projects/PRJ-1/ic-review");
    expect(reconfirmItemHref("PRJ-1", "na_review")).toBe("/projects/PRJ-1/dd");
  });
  test("409 text lists localized unmet items and ignores unknown keys", () => {
    expect(unmetFrom({ unmet: ["wacc_confirmed", "zzz"] })).toEqual(["wacc_confirmed"]);
    expect(reconfirmErrorText("Refused.", { unmet: ["na_review"] }, (k) => `L:${k}`)).toBe("Refused. (L:na_review)");
    expect(reconfirmErrorText("Refused.", {}, (k) => k)).toBe("Refused.");
  });
  test("only analysts are offered the clear form", () => {
    expect(canTryClear("analyst")).toBe(true);
    expect(canTryClear("admin")).toBe(false);
    expect(canTryClear("viewer")).toBe(false);
  });
});

describe("catalog keys exist in ko and en", () => {
  const keys = [
    "admin.gateIntegrity.h1", "pages.titles.adminGateIntegrity", "nav.admin.gateIntegrity", "pages.deals.filterHold",
    ...["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"].map((g) => `admin.gateIntegrity.kpiName.${g}`),
    ...["wacc_confirmed", "ic_countersign", "na_review"].map((k) => `components.reconfirm.item.${k}`),
    "components.reconfirm.title", "components.reconfirm.clear.submit", "components.reconfirm.create.submit",
  ];
  test("parity", () => {
    for (const l of ["ko", "en"]) for (const k of keys) expect(typeof at(cat(l), k), `${l}:${k}`).toBe("string");
  });
});
