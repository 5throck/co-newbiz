/**
 * Unit tests for migration 0019 (enum CHECK constraints + rag_rule
 * finalization) — implementing the three approved threshold decision records
 * verbatim: docs/decisions/market-thresholds.md (D-M-MKT-2/9/10 + the final
 * mapping table), docs/decisions/risk-thresholds.md (D-M-RISK-3/6/7),
 * docs/decisions/technical-execution-thresholds.md (D-M-TE-1/3/4/5/8
 * "Activation prerequisites" step 1). Real scratch SQLite (the
 * migration-0013/0016/0017/0018 pattern: runMigrations on a temp WAL DB,
 * resetDb in afterAll) so the rebuilt CHECKs and the surviving FK graph are
 * exercised by SQLite itself, not mocked.
 *
 * These tests pin four things:
 *   (a) the rebuild lost nothing — column shape, pre-existing CHECKs, indexes,
 *       and child FKs (jv_term / permit_edge / certification_edge) all survive;
 *   (b) each new CHECK accepts every record member (NULL where allowed) and
 *       rejects out-of-enum writes — including the exact defect the records
 *       cite (integer 1 into transferable_on_coc, bare "6" trl_grade);
 *   (c) the rag_rule rows match the records' mapping tables CHARACTER FOR
 *       CHARACTER (grade/priority/stage_gate included), all still enabled=0
 *       (PR-9 owns activation; the Green-capped right-to-win green grade must
 *       not be enabled by this PR);
 *   (d) every final condition_expr parses under the real PredicateSchema gate
 *       and the rag_rule_variable wiring equals collectPredicateVars.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { parsePredicate, type Predicate, type Scalar } from "../../db/lib/predicate.ts";
import { collectPredicateVars } from "../../db/lib/applies-when.ts";

const TEST_DB_PATH = "db/data/test-migration-0019.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-23T10:00:00Z";
const SEED_CREATED_AT = "2026-08-23T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let industryA: string;
let industryB: string;

/** Column names of each rebuilt table, declaration order — must equal the 0011/0012 shape. */
const TABLE_COLUMNS: Record<string, string[]> = {
  value_chain_link: ["id", "project_id", "from_industry_id", "to_industry_id", "direction", "elasticity", "lag_months", "correlation", "r2", "pass_through_rate", "pass_through_lag_months", "concentration_hhi", "switching_cost_grade", "substitution_threat", "evidence_ref", "assessed_at"],
  dd_finding: ["id", "project_id", "category", "description", "value_impact", "assumption_key", "evidence_ref", "trl_grade", "ip_ownership_status", "commercialization_path", "parent_relationship_json", "rbd_source", "created_at"],
  certification: ["id", "project_id", "name", "agency", "statutory_days", "status", "transferability_basis", "transferable_on_coc", "transferability_evidence_ref", "load_bearing", "confirmed_at"],
  permit: ["id", "project_id", "name", "agency", "statutory_days", "status"],
  partner_candidate: ["id", "project_id", "name", "partner_type", "region_code", "capability_score", "capacity_score", "financial_score", "compliance_risk", "customer_base_fit", "dependency_risk", "status", "contacted_at", "nda_signed", "evidence_ref"],
};

/** The rebuilt tables' project-scoped indexes, recreated verbatim from 0011. */
const TABLE_INDEXES: Record<string, string> = {
  value_chain_link: "idx_value_chain_link_project",
  dd_finding: "idx_dd_finding_project",
  certification: "idx_certification_project",
  permit: "idx_permit_project",
  partner_candidate: "idx_partner_candidate_project",
};

const TRL_MEMBERS = ["TRL1", "TRL2", "TRL3", "TRL4", "TRL5", "TRL6", "TRL7", "TRL8", "TRL9"] as const;

/**
 * The records' final mapping tables, transcribed verbatim. grade/priority/
 * stage_gate/condition_expr are all decided there — this constant is the test
 * oracle, not a restatement the migration could drift against unnoticed (the
 * migration is asserted equal to THIS, which is asserted equal to the records
 * by the exact-string comparisons below).
 */
const FINAL_RULES: Record<string, { gate: string; grade: string; priority: number; expr: string }> = {
  // market — D-M-MKT-9/10 + final mapping table
  "market-dd-bargaining-power": { gate: "dd", grade: "amber", priority: 1, expr: '{"op":"all_of","of":[{"op":"cmp","var":"market.bargaining_power_hhi","cmp":"gte","value":0.25},{"op":"cmp","var":"market.link_fit_quality","cmp":"gte","value":0.6}]}' },
  "market-dd-competitive-demerit": { gate: "dd", grade: "amber", priority: 2, expr: '{"op":"all_of","of":[{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.05},{"op":"in","var":"market.entry_barrier","values":["none","low"]},{"op":"cmp","var":"market.top3_share","cmp":"gte","value":0.5}]}' },
  "market-dd-switching-cost": { gate: "dd", grade: "amber", priority: 3, expr: '{"op":"in","var":"market.switching_cost_grade","values":["negligible","low"]}' },
  "market-dd-tam-growth": { gate: "dd", grade: "amber", priority: 4, expr: '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}' },
  "market-dd-right-to-win": { gate: "dd", grade: "green", priority: 5, expr: '{"op":"at_least","k":2,"of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"gte","value":3}]}' },
  "market-screening-tam-growth": { gate: "screening", grade: "amber", priority: 1, expr: '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}' },
  "market-pre-fs-tam-growth": { gate: "pre_fs", grade: "amber", priority: 1, expr: '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}' },
  "market-dd-right-to-win-absent": { gate: "dd", grade: "amber", priority: 6, expr: '{"op":"all_of","of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"lt","value":2}]}' },
  // risk — D-M-RISK-6/7 (D-M-RISK-4 layer 2: covenant Red = priority 5)
  "risk-dd-covenant-breach": { gate: "dd", grade: "red", priority: 5, expr: '{"op":"count","var":"risk.covenants_breached","cmp":"gte","value":1}' },
  "risk-dd-contingent-expected-value": { gate: "dd", grade: "amber", priority: 6, expr: '{"op":"cmp","var":"risk.contingent_expected_value","cmp":"gte","value":10000000000,"unit":"krw"}' },
  "risk-dd-contingent-two-factor": { gate: "dd", grade: "amber", priority: 7, expr: '{"op":"all_of","of":[{"op":"cmp","var":"risk.contingent_max_amount","cmp":"gte","value":30000000000,"unit":"krw"},{"op":"cmp","var":"risk.contingent_max_probability","cmp":"gte","value":0.5,"unit":"ratio"}]}' },
  "risk-dd-partner-sourcing": { gate: "pre_fs", grade: "amber", priority: 8, expr: '{"op":"all_of","of":[{"op":"count","var":"risk.partner_candidates_active","cmp":"lte","value":1},{"op":"in","var":"risk.partner_dependency_risk","values":["high"]}]}' },
  // technical_execution — D-M-TE-8 rows 1–7
  "tech-dd-trl-pre-validation": { gate: "dd", grade: "red", priority: 1, expr: '{"op":"in","var":"tech.trl_grade","values":["TRL1","TRL2","TRL3"]}' },
  "tech-dd-trl-grade": { gate: "dd", grade: "amber", priority: 2, expr: '{"op":"in","var":"tech.trl_grade","values":["TRL4","TRL5"]}' },
  "tech-dd-ip-disputed": { gate: "dd", grade: "red", priority: 3, expr: '{"op":"in","var":"tech.ip_ownership_status","values":["disputed"]}' },
  "tech-dd-ip-clarity": { gate: "dd", grade: "amber", priority: 4, expr: '{"op":"any_of","of":[{"op":"in","var":"tech.ip_ownership_status","values":["owned_by_originator","licensed_in","jointly_owned"]},{"op":"is_null","var":"tech.ip_ownership_status"}]}' },
  "tech-dd-cert-load-bearing-loss": { gate: "dd", grade: "red", priority: 5, expr: '{"op":"count","var":"cert.load_bearing_non_transferable_on_coc","cmp":"gte","value":1}' },
  "tech-dd-cert-transferability": { gate: "dd", grade: "amber", priority: 6, expr: '{"op":"count","var":"cert.non_transferable_on_coc","cmp":"gte","value":1}' },
  "tech-dd-permit-critical-path": { gate: "dd", grade: "amber", priority: 7, expr: '{"op":"any_of","of":[{"op":"cmp","var":"permit.critical_path_duration","cmp":"gt","value":18,"unit":"months"},{"op":"count","var":"permit.unresolved_on_critical_path","cmp":"gte","value":1}]}' },
};

const NEW_RULE_KEYS = new Set([
  "market-screening-tam-growth",
  "market-pre-fs-tam-growth",
  "market-dd-right-to-win-absent",
  "tech-dd-trl-pre-validation",
  "tech-dd-ip-disputed",
  "tech-dd-cert-load-bearing-loss",
]);

interface RuleRow {
  id: string;
  rule_key: string;
  version: number;
  stage_gate: string;
  dimension: string;
  grade: string;
  condition_expr: string;
  priority: number;
  enabled: number;
  policy_id: string | null;
  thresholds_source: string | null;
}

function ruleRow(ruleKey: string): RuleRow {
  return db
    .query("SELECT id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source FROM rag_rule WHERE rule_key = ?")
    .get(ruleKey) as never;
}

function insertValueChainLink(switchingCostGrade: string | null): void {
  db.run(
    "INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, switching_cost_grade, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, industryA, industryB, "upstream", switchingCostGrade, NOW],
  );
}

function insertPartner(opts: { dependencyRisk?: string | null; status?: string }): void {
  db.run(
    "INSERT INTO partner_candidate (id, project_id, name, partner_type, dependency_risk, status) VALUES (?,?,?,?,?,?)",
    [ulid(), projectId, "Acme", "supplier", opts.dependencyRisk ?? null, opts.status ?? "sourcing"],
  );
}

function insertDdFinding(opts: { trl?: string | null; ipStatus?: string | null; rbdSource?: string | null; category?: string }): void {
  db.run(
    "INSERT INTO dd_finding (id, project_id, category, description, trl_grade, ip_ownership_status, rbd_source, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, opts.category ?? "technical", "Test finding", opts.trl ?? null, opts.ipStatus ?? null, opts.rbdSource ?? null, NOW],
  );
}

function insertCertification(opts: { transferableOnCoc?: unknown }): void {
  const cols = ["id", "project_id", "name"];
  const vals: unknown[] = [ulid(), projectId, "ISO 9001"];
  if (opts.transferableOnCoc !== undefined) {
    cols.push("transferable_on_coc");
    vals.push(opts.transferableOnCoc);
  }
  db.run(`INSERT INTO certification (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals as never[]);
}

function insertPermit(status: string): void {
  db.run("INSERT INTO permit (id, project_id, name, status) VALUES (?,?,?,?)", [ulid(), projectId, "Permit", status]);
}

function tableColumns(table: string): { name: string; type: string; notnull: number; dflt_value: string | null }[] {
  return db.query(`PRAGMA table_info(${table})`).all() as never[];
}

function indexExists(table: string, indexName: string): boolean {
  return (db.query(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND name = '${indexName}'`).get() as { c: number }).c === 1;
}

/** The 0017 walker, reused verbatim in shape — value slots only. */
function countPlaceholderLeaves(pred: Predicate, marker = "_threshold_placeholder"): number {
  switch (pred.op) {
    case "all_of":
    case "any_of":
    case "none_of":
    case "at_least":
      return pred.of.reduce((n, child) => n + countPlaceholderLeaves(child, marker), 0);
    case "cmp":
      return pred.value === marker ? 1 : 0;
    case "in":
      return pred.values.filter((v: Scalar) => v === marker).length;
    case "is_null":
      return 0;
    case "count":
      return pred.value === marker ? 1 : 0;
  }
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
  industryA = ulid();
  industryB = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryA, "30110", "선박용 엔진", "Marine engines", NOW]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryB, "30111", "조선업", "Shipbuilding", NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    // Windows occasionally lags the handle release just past close(); the
    // artifact is throwaway and beforeAll removes any leftover next run
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

// ---------------------------------------------------------------------------
// (a) The rebuild lost nothing — shape, prior CHECKs, indexes, FK graph
// ---------------------------------------------------------------------------

describe("rebuild: shape preservation", () => {
  test("applies cleanly in the full chain — 0019 is recorded", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0019_enum_constraints_and_rule_finalization.sql");
  });

  test("every rebuilt table keeps the exact 0011/0012 column list (order included)", () => {
    for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
      expect(tableColumns(table).map((c) => c.name), table).toEqual(cols);
    }
  });

  test("each rebuilt table's project index was recreated", () => {
    for (const [table, index] of Object.entries(TABLE_INDEXES)) {
      expect(indexExists(table, index), `${table}/${index}`).toBe(true);
    }
  });

  test("pre-existing CHECKs survived the rebuild verbatim", () => {
    // value_chain_link.direction (0011)
    expect(() => insertValueChainLink(null)).not.toThrow();
    expect(() =>
      db.run("INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, assessed_at) VALUES (?,?,?,?,?,?)", [ulid(), projectId, industryA, industryB, "sideways", NOW]),
    ).toThrow(/CHECK constraint failed/);
    // dd_finding rbd_source CHECK + the category/rbd table-level CHECK (0011)
    expect(() => insertDdFinding({ rbdSource: "internal_only", category: "rbd" })).not.toThrow();
    expect(() => insertDdFinding({ rbdSource: "teleported", category: "rbd" })).toThrow(/CHECK constraint failed/);
    expect(() => insertDdFinding({ category: "rbd" })).toThrow(/CHECK constraint failed/); // rbd without rbd_source
    // certification transferability_basis + load_bearing CHECKs (0012)
    expect(() => db.run("INSERT INTO certification (id, project_id, name, transferability_basis) VALUES (?,?,?,?)", [ulid(), projectId, "C", "verified"])).not.toThrow();
    expect(() => db.run("INSERT INTO certification (id, project_id, name, transferability_basis) VALUES (?,?,?,?)", [ulid(), projectId, "C", "guessed"])).toThrow(/CHECK constraint failed/);
    expect(() => db.run("INSERT INTO certification (id, project_id, name, load_bearing) VALUES (?,?,?,?)", [ulid(), projectId, "C", 2])).toThrow(/CHECK constraint failed/);
  });

  test("the FK graph survived — foreign_key_check is empty and child tables still enforce", () => {
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    // jv_term -> rebuilt partner_candidate
    const partnerId = ulid();
    db.run("INSERT INTO partner_candidate (id, project_id, name, partner_type) VALUES (?,?,?,?)", [partnerId, projectId, "JV Partner", "supplier"]);
    db.run("INSERT INTO jv_term (id, project_id, partner_id, equity_split) VALUES (?,?,?,?)", [ulid(), projectId, partnerId, "50:50"]);
    expect(() => db.run("INSERT INTO jv_term (id, project_id, partner_id) VALUES (?,?,?)", [ulid(), projectId, "01NOSUCHPARTNER000000001"])).toThrow(/FOREIGN KEY constraint failed/);
    // permit_edge -> rebuilt permit
    const permitId = ulid();
    db.run("INSERT INTO permit (id, project_id, name) VALUES (?,?,?)", [permitId, projectId, "P"]);
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitId, permitId]);
    expect(() => db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitId, "01NOSUCHPERMIT0000000001"])).toThrow(/FOREIGN KEY constraint failed/);
    // certification_edge -> rebuilt certification
    const certId = ulid();
    db.run("INSERT INTO certification (id, project_id, name) VALUES (?,?,?)", [certId, projectId, "C2"]);
    db.run("INSERT INTO certification_edge (from_certification_id, to_certification_id) VALUES (?,?)", [certId, certId]);
    expect(() => db.run("INSERT INTO certification_edge (from_certification_id, to_certification_id) VALUES (?,?)", [certId, "01NOSUCHCERT00000000001"])).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// (b) The new CHECK enums — every member accepted, out-of-enum rejected
// ---------------------------------------------------------------------------

describe("new CHECK enums", () => {
  test("switching_cost_grade: all five members + NULL accepted; anything else rejected (D-M-MKT-2)", () => {
    for (const member of ["negligible", "low", "moderate", "high", "very_high"]) {
      expect(() => insertValueChainLink(member), member).not.toThrow();
    }
    expect(() => insertValueChainLink(null)).not.toThrow(); // NULL allowed — absence distinguishable from a value
    expect(() => insertValueChainLink("severe")).toThrow(/CHECK constraint failed/);
    expect(() => insertValueChainLink("Low")).toThrow(/CHECK constraint failed/); // case-sensitive
  });

  test("partner_candidate.status: six members + default 'sourcing'; dependency_risk: four members + NULL (D-M-RISK-3)", () => {
    for (const status of ["sourcing", "contacted", "in_negotiation", "signed", "withdrawn", "rejected"]) {
      expect(() => insertPartner({ status }), status).not.toThrow();
    }
    expect(() => insertPartner({ status: "married" })).toThrow(/CHECK constraint failed/);
    // the default survives the rebuild (a longlist entry, not the active set)
    db.run("INSERT INTO partner_candidate (id, project_id, name, partner_type) VALUES (?,?,?,?)", [ulid(), projectId, "Defaults", "supplier"]);
    const defaulted = db.query("SELECT status FROM partner_candidate WHERE name = 'Defaults'").get() as { status: string };
    expect(defaulted.status).toBe("sourcing");
    for (const risk of ["high", "medium", "low", "none"]) {
      expect(() => insertPartner({ dependencyRisk: risk }), risk).not.toThrow();
    }
    expect(() => insertPartner({ dependencyRisk: null })).not.toThrow();
    expect(() => insertPartner({ dependencyRisk: "catastrophic" })).toThrow(/CHECK constraint failed/); // 'none' is the no-dependency member, not a 5th grade
  });

  test("trl_grade: TRL1..TRL9 + NULL accepted; the pre-0019 'bare digit' and zero-padded forms rejected (D-M-TE-1)", () => {
    for (const member of TRL_MEMBERS) {
      expect(() => insertDdFinding({ trl: member }), member).not.toThrow();
    }
    expect(() => insertDdFinding({ trl: null })).not.toThrow();
    expect(() => insertDdFinding({ trl: "6" })).toThrow(/CHECK constraint failed/); // the exact stale shape 0018-era tests wrote
    expect(() => insertDdFinding({ trl: "TRL01" })).toThrow(/CHECK constraint failed/); // no zero-padding
    expect(() => insertDdFinding({ trl: "trl6" })).toThrow(/CHECK constraint failed/); // case-sensitive
    expect(() => insertDdFinding({ trl: "TRL10" })).toThrow(/CHECK constraint failed/); // no tenth grade
  });

  test("ip_ownership_status: five members + NULL accepted; anything else rejected (D-M-TE-3)", () => {
    for (const member of ["owned_by_target", "owned_by_originator", "licensed_in", "jointly_owned", "disputed"]) {
      expect(() => insertDdFinding({ ipStatus: member }), member).not.toThrow();
    }
    expect(() => insertDdFinding({ ipStatus: null })).not.toThrow();
    expect(() => insertDdFinding({ ipStatus: "exclusive_license" })).toThrow(/CHECK constraint failed/); // license quality is deliberately OUT of the enum
  });

  test("transferable_on_coc: 'yes'/'no'/NULL accepted; the integer-1 write the record cites is rejected (D-M-TE-4)", () => {
    expect(() => insertCertification({ transferableOnCoc: "yes" })).not.toThrow();
    expect(() => insertCertification({ transferableOnCoc: "no" })).not.toThrow();
    expect(() => insertCertification({ transferableOnCoc: null })).not.toThrow(); // NULL = no position taken
    expect(() => insertCertification({ transferableOnCoc: 1 })).toThrow(/CHECK constraint failed/); // tests/unit/dd-cross-validation.test.ts:77's old write
    expect(() => insertCertification({ transferableOnCoc: "maybe" })).toThrow(/CHECK constraint failed/);
  });

  test("permit.status: five members + default 'not_started'; anything else rejected (D-M-TE-5)", () => {
    for (const status of ["not_started", "in_progress", "granted", "denied", "withdrawn"]) {
      expect(() => insertPermit(status), status).not.toThrow();
    }
    expect(() => insertPermit("paused")).toThrow(/CHECK constraint failed/);
    db.run("INSERT INTO permit (id, project_id, name) VALUES (?,?,?)", [ulid(), projectId, "Defaulted"]);
    const defaulted = db.query("SELECT status FROM permit WHERE name = 'Defaulted'").get() as { status: string };
    expect(defaulted.status).toBe("not_started");
  });
});

// ---------------------------------------------------------------------------
// (c) evidence_var seed + rag_rule final state — the records, verbatim
// ---------------------------------------------------------------------------

describe("evidence_var seed (D-M-TE-8)", () => {
  test("cert.load_bearing_non_transferable_on_coc is seeded with the record's exact attributes", () => {
    const row = db
      .query("SELECT var_key, value_type, unit, source_kind, requires_evidence_ref, created_at FROM evidence_var WHERE var_key = 'cert.load_bearing_non_transferable_on_coc'")
      .get() as { var_key: string; value_type: string; unit: string; source_kind: string; requires_evidence_ref: number; created_at: string };
    expect(row).toMatchObject({
      var_key: "cert.load_bearing_non_transferable_on_coc",
      value_type: "number",
      unit: "count",
      source_kind: "computed",
      requires_evidence_ref: 0,
      created_at: SEED_CREATED_AT,
    });
  });

  test("the cert.% prefix holds the two count vars this migration seeded — plus ADR-0064's tripwire additions", () => {
    // 0027 (ADR-0064) added two more cert.% tripwires under the shared
    // prefix; this file pins its OWN seeds exactly and acknowledges the rest.
    const keys = (db.query("SELECT var_key FROM evidence_var WHERE var_key LIKE 'cert.%' ORDER BY var_key").all() as { var_key: string }[]).map((r) => r.var_key);
    expect(keys).toEqual([
      "cert.load_bearing_non_transferable_on_coc",
      "cert.load_bearing_unconfirmed",
      "cert.non_transferable_on_coc",
      "cert.transferability_inferred_count",
    ]);
  });
});

describe("rag_rule finalization — the three records' mapping tables", () => {
  test("all 19 market/technical_execution/risk rows match grade/priority/stage_gate/condition_expr character for character", () => {
    expect(Object.keys(FINAL_RULES)).toHaveLength(19);
    for (const [ruleKey, expected] of Object.entries(FINAL_RULES)) {
      const row = ruleRow(ruleKey);
      expect(row, ruleKey).toBeDefined();
      expect(row.version, ruleKey).toBe(1); // updated in place, not re-versioned
      expect(row.stage_gate, ruleKey).toBe(expected.gate);
      expect(row.grade, ruleKey).toBe(expected.grade);
      expect(row.priority, ruleKey).toBe(expected.priority);
      expect(row.condition_expr, ruleKey).toBe(expected.expr); // exact string — no re-serialization drift
    }
  });

  test("dimension assignment: market×8, technical_execution×7, risk×4", () => {
    const rows = db
      .query("SELECT dimension, COUNT(*) AS c FROM rag_rule WHERE dimension IN ('market','technical_execution','risk') GROUP BY dimension")
      .all() as { dimension: string; c: number }[];
    expect(Object.fromEntries(rows.map((r) => [r.dimension, r.c]))).toEqual({
      market: 8,
      technical_execution: 7,
      risk: 4,
    });
  });

  test("the six new rows carry rule-0019-* ids; the thirteen updated rows keep their 0017/0018 ids", () => {
    for (const ruleKey of NEW_RULE_KEYS) {
      expect(ruleRow(ruleKey).id, ruleKey).toBe(`rule-0019-${ruleKey}`);
    }
    for (const ruleKey of ["market-dd-bargaining-power", "market-dd-competitive-demerit", "market-dd-switching-cost", "market-dd-tam-growth", "market-dd-right-to-win"]) {
      expect(ruleRow(ruleKey).id, ruleKey).toMatch(/^rule-0017-/);
    }
    for (const ruleKey of ["risk-dd-covenant-breach", "risk-dd-contingent-expected-value", "risk-dd-contingent-two-factor", "risk-dd-partner-sourcing", "tech-dd-trl-grade", "tech-dd-ip-clarity", "tech-dd-cert-transferability", "tech-dd-permit-critical-path"]) {
      expect(ruleRow(ruleKey).id, ruleKey).toMatch(/^rule-0018-/);
    }
  });

  test("0022 (PR-9) activated 18 of 19 with both anchors; the capped right-to-win alone stays disabled with NULL anchors (D-M-MKT-11.2)", () => {
    for (const ruleKey of Object.keys(FINAL_RULES)) {
      const row = ruleRow(ruleKey);
      if (ruleKey === "market-dd-right-to-win") {
        expect(row.enabled, ruleKey).toBe(0);
        expect(row.policy_id, ruleKey).toBeNull();
        expect(row.thresholds_source, ruleKey).toBeNull();
      } else {
        expect(row.enabled, ruleKey).toBe(1);
        expect(row.policy_id, ruleKey).not.toBeNull();
        expect(row.thresholds_source, ruleKey).not.toBeNull();
      }
    }
  });

  test("the re-graded green right-to-win still cannot be enabled without the anchors (Decision 9 cap holds)", () => {
    expect(() =>
      db.run("UPDATE rag_rule SET enabled = 1 WHERE rule_key = 'market-dd-right-to-win'"),
    ).toThrow(/CHECK constraint failed/);
  });

  test("no _threshold_placeholder remains anywhere in rag_rule", () => {
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE condition_expr LIKE '%_threshold_placeholder%'").get() as { c: number }).c).toBe(0);
    for (const ruleKey of Object.keys(FINAL_RULES)) {
      expect(countPlaceholderLeaves(parsePredicate(JSON.parse(ruleRow(ruleKey).condition_expr))), ruleKey).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) Parseability + wiring — the real gates, reused
// ---------------------------------------------------------------------------

describe("condition_expr parseability and join wiring", () => {
  test("every final condition_expr parses under the real PredicateSchema gate", () => {
    for (const ruleKey of Object.keys(FINAL_RULES)) {
      expect(() => parsePredicate(JSON.parse(ruleRow(ruleKey).condition_expr)), ruleKey).not.toThrow();
    }
  });

  test("for the six new rules, join rows equal collectPredicateVars exactly (D-M-TE-8's join-row mandate)", () => {
    for (const ruleKey of NEW_RULE_KEYS) {
      const row = ruleRow(ruleKey);
      const joined = new Set(
        (db.query("SELECT var_key FROM rag_rule_variable WHERE rule_id = ?").all(row.id) as { var_key: string }[]).map((r) => r.var_key),
      );
      const parsed = collectPredicateVars(parsePredicate(JSON.parse(row.condition_expr)));
      expect([...joined].sort(), ruleKey).toEqual([...parsed].sort());
    }
  });

  test("the record-mandated var references are all registered vars (FK holds; asserted anyway)", () => {
    const seeded = new Set((db.query("SELECT var_key FROM evidence_var").all() as { var_key: string }[]).map((r) => r.var_key));
    for (const ruleKey of Object.keys(FINAL_RULES)) {
      const row = ruleRow(ruleKey);
      for (const v of collectPredicateVars(parsePredicate(JSON.parse(row.condition_expr)))) {
        expect(seeded.has(v), `${ruleKey} references unregistered var ${v}`).toBe(true);
      }
    }
  });

  test("market.growth_rate is wired to exactly the four tam-growth/demerit rules after the two gate-split rows", () => {
    const rules = (db
      .query("SELECT rule_id FROM rag_rule_variable WHERE var_key = 'market.growth_rate'")
      .all() as { rule_id: string }[]).map((r) => r.rule_id);
    expect(rules.sort()).toEqual([
      "rule-0017-market-dd-competitive-demerit",
      "rule-0017-market-dd-tam-growth",
      "rule-0019-market-pre-fs-tam-growth",
      "rule-0019-market-screening-tam-growth",
    ].sort());
  });
});

// ---------------------------------------------------------------------------
// Runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; the finalized seed state survives untouched", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0019_enum_constraints_and_rule_finalization.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE dimension IN ('market','technical_execution','risk')").get() as { c: number }).c).toBe(19);
    // 0022 (PR-9) activated 18 rows; right-to-win stays disabled under the cap
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE enabled = 1").get() as { c: number }).c).toBe(18);
    expect((db.query("SELECT COUNT(*) AS c FROM evidence_var WHERE var_key LIKE 'cert.%'").get() as { c: number }).c).toBe(4); // 0018+0019's two, + ADR-0064's two tripwires (0027)
  });
});
