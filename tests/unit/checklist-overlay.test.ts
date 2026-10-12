// @version 1.0.0
/**
 * Checklist overlay validator — ADR-0160 addendum (b).
 *
 * (a) the real overlay checklists/_overlays/greenfield-workspace-scope.yaml
 *     validates clean against the real checklists and procedures, and its
 *     recomputed counts equal design section 5;
 * (b) fin-09 (the only binding item) is R in every sub-track;
 * (c) the validator rejects: missing item, unknown item, N without reason,
 *     R without reading, X with an unknown target, binding item N/X without
 *     (even with adr_reference), missing approval, count mismatch, unknown step.
 */

import { test, expect, describe } from "bun:test";
import * as yaml from "js-yaml";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateOverlay, checklistIdForFile, type OverlayContext } from "../../checklists/_validate";

const ROOT = resolve(import.meta.dirname, "../..");
const OVERLAY_PATH = join(ROOT, "checklists/_overlays/greenfield-workspace-scope.yaml");
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
  const gf = load(join(ROOT, "procedures/_shared/greenfield-dd/schema.yaml"));
  return { checklists, procedureSteps: new Map([[gf.procedure_id, new Set(gf.steps.map((s: any) => String(s.id)))]]) };
}

const ctx = realContext();
const fresh = () => structuredClone(load(OVERLAY_PATH));
const errorsOf = (doc: unknown) => validateOverlay("ovl.yaml", doc, ctx).filter((i) => i.severity === "error");
const row = (doc: any, checklist: string, id: string) => doc.checklists[checklist].items.find((r: any) => r.id === id);

/** Rows changed after the risk-officer review 2026-10-12 (user decision pending). */
const RISK_REVIEW_ROWS = ["fin-09", "ldd-06", "ldd-07", "tdd-05", "mdd-09"];
const RISK_REVIEW_NOTE = "risk-officer review 2026-10-12: reclassified; user decision pending (approval record predates this change)";

describe("greenfield workspace scope overlay (real file)", () => {
  test("validates clean", () => {
    expect(errorsOf(fresh())).toEqual([]);
  });

  test("covers the 77 items of the seven ADR-0148 checklists", () => {
    const doc = fresh();
    expect(Object.keys(doc.checklists).sort()).toEqual(
      [
        "chk-commercial-dd-checklist",
        "chk-financial-dd-checklist",
        "chk-financing-plan-checklist",
        "chk-hr-dd-checklist",
        "chk-legal-dd-checklist",
        "chk-market-dd-checklist",
        "chk-technical-dd-checklist",
      ].sort(),
    );
    const total = Object.values(doc.checklists).reduce((n: number, b: any) => n + b.items.length, 0);
    expect(total).toBe(77);
  });

  test("recomputed counts equal design section 5", () => {
    const doc = fresh();
    const count = (st: string) => {
      const c: Record<string, number> = { A: 0, R: 0, X: 0, N: 0, C: 0 };
      for (const b of Object.values(doc.checklists) as any[]) for (const r of b.items) c[r.sub_tracks[st].code]++;
      return c;
    };
    expect(count("none")).toEqual({ A: 14, R: 42, X: 2, N: 19, C: 0 });
    expect(count("existing_business_rbd")).toEqual({ A: 13, R: 47, X: 1, N: 13, C: 3 });
    expect(count("intra_venture")).toEqual({ A: 11, R: 44, X: 4, N: 15, C: 3 });
  });

  test("binding item fin-09 is A in every sub-track (risk-officer review 2026-10-12)", () => {
    const r = row(fresh(), "chk-financing-plan-checklist", "fin-09");
    for (const st of ["none", "existing_business_rbd", "intra_venture"]) expect(r.sub_tracks[st].code).toBe("A");
  });

  test("every row carries the chat approval record (no invented reviewer)", () => {
    for (const b of Object.values(fresh().checklists) as any[])
      for (const r of b.items) {
        const note = RISK_REVIEW_ROWS.includes(r.id) ? RISK_REVIEW_NOTE : "approved in chat with the design";
        expect(r.approval).toEqual({ status: "approved", approved_by: "user", approved_at: "2026-10-12", note });
      }
  });

  test("tab labels are marked interim", () => {
    expect(fresh().tab_labels_status).toBe("interim");
  });
});

describe("overlay validator rejections", () => {
  const expectError = (doc: unknown, fragment: string) =>
    expect(errorsOf(doc).some((e) => e.message.includes(fragment) || e.item.includes(fragment))).toBe(true);

  test("checklist item missing from overlay", () => {
    const doc = fresh();
    doc.checklists["chk-commercial-dd-checklist"].items = doc.checklists["chk-commercial-dd-checklist"].items.filter((r: any) => r.id !== "cdd-07");
    expectError(doc, "missing from overlay");
  });

  test("decision record pointer missing or malformed", () => {
    expect(fresh().decision_record).toBe("DEC-20261012-01");
    const doc = fresh();
    delete doc.decision_record;
    expectError(doc, "decision_record");
    const bad = fresh();
    bad.decision_record = "approved in chat";
    expectError(bad, "decision_record");
  });

  test("overlay row for unknown item", () => {
    const doc = fresh();
    row(doc, "chk-commercial-dd-checklist", "cdd-07").id = "cdd-99";
    expectError(doc, "does not exist in checklist");
  });

  test("N without reason", () => {
    const doc = fresh();
    delete row(doc, "chk-legal-dd-checklist", "ldd-07").sub_tracks.none.na_reason;
    expectError(doc, "na_reason");
  });

  test("R without reading", () => {
    const doc = fresh();
    delete row(doc, "chk-legal-dd-checklist", "ldd-05").sub_tracks.none.reading;
    expectError(doc, "reading");
  });

  test("invalid code", () => {
    const doc = fresh();
    row(doc, "chk-legal-dd-checklist", "ldd-05").sub_tracks.none.code = "Z";
    expectError(doc, "invalid code");
  });

  test("X with unknown replacement target", () => {
    const doc = fresh();
    row(doc, "chk-commercial-dd-checklist", "cdd-04").sub_tracks.none.replaced_by[0].item = "gf-99";
    expectError(doc, "does not exist");
  });

  test("binding item R rejected (binding items must be A in every column)", () => {
    const doc = fresh();
    Object.assign(row(doc, "chk-financing-plan-checklist", "fin-09").sub_tracks.none, { code: "R", reading: "test" });
    expectError(doc, "Binding item");
  });

  test("binding item N rejected, even with adr_reference", () => {
    const doc = fresh();
    const cell = row(doc, "chk-financing-plan-checklist", "fin-09").sub_tracks.none;
    cell.code = "N";
    cell.na_reason = "test";
    delete cell.reading;
    expectError(doc, "Binding item");
    cell.adr_reference = "ADR-0160 addendum (test)";
    expectError(doc, "Binding item");
  });

  test("missing approval record", () => {
    const doc = fresh();
    delete row(doc, "chk-hr-dd-checklist", "hdd-01").approval;
    expectError(doc, "approval");
  });

  test("count mismatch", () => {
    const doc = fresh();
    doc.expected_counts.none.R = 40;
    expectError(doc, "recomputed");
  });

  test("unknown procedure step and unmapped step", () => {
    const doc = fresh();
    doc.steps[0].step = 99;
    expectError(doc, "does not exist in procedure");
    expectError(doc, "not mapped");
  });

  test("step referencing unknown tab", () => {
    const doc = fresh();
    doc.steps[0].tabs = ["nowhere"];
    expectError(doc, "tab_labels");
  });
});
