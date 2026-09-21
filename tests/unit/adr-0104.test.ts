// Unit tests for ADR-0104 libraries: track advisory, project charter,
// committee scorecard/minutes, gate aging. Scratch SQLite (house pattern).
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-adr0104.sqlite";
// Must precede the first db/client import: DEFAULT_DB_PATH is captured at
// module init (house pattern — see admin-deal-block.test.ts).
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
const NOW = "2026-09-04T00:00:00Z";
type Db = ReturnType<typeof GetDb>;
let db: Db;
let oppHighGrowth: string;
let oppSynergy: string;
let projectId: string;
let sessionId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  resetDb();
  db = getDb(TEST_DB_PATH);
  runMigrations(TEST_DB_PATH);

  oppHighGrowth = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppHighGrowth, "휴머노이드 진출", "휴머노이드 로봇", "selected", "t", NOW]);

  // pipeline-recorded (unconfirmed) synergy recommendation — migration 0099
  // confirmation semantics: NULL confirmed_at = 권고 상태.
  oppSynergy = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppSynergy, "시너지 확정 테스트", "휴머노이드 로봇", "selected", "t", NOW]);
  db.run("UPDATE opportunity SET synergy_score = 67, synergy_rationale = '권고 근거' WHERE id = ?", [oppSynergy]);

  // completed S1 matrix with 36% CAGR + related industries. bottomUpCagr is
  // persisted already scaled to a percent number (e.g. 36 means 36%), not a
  // fraction — matches market-sizing-pipeline.ts's `Math.round(cagr * 1000) / 10`
  // storage convention (2026-09-13 CAGR display bug fix).
  const industry = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industry, "28990", "휴머노이드 로봇", "Humanoid robots", NOW]);
  const analysis = ulid();
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)",
    [analysis, industry, "completed", "t", NOW]);
  const matrix = JSON.stringify({ matrix: { consistency: { bottomUpCagr: 36 }, chainDirection: { relatedIndustries: [{ name: "정밀 감속기" }, { name: "AI 반도체" }] } } });
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), analysis, 1, matrix, "v1", "t", NOW]);

  // completed S1 pipeline run needs process_run for committee minutes test
  sessionId = ulid();
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-0104-T", NOW]);
  db.run(
    `INSERT INTO process_run (id, project_id, entity_type, entity_id, spec_version, stage, status, started_by, started_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [sessionId, projectId, "project", projectId, "2.0.0", "committee", "done", "t", NOW]);
  const evId = ulid();
  db.run("INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, recommendation, evaluated_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [evId, sessionId, "entity_ic", "{}", "go", "t", NOW]);
  db.run("UPDATE process_run SET meta_json = ? WHERE id = ?",
    [JSON.stringify({ committee_key: "entity-ic", decision_mode: "agent_team", gate: "entity_ic", synthesized: true, evaluation_id: evId }), sessionId]);
  db.run("INSERT INTO agent_position (id, process_run_id, member_type, agent_key, position_md, confidence, round, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), sessionId, "agent", "brownfield-agent",
      "번들링 시너지 크다 <!--position-meta:{\"recommendation\":\"go\",\"confidence\":80,\"criteria_scores\":{\"control_need\":2,\"capability_criticality\":3,\"market_uncertainty\":2,\"integration_capacity\":2,\"speed_to_capability\":3}}-->"
      , 80, 1, NOW]);

}, 30_000); // fresh-DB migration run exceeds bun's default 5s hook timeout on CI runners

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("computeTrackAdvisory", () => {
  test("high-growth market leans greenfield on S1-S3 evidence; shortlist never votes", () => {
    const { computeTrackAdvisory } = require("../../app/web-next/lib/track-advisory.ts");
    const r = computeTrackAdvisory(db, oppHighGrowth);
    expect(r.signals.length).toBeGreaterThan(0);
    const mkt = r.signals.find((s: { key: string }) => s.key === "market_growth");
    expect(mkt.leans).toBe("greenfield");
    expect(r.greenfieldScore).toBeGreaterThan(r.brownfieldScore);
    // Regression (2026-09-14): the S6/S7 shortlist is downstream of S4, so it
    // must not appear as a voting signal — its absence branch was an
    // unconditional greenfield +2 for every opportunity.
    expect(r.signals.find((s: { key: string }) => s.key === "shortlist")).toBeUndefined();
  });

  test("base rates array present", () => {
    const { computeTrackAdvisory } = require("../../app/web-next/lib/track-advisory.ts");
    expect(Array.isArray(computeTrackAdvisory(db, oppHighGrowth).baseRates)).toBe(true);
  });

  test("unconfirmed synergy recommendation stays a neutral info signal (경계 #2)", () => {
    const { computeTrackAdvisory } = require("../../app/web-next/lib/track-advisory.ts");
    const syn = computeTrackAdvisory(db, oppSynergy).signals.find((s: { key: string }) => s.key === "synergy");
    expect(syn).toBeDefined();
    expect(syn.leans).toBe("neutral");
    expect(syn.weight).toBe(1);
    expect(syn.note).toContain("사람 확정 전 권고값");
  });

  test("human-confirmed synergy score votes brownfield when strong, neutral when weak", () => {
    const { computeTrackAdvisory } = require("../../app/web-next/lib/track-advisory.ts");
    db.run("UPDATE opportunity SET synergy_score = 67, synergy_score_confirmed_at = ?, synergy_score_confirmed_by = 'human' WHERE id = ?", [NOW, oppSynergy]);
    const strong = computeTrackAdvisory(db, oppSynergy).signals.find((s: { key: string }) => s.key === "synergy");
    expect(strong.leans).toBe("brownfield");
    expect(strong.weight).toBe(2);
    expect(strong.label).toContain("시너지 확정");

    db.run("UPDATE opportunity SET synergy_score = 40 WHERE id = ?", [oppSynergy]);
    const weak = computeTrackAdvisory(db, oppSynergy).signals.find((s: { key: string }) => s.key === "synergy");
    expect(weak.leans).toBe("neutral");
    expect(weak.weight).toBe(2);
  });

  test("pipeline re-record keeps confirmation on same value, clears on change", () => {
    const { recordSynergyRecommendation } = require("../../app/web-next/lib/synergy-pipeline.ts");
    db.run("UPDATE opportunity SET synergy_score = 67, synergy_score_confirmed_at = ?, synergy_score_confirmed_by = 'human' WHERE id = ?", [NOW, oppSynergy]);

    recordSynergyRecommendation(db, oppSynergy, 67, "재분석 — 같은 점수");
    const kept = db.query("SELECT synergy_score_confirmed_at c FROM opportunity WHERE id = ?").get(oppSynergy) as { c: string | null };
    expect(kept.c).not.toBeNull();

    recordSynergyRecommendation(db, oppSynergy, 71, "재분석 — 점수 변경");
    const cleared = db.query("SELECT synergy_score_confirmed_at c, synergy_score s FROM opportunity WHERE id = ?").get(oppSynergy) as { c: string | null; s: number };
    expect(cleared.c).toBeNull();
    expect(cleared.s).toBe(71);
  });
});

describe("buildCommitteeScorecard + minutes", () => {
  test("aggregates per-criterion median and counts vetoes/recommendations", () => {
    const { buildCommitteeScorecard } = require("../../app/web-next/lib/committee-scorecard.ts");
    const run = db.query("SELECT id, typeof(meta_json) AS t, substr(meta_json,1,40) AS head FROM process_run WHERE id = ?").get(sessionId);
    if (process.env.SC_DEBUG) console.error("RUN_DEBUG", JSON.stringify(run));
    const t = require("../../app/web-next/lib/committee-session.ts").getCommitteeSession(sessionId);
    const sc = buildCommitteeScorecard(t);
    expect(sc.rows).toHaveLength(1);
    if (process.env.SC_DEBUG) console.error("SC_DEBUG", JSON.stringify(sc));
    if (process.env.SC_DEBUG) console.error("SC_DEBUG", JSON.stringify({ rows: sc.rows, agg: sc.aggregate }));
    expect(sc.aggregate.byCriterion.control_need.median).toBe(2);
    expect(sc.aggregate.recommendations.go).toBe(1);
    expect(sc.aggregate.vetoes).toBe(0);
  });

  test("minutes markdown contains scorecard table and gate link", () => {
    const { buildCommitteeMinutes } = require("../../app/web-next/lib/committee-scorecard.ts");
    const md = buildCommitteeMinutes(db, sessionId)!;
    expect(md).toContain("좌석별 스코어카드");
    expect(md).toContain("Chair 종합 판정");
    expect(md).toContain("brownfield-agent");
  });
});

describe("gate aging + pipeline", () => {
  test("HOLD gates age; pipeline lists projects", () => {
    const { listGateAging, listProjectPipeline } = require("../../app/web-next/lib/gate-aging.ts");
    projectId = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-0104", NOW]);
    db.run(`INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), "project", projectId, "dd", "hold", "데이터룸 대기", "t", "2026-09-01T00:00:00Z"]);
    const aging = listGateAging(db, { minAgeDays: 1 });
    expect(aging.some((r: { gate: string; decision: string }) => r.gate === "dd" && r.decision === "hold")).toBe(true);
    const pipeline = listProjectPipeline(db);
    expect(Array.isArray(pipeline)).toBe(true);
  });
});
