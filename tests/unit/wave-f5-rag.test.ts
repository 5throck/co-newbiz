/**
 * Wave F-5/F-6 tests (design 2026-10-08-wave-f-process-closure §12):
 *  - data-confidence derivation: hop bands + provenance cap, and PARITY with
 *    migration 0125's backfill SQL (same cut lines on the same seeded chain);
 *  - migration 0126: exact-unique-match industry FK backfill, ambiguous /
 *    no-match reported for humans, never guessed;
 *  - assessRun enforceConfidenceCeiling: cap demotes immediately (bypassing
 *    the 7-day hysteresis hold), never promotes; CLI semantics unchanged;
 *  - recomputeRag idempotency: unchanged inputs write nothing;
 *  - F-6 predicate additions via evaluateProcess (S1 confidence grade, S3
 *    sourced capability rows, grandfathering) and the S11 PMI kickoff record
 *    mechanics (human-only, latest-record read).
 *
 * Real scratch SQLite (process-predicate-alignment pattern).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wave-f5-rag.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { gradeFromHops, provenanceCap, worseGrade, deriveDataConfidence } = await import("../../db/lib/data-confidence.ts");
const { assessRun } = await import("../../db/lib/rag-engine.ts");
const { recomputeRag } = await import("../../db/lib/rag-service.ts");
const { evaluateProcess, WAVE_F_PREDICATE_DATE } = await import("../../app/web-next/lib/process-flow.ts");
const { recordPmiKickoff, latestPmiKickoff, PmiKickoffError, pmiKickoffApplies } = await import("../../app/web-next/lib/pmi-kickoff.ts");

const NOW = "2026-10-08T09:00:00Z";
const PRE_F = "2026-09-18T09:00:00Z";
const U1 = "user-wave-f";

let seq = 0;
const next = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

function seedIndustry(): { id: string; name: string } {
  const id = next("ind");
  const name = `웨이브에프 산업 ${seq}`;
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [id, `90000${seq}`, name, "wave-f-test", NOW],
  );
  return { id, name };
}

function seedProxyLink(fromId: string, toId: string, hopType: "engineering" | "statistical", r2: number | null): void {
  db.run(
    "INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, coefficient, beta, r2, evidence_ref) VALUES (?,?,?,?,?,?,?,?)",
    [next("px"), fromId, toId, hopType, hopType === "engineering" ? 1.0 : null, hopType === "statistical" ? 0.9 : null, hopType === "statistical" ? r2 : null, "test://evidence"],
  );
}

function seedSizedAnalysis(industryId: string, opts: { provenance?: string; grade?: string | null; competitive?: boolean; versionNo?: number } = {}): void {
  const analysisId = next("msa");
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, industryId, "completed", U1, NOW, NOW],
  );
  const payload = JSON.stringify({
    matrix: {
      anchor: { total: 100 },
      competitive: opts.competitive === false ? undefined : { structure: "테스트", players: [{ name: "A" }] },
      ...(opts.provenance ? { provenance: opts.provenance } : {}),
    },
  });
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, data_confidence_grade, chain_hops, confidence_basis, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [next("msv"), analysisId, opts.versionNo ?? 1, payload, opts.grade ?? null, null, null, U1, NOW],
  );
}

function seedOpportunity(marketScope: string, createdAt: string): string {
  const id = next("opp");
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, market_size_krw_m, growth_rate, value_chain_node, attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, `opp-${id.slice(-6)}`, marketScope, 500000, 9.4, "셀 제조", 70, 65, "적합성 판단 근거", "selected", U1, createdAt],
  );
  return id;
}

function seedProject(track: string, createdAt: string, oppId?: string): string {
  const id = next("proj");
  db.run(
    "INSERT INTO md_project (id, project_no, origin, track, source_opportunity_id, created_at) VALUES (?,?,?,?,?,?)",
    [id, `NP-WF-${seq}`, "mna", track, oppId ?? null, createdAt],
  );
  return id;
}

beforeAll(() => {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ["uid-wave-f", U1, "analyst", "active", "salt", "hash", 1, NOW],
  );
});

afterAll(() => {
  resetDb();
});

// ── data-confidence derivation ──────────────────────────────────────────

describe("gradeFromHops / provenanceCap bands (migration 0125 cut lines)", () => {
  test("0 statistical hops -> A", () => expect(gradeFromHops(0, null)).toBe("A"));
  test("0 statistical hops but a bad engineering r2 is ignored", () => expect(gradeFromHops(0, null)).toBe("A"));
  test("1 statistical hop with r2 >= 0.6 -> B", () => expect(gradeFromHops(1, 0.72)).toBe("B"));
  test("1 statistical hop with r2 < 0.6 -> C", () => expect(gradeFromHops(1, 0.4)).toBe("C"));
  test("2+ statistical hops -> C even at r2 = 1.0", () => expect(gradeFromHops(2, 1.0)).toBe("C"));
  test("frozen-research provenance caps at A", () => expect(provenanceCap("frozen-research")).toBe("A"));
  test("llm-estimate / unknown provenance caps at B", () => {
    expect(provenanceCap("llm-estimate")).toBe("B");
    expect(provenanceCap(null)).toBe("B");
  });
  test("worseGrade picks the lower grade", () => {
    expect(worseGrade("A", "B")).toBe("B");
    expect(worseGrade("C", "A")).toBe("C");
    expect(worseGrade("B", "B")).toBe("B");
  });
});

describe("migration 0125 backfill SQL parity with deriveDataConfidence", () => {
  test("TS twin agrees with the SQL for every seeded chain shape", () => {
    const shapes: Array<{ hops: Array<["engineering" | "statistical", number | null]>; provenance?: string }> = [
      { hops: [] },
      { hops: [["engineering", null]] },
      { hops: [["statistical", 0.8]], provenance: "frozen-research" },
      { hops: [["statistical", 0.8]] },
      { hops: [["statistical", 0.5]] },
      { hops: [["statistical", 0.9], ["statistical", 0.9]] },
      { hops: [["engineering", null], ["statistical", 0.7]], provenance: "llm-estimate" },
    ];
    for (const shape of shapes) {
      const ind = seedIndustry();
      for (const [t, r2] of shape.hops) seedProxyLink(ind.id, seedIndustry().id, t, r2);
      seedSizedAnalysis(ind.id, { provenance: shape.provenance });
      // Re-run ONLY the migration 0125 backfill UPDATE (verbatim from the file)
      // against the fresh row whose grade columns start NULL.
      const sql = readFileSync("db/migrations/0125_market_sizing_confidence.sql", "utf-8");
      const start = sql.indexOf("UPDATE market_sizing_version SET");
      const update = sql.slice(start, sql.indexOf(";", start) + 1);
      db.run(update);
      const row = db
        .query(
          `SELECT v.data_confidence_grade AS grade, v.chain_hops AS hops, v.confidence_basis AS basis
           FROM market_sizing_version v JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(ind.id) as { grade: string; hops: number; basis: string };
      const derived = deriveDataConfidence(db, ind.id, shape.provenance ?? null);
      expect(row.grade).toBe(derived.grade);
      expect(row.hops).toBe(derived.chainHops);
      expect(row.basis).toBeTruthy();
    }
  });
});

// ── migration 0126 industry FK backfill ─────────────────────────────────

describe("migration 0126 opportunity industry FK backfill", () => {
  test("exact unique match sets industry_id; ambiguous and no-match are reported, never guessed", () => {
    const unique = seedIndustry();
    const dupA = seedIndustry();
    const dupB = seedIndustry();
    db.run("UPDATE md_industry SET name_ko = ? WHERE id = ?", [dupA.name, dupB.id]); // two industries, same name
    const exact = seedOpportunity(unique.name, NOW);
    const ambiguous = seedOpportunity(dupA.name, NOW);
    const noMatch = seedOpportunity("존재하지 않는 산업", NOW);
    // migration 0125's INSERT used NEW rows; simulate pre-migration rows by
    // NULLing the derived FK and re-running the 0126 backfill verbatim.
    db.run("UPDATE opportunity SET industry_id = NULL WHERE id IN (?,?,?)", [exact, ambiguous, noMatch]);
    const sql = readFileSync("db/migrations/0126_opportunity_industry_fk.sql", "utf-8");
    const backfill = sql.slice(sql.indexOf("-- @backfill-begin") + "-- @backfill-begin".length, sql.indexOf("-- @backfill-end"));
    db.run(backfill);
    expect((db.query("SELECT industry_id AS i FROM opportunity WHERE id = ?").get(exact) as { i: string | null }).i).toBe(unique.id);
    expect((db.query("SELECT industry_id AS i FROM opportunity WHERE id = ?").get(ambiguous) as { i: string | null }).i).toBeNull();
    expect((db.query("SELECT industry_id AS i FROM opportunity WHERE id = ?").get(noMatch) as { i: string | null }).i).toBeNull();
    const reports = db
      .query("SELECT reason FROM opportunity_industry_backfill_report WHERE opportunity_id IN (?, ?)")
      .all(ambiguous, noMatch) as Array<{ reason: string }>;
    expect(reports.length).toBe(2);
    expect(new Set(reports.map((r) => r.reason))).toEqual(new Set(["ambiguous", "no_match"]));
  });
});

// ── RAG confidence cap + recompute idempotency ──────────────────────────

function seedRun(pid: string, runId: string): void {
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, pid, "test", "hash", U1, NOW]);
}

/** All-green input except the given chain grade. */
function greenInput(chainGrade: "A" | "B" | "C" | undefined) {
  return {
    stageGate: "fs" as const,
    chainGrade,
    financial: { irr: 0.18, hurdle: 0.10, dscrDownside: 1.5 },
    marketGrade: "green" as const,
    regulatory: { remedyType: "none" as const },
    technicalGrade: "green" as const,
    riskGrade: "green" as const,
  };
}

describe("assessRun enforceConfidenceCeiling (boundary #4)", () => {
  test("cap demotes immediately, bypassing the 7-day hysteresis hold (web semantics)", () => {
    const pid = seedProject("greenfield", NOW);
    const t0 = "2026-10-01T09:00:00Z";
    const r1 = next("run");
    seedRun(pid, r1);
    const first = assessRun(db, { projectId: pid, runId: r1, input: greenInput("A"), irrOverHurdlePp: 8, now: t0 });
    expect(first.recordedOverall).toBe("green");
    // 1 day later confidence worsens to B — hysteresis would HOLD green.
    const r2 = next("run");
    seedRun(pid, r2);
    const held = assessRun(db, { projectId: pid, runId: r2, input: greenInput("B"), irrOverHurdlePp: 8, previousIrrOverHurdlePp: 8, now: t0.replace("01", "02") });
    expect(held.recordedOverall).toBe("green"); // CLI semantics unchanged (flag unset)
    const r3 = next("run");
    seedRun(pid, r3);
    const capped = assessRun(db, {
      projectId: pid,
      runId: r3,
      input: greenInput("B"),
      irrOverHurdlePp: 8,
      previousIrrOverHurdlePp: 8,
      now: t0.replace("01", "03"),
      enforceConfidenceCeiling: true,
    });
    expect(capped.recordedOverall).toBe("amber");
    expect(capped.hysteresisRationale ?? "").toContain("cap applied immediately");
  });

  test("the cap never promotes a grade (B confidence cannot pull amber to green)", () => {
    const pid = seedProject("greenfield", NOW);
    const r = next("run");
    seedRun(pid, r);
    const result = assessRun(db, {
      projectId: pid,
      runId: r,
      input: { ...greenInput(undefined), financial: { irr: 0.11, hurdle: 0.10, dscrDownside: 1.05 } },
      irrOverHurdlePp: 1,
      now: NOW,
    });
    expect(result.recordedOverall).not.toBe("green");
  });
});

describe("recomputeRag idempotency (web recompute)", () => {
  test("first call assesses; an unchanged input set writes nothing; a change reassesses", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { provenance: "frozen-research", grade: "A" });
    const oppId = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    const pid = seedProject("greenfield", NOW, oppId);

    const first = recomputeRag(db, pid, "ic_package", { actor: U1, now: NOW });
    expect(first.status).toBe("assessed");
    expect(first.complete).toBe(false); // only some dimensions assessed -> no overall, "not_graded"
    const runsAfterFirst = (db.query("SELECT COUNT(*) c FROM run WHERE project_id = ?").get(pid) as { c: number }).c;
    expect(runsAfterFirst).toBe(1);

    const second = recomputeRag(db, pid, "ic_package", { actor: U1, now: NOW });
    expect(second.status).toBe("unchanged");
    const runsAfterSecond = (db.query("SELECT COUNT(*) c FROM run WHERE project_id = ?").get(pid) as { c: number }).c;
    expect(runsAfterSecond).toBe(1); // NO new run row on unchanged inputs

    // The trigger_source/inputs_hash provenance (migration 0127) is stamped.
    const stamped = db
      .query("SELECT DISTINCT trigger_source AS t, inputs_hash AS h FROM rag_assessment WHERE project_id = ?")
      .get(pid) as { t: string; h: string };
    expect(stamped.t).toBe("ic_package");
    expect(stamped.h).toBeTruthy();

    // New confidence input -> different hash -> reassessed.
    seedSizedAnalysis(ind.id, { provenance: "llm-estimate", grade: "C", versionNo: 2 });
    const third = recomputeRag(db, pid, "ic_package", { actor: U1, now: NOW });
    expect(third.status).toBe("assessed");
    expect(third.dataConfidenceGrade).toBe("C");
  });
});

// ── F-6 predicates ──────────────────────────────────────────────────────

describe("S1 data-confidence grade predicate (Wave F-6)", () => {
  test("post-cutoff opportunity with an ungraded latest version is blocked with a named artifact", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: null }); // matrix + competitive, no grade
    const oppId = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.currentStage).toBe("S1");
    expect(proc.blockers.some((b) => b.includes("데이터 신뢰도 등급"))).toBe(true);
    expect(proc.requiredArtifacts).toContain("데이터 신뢰도 등급");
  });

  test("a graded version completes S1 (advances to S2)", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: "B" });
    const oppId = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.completedStages).toContain("S1");
    expect(proc.blockers.some((b) => b.includes("데이터 신뢰도 등급"))).toBe(false);
  });

  test("pre-cutoff opportunities are grandfathered — an ungraded version does not block", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: null });
    const oppId = seedOpportunity(ind.name, PRE_F);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.completedStages).toContain("S1");
    expect(WAVE_F_PREDICATE_DATE).toBe("2026-10-08");
  });
});

describe("S3 sourced capability list predicate (Wave F-6)", () => {
  test("post-cutoff opportunity without a sourced capability row is blocked", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: "B" }); // S1 complete so the S3 stage is current
    const oppId = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    const proc = evaluateProcess({ type: "opportunity", id: oppId });
    expect(proc.currentStage).toBe("S3");
    expect(proc.blockers.some((b) => b.includes("필요 역량 목록"))).toBe(true);
  });

  test("a capability row WITH a source completes the check; source-less rows do not count", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: "B" });
    const withSource = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
      JSON.stringify({ rows: [{ capability: "엔진 정비망", gap: "부족", how: "파트너십", source: "synergy_area" }] }),
      withSource,
    ]);
    expect(evaluateProcess({ type: "opportunity", id: withSource }).blockers.some((b) => b.includes("필요 역량 목록"))).toBe(false);

    const withoutSource = seedOpportunity(ind.name, NOW);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
      JSON.stringify({ rows: [{ capability: "엔진 정비망", gap: "부족", how: "파트너십" }] }),
      withoutSource,
    ]);
    expect(evaluateProcess({ type: "opportunity", id: withoutSource }).blockers.some((b) => b.includes("필요 역량 목록"))).toBe(true);
  });

  test("pre-cutoff opportunities are grandfathered — no capability rows needed", () => {
    const ind = seedIndustry();
    seedSizedAnalysis(ind.id, { grade: null });
    const oppId = seedOpportunity(ind.name, PRE_F);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [ind.id, oppId]);
    expect(evaluateProcess({ type: "opportunity", id: oppId }).blockers.some((b) => b.includes("필요 역량 목록"))).toBe(false);
  });
});

describe("S11 PMI kickoff record (Wave F-6)", () => {
  test("brownfield M&A/JV/strategic-investment routes require PMI; other routes do not", () => {
    expect(pmiKickoffApplies("brownfield", "m_and_a")).toBe(true);
    expect(pmiKickoffApplies("brownfield", "jv")).toBe(true);
    expect(pmiKickoffApplies("brownfield", "partnership")).toBe(false);
    expect(pmiKickoffApplies("greenfield", null)).toBe(false);
  });

  test("a person records the kickoff; an agent persona is refused; latest record is read back", () => {
    const pid = seedProject("brownfield", NOW);
    expect(latestPmiKickoff(db, pid)).toBeNull();
    const rec = recordPmiKickoff(db, { projectId: pid, owner: "통합 책임자", planNote: "100일 통합 계획 기준선 — 시스템·인력·고객 통합 순서를 확정한다.", recordedBy: U1, now: NOW });
    expect(rec.id).toBeTruthy();
    const latest = latestPmiKickoff(db, pid);
    expect(latest?.recordedBy).toBe(U1);
    expect(latest?.owner).toBe("통합 책임자");
    expect(() => recordPmiKickoff(db, { projectId: pid, owner: "x", planNote: "짧은 메모", recordedBy: U1 })).toThrow(PmiKickoffError);
    expect(() => recordPmiKickoff(db, { projectId: pid, owner: "x", planNote: "에이전트가 기록하려는 시도용 충분히 긴 메모입니다.", recordedBy: "pmi-agent" })).toThrow(PmiKickoffError);
  });
});
