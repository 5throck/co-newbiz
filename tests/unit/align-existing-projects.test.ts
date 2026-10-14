import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyApproved, applyPlan, assertSafePath, buildApprovedPlan, buildPlan, isLiveDbPath } from "../../scripts/co-newbiz/align-existing-projects.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeDb(opts: { mode?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "align-"));
  dirs.push(dir);
  const path = join(dir, "t.sqlite");
  const db = new Database(path);
  db.run(`CREATE TABLE md_project (id TEXT PRIMARY KEY, project_no TEXT, track TEXT, origin TEXT,
    source_opportunity_id TEXT, deleted_at TEXT${opts.mode ? ", establishment_mode TEXT" : ""})`);
  db.run("CREATE TABLE route_decision (id TEXT PRIMARY KEY, opportunity_id TEXT, sub_track TEXT, is_current INTEGER)");
  db.run(`CREATE TABLE entity_establishment_step (id TEXT PRIMARY KEY, opportunity_id TEXT, project_id TEXT,
    step_no INTEGER, status TEXT)`);
  db.run("CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT, target TEXT, created_at TEXT)");
  // greenfield, origin NULL, no steps
  db.run("INSERT INTO md_project VALUES ('p1','P1','greenfield',NULL,'o1',NULL" + (opts.mode ? ",NULL" : "") + ")");
  db.run("INSERT INTO route_decision VALUES ('r1','o1',NULL,1)");
  // greenfield, origin internal, recorded steps keyed by opportunity only
  db.run("INSERT INTO md_project VALUES ('p2','P2','greenfield','internal','o2',NULL" + (opts.mode ? ",NULL" : "") + ")");
  db.run("INSERT INTO entity_establishment_step VALUES ('s1','o2',NULL,1,'done')");
  // greenfield whose route is a brownfield sub-track: human
  db.run("INSERT INTO md_project VALUES ('p3','P3','greenfield',NULL,'o3',NULL" + (opts.mode ? ",NULL" : "") + ")");
  db.run("INSERT INTO route_decision VALUES ('r3','o3','jv',1)");
  // duplicate step rows: human only
  db.run("INSERT INTO md_project VALUES ('p4','P4','brownfield','external','o4',NULL" + (opts.mode ? ",NULL" : "") + ")");
  db.run("INSERT INTO entity_establishment_step VALUES ('s2','o4','p4',1,'done'),('s3','o4','p4',1,'pending')");
  db.close();
  return path;
}

const snapshot = (path: string) => {
  const db = new Database(path, { readonly: true });
  const s = JSON.stringify({
    p: db.query("SELECT * FROM md_project ORDER BY id").all(),
    s: db.query("SELECT * FROM entity_establishment_step ORDER BY id").all(),
    a: db.query("SELECT COUNT(*) c FROM audit_log").get(),
  });
  db.close();
  return s;
};

describe("align-existing-projects", () => {
  test("dry-run plan classifies items and changes nothing", () => {
    const path = makeDb({ mode: true });
    const before = snapshot(path);
    const db = new Database(path, { readonly: true });
    const plan = buildPlan(db);
    db.close();
    const by = (no: string, item: string) => plan.find((f) => f.project_no === no && f.item === item);
    expect(by("P1", "origin_greenfield_internal")?.class).toBe("deterministic");
    expect(by("P1", "establishment_mode_choice")?.class).toBe("human");
    expect(by("P2", "step_rows_project_id")?.class).toBe("deterministic");
    expect(by("P2", "establishment_mode_new_entity")?.class).toBe("deterministic");
    expect(by("P3", "origin_greenfield_internal")?.class).toBe("human");
    expect(by("P4", "duplicate_step_rows")?.class).toBe("human");
    expect(snapshot(path)).toBe(before);
  });

  test("apply performs deterministic changes only, audits each, and is idempotent", () => {
    const path = makeDb({ mode: true });
    const r1 = applyPlan(path, "2026-10-14T00:00:00.000Z");
    expect(r1.applied).toBe(3);
    expect(r1.integrity).toBe("ok");
    expect(readdirSync(join(path, "..")).some((f) => f.includes("align-backup"))).toBe(true);
    const db = new Database(path, { readonly: true });
    const get = (id: string) => db.query("SELECT origin, establishment_mode FROM md_project WHERE id = ?").get(id) as any;
    expect(get("p1")).toEqual({ origin: "internal", establishment_mode: null });
    expect(get("p2").establishment_mode).toBe("new_entity");
    expect(get("p3")).toEqual({ origin: null, establishment_mode: null });
    expect((db.query("SELECT project_id FROM entity_establishment_step WHERE id='s1'").get() as any).project_id).toBe("p2");
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step").get() as any).c).toBe(3);
    const audits = db.query("SELECT actor_user_id, action FROM audit_log").all() as any[];
    expect(audits.length).toBe(3);
    expect(audits.every((a) => a.actor_user_id === "system:data-alignment" && a.action.startsWith("data_alignment."))).toBe(true);
    db.close();
    const after1 = snapshot(path);
    const r2 = applyPlan(path, "2026-10-14T00:01:00.000Z");
    expect(r2.applied).toBe(0);
    expect(snapshot(path)).toBe(after1);
  });

  test("without the mode column the mode item is not applied", () => {
    const path = makeDb({ mode: false });
    const db = new Database(path, { readonly: true });
    const plan = buildPlan(db);
    db.close();
    expect(plan.filter((f) => f.item.startsWith("establishment_mode") && f.class === "deterministic")).toHaveLength(0);
  });

  test("refuses live DB paths unless --apply and --i-know-this-is-a-live-db", () => {
    const live = join(import.meta.dir, "..", "..", "db", "data", "co-newbiz.sqlite");
    expect(isLiveDbPath(live)).toBe(true);
    expect(() => assertSafePath(live, { apply: false, liveAck: false })).toThrow();
    expect(() => assertSafePath(live, { apply: false, liveAck: true })).toThrow();
    expect(() => assertSafePath(live, { apply: true, liveAck: false })).toThrow();
    expect(() => assertSafePath(live, { apply: true, liveAck: true })).not.toThrow();
    expect(() => assertSafePath("/var/lib/docker/volumes/x/_data/a.sqlite", { apply: false, liveAck: false })).toThrow();
    expect(() => assertSafePath("/tmp/copy.sqlite", { apply: false, liveAck: false })).not.toThrow();
  });
});

function makeApprovedDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "align-appr-"));
  dirs.push(dir);
  const path = join(dir, "a.sqlite");
  const db = new Database(path);
  db.run("CREATE TABLE md_project (id TEXT PRIMARY KEY, project_no TEXT, track TEXT, origin TEXT, source_opportunity_id TEXT, deleted_at TEXT)");
  db.run("CREATE TABLE entity_establishment_step (id TEXT PRIMARY KEY, opportunity_id TEXT, project_id TEXT, step_no INTEGER, status TEXT, note TEXT, evidence_url TEXT)");
  db.run("CREATE TABLE entity_establishment_step_event (id TEXT PRIMARY KEY, step_id TEXT REFERENCES entity_establishment_step(id), kind TEXT)");
  db.run("CREATE TABLE project_policy_pin (id TEXT PRIMARY KEY, project_id TEXT, policy_doc_id TEXT, pinned_version TEXT, pinned_at TEXT, pinned_by TEXT, superseded_by TEXT)");
  db.run("CREATE UNIQUE INDEX live ON project_policy_pin(project_id, policy_doc_id) WHERE superseded_by IS NULL");
  db.run("CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT, target TEXT, created_at TEXT)");
  db.run("INSERT INTO md_project VALUES ('d','PRJ-DSE4PW','greenfield','internal','od',NULL),('t','PRJ-T7T81A','brownfield','external','ot',NULL),('m','DEMO-S1-S12','brownfield','acquisition','om',NULL)");
  db.run("INSERT INTO entity_establishment_step VALUES ('keep','od','d',1,'done','n','u'),('dup','od','d',1,'pending',NULL,NULL)");
  db.run("INSERT INTO entity_establishment_step_event VALUES ('e1','dup','assign'),('e2','keep','assign')");
  db.run("INSERT INTO project_policy_pin VALUES ('k1','d','ovl-greenfield-workspace-scope','1.0.0','x','h',NULL),('k2','t','ovl-brownfield-workspace-scope','1.0.0','x','h',NULL)");
  db.close();
  return path;
}

describe("align-existing-projects approved decisions", () => {
  test("dry-run plans three items and changes nothing", () => {
    const path = makeApprovedDb();
    const db = new Database(path, { readonly: true });
    const { items } = buildApprovedPlan(db);
    db.close();
    expect(items.map((i) => i.item).sort()).toEqual(["duplicate_step_cleanup", "origin_acquisition_external", "policy_repin", "policy_repin"]);
  });

  test("apply executes, audits, re-points events, supersedes pins, and is idempotent", () => {
    const path = makeApprovedDb();
    const r = applyApproved(path, "2026-10-14T00:00:00.000Z");
    expect(r.results.filter((x) => x.status === "applied")).toHaveLength(4);
    const db = new Database(path, { readonly: true });
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step").get() as any).c).toBe(1);
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step_event WHERE step_id='keep'").get() as any).c).toBe(2);
    expect((db.query("SELECT origin FROM md_project WHERE id='m'").get() as any).origin).toBe("external");
    const live = db.query("SELECT policy_doc_id, pinned_version FROM project_policy_pin WHERE superseded_by IS NULL ORDER BY 1").all() as any[];
    expect(live.map((l) => l.pinned_version)).not.toContain("1.0.0");
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'data_alignment.approved.%' AND actor_user_id='system:data-alignment'").get() as any).c).toBe(4);
    db.close();
    const r2 = applyApproved(path, "2026-10-14T00:01:00.000Z");
    expect(r2.results.every((x) => x.status === "skipped")).toBe(true);
    expect(r2.backup).toBeNull();
  });

  test("guards refuse when preconditions differ", () => {
    const path = makeApprovedDb();
    const w = new Database(path);
    w.run("UPDATE entity_establishment_step SET note = 'work done' WHERE id = 'dup'");
    w.run("UPDATE project_policy_pin SET pinned_version = '0.9.0' WHERE id = 'k2'");
    w.run("UPDATE md_project SET origin = 'internal' WHERE id = 'm'");
    w.close();
    const r = applyApproved(path);
    expect(r.results.filter((x) => x.status === "applied").map((x) => x.item)).toEqual(["policy_repin"]);
    const db = new Database(path, { readonly: true });
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step").get() as any).c).toBe(2);
    expect((db.query("SELECT origin FROM md_project WHERE id='m'").get() as any).origin).toBe("internal");
    db.close();
  });
});

