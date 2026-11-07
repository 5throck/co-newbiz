/**
 * Review scope follows the carrier stage (user-approved fix, precedent: spec
 * 2026-11-06-ai-review-stage-scope-fit-i18n — AI 1st no longer reports stages
 * the deal has not reached as defects). The S3 screen asks for the `screening`
 * gate review, which spans S1–S4. After S3 completes and the opportunity is
 * selected, S4 becomes `current`; requested from the S3 carrier, S4 is out of
 * scope (not_reached, non-structural, never blocks AI 2nd). A gate-level
 * request (no carrier) keeps the full span.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-review-carrier-scope.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { buildGateArtifact } = await import("../../app/web-next/lib/review/gate-artifacts.ts");
const { runAiFirstChecks, hasStructuralGaps } = await import("../../app/web-next/lib/review/ai-first.ts");
const { runAiSecond } = await import("../../app/web-next/lib/review/ai-second.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
import type { Ai2ndDeps } from "../../app/web-next/lib/review/ai-second.ts";

const NOW = "2026-09-18T09:00:00Z"; // before ADR-0192 predicate date: legacy S3 predicate
const U1 = "user-carrier-scope";
let industrySeq = 0;

function seedIndustryWithAnalysis(): string {
  const industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  const name = `범위테스트 산업 ${++industrySeq}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    `99900${++industrySeq}`,
    name,
    "carrier-scope-test",
    NOW,
  ]);
  const analysisId = `msa-${industryId}`;
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, industryId, "completed", U1, NOW, NOW],
  );
  const payload = JSON.stringify({
    methodology: "systematic-market-sizing v1.1.0",
    matrix: {
      anchor: { total: 100 },
      consistency: { bottomUpCagr: 9.4, topDownCagr: 0, tolerance: 3 },
      competitive: { structure: "상위 3사 집중도 60%", players: [{ name: "A" }] },
    },
  });
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [`msv-${industryId}`, analysisId, 1, payload, U1, NOW],
  );
  return name;
}

/** An opportunity with S1–S3 complete and selected: S4 is the current stage. */
function oppAtS4(): string {
  const id = `opp-${Math.random().toString(36).slice(2, 10)}`;
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, market_size_krw_m, growth_rate, value_chain_node, attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      `opp-${id.slice(-6)}`,
      seedIndustryWithAnalysis(),
      500000,
      9.4,
      "셀 제조",
      74,
      69,
      "적합성 판단 근거",
      "selected",
      U1,
      NOW,
    ],
  );
  return id;
}

const reply = JSON.stringify({
  verified: [{ claim: "S3 evidence exists", reason: "record found", evidence_ref: "stage:S3" }],
  could_not_verify: [{ claim: "Accuracy of source data", reason: "not checkable" }],
  needs_judgement: [{ claim: "Strategic fit of the synergy score", reason: "needs a human call" }],
});
let lastUser = "";
function fakeDeps(calls: { n: number }): Ai2ndDeps {
  return {
    complete: async (messages) => {
      calls.n++;
      lastUser = messages[1].content;
      return reply;
    },
    isConfigured: () => true,
    modelId: () => "mock-model",
  };
}

let cookie = "";
beforeAll(async () => {
  await createUser(db, {
    userId: U1,
    role: "analyst",
    password: "pw-carrier-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: U1, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: U1, password: "pw-carrier-12345" }),
  });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
});

describe("carrier-stage scoping of the screening gate review", () => {
  test("fixture: S3 complete + selected makes S4 the current stage", () => {
    const opp = oppAtS4();
    expect(evaluateProcess({ type: "opportunity", id: opp }).currentStage).toBe("S4");
  });

  test("gate-level (no carrier): S4 stays a structural 'incomplete' defect and blocks AI 2nd (unchanged)", () => {
    const opp = oppAtS4();
    const artifact = buildGateArtifact("screening", opp);
    const s4 = artifact.stages.find((s) => s.id === "S4")!;
    expect(s4.status).toBe("current");
    expect(s4.not_reached).toBeUndefined();
    const buckets = runAiFirstChecks(artifact);
    const incomplete = buckets.could_not_verify.find(
      (i) => i.claim.includes("Stage S4") && i.claim.includes("incomplete"),
    );
    expect(incomplete?.structural).toBe(true);
    expect(hasStructuralGaps(buckets)).toBe(true);
  });

  test("carrier S3 with S4 current: S4 is not_reached (info only), no structural gap, S1-S3 verified", () => {
    const opp = oppAtS4();
    const artifact = buildGateArtifact("screening", opp, { carrierStage: "S3" });
    const s4 = artifact.stages.find((s) => s.id === "S4")!;
    expect(s4.status).toBe("current");
    expect(s4.not_reached).toBe(true);
    expect(s4.blockers).toEqual([]);
    expect(s4.missing_artifacts).toEqual([]);
    for (const id of ["S1", "S2", "S3"]) expect(artifact.stages.find((s) => s.id === id)!.not_reached).toBeUndefined();

    const buckets = runAiFirstChecks(artifact);
    expect(hasStructuralGaps(buckets)).toBe(false);
    const nr = buckets.could_not_verify.filter((i) => i.scope === "not_reached");
    expect(nr).toHaveLength(1);
    expect(nr[0]!.structural).toBe(false);
    expect(nr[0]!.claim).toContain("Stage S4");
    expect(buckets.could_not_verify.some((i) => i.claim.includes("incomplete"))).toBe(false);
    expect(buckets.verified.filter((i) => i.claim.includes("completion predicate")).length).toBe(3);
  });

  test("carrier scoping changes the content hash; no carrier keeps the old hash", () => {
    const opp = oppAtS4();
    const plain = buildGateArtifact("screening", opp);
    expect(buildGateArtifact("screening", opp).contentHash).toBe(plain.contentHash);
    expect(buildGateArtifact("screening", opp, { carrierStage: "S3" }).contentHash).not.toBe(plain.contentHash);
  });

  test("a carrier at the last gate stage (S4) scopes nothing out", () => {
    const opp = oppAtS4();
    const plain = buildGateArtifact("screening", opp);
    expect(buildGateArtifact("screening", opp, { carrierStage: "S4" }).contentHash).toBe(plain.contentHash);
  });

  test("AI 2nd runs for the S3 carrier (not blocked by S4) and the S4 stage is excluded from the payload", async () => {
    const opp = oppAtS4();
    const artifact = buildGateArtifact("screening", opp, { carrierStage: "S3" });
    const ai1 = runAiFirstChecks(artifact);
    const calls = { n: 0 };
    const out = await runAiSecond({ artifact, ai1stBuckets: ai1, userId: U1, db }, fakeDeps(calls));
    expect(out.notPerformedReason ?? "").not.toContain("structural gaps");
    expect(calls.n).toBeGreaterThan(0);
    expect(lastUser).not.toContain('"id":"S4"');
    expect(lastUser).toContain('"id":"S3"');
  });

  test("gate-level AI 2nd stays blocked by the structural S4 gap (unchanged)", async () => {
    const opp = oppAtS4();
    const artifact = buildGateArtifact("screening", opp);
    const ai1 = runAiFirstChecks(artifact);
    const calls = { n: 0 };
    const out = await runAiSecond({ artifact, ai1stBuckets: ai1, userId: U1, db }, fakeDeps(calls));
    expect(out.performed).toBe(false);
    expect(out.notPerformedReason).toContain("structural gaps");
    expect(calls.n).toBe(0);
  });
});

describe("HTTP: carrierStage threading", () => {
  const post = (opp: string, body: unknown) =>
    nextRequest(`/api/opportunities/${opp}/reviews`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify(body),
    });
  const stagesOf = async (res: Response) =>
    ((await res.json()) as { data: { ai_1st: { could_not_verify: Array<{ claim: string; scope?: string }> } } }).data
      .ai_1st.could_not_verify;

  test("an invalid carrierStage (not a stage of the gate) is a 400", async () => {
    const opp = oppAtS4();
    expect((await post(opp, { gate: "screening", carrierStage: "S9" })).status).toBe(400);
    expect((await post(opp, { gate: "screening", carrierStage: "nope" })).status).toBe(400);
  });

  test("POST + GET with carrierStage S3 scope S4 out; without it S4 is a defect; keys/ledger unchanged", async () => {
    const opp = oppAtS4();
    const scoped = await post(opp, { gate: "screening", carrierStage: "S3" });
    expect(scoped.status).toBe(200);
    const items = await stagesOf(scoped);
    expect(items.find((i) => i.claim.includes("Stage S4"))?.scope).toBe("not_reached");
    const view = await nextRequest(`/api/opportunities/${opp}/reviews?gate=screening&carrier_stage=S3`, {
      headers: { cookie },
    });
    expect(view.status).toBe(200);
    expect((await stagesOf(view)).some((i) => i.claim.includes("S4") && i.claim.includes("incomplete"))).toBe(false);

    const plain = await post(opp, { gate: "screening" });
    expect((await stagesOf(plain)).some((i) => i.claim.includes("Stage S4") && i.claim.includes("incomplete"))).toBe(
      true,
    );
  });
});
