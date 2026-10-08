// Wave F-5: S1 data-confidence grade (migration 0125), opportunity.industry_id
// FK + backfill (0126), recomputeRag (cap, not-graded, idempotence).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { getDb, resetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { gradeFromHops, provenanceCap, worseGrade, deriveDataConfidence } from "../../db/lib/data-confidence.ts";
import { readRagView, recomputeRag } from "../../db/lib/rag-service.ts";

const PATH = "db/data/test-wave-f5-rag-recompute.sqlite";
const NOW = "2026-10-08T00:00:00Z";
type Db = ReturnType<typeof getDb>;
let db: Db;

function industry(name: string): string {
  const id = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [id, `F5${Math.floor(Math.random() * 1e6)}`, name, name, NOW]);
  return id;
}
function link(from: string, to: string, type: "engineering" | "statistical", r2 = 0.8) {
  if (type === "engineering") {
    db.run("INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, coefficient, evidence_ref) VALUES (?,?,?,?,?,?)", [ulid(), from, to, type, 1.5, "t"]);
  } else {
    db.run("INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, beta, r2, evidence_ref) VALUES (?,?,?,?,?,?,?)", [ulid(), from, to, type, 1.1, r2, "t"]);
  }
}
function sizing(industryId: string, provenance: string, grade: string | null): string {
  const a = ulid();
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)", [a, industryId, "completed", "t", NOW, NOW]);
  const v = ulid();
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)", [v, a, 1, JSON.stringify({ matrix: { provenance } }), "t", NOW, grade]);
  return v;
}
function project(industryId: string): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at, industry_id) VALUES (?,?,?,?,?,?)", [opp, "o", "selected", "t", NOW, industryId]);
  const p = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id) VALUES (?,?,?,?)", [p, `NP-${p.slice(-6)}`, NOW, opp]);
  return p;
}
/** A prior CLI-style assessment carrying the five directly-scored dimensions. */
function priorDims(projectId: string, grades: Record<string, string>) {
  const run = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [run, projectId, "cli", "h", "t", "2026-09-01T00:00:00Z"]);
  for (const [dim, grade] of Object.entries(grades)) {
    db.run("INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)", [ulid(), run, projectId, dim, grade, `cli ${dim}`, "2026-09-01T00:00:00Z"]);
  }
}
const ALL_GREEN = { financial: "green", market: "green", regulatory_permit: "green", technical_execution: "green", risk: "green" };

beforeAll(() => {
  if (existsSync(PATH)) rmSync(PATH);
  resetDb();
  db = getDb(PATH);
  runMigrations(PATH);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(PATH + s)) rmSync(PATH + s);
});

describe("data-confidence grade (0125)", () => {
  test("pure rule: hops x source, worse of the two", () => {
    const g = (stat: number, r2: number | null, prov: string) => worseGrade(gradeFromHops(stat, r2), provenanceCap(prov));
    expect(g(0, null, "frozen-research")).toBe("A");
    expect(g(0, null, "llm-estimate")).toBe("B");
    expect(g(1, 0.7, "frozen-research")).toBe("B");
    expect(g(1, 0.5, "frozen-research")).toBe("C");
    expect(g(2, 0.9, "frozen-research")).toBe("C");
  });

  test("migration backfill SQL agrees with the TS rule", () => {
    const sql = readFileSync("db/migrations/0125_market_sizing_confidence.sql", "utf-8");
    const update = sql.slice(sql.indexOf("UPDATE market_sizing_version"));
    const cases: Array<[string, () => string, string]> = [];
    const a = industry("F5-A"); const a2 = industry("F5-A2");
    link(a, a2, "engineering");
    cases.push(["frozen-research", () => sizing(a, "frozen-research", null), "A"]);
    const b = industry("F5-B"); const b2 = industry("F5-B2"); link(b, b2, "statistical", 0.7);
    cases.push(["frozen-research", () => sizing(b, "frozen-research", null), "B"]);
    const c = industry("F5-C"); const c2 = industry("F5-C2"); link(c, c2, "statistical", 0.7); link(c, a2, "statistical", 0.9);
    cases.push(["frozen-research", () => sizing(c, "frozen-research", null), "C"]);
    const d = industry("F5-D");
    cases.push(["llm-estimate", () => sizing(d, "llm-estimate", null), "B"]);
    const ids = cases.map(([, make]) => make());
    db.exec(update);
    ids.forEach((id, i) => {
      const row = db.query("SELECT data_confidence_grade g FROM market_sizing_version WHERE id = ?").get(id) as { g: string };
      expect(row.g).toBe(cases[i][2]);
    });
    // TS twin agrees on every case
    expect(deriveDataConfidence(db, c, "frozen-research").grade).toBe("C");
    expect(deriveDataConfidence(db, a, "frozen-research").grade).toBe("A");
  });
});

describe("opportunity.industry_id (0126)", () => {
  test("backfill maps exact unique matches, reports the rest, never guesses", () => {
    const sql = readFileSync("db/migrations/0126_opportunity_industry_fk.sql", "utf-8");
    const block = sql.slice(sql.indexOf("-- @backfill-begin"), sql.indexOf("-- @backfill-end"));
    const ind = industry("백필 산업");
    const mk = (scope: string | null) => {
      const id = ulid();
      db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, "x", scope, "identified", "t", NOW]);
      db.run("UPDATE opportunity SET industry_id = NULL WHERE id = ?", [id]); // simulate pre-0126 state
      return id;
    };
    const hit = mk("백필 산업"); const miss = mk("없는 산업"); const none = mk(null);
    db.exec(block);
    const get = (id: string) => (db.query("SELECT industry_id i FROM opportunity WHERE id = ?").get(id) as { i: string | null }).i;
    expect(get(hit)).toBe(ind);
    expect(get(miss)).toBeNull();
    expect(get(none)).toBeNull();
    const rep = db.query("SELECT reason FROM opportunity_industry_backfill_report WHERE opportunity_id = ?").get(miss) as { reason: string };
    expect(rep.reason).toBe("no_match");
    expect(db.query("SELECT 1 FROM opportunity_industry_backfill_report WHERE opportunity_id = ?").get(none)).toBeNull();
  });

  test("triggers keep the FK derived on insert and market_scope change", () => {
    const i1 = industry("트리거 산업 1"); const i2 = industry("트리거 산업 2");
    const id = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, "t", "트리거 산업 1", "identified", "t", NOW]);
    const get = () => (db.query("SELECT industry_id i FROM opportunity WHERE id = ?").get(id) as { i: string | null }).i;
    expect(get()).toBe(i1);
    db.run("UPDATE opportunity SET market_scope = ? WHERE id = ?", ["트리거 산업 2", id]);
    expect(get()).toBe(i2);
    db.run("UPDATE opportunity SET market_scope = ? WHERE id = ?", ["없음", id]);
    expect(get()).toBeNull();
  });
});

describe("recomputeRag", () => {
  test("grade B caps an all-green carried assessment at Amber (boundary #4)", () => {
    const ind = industry("RAG B"); sizing(ind, "llm-estimate", "B");
    const p = project(ind); priorDims(p, ALL_GREEN);
    const r = recomputeRag(db, p, "ic_package", { actor: "analyst1", now: NOW });
    expect(r.status).toBe("assessed");
    expect(r.overall).toBe("amber");
    const view = readRagView(db, p);
    expect(view.status).toBe("graded");
    expect(view.overall?.grade).toBe("amber");
    expect(view.dimensions.data_confidence?.grade).toBe("amber");
  });

  test("grade C makes data_confidence Red and the overall Red", () => {
    const ind = industry("RAG C"); sizing(ind, "llm-estimate", "C");
    const p = project(ind); priorDims(p, ALL_GREEN);
    expect(recomputeRag(db, p, "ic_package", { actor: "analyst1", now: NOW }).overall).toBe("red");
  });

  test("grade A with everything green may read Green", () => {
    const ind = industry("RAG A"); sizing(ind, "frozen-research", "A");
    const p = project(ind); priorDims(p, ALL_GREEN);
    expect(recomputeRag(db, p, "ic_package", { actor: "analyst1", now: NOW }).overall).toBe("green");
  });

  test("incomplete assessment is 'not graded' — no overall row, no color", () => {
    const ind = industry("RAG inc"); sizing(ind, "llm-estimate", "B");
    const p = project(ind); // only data_confidence is derivable
    const r = recomputeRag(db, p, "gate_brief", { actor: "analyst1", now: NOW });
    expect(r.status).toBe("assessed");
    expect(r.complete).toBe(false);
    expect(r.overall).toBeNull();
    const view = readRagView(db, p);
    expect(view.status).toBe("not_graded");
    expect(view.overall).toBeNull();
    expect(view.missing_dimensions).toContain("market");
    expect(db.query("SELECT 1 FROM rag_assessment WHERE project_id = ? AND dimension = 'overall'").get(p)).toBeNull();
  });

  test("a newer incomplete run hides an older overall grade", () => {
    const ind = industry("RAG stale"); sizing(ind, "llm-estimate", "B");
    const p = project(ind);
    priorDims(p, ALL_GREEN);
    recomputeRag(db, p, "ic_package", { actor: "a", now: NOW });
    expect(readRagView(db, p).status).toBe("graded");
    // an incomplete CLI-style run lands later: only one dimension
    const run = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [run, p, "cli2", "h2", "t", NOW]);
    db.run("INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)", [ulid(), run, p, "market", "amber", "r", "2026-12-01T00:00:00Z"]);
    expect(readRagView(db, p).status).toBe("not_graded");
  });

  test("unchanged inputs write nothing; changed inputs append", () => {
    const ind = industry("RAG idem"); const v = sizing(ind, "llm-estimate", "B");
    const p = project(ind); priorDims(p, ALL_GREEN);
    recomputeRag(db, p, "ic_package", { actor: "a", now: NOW });
    const count = () => (db.query("SELECT COUNT(*) c FROM rag_assessment WHERE project_id = ?").get(p) as { c: number }).c;
    const before = count();
    expect(recomputeRag(db, p, "stale_read", { actor: "a", now: NOW }).status).toBe("unchanged");
    expect(count()).toBe(before);
    db.run("UPDATE market_sizing_version SET data_confidence_grade = 'C' WHERE id = ?", [v]);
    expect(recomputeRag(db, p, "stale_read", { actor: "a", now: NOW }).status).toBe("assessed");
    expect(count()).toBeGreaterThan(before);
  });

  test("nothing derivable and nothing carried writes no run", () => {
    const p = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [p, `NP-${p.slice(-6)}`, NOW]);
    expect(recomputeRag(db, p, "ic_package", { actor: "a" }).status).toBe("nothing_to_assess");
    expect(db.query("SELECT 1 FROM run WHERE project_id = ?").get(p)).toBeNull();
    expect(readRagView(db, p).status).toBe("not_graded");
  });
});
