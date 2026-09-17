/**
 * Unit tests for the v2.4.1 spec-engine alignment (design
 * 2026-09-18-s1s7-process-alignment):
 *  (a) S1 competitive structure (경쟁 구조) is a HARD requirement — a completed
 *      market_sizing_version payload without matrix.competitive keeps S1
 *      incomplete with 경쟁 구조 as a required artifact (the transition-period
 *      soft blocker ended);
 *  (b) S4 route_decision.alternatives_considered (검토한 대안) is completion-
 *      checked — empty blocks S4, a later decision that records it completes
 *      the stage.
 *
 * Real scratch SQLite (classification-write test pattern) so the industry →
 * market_sizing_analysis → market_sizing_version lookups inside the S1
 * predicate run against SQLite itself.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-process-predicate-alignment.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = "2026-09-18T09:00:00Z";
const U1 = "user-predicate";
// S1 predicate resolves the industry by name (market_scope) — each scenario
// seeds its own uniquely named industry so lookups cannot cross.
let industrySeq = 0;

function payloadWithCompetitive(withCompetitive: boolean): string {
  return JSON.stringify({
    methodology: "systematic-market-sizing v1.1.0",
    matrix: {
      anchor: { total: 100 },
      consistency: { bottomUpCagr: 9.4, topDownCagr: 0, tolerance: 3 },
      ...(withCompetitive ? { competitive: { structure: "상위 3사 집중도 60%", players: [{ name: "A" }] } } : {}),
    },
  });
}

function seedIndustryWithAnalysis(withCompetitive: boolean): string {
  const industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  const name = `정합테스트 산업 ${++industrySeq}`;
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [industryId, `00000${++industrySeq}`, name, "alignment-test", NOW],
  );
  const analysisId = `msa-${industryId}`;
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, industryId, "completed", U1, NOW, NOW],
  );
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [`msv-${industryId}`, analysisId, 1, payloadWithCompetitive(withCompetitive), U1, NOW],
  );
  return name;
}

function seedOpportunity(marketScope: string, fields: { attractiveness?: number; synergy?: number; rationale?: string; status?: string }): string {
  const id = `opp-${Math.random().toString(36).slice(2, 10)}`;
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, market_size_krw_m, growth_rate, value_chain_node, attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, `opp-${id.slice(-6)}`, marketScope, 500000, 9.4, "셀 제조", fields.attractiveness ?? null, fields.synergy ?? null, fields.rationale ?? null, fields.status ?? "identified", U1, NOW],
  );
  return id;
}

beforeAll(() => {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ["uid-predicate", U1, "analyst", "active", "salt", "hash", 1, NOW],
  );
});

afterAll(() => {
  resetDb();
});

describe("S1 competitive structure hard gate (v2.4.1)", () => {
  test("missing matrix.competitive keeps S1 incomplete with 경쟁 구조 required", () => {
    const name = seedIndustryWithAnalysis(false);
    const oppId = seedOpportunity(name, {});
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.currentStage).toBe("S1");
    expect(proc.blockers.some((b) => b.includes("경쟁 구조"))).toBe(true);
    expect(proc.requiredArtifacts).toContain("경쟁 구조");
  });

  test("matrix.competitive present completes S1 (evaluation advances to S2)", () => {
    const name = seedIndustryWithAnalysis(true);
    const oppId = seedOpportunity(name, {});
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.completedStages).toContain("S1");
    expect(proc.currentStage).toBe("S2");
    expect(proc.blockers.some((b) => b.includes("경쟁 구조"))).toBe(false);
  });
});

describe("S4 alternatives considered completion check (v2.4.1)", () => {
  function seedGreenfieldThroughS3(withCompetitiveIndustry: string): string {
    return seedOpportunity(withCompetitiveIndustry, { attractiveness: 74, synergy: 69, rationale: "적합성 판단 근거", status: "selected" });
  }

  test("route_decision without alternatives keeps S4 incomplete", () => {
    const oppId = seedGreenfieldThroughS3(seedIndustryWithAnalysis(true));
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
      [`rd-${oppId}-a`, oppId, "greenfield", "test route", U1, NOW],
    );
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.currentStage).toBe("S4");
    expect(proc.blockers.some((b) => b.includes("검토한 대안"))).toBe(true);
    expect(proc.requiredArtifacts).toContain("검토한 대안");
  });

  test("a later decision recording alternatives completes S4", () => {
    const oppId = seedGreenfieldThroughS3(seedIndustryWithAnalysis(true));
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
      [`rd-${oppId}-b`, oppId, "greenfield", "test route", U1, NOW],
    );
    // The real flow UPDATEs the current decision in place (route-decision POST:
    // UPDATE when a decision exists) — a second is_current row would violate
    // idx_route_decision_current (0101).
    db.run("UPDATE route_decision SET alternatives_considered = ? WHERE id = ?", ["M&A 대안 검토 후 제외", `rd-${oppId}-b`]);
    // 5criteria scores are also completion-mandatory for both tracks (ADR-0104).
    const criteria = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"];
    for (const [i, criterion] of criteria.entries()) {
      db.run(
        "INSERT INTO route_decision_score (id, decision_id, intent, criterion, score, evidence_note, created_at) VALUES (?,?,?,?,?,?,?)",
        [`rds-${oppId}-${i}`, `rd-${oppId}-b`, "integration", criterion, 2, "test evidence", NOW],
      );
    }
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.completedStages).toContain("S4");
    expect(proc.currentStage).toBe("S5");
    expect(proc.blockers.some((b) => b.includes("검토한 대안"))).toBe(false);
  });
});
