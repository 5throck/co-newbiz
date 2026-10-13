// @version 1.0.0
/**
 * Brownfield checklist overlay — ADR-0162 (Proposed).
 *
 * (a) checklists/_overlays/brownfield-workspace-scope.yaml validates clean
 *     against the real checklists, and its recomputed counts equal design
 *     sections 5 and 7;
 * (b) m_and_a is all A with unscoped extras; fin-09 is never N/X;
 * (c) extras: jv keeps jvd only, minority keeps min-01..05 + 11 pt items,
 *     partnership keeps lic + cdv + 11 pt items;
 * (d) the validator rejects: C on brownfield, non-A baseline cell, binding
 *     item N/X, bf-01..03 excluded, X target not attached to the sub-track,
 *     N without reason, R without reading, count mismatches, missing approval.
 */

import { test, expect, describe } from "bun:test";
import * as yaml from "js-yaml";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateOverlay, checklistIdForFile, type OverlayContext } from "../../checklists/_validate";

const ROOT = resolve(import.meta.dirname, "../..");
const OVERLAY_PATH = join(ROOT, "checklists/_overlays/brownfield-workspace-scope.yaml");
const load = (p: string) => yaml.load(readFileSync(p, "utf-8"), { schema: yaml.JSON_SCHEMA }) as any;

function realContext(): OverlayContext {
  const checklists = new Map();
  for (const f of readdirSync(join(ROOT, "checklists")).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))) {
    const doc = load(join(ROOT, "checklists", f));
    checklists.set(
      checklistIdForFile(f),
      new Map((doc.items ?? []).map((i: any) => [i.id, { mandatory: i.mandatory === true, waiver_eligible: i.waiver_eligible !== false }])),
    );
  }
  return { checklists, procedureSteps: new Map() };
}

const ctx = realContext();
const ST = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"];
const fresh = () => structuredClone(load(OVERLAY_PATH));
const errorsOf = (doc: unknown) => validateOverlay("ovl.yaml", doc, ctx).filter((i) => i.severity === "error");
const row = (doc: any, checklist: string, id: string) => doc.checklists[checklist].items.find((r: any) => r.id === id);
const expectError = (doc: unknown, fragment: string) =>
  expect(errorsOf(doc).some((e) => e.message.includes(fragment) || e.item.includes(fragment))).toBe(true);

function counts(doc: any, st: string) {
  const c: Record<string, number> = { A: 0, R: 0, X: 0, N: 0 };
  for (const b of Object.values(doc.checklists) as any[]) for (const r of b.items) c[r.sub_tracks[st].code]++;
  return c;
}
function keptExtras(doc: any, st: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cid, b] of Object.entries(doc.extra_checklists) as [string, any][]) {
    if (!b.attached_to.includes(st)) continue;
    const ex = new Set(b.sub_tracks[st].excluded.flatMap((e: any) => e.ids));
    out[cid] = [...ctx.checklists.get(cid)!.keys()].filter((id) => !ex.has(id));
  }
  return out;
}

describe("brownfield workspace scope overlay (real file)", () => {
  test("validates clean", () => {
    expect(errorsOf(fresh())).toEqual([]);
  });

  test("header", () => {
    const d = fresh();
    expect([d.governance_doc_id, d.version, d.status, d.track, d.baseline_sub_track]).toEqual(["ovl-brownfield-workspace-scope", "1.2.2", "proposed", "brownfield", "m_and_a"]);
    expect(d.decision_record).toBe("DEC-20261013-03");
    expect(Object.keys(d.sub_track_keys)).toEqual(ST);
    expect(Object.keys(d.codes)).toEqual(["A", "R", "X", "N"]);
    expect(d.steps).toBeUndefined();
  });

  test("covers the 77 items of the seven workspace checklists", () => {
    const total = Object.values(fresh().checklists).reduce((n: number, b: any) => n + b.items.length, 0);
    expect(total).toBe(77);
  });

  test("recomputed counts equal design section 5", () => {
    const d = fresh();
    const exp: Record<string, number[]> = {
      m_and_a: [77, 0, 0, 0],
      jv: [57, 18, 0, 2],
      strategic_investment: [56, 15, 0, 6],
      minority_investment: [56, 15, 0, 6],
      partnership: [22, 30, 2, 23],
      rbd: [75, 2, 0, 0],
      corporate_venture: [56, 15, 0, 6],
    };
    for (const st of ST) {
      const [A, R, X, N] = exp[st];
      expect(counts(d, st)).toEqual({ A, R, X, N });
    }
  });

  test("Y (workspace + extras) equals design section 7", () => {
    const d = fresh();
    const y: Record<string, number> = { m_and_a: 102, jv: 93, strategic_investment: 76, minority_investment: 90, partnership: 78, rbd: 92, corporate_venture: 75 };
    for (const st of ST) {
      const c = counts(d, st);
      const extras = Object.values(keptExtras(d, st)).reduce((n, ids) => n + ids.length, 0);
      expect(c.A + c.R + extras).toBe(y[st]);
    }
  });

  test("m_and_a baseline: every row A, extras unscoped", () => {
    const d = fresh();
    for (const b of Object.values(d.checklists) as any[]) for (const r of b.items) expect(r.sub_tracks.m_and_a).toEqual({ code: "A" });
    const kept = keptExtras(d, "m_and_a");
    expect(kept["chk-brownfield-feasibility-checklist"].length).toBe(13);
    expect(kept["chk-ma-special-topics-checklist"].length).toBe(12);
  });

  test("binding fin-09 is A in every column (risk-officer review 2026-10-12)", () => {
    const r = row(fresh(), "chk-financing-plan-checklist", "fin-09");
    for (const st of ST) expect(r.sub_tracks[st].code).toBe("A");
  });

  test("extras section scoping", () => {
    const d = fresh();
    const ds = "chk-deal-shape-presigning-checklist";
    const pt = "chk-partnership-checklist";
    expect(keptExtras(d, "jv")[ds]).toEqual(["jvd-01", "jvd-02", "jvd-03", "jvd-04", "jvd-05", "jvd-06"]);
    expect(keptExtras(d, "jv")[pt].length).toBe(12);
    expect(keptExtras(d, "minority_investment")[ds]).toEqual(["min-01", "min-02", "min-03", "min-04", "min-05"]);
    expect(keptExtras(d, "minority_investment")[pt]).not.toContain("pt-06");
    expect(keptExtras(d, "minority_investment")[pt].length).toBe(11);
    expect(keptExtras(d, "partnership")[ds].every((id) => id.startsWith("lic-") || id.startsWith("cdv-"))).toBe(true);
    expect(keptExtras(d, "partnership")[ds].length).toBe(15);
    expect(keptExtras(d, "partnership")[pt]).not.toContain("pt-06");
    expect(keptExtras(d, "rbd")["chk-rbd-technology-checklist"].length).toBe(15);
    // DEC-20261013-03: merger-control / FDI items only
    const ma = "chk-ma-special-topics-checklist";
    for (const st of ["strategic_investment", "corporate_venture"]) expect(keptExtras(d, st)).toEqual({ [ma]: ["ma-01", "ma-02", "ma-03"], [ds]: st === "strategic_investment" ? ["min-04", "min-05"] : ["min-05"] });
    expect(keptExtras(d, "minority_investment")[ma]).toEqual(["ma-01", "ma-02", "ma-03"]);
  });

  test("extra R readings per sub-track (DEC-20261013-03)", () => {
    const d = fresh();
    const readIds = (cid: string, st: string) => (d.extra_checklists[cid].sub_tracks[st].readings ?? []).flatMap((r: any) => r.ids).sort();
    const ma = "chk-ma-special-topics-checklist";
    const ds = "chk-deal-shape-presigning-checklist";
    expect(readIds(ma, "strategic_investment")).toEqual(["ma-01", "ma-03"]);
    expect(readIds(ma, "minority_investment")).toEqual(["ma-01", "ma-03"]);
    expect(readIds(ma, "corporate_venture")).toEqual(["ma-01", "ma-03"]);
    expect(readIds(ds, "corporate_venture")).toEqual(["min-05"]);
    expect(readIds(ds, "strategic_investment")).toEqual(["min-04"]);
    expect(readIds(ds, "minority_investment")).toEqual([]);
  });

  test("validator rejects bad extra readings", () => {
    const ma = "chk-ma-special-topics-checklist";
    let d = fresh();
    d.extra_checklists[ma].sub_tracks.corporate_venture.readings[0].reading = "";
    expectError(d, "non-empty 'reading'");
    d = fresh();
    d.extra_checklists[ma].sub_tracks.corporate_venture.readings[0].ids = ["ma-07"];
    expectError(d, "both excluded and given a reading");
    d = fresh();
    d.extra_checklists[ma].sub_tracks.corporate_venture.readings[0].ids = ["ma-99"];
    expectError(d, "does not exist");
    d = fresh();
    d.extra_checklists[ma].sub_tracks.m_and_a.readings = [{ ids: ["ma-01"], reading: "x" }];
    expectError(d, "byte-identical baseline");
    d = fresh();
    const bfc = "chk-brownfield-feasibility-checklist";
    d.extra_checklists[bfc].sub_tracks.m_and_a.readings = [{ ids: ["bf-01"], reading: "x" }];
    expectError(d, "binding items must be A");
  });

  test("every row and extra block carries the chat approval record (no invented reviewer)", () => {
    const d = fresh();
    const rec = { status: "approved", approved_by: "user", approved_at: "2026-10-12", note: "approved in chat with the design" };
    const riskNote = "risk-officer review 2026-10-12: reclassified; user decision pending (approval record predates this change)";
    for (const b of Object.values(d.checklists) as any[])
      for (const r of b.items) expect(r.approval).toEqual(r.id === "fin-09" ? { ...rec, note: riskNote } : rec);
    for (const b of Object.values(d.extra_checklists) as any[]) expect(b.approval).toEqual(rec);
    const rec13 = { approved_by: "user", approved_at: "2026-10-13", note: "user decision 2026-10-13 (DEC-20261013-03): attach merger-control and FDI items to these sub-tracks" };
    for (const cid of ["chk-ma-special-topics-checklist", "chk-deal-shape-presigning-checklist"]) expect(d.extra_checklists[cid].approval_2026_10_13).toEqual(rec13);
  });

  test("user-facing text is Korean", () => {
    const d = fresh();
    const hangul = /[가-힣]/;
    for (const b of Object.values(d.checklists) as any[])
      for (const r of b.items)
        for (const st of ST) {
          const c = r.sub_tracks[st];
          for (const t of [c.reading, c.na_reason, c.note]) if (t !== undefined) expect(hangul.test(t)).toBe(true);
        }
  });
});

describe("brownfield overlay validator rejections", () => {
  test("C rejected on brownfield", () => {
    const d = fresh();
    const cell = row(d, "chk-technical-dd-checklist", "tdd-01").sub_tracks.jv;
    Object.assign(cell, { code: "C", na_reason: "x", site_rule: "x" });
    expectError(d, "not used on brownfield");
  });

  test("baseline m_and_a non-A rejected", () => {
    const d = fresh();
    Object.assign(row(d, "chk-legal-dd-checklist", "ldd-07").sub_tracks.m_and_a, { code: "R", reading: "x" });
    expectError(d, "Baseline sub-track");
  });

  test("baseline extras exclusion rejected", () => {
    const d = fresh();
    d.extra_checklists["chk-ma-special-topics-checklist"].sub_tracks.m_and_a.excluded = [{ ids: ["ma-05"], na_reason: "x" }];
    expectError(d, "extras must stay unscoped");
  });

  test("fin-09 R, N or X rejected", () => {
    const d = fresh();
    const cell = row(d, "chk-financing-plan-checklist", "fin-09").sub_tracks.partnership;
    Object.assign(cell, { code: "R", reading: "x" });
    expectError(d, "Binding item");
    Object.assign(cell, { code: "N", na_reason: "x" });
    expectError(d, "Binding item");
    Object.assign(cell, { code: "X", replaced_by: [{ checklist: "chk-partnership-checklist", item: "pt-03", stage: "S9" }] });
    expectError(d, "Binding item");
  });

  test("bf-01..03 excluded in extras rejected", () => {
    for (const id of ["bf-01", "bf-02", "bf-03"]) {
      const d = fresh();
      const b = d.extra_checklists["chk-brownfield-feasibility-checklist"];
      b.attached_to.push("jv");
      b.sub_tracks.jv = { excluded: [{ ids: [id], na_reason: "x" }] };
      expectError(d, "Binding item");
    }
  });

  test("X target in a checklist not attached to the sub-track rejected", () => {
    const d = fresh();
    Object.assign(row(d, "chk-financial-dd-checklist", "fdd-01").sub_tracks.strategic_investment, {
      code: "X",
      replaced_by: [{ checklist: "chk-partnership-checklist", item: "pt-03", stage: "S9" }],
      note: "x",
    });
    d.expected_counts.strategic_investment = { ...d.expected_counts.strategic_investment, A: 54, X: 1, judgeable: 70, total_judgeable: 70 };
    expectError(d, "not in a checklist attached");
  });

  test("X target that is excluded for the sub-track rejected", () => {
    const d = fresh();
    row(d, "chk-financial-dd-checklist", "fdd-01").sub_tracks.partnership.replaced_by[0].item = "pt-06";
    expectError(d, "itself excluded");
  });

  test("X target that does not exist rejected", () => {
    const d = fresh();
    row(d, "chk-financial-dd-checklist", "fdd-01").sub_tracks.partnership.replaced_by[0].item = "pt-99";
    expectError(d, "does not exist");
  });

  test("N without reason and R without reading rejected", () => {
    const d = fresh();
    delete row(d, "chk-legal-dd-checklist", "ldd-07").sub_tracks.minority_investment.na_reason;
    expectError(d, "na_reason");
    delete row(d, "chk-legal-dd-checklist", "ldd-06").sub_tracks.jv.reading;
    expectError(d, "brownfield 'reading'");
  });

  test("extras exclusion without reason or of an unknown item rejected", () => {
    const d = fresh();
    const ex = d.extra_checklists["chk-partnership-checklist"].sub_tracks.minority_investment.excluded;
    delete ex[0].na_reason;
    ex.push({ ids: ["pt-99"], na_reason: "x" });
    expectError(d, "Exclusion requires");
    expectError(d, "does not exist in checklist");
  });

  test("count mismatches rejected (workspace, extras, total)", () => {
    let d = fresh();
    d.expected_counts.jv.R = 19;
    expectError(d, "recomputed");
    d = fresh();
    d.expected_counts.minority_investment.extras_judgeable = 38;
    expectError(d, "extras_judgeable");
    d = fresh();
    d.expected_counts.partnership.total_judgeable = 115;
    expectError(d, "total_judgeable");
  });

  test("missing approval rejected (row and extra block)", () => {
    const d = fresh();
    delete row(d, "chk-hr-dd-checklist", "hdd-02").approval;
    expectError(d, "approval");
    const d2 = fresh();
    delete d2.extra_checklists["chk-deal-shape-presigning-checklist"].approval;
    expectError(d2, "(extra_checklists)/chk-deal-shape-presigning-checklist");
  });

  test("missing workspace checklist rejected", () => {
    const d = fresh();
    delete d.checklists["chk-hr-dd-checklist"];
    expectError(d, "Workspace checklist missing");
  });
});
