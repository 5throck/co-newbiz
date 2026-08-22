/**
 * project_industry repository tests — ADR-0056 (the write path ADR-0054
 * Decision 5 deferred). Mirrors classification-write.test.ts fixtures.
 *
 * Covers, per the repository's contract:
 *   - bind: append, guards (rationale / project / industry / membership /
 *     MNPI insider), multiple distinct live industries legal;
 *   - re-bind: the 3-step supersede sequence, history kept;
 *   - retire: born-dead self-superseded successor, live slot freed;
 *   - shape: the partial unique live index rejects a second live row;
 *   - governance: audit + data-access rows written per mutation.
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  bindIndustry,
  retireIndustry,
  getLiveBindings,
} from "../../db/repositories/project-industry.repository.ts";

const TEST_DB_PATH = "db/data/test-project-industry.sqlite";
const NOW = "2026-08-23T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

/** user-001 member+insider everywhere, user-002 member only, user-003 nothing. */
const U1 = "user-001";
const U2 = "user-002";
const U3 = "user-003";

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, NOW],
  );
}

function insertProject(mnpi = false): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  if (mnpi) {
    db.run(
      "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
      [id, "restricted", 1, "legal", NOW],
    );
  }
  return id;
}

function grantMember(projectId: string, userId: string): void {
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, userId, "contributor", "admin", NOW, "test fixture basis"],
  );
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [
    projectId,
    userId,
    NOW,
    "test fixture enrollment",
  ]);
}

let ksicSeq = 0;

function insertIndustry(): string {
  const id = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    id,
    `9999${String(++ksicSeq).padStart(4, "0")}`,
    "테스트 산업",
    "Test industry",
    NOW,
  ]);
  return id;
}

/** Project with U1/U2 members and both industries; U1 also insider when MNPI. */
function fixture(opts: { mnpi?: boolean } = {}): { projectId: string; industryA: string; industryB: string } {
  const projectId = insertProject(opts.mnpi ?? false);
  grantMember(projectId, U1);
  grantMember(projectId, U2);
  if (opts.mnpi) enrollInsider(projectId, U1);
  return { projectId, industryA: insertIndustry(), industryB: insertIndustry() };
}

function auditCount(action: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb();
  insertUser(U1);
  insertUser(U2);
  insertUser(U3);
});

afterAll(() => {
  resetDb();
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
});

describe("bindIndustry — append + guards", () => {
  test("first bind inserts a live row and writes the audit + data-access trail", () => {
    const { projectId, industryA } = fixture();
    const row = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "target's primary KSIC class", now: NOW });
    expect(row.superseded_by).toBeNull();
    expect(row.bound_by).toBe(U1);
    const live = getLiveBindings(projectId);
    expect(live).toHaveLength(1);
    expect(live[0].industry_id).toBe(industryA);
    expect(auditCount("project_industry_bound")).toBe(1);
    expect(
      (db.query("SELECT COUNT(*) AS n FROM data_access_log WHERE table_key = 'project_industry'").get() as { n: number }).n,
    ).toBeGreaterThanOrEqual(1);
  });

  test("multiple DISTINCT live industries are legal (0021: multi-industry targets are real)", () => {
    const { projectId, industryA, industryB } = fixture();
    bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "primary class", now: NOW });
    bindIndustry({ project_id: projectId, industry_id: industryB, bound_by: U1, rationale: "secondary class the target also spans", now: NOW });
    expect(getLiveBindings(projectId).map((r) => r.industry_id).sort()).toEqual([industryA, industryB].sort());
  });

  test("empty rationale is rejected", () => {
    const { projectId, industryA } = fixture();
    expect(() =>
      bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "   ", now: NOW }),
    ).toThrow(/rationale is mandatory/);
  });

  test("unknown project is rejected with a named error, not a raw FK failure", () => {
    const { industryA } = fixture();
    expect(() =>
      bindIndustry({ project_id: "no-such-project", industry_id: industryA, bound_by: U1, rationale: "x", now: NOW }),
    ).toThrow(/does not exist \(md_project\)/);
  });

  test("unknown industry is rejected with a named error", () => {
    const { projectId } = fixture();
    expect(() =>
      bindIndustry({ project_id: projectId, industry_id: "no-such-industry", bound_by: U1, rationale: "x", now: NOW }),
    ).toThrow(/does not exist \(md_industry\)/);
  });

  test("non-member is rejected (FR-SEC-08)", () => {
    const { projectId, industryA } = fixture();
    expect(() =>
      bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U3, rationale: "x", now: NOW }),
    ).toThrow(/not an active project_member/);
  });

  test("MNPI project: member off the insider list is rejected (FR-SEC-06)", () => {
    const { projectId, industryA } = fixture({ mnpi: true }); // U1 insider, U2 member-only
    expect(() =>
      bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U2, rationale: "x", now: NOW }),
    ).toThrow(/not on its active insider list/);
  });

  test("MNPI project: current insider binds successfully", () => {
    const { projectId, industryA } = fixture({ mnpi: true });
    const row = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "insider binding on an MNPI deal", now: NOW });
    expect(row.superseded_by).toBeNull();
  });
});

describe("bindIndustry — re-bind (supersede in place)", () => {
  test("binding the same industry again supersedes the predecessor and keeps history", () => {
    const { projectId, industryA } = fixture();
    const first = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "initial reading", now: "2026-08-20T10:00:00Z" });
    const second = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "corrected KSIC class after DD finding", now: NOW });

    const live = getLiveBindings(projectId);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(second.id);

    const predecessor = db.query("SELECT superseded_by FROM project_industry WHERE id = ?").get(first.id) as { superseded_by: string };
    expect(predecessor.superseded_by).toBe(second.id);
    expect(auditCount("project_industry_rebound")).toBe(1);

    // History kept: both rows exist for the same (project, industry).
    expect(
      (db.query("SELECT COUNT(*) AS n FROM project_industry WHERE project_id = ? AND industry_id = ?").get(projectId, industryA) as { n: number }).n,
    ).toBe(2);
  });
});

describe("retireIndustry — born-dead self-superseded successor (ADR-0056)", () => {
  test("retire frees the live slot, writes a self-superseded marker carrying who/when/why", () => {
    const { projectId, industryA } = fixture();
    const binding = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "binding to retire", now: NOW });

    const marker = retireIndustry({ project_id: projectId, industry_id: industryA, retired_by: U2, rationale: "DD established the target is not in this class", now: NOW });

    expect(getLiveBindings(projectId)).toHaveLength(0);
    // Born-dead signature: the marker references itself.
    expect(marker.superseded_by).toBe(marker.id);
    expect(marker.bound_by).toBe(U2);
    expect(marker.rationale).toContain("DD established");
    // The retired binding points at the marker.
    const retired = db.query("SELECT superseded_by FROM project_industry WHERE id = ?").get(binding.id) as { superseded_by: string };
    expect(retired.superseded_by).toBe(marker.id);
    expect(auditCount("project_industry_retired")).toBe(1);
  });

  test("retiring one of two live industries leaves the other live", () => {
    const { projectId, industryA, industryB } = fixture();
    bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "primary", now: NOW });
    bindIndustry({ project_id: projectId, industry_id: industryB, bound_by: U1, rationale: "secondary", now: NOW });
    retireIndustry({ project_id: projectId, industry_id: industryA, retired_by: U1, rationale: "narrowed to B only", now: NOW });
    const live = getLiveBindings(projectId);
    expect(live).toHaveLength(1);
    expect(live[0].industry_id).toBe(industryB);
  });

  test("retiring with no live binding is a named error", () => {
    const { projectId, industryA } = fixture();
    expect(() =>
      retireIndustry({ project_id: projectId, industry_id: industryA, retired_by: U1, rationale: "x", now: NOW }),
    ).toThrow(/no live binding/);
  });

  test("a retired binding can be re-bound afterwards (history never blocks)", () => {
    const { projectId, industryA } = fixture();
    bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "first stint", now: "2026-08-20T10:00:00Z" });
    retireIndustry({ project_id: projectId, industry_id: industryA, retired_by: U2, rationale: "ended", now: "2026-08-21T10:00:00Z" });
    const again = bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "re-entered the class by acquisition", now: NOW });
    expect(again.superseded_by).toBeNull();
    expect(getLiveBindings(projectId)).toHaveLength(1);
    // 3 rows total: original binding, retire marker, new live binding.
    expect((db.query("SELECT COUNT(*) AS n FROM project_industry WHERE project_id = ?").get(projectId) as { n: number }).n).toBe(3);
  });

  test("retire guards match bind guards (membership + MNPI insider)", () => {
    const { projectId, industryA } = fixture({ mnpi: true }); // U2 member-only on an MNPI project
    bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "binding", now: NOW });
    expect(() =>
      retireIndustry({ project_id: projectId, industry_id: industryA, retired_by: U2, rationale: "x", now: NOW }),
    ).toThrow(/not on its active insider list/);
  });
});

describe("shape — the partial unique live index (idx_project_industry_live)", () => {
  test("a raw second live row for the same (project, industry) is rejected by the index", () => {
    const { projectId, industryA } = fixture();
    bindIndustry({ project_id: projectId, industry_id: industryA, bound_by: U1, rationale: "first", now: NOW });
    expect(() =>
      db.run(
        "INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,NULL)",
        [ulid(), projectId, industryA, U1, NOW, "raw duplicate"],
      ),
    ).toThrow();
  });

  test("history rows (superseded_by set) never block re-binding — proven by the re-bind and retire suites above", () => {
    // Structural assertion: the index is partial.
    const sql = db.query("SELECT sql FROM sqlite_master WHERE name = 'idx_project_industry_live'").get() as { sql: string };
    expect(sql.sql).toContain("WHERE superseded_by IS NULL");
  });
});
