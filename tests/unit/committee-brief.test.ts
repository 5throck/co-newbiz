// @version 1.0.0
/**
 * Design §8.2/§8.3 (amendment 2026-11-10) — the pre_fs committee brief:
 *
 *  - buildPreFsCommitteeBrief composes the ADR-0118 pre_fs manifest context
 *    plus the track advisory rendered as evidence; every figure row carries
 *    its source version id + data-confidence grade where the data exposes
 *    one (market_sizing_version.data_confidence_grade / chain_hops /
 *    confidence_basis per ADR-0187); unset states render honestly
 *    (시장 근거 미산출 / 진입시장 미확정, ADR-0181); the advisory's
 *    recommendedTrack appears only as a labeled proposal line; undefined
 *    when the deal has no artifacts at all (no fabrication).
 *  - createCommitteeSession injects the brief by default for
 *    entity=opportunity + gate=pre_fs (the single choke point covering the
 *    web route and the pipeline path); client-supplied briefMd wins;
 *    project-entity sessions never receive one; a builder failure never
 *    blocks convening.
 */
import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-brief.sqlite");
// Coverage runs share one process across files: capture and restore every
// env var and module mock this suite touches (see committee-minutes.test.ts).
const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);
// This suite must never dial an LLM.
setEnv("CO_NEWBIZ_LLM_PROVIDER", "none");

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

// Owner decision 10: REST convene requires the provider seam to be
// registered — inject the deterministic agent AS the factory (the provider
// is forced offline above, so the chair passes stay deterministic).
const { setCallAgentFactory, deterministicCallAgent } = await import("../../app/web-next/lib/committee-agents.ts");
setCallAgentFactory(() => deterministicCallAgent());

// Snapshot of the pristine gate-brief module (spread BEFORE any mock.module
// call) — the builder-failure test mocks it and the afterAll restore puts
// the real module back (bun's mock.module is process-global).
const PRISTINE_GATE_BRIEF = { ...(await import("../../app/web-next/lib/gate-brief.ts")) };
const gateBriefResets: Array<() => void> = [];
afterEach(() => {
  for (const r of gateBriefResets.splice(0)) r();
});

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();
const INDUSTRY_ID = "ind-brief-test-1";
const INDUSTRY_NAME = "브리프 테스트 산업";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;

beforeAll(async () => {
  await createUser(db, {
    userId: "brief-admin",
    role: "analyst",
    password: "pw-brief-123456",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "brief-admin", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("brief-admin", "pw-brief-123456");
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const SIZING_PAYLOAD = JSON.stringify({
  matrix: {
    anchor: { total: 12.5 },
    consistency: { bottomUpCagr: 18.2 },
    competitive: { structure: "분산", players: [{ tier: "leader", name: "A" }] },
    qualitative: { opportunityFactors: ["규제 완화"], riskFactors: ["환율 변동"] },
  },
});

/** Seed the S1 sizing chain (industry → completed analysis → graded version)
 * plus an S3 attractiveness score on the opportunity — the artifacts the
 * pre_fs manifest and the advisory signals read. */
let seedSeq = 0;
function seedArtifacts(oppId: string, opts: { grade?: string | null } = {}): void {
  seedSeq += 1;
  db.run("INSERT OR IGNORE INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    INDUSTRY_ID,
    "T9999",
    INDUSTRY_NAME,
    "Brief Test Industry",
    NOW,
  ]);
  // The opportunity row already exists (created through the API) — point it
  // at the industry and give it an S3 attractiveness score.
  db.run("UPDATE opportunity SET market_scope = ?, attractiveness_score = 70 WHERE id = ?", [INDUSTRY_NAME, oppId]);
  const analysisId = `msa-brief-${seedSeq}`;
  const versionId = `msv-brief-${seedSeq}`;
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, INDUSTRY_ID, "completed", "test", NOW, NOW],
  );
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      versionId,
      analysisId,
      seedSeq, // unique per seed — the latest-version pick stays deterministic
      SIZING_PAYLOAD,
      "test",
      NOW,
      opts.grade === undefined ? "B" : opts.grade,
      1,
      "test: proxy chain recorded",
    ],
  );
}

async function createOpportunity(name = "Brief test opportunity"): Promise<string> {
  const res = await req("/api/opportunities", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.id as string;
}

function metaOf(sessionId: string): Record<string, unknown> {
  const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
  return JSON.parse(row.meta_json) as Record<string, unknown>;
}

/** Async convene contract (202): wait until the background deliberation
 * settles before asserting on the stored meta. */
async function waitForSessionSettled(sessionId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
    const meta = JSON.parse(row.meta_json) as { convening?: boolean };
    if (!meta.convening) return;
    await Bun.sleep(20);
  }
  throw new Error(`committee session ${sessionId} did not settle in time`);
}

describe("buildPreFsCommitteeBrief (design §8.2, supplements A + C)", () => {
  test("composes the scope line, manifest, version id + grade, and the advisory as a labeled proposal", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("Brief composed");
    seedArtifacts(oppId, { grade: "B" });

    const brief = buildPreFsCommitteeBrief(db, oppId);
    expect(typeof brief).toBe("string");
    const md = brief as string;
    // Supplement C — the leading scope line comes FIRST.
    expect(md.startsWith("[범위] 재무 정량 근거는 S5/S8에서 산출 — 본 심의는 라우트·범위 판단 근거임")).toBe(true);
    // Manifest context (ADR-0118 pre_fs blocks).
    expect(md).toContain("## 판정 근거 매니페스트 (ADR-0118 pre_fs)");
    expect(md).toContain("[S1 시장 규모·성장]");
    // Supplement A — the S1 figure carries the source version id AND the
    // grade column the table exposes (data_confidence_grade B, chain_hops 1).
    // This is the FIRST seeded version (seedSeq 1 → v1 / msv-brief-1).
    expect(md).toContain("market_sizing_version v1");
    expect(md).toContain("id msv-brief-1");
    expect(md).toContain("데이터 신뢰도 등급 B");
    expect(md).toContain("근거 사슬 홉 1");
    // Advisory as evidence — both directions visible, the recommendation
    // labeled a proposal, never a decision.
    expect(md).toContain("## 트랙 어드바이저 판단 근거");
    expect(md).toContain("· greenfield · weight");
    expect(md).toContain("결정론 트랙 권고:");
    expect(md).toContain("(proposal, not a decision");
    // The §8.2 labeled proposal line wording.
    expect(md).toContain("결정은 사람의 route_decision");
  });

  test("an unset grade column renders 미기록, never an invented grade", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("Brief ungraded");
    seedArtifacts(oppId, { grade: null });
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("데이터 신뢰도 등급 미기록");
    expect(brief).not.toContain("데이터 신뢰도 등급 B");
  });

  test("no artifacts at all → undefined (convening proceeds without a brief, no fabrication)", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("Brief bare");
    expect(buildPreFsCommitteeBrief(db, oppId)).toBeUndefined();
  });

  test("an unknown opportunity id → undefined", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    expect(buildPreFsCommitteeBrief(db, "01NO_SUCH_OPPORTUNITY")).toBeUndefined();
  });

  test("no S2-confirmed entry market renders 진입시장 미확정 (ADR-0181 wording)", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("Brief entry unset");
    seedArtifacts(oppId);
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("진입시장 미확정");
    expect(brief).not.toContain("진입시장 성장률 (S2 확정");
  });
});

describe("default brief injection at createCommitteeSession (design §8.3)", () => {
  test("opportunity + default gate (pre_fs) + no briefMd → meta.brief_md present with the scope line", async () => {
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    const oppId = await createOpportunity("Inject pre_fs");
    seedArtifacts(oppId);
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      { committeeKey: "route-steering-committee", decisionMode: "human_only", actor: "test" },
    );
    const meta = metaOf(created.sessionId);
    expect(meta.gate).toBe("pre_fs");
    const brief = meta.brief_md as string;
    expect(typeof brief).toBe("string");
    expect(brief).toContain("재무 정량 근거는 S5/S8에서 산출");
    expect(brief).toMatch(/market_sizing_version v\d+/);
    expect(brief).toContain("데이터 신뢰도 등급 B");
  });

  test("opportunity + explicit non-pre_fs gate → NOT injected", async () => {
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    const oppId = await createOpportunity("Inject screening");
    seedArtifacts(oppId);
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      { committeeKey: "route-steering-committee", decisionMode: "human_only", gate: "screening", actor: "test" },
    );
    expect(metaOf(created.sessionId).brief_md).toBeUndefined();
  });

  test("opportunity + pre_fs with NO artifacts → no brief_md, convening proceeds (no fabrication)", async () => {
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    const oppId = await createOpportunity("Inject bare");
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      { committeeKey: "route-steering-committee", decisionMode: "human_only", actor: "test" },
    );
    const meta = metaOf(created.sessionId);
    expect(meta.gate).toBe("pre_fs");
    expect(meta.brief_md).toBeUndefined();
  });

  test("a client-supplied briefMd wins — injection never overrides an explicit brief", async () => {
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    const oppId = await createOpportunity("Inject client brief");
    seedArtifacts(oppId);
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      {
        committeeKey: "route-steering-committee",
        decisionMode: "human_only",
        actor: "test",
        briefMd: "## 클라이언트 작성 브리프\nt-01 판정 근거",
      },
    );
    expect(metaOf(created.sessionId).brief_md).toBe("## 클라이언트 작성 브리프\nt-01 판정 근거");
  });

  test("project-entity session is excluded by the entity-type guard — never receives an opportunity brief", async () => {
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", ["proj-brief-1", "TEST-1", NOW]);
    const created = createCommitteeSession(
      { entityType: "project", entityId: "proj-brief-1" },
      { committeeKey: "route-steering-committee", decisionMode: "human_only", gate: "pre_fs", actor: "test" },
    );
    const meta = metaOf(created.sessionId);
    expect(meta.gate).toBe("pre_fs");
    expect(meta.brief_md).toBeUndefined();
  });

  test("a brief-builder failure never blocks convening — logged, session proceeds without a brief", async () => {
    gateBriefResets.push(() => mock.restore());
    gateBriefResets.push(() => mock.module("../../app/web-next/lib/gate-brief.ts", () => ({ ...PRISTINE_GATE_BRIEF })));
    mock.module("../../app/web-next/lib/gate-brief.ts", () => ({
      ...PRISTINE_GATE_BRIEF,
      buildPreFsCommitteeBrief: () => {
        throw new Error("brief builder exploded");
      },
    }));
    const { createCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
    const oppId = await createOpportunity("Inject builder failure");
    seedArtifacts(oppId);
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      { committeeKey: "route-steering-committee", decisionMode: "human_only", actor: "test" },
    );
    expect(created.sessionId).toBeTruthy();
    expect(metaOf(created.sessionId).brief_md).toBeUndefined();
  });
});

describe("web path end-to-end — the POST route convenes WITH the default brief", () => {
  test("agent_team convene (no briefMd) on an artifact-bearing deal stores meta.brief_md", async () => {
    const oppId = await createOpportunity("Inject web path");
    seedArtifacts(oppId);
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "agent_team" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;
    await waitForSessionSettled(sessionId);
    const meta = metaOf(sessionId);
    const brief = meta.brief_md as string;
    expect(typeof brief).toBe("string");
    expect(brief).toContain("재무 정량 근거는 S5/S8에서 산출");
    // The brief rode into the stored session through the same SessionMeta
    // key the S6/S7 caller-built briefs use (§8.2 storage seam).
    expect(meta.gate).toBe("pre_fs");
    // And the minutes draft persisted at synthesis (the topic carried the
    // brief via sessionTopic — §8.4).
    expect((meta.minutes_draft as { prompt_version: string } | undefined)?.prompt_version).toBe("committee.minutes@2");
  });
});

// ── Design §9.4 (F4) / §9.5 (F5) — follow-up batch, amendment 2026-11-11 ──

/** The single seeded sizing version's identity (id + version_no) for an
 * industry — read back instead of hardcoding seedSeq, which counts across
 * the whole file. */
function seededVersionOf(industryId: string): { id: string; version_no: number } {
  return db
    .query(
      "SELECT id, version_no FROM market_sizing_version WHERE analysis_id IN (SELECT id FROM market_sizing_analysis WHERE industry_id = ?) ORDER BY version_no DESC LIMIT 1",
    )
    .get(industryId) as { id: string; version_no: number };
}

describe("S1 resolution aligned to the ADR-0180 industry-FK-first order (design §9.4)", () => {
  test("(a) industry_id set + drifted market_scope → the manifest block and the provenance line cite the FK-resolved version, the same one the advisory reads", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const { computeTrackAdvisory } = await import("../../app/web-next/lib/track-advisory.ts");
    const oppId = await createOpportunity("S1 FK drift");
    seedArtifacts(oppId, { grade: "B" });
    // The drift: the FK points at the industry while market_scope names
    // something else entirely — the pre-amendment name-join resolved NOTHING
    // here (a false 없음) while the advisory resolved the FK row. Two
    // statements: the 0126 UPDATE trigger re-derives the FK from a changed
    // market_scope (drifted name → NULL), so the explicit FK write lands
    // only after the drift, in its own statement.
    db.run("UPDATE opportunity SET market_scope = '드리프트된 시장명' WHERE id = ?", [oppId]);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [INDUSTRY_ID, oppId]);
    const version = seededVersionOf(INDUSTRY_ID);

    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    // The manifest S1 block shows the real figures (no false 없음).
    expect(brief).toContain("[S1 시장 규모·성장]");
    expect(brief).toContain("기준 규모: $12.50B");
    expect(brief).toContain("CAGR: 18.2%");
    // The provenance line cites the SAME version identity.
    expect(brief).toContain(`market_sizing_version v${version.version_no}`);
    expect(brief).toContain(`id ${version.id}`);
    // And the advisory resolved the same analysis — its market signal exists
    // with the payload's CAGR, so one version feeds both sections.
    const marketSignal = computeTrackAdvisory(db, oppId).signals.find((s) => s.key === "market_growth");
    expect(marketSignal).toBeDefined();
    expect(marketSignal?.label).toContain("18%");
  });

  test("(a2) industry_id set + market_scope NULL also resolves through the FK", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("S1 FK null scope");
    seedArtifacts(oppId);
    // Same two-statement fixture rule as (a): nulling market_scope fires the
    // 0126 trigger (FK re-derived to NULL), then the explicit FK write lands
    // untouched — the §9.4 "market_scope null while the FK is set" state.
    db.run("UPDATE opportunity SET market_scope = NULL WHERE id = ?", [oppId]);
    db.run("UPDATE opportunity SET industry_id = ? WHERE id = ?", [INDUSTRY_ID, oppId]);
    const version = seededVersionOf(INDUSTRY_ID);
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("기준 규모: $12.50B");
    expect(brief).toContain(`id ${version.id}`);
    expect(brief).not.toContain("S1 시장분석: 없음");
  });

  test("(b) industry_id null + market_scope set → the name-join fallback resolves unchanged", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("S1 name fallback");
    seedArtifacts(oppId); // market_scope = INDUSTRY_NAME, industry_id untouched (NULL)
    const version = seededVersionOf(INDUSTRY_ID);
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("기준 규모: $12.50B");
    expect(brief).toContain(`market_sizing_version v${version.version_no}`);
    expect(brief).toContain(`id ${version.id}`);
  });

  test("(c) neither market_scope nor industry_id → the honest unset labels", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("S1 both unset");
    // One non-S1 artifact keeps the brief defined (otherwise §8.2 returns
    // undefined and the labels would not render at all).
    db.run("UPDATE opportunity SET attractiveness_score = 70 WHERE id = ?", [oppId]);
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("S1 시장분석: 없음 (market_scope 미지정)");
    expect(brief).toContain("- S1 시장 규모·성장·경쟁 구조: 시장 근거 미산출");
  });

  test("(c2) a named market whose analysis does not resolve keeps the plain 없음 label", async () => {
    const { buildPreFsCommitteeBrief } = await import("../../app/web-next/lib/gate-brief.ts");
    const oppId = await createOpportunity("S1 name miss");
    db.run("UPDATE opportunity SET market_scope = '존재하지 않는 산업명', attractiveness_score = 70 WHERE id = ?", [
      oppId,
    ]);
    const brief = buildPreFsCommitteeBrief(db, oppId) as string;
    expect(brief).toContain("S1 시장분석: 없음");
    expect(brief).not.toContain("market_scope 미지정");
  });
});

describe("s4Summary rationale truncation marker (design §9.5)", () => {
  async function contextWithRationale(oppId: string, rationale: string): Promise<string> {
    const { buildGateContext } = await import("../../app/web-next/lib/gate-brief.ts");
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
      [`rd-${oppId.slice(-8)}`, oppId, "greenfield", "existing_business_rbd", rationale, "test", NOW],
    );
    return buildGateContext(db, "opportunity", oppId, "pre_fs");
  }

  function rationaleLine(ctx: string): string {
    const line = ctx.split("\n").find((l) => l.startsWith("결정 근거: "));
    expect(line).toBeDefined();
    return line as string;
  }

  test("a >300-char rationale ends with … after the 300-char prefix", async () => {
    const oppId = await createOpportunity("Truncate long");
    const line = rationaleLine(await contextWithRationale(oppId, "가".repeat(450)));
    expect(line).toBe(`결정 근거: ${"가".repeat(300)}…`);
  });

  test("exactly 300 chars → no … marker (the budget is unchanged)", async () => {
    const oppId = await createOpportunity("Truncate exact");
    const line = rationaleLine(await contextWithRationale(oppId, "나".repeat(300)));
    expect(line).toBe(`결정 근거: ${"나".repeat(300)}`);
    expect(line.endsWith("…")).toBe(false);
  });
});
