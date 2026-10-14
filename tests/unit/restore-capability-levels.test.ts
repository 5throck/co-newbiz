// @version 1.0.0
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRestore, assertFiles, buildDiff } from "../../scripts/co-newbiz/restore-capability-levels.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const row = (id: string, req: string, cur: string, extra: Record<string, unknown> = {}) => ({
  id, capability: `cap ${id}`, source: "manual", requiredNote: "note", held: { status: "unmet", holders: [], evidence: "" },
  resolution: null, note: "", requiredLevel: req, currentLevel: cur, ...extra,
});
const reg = (rows: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ rows, updatedAt: "2026-10-01", ...extra });

function mk(dir: string, name: string, regs: Record<string, string>): string {
  const p = join(dir, name);
  const db = new Database(p);
  db.run("CREATE TABLE opportunity (id TEXT PRIMARY KEY, capability_gap_json TEXT)");
  db.run("CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT, target TEXT, created_at TEXT)");
  for (const [id, j] of Object.entries(regs)) db.run("INSERT INTO opportunity VALUES (?,?)", [id, j]);
  db.close();
  return p;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rcl-"));
  dirs.push(dir);
  const att = { closingCostKrwM: 5, monthsToAttain: 3, grade: "high", rationale: "r", evidence: [], draftedBy: "human", confirmedBy: "u", confirmedAt: "t" };
  const backup = mk(dir, "backup.sqlite", {
    o1: reg([row("a", "고급", "기초"), row("b", "", "")]),
    o3: reg([row("z", "x", "y")]),
  });
  const live = mk(dir, "live.sqlite", {
    o1: reg(
      [row("a", "중급", "중급", { attainability: att, unknownKey: 7 }), row("b", "중급", ""), row("c", "n", "n")],
      { technicalLens: { T1: "keep" } },
    ),
    o2: reg([row("q", "1", "2")]),
    o3: reg([row("z", "x", "y")]),
  });
  return { dir, live, backup };
}
const json = (p: string, id: string) => (new Database(p, { readonly: true }).query("SELECT capability_gap_json j FROM opportunity WHERE id=?").get(id) as { j: string }).j;

describe("restore-capability-levels", () => {
  test("dry run changes nothing and classifies", () => {
    const { live, backup } = fixture();
    const before = json(live, "o1");
    const l = new Database(live, { readonly: true });
    const b = new Database(backup, { readonly: true });
    const d = buildDiff(l, b);
    l.close(); b.close();
    const o1 = d.find((o) => o.opportunityId === "o1")!;
    expect(o1.rows.map((r) => [r.rowId, r.cls])).toEqual([["a", "would-restore"], ["b", "would-restore"], ["c", "row-new-since-backup"]]);
    expect(d.find((o) => o.opportunityId === "o2")!.status).toBe("opportunity-new");
    expect(d.find((o) => o.opportunityId === "o3")!.rows[0].cls).toBe("unchanged");
    expect(json(live, "o1")).toBe(before);
  });

  test("apply restores only the two level fields and keeps everything else", () => {
    const { live, backup } = fixture();
    const r = applyRestore(live, backup);
    expect(r.rowsRestored).toBe(2);
    expect(r.opportunitiesChanged).toBe(1);
    const o1 = JSON.parse(json(live, "o1"));
    expect(o1.rows[0]).toMatchObject({ requiredLevel: "고급", currentLevel: "기초", unknownKey: 7, attainability: { grade: "high", confirmedBy: "u" } });
    expect(o1.rows[1]).toMatchObject({ requiredLevel: "", currentLevel: "", requiredNote: "note" });
    expect(o1.rows[2]).toMatchObject({ requiredLevel: "n", currentLevel: "n" });
    expect(o1.technicalLens).toEqual({ T1: "keep" });
    expect(JSON.parse(json(live, "o2")).rows[0].requiredLevel).toBe("1");
    const db = new Database(live, { readonly: true });
    const audits = db.query("SELECT actor_user_id a, action, target FROM audit_log").all() as any[];
    db.close();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ a: "system:capability-levels-restore", action: "capability_levels.restore" });
    expect(audits[0].target).toContain("o1");
    expect(readdirSync(r.safetyCopy.replace(/\/[^/]+$/, "")).some((f) => f.includes("pre-levels-restore"))).toBe(true);
  });

  test("idempotent: second apply changes nothing", () => {
    const { live, backup } = fixture();
    applyRestore(live, backup);
    const snap = json(live, "o1");
    const r2 = applyRestore(live, backup, undefined, "2030-01-01T00:00:00.000Z");
    expect(r2.rowsRestored).toBe(0);
    expect(json(live, "o1")).toBe(snap);
    const db = new Database(live, { readonly: true });
    expect((db.query("SELECT COUNT(*) c FROM audit_log").get() as any).c).toBe(1);
    db.close();
  });

  test("--opportunity limits scope; missing paths refused", () => {
    const { live, backup } = fixture();
    expect(applyRestore(live, backup, "o3").rowsRestored).toBe(0);
    expect(JSON.parse(json(live, "o1")).rows[0].requiredLevel).toBe("중급");
    expect(() => assertFiles(undefined, backup)).toThrow(/--live/);
    expect(() => assertFiles(live, undefined)).toThrow(/--backup/);
    expect(() => assertFiles(live, "/nonexistent/x.sqlite")).toThrow(/not found/);
    expect(() => applyRestore(live, "/nonexistent/x.sqlite")).toThrow(/not found/);
  });
});
