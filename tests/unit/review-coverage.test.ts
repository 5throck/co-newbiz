// Wave F-3/F-4 coverage guard — the stage-artifact review registry must never
// drift from process/flow.spec.yaml (ADR-0153 §4.4, design §F-4). This file:
// (1) FAILS if any spec requiredArtifacts entry is missing from the registry,
// (2) keeps the client-safe label list in parity with the registry,
// (3) extends the boundary-#2 row-count guard to the stage-artifact engine and
//     the audit-sample repository,
// (4) exercises the human_final hooks and the audit-sample KPI end to end.
// The LLM is ALWAYS mocked; no real provider is ever called.
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TEST_DB_PATH = "db/data/test-review-coverage.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { insertAiReview } = await import("../../db/repositories/review.repository.ts");
const {
  STAGE_ARTIFACT_REGISTRY,
  artifactKeyForStage,
  parseStageArtifactKey,
  stageArtifactDefsFor,
  buildStageArtifact,
  buildStageArtifactsForStage,
} = await import("../../app/web-next/lib/review/stage-artifacts.ts");
const { STAGE_ARTIFACT_LABELS } = await import("../../app/web-next/lib/review/stage-artifact-labels.ts");
const { runAiFirstChecks } = await import("../../app/web-next/lib/review/ai-first.ts");
const { runAiFirst, getArtifactReviewView } = await import("../../app/web-next/lib/review/engine.ts");
const { AuditSampleError, insertAuditSample, auditAgreementSummary } = await import(
  "../../db/repositories/review-audit.repository.ts"
);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
import type { ReviewBuckets } from "../../db/repositories/review.repository.ts";

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
const USER = "coverage-human";
const ANALYST = "coverage-analyst";
let cookie = "";
let analystCookie = "";

interface SpecStage {
  id: string;
  requiredArtifacts?: string[];
}

const spec = yaml.load(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as {
  stages: SpecStage[];
};

function newOpp(): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    `opp-${id.slice(-5)}`,
    "assessed",
    "test",
    NOW,
  ]);
  return id;
}
function newProject(charterJson?: string): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, charter_json, created_at) VALUES (?,?,?,?)", [
    id,
    `PRJ-${id.slice(-6)}`,
    charterJson ?? null,
    NOW,
  ]);
  return id;
}
const count = (table: string): number => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeAll(async () => {
  await createUser(db, {
    userId: USER,
    role: "admin",
    password: "pw-coverage-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  await createUser(db, {
    userId: ANALYST,
    role: "analyst",
    password: "pw-analyst-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (uid: string, pw: string): Promise<string> => {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: uid, password: pw }),
    });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  cookie = await login(USER, "pw-coverage-12345");
  analystCookie = await login(ANALYST, "pw-analyst-12345");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("spec-coverage guard (F-3/F-4)", () => {
  test("every requiredArtifacts entry of S1–S12 exists in the registry, in spec order", () => {
    for (const stage of spec.stages) {
      const required = stage.requiredArtifacts ?? [];
      const defs = stageArtifactDefsFor(stage.id as never);
      const names = defs.map((d) => d.name);
      // THE GUARD: a spec artifact missing from the registry fails the suite.
      for (const name of required) {
        expect(names, `stage ${stage.id}: spec artifact '${name}' missing from STAGE_ARTIFACT_REGISTRY`).toContain(name);
      }
      // Registry must not invent artifacts the spec does not require either.
      for (const name of names) {
        expect(required, `stage ${stage.id}: registry artifact '${name}' is not in flow.spec.yaml`).toContain(name);
      }
      expect(names).toEqual(required);
    }
    expect(STAGE_ARTIFACT_REGISTRY.length).toBeGreaterThan(20);
  });

  test("registry key helpers round-trip and reject malformed keys", () => {
    expect(parseStageArtifactKey("stage:S9:2")).toEqual({ stageId: "S9", index: 2 });
    expect(parseStageArtifactKey(artifactKeyForStage("S12", 3))).toEqual({ stageId: "S12", index: 3 });
    expect(parseStageArtifactKey("stage:S13:1")).toBeNull();
    expect(parseStageArtifactKey("stage:S9:0")).toBeNull();
    expect(parseStageArtifactKey("screening")).toBeNull();
  });

  test("carrier entity type follows the S1–S7 opportunity / S8–S12 project split", () => {
    expect(stageArtifactDefsFor("S4").every((d) => d.entityType === "opportunity")).toBe(true);
    expect(stageArtifactDefsFor("S9").every((d) => d.entityType === "project")).toBe(true);
  });

  test("client-safe label list is in parity with the registry (exact key set)", () => {
    const registryKeys = new Set(STAGE_ARTIFACT_REGISTRY.map((d) => artifactKeyForStage(d.stageId, d.index)));
    const labelKeys = new Set(STAGE_ARTIFACT_LABELS.map((l) => l.key));
    expect(labelKeys).toEqual(registryKeys);
    for (const l of STAGE_ARTIFACT_LABELS) expect(l.label.length).toBeGreaterThan(0);
  });

  test("buildStageArtifact: deterministic hash, names, author agents, no verdict fields", () => {
    const pid = newProject();
    const a = buildStageArtifact("S10", 1, pid);
    const again = buildStageArtifact("S10", 1, pid);
    expect(a.contentHash).toBe(again.contentHash);
    expect(a.artifactKey).toBe("stage:S10:1");
    expect(a.artifactName).toBe(stageArtifactDefsFor("S10")[0].name);
    expect(a.authorAgents.length).toBeGreaterThan(0);
    expect(a.stages.length).toBe(1);
    expect(a.stages[0].id).toBe("S10");
    const content = a.content as Record<string, unknown>;
    expect(content).toMatchObject({ kind: "stage-artifact", stage: "S10", artifact_index: 1, entity_id: pid });
    expect(JSON.stringify(content)).not.toMatch(/"(verdict|result|pass|score)"/i);
    expect(buildStageArtifactsForStage("S10", pid).length).toBe(stageArtifactDefsFor("S10").length);
  });

  test("AI 1st on a stage artifact writes the row under its stage:S#:N key", async () => {
    const pid = newProject();
    const artifact = buildStageArtifact("S9", 1, pid);
    const out = await runAiFirst({ artifact, entityId: pid, userId: USER, db });
    expect(out.buckets.could_not_verify.length).toBeGreaterThan(0);
    const view = getArtifactReviewView(artifact, db);
    expect(view.gate).toBe("stage:S9:1");
    expect(view.artifact_key).toBe("stage:S9:1");
    expect(view.ai_1st?.current).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/"(verdict|result)"/i);
    // AI 1st reuses the deterministic predicates for both artifact kinds.
    const buckets = runAiFirstChecks(artifact);
    expect(buckets.could_not_verify.length).toBeGreaterThan(0);
  });
});

describe("boundary #2 extension (stage artifacts + audit samples)", () => {
  const PROTECTED_WRITE =
    /(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(gate_decision|approval\w*|venture_transition_decision|closure_record)\b/i;

  test("review-audit repository has no import path to decision writers and no protected writes", () => {
    const src = readFileSync(join(ROOT, "db/repositories/review-audit.repository.ts"), "utf8");
    expect(src).not.toMatch(PROTECTED_WRITE);
    expect(src).not.toMatch(/approval-chain|closure\.repository|project\.repository|app\/web-next\/app\/api/);
  });

  test("running the stage-artifact engine and recording samples writes no decision rows", async () => {
    const opp = newOpp();
    const before = ["gate_decision", "approval_chain", "venture_transition_decision", "closure_record"].map(count);
    const artifact = buildStageArtifact("S3", 1, opp);
    await runAiFirst({ artifact, entityId: opp, userId: USER, db });
    const ai2 = insertAiReview({
      stage: "ai_2nd",
      artifactKey: artifact.artifactKey,
      entityType: artifact.entityType,
      entityId: opp,
      stageId: artifact.stageId,
      contentHash: artifact.contentHash,
      buckets: {
        verified: [{ claim: "c", reason: "r", evidence_ref: "stage:S3" }],
        could_not_verify: [{ claim: "u", reason: "unverified by mock" }],
        needs_judgement: [],
      },
      authorDomain: "functional",
      reviewerAgent: "process-governance-manager",
      reviewerDomain: "functional",
      modelId: "mock-model",
      costTokens: 10,
      performed: true,
      requestedBy: USER,
      db,
      now: NOW,
    });
    insertAuditSample({ reviewStageId: ai2, sampledBy: USER, agreed: true, note: "검표 동의", agentIds: new Set(), db, now: NOW });
    const after = ["gate_decision", "approval_chain", "venture_transition_decision", "closure_record"].map(count);
    expect(after).toEqual(before);
  });
});

describe("human_final hooks (F-3)", () => {
  test("charter/confirm POST writes human_final rows for every S11 artifact", async () => {
    const pid = newProject('{"sections":{}}');
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, ANALYST, "lead", "test", NOW, "review coverage test"],
    );
    const defs = stageArtifactDefsFor("S11");
    const res = await nextRequest(`/api/projects/${pid}/charter/confirm`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: "{}",
    });
    expect(res.status).toBe(200);
    for (let i = 1; i <= defs.length; i++) {
      const rows = db
        .query("SELECT result, requested_by FROM review_stage WHERE artifact_key = ? AND stage = 'human_final'")
        .all(artifactKeyForStage("S11", i)) as Array<{ result: string; requested_by: string }>;
      expect(rows.length, `human_final for stage:S11:${i}`).toBeGreaterThan(0);
      expect(rows[0].result).toBe("charter_confirmed");
      expect(rows[0].requested_by).toBe(ANALYST);
    }
  });

  test("audit-sample route: 201 on a performed ai_2nd, 400 on ai_1st, 404 unknown", async () => {
    const opp = newOpp();
    const artifact = buildStageArtifact("S2", 1, opp);
    await runAiFirst({ artifact, entityId: opp, userId: USER, db });
    const firstView = getArtifactReviewView(artifact, db);
    const firstId = firstView.ai_1st!.id;
    expect(
      (await nextRequest(`/api/reviews/${firstId}/audit-sample`, { method: "POST", headers: { cookie }, body: '{"agreed":true}' }))
        .status,
    ).toBe(400);
    expect(
      (await nextRequest(`/api/reviews/${ulid()}/audit-sample`, { method: "POST", headers: { cookie }, body: '{"agreed":true}' }))
        .status,
    ).toBe(404);
    expect(
      (await nextRequest(`/api/reviews/${firstId}/audit-sample`, { method: "POST", headers: { cookie }, body: "{}" })).status,
    ).toBe(400);
    // The AI reviewer persona can never be the sampler (boundary #1/#2).
    expect(() =>
      insertAuditSample({
        reviewStageId: firstId,
        sampledBy: "process-governance-manager",
        agreed: true,
        agentIds: new Set(["process-governance-manager"]),
        db,
      }),
    ).toThrow(AuditSampleError);
  });

  test("agreement-rate KPI math: overall/by_domain/by_quarter aggregate correctly", () => {
    const pid = newProject();
    const artifact = buildStageArtifact("S8", 1, pid);
    const mkAi2 = (domain: string): string =>
      insertAiReview({
        stage: "ai_2nd",
        artifactKey: artifact.artifactKey,
        entityType: artifact.entityType,
        entityId: pid,
        stageId: artifact.stageId,
        contentHash: artifact.contentHash,
        buckets: {
          verified: [],
          could_not_verify: [{ claim: "u", reason: "mock" }],
          needs_judgement: [],
        },
        authorDomain: domain,
        reviewerAgent: "financial-analyst",
        reviewerDomain: domain,
        modelId: "mock-model",
        costTokens: 5,
        performed: true,
        requestedBy: USER,
        db,
        now: "2026-10-08T00:00:00.000Z",
      });
    const a = mkAi2("functional-coverage");
    const b = mkAi2("technical-coverage");
    insertAuditSample({ reviewStageId: a, sampledBy: USER, agreed: true, agentIds: new Set(), db, now: "2027-01-15T01:00:00.000Z" });
    insertAuditSample({ reviewStageId: b, sampledBy: USER, agreed: false, agentIds: new Set(), db, now: "2027-01-15T02:00:00.000Z" });
    const summary = auditAgreementSummary(db);
    // The suite shares one DB; assert the DELTA this test contributed.
    const base = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(agreed),0) AS a FROM review_audit_sample WHERE review_stage_id NOT IN (?,?)").get(a, b) as { n: number; a: number };
    expect(summary.overall.sampled - base.n).toBe(2);
    expect(summary.overall.agreed - base.a).toBe(1);
    const fn = summary.by_domain.find((d) => d.key === "functional-coverage");
    const tech = summary.by_domain.find((d) => d.key === "technical-coverage");
    expect(fn).toMatchObject({ sampled: 1, agreed: 1, rate: 1 });
    expect(tech).toMatchObject({ sampled: 1, agreed: 0, rate: 0 });
    const q = summary.by_quarter.find((x) => x.key === "2027-Q1");
    expect(q).toMatchObject({ sampled: 2, agreed: 1, rate: 0.5 });
  });

  test("admin review-audit endpoint is admin-gated and returns the summary + suggested rate", async () => {
    const anon = await nextRequest("/api/admin/review-audit");
    expect(anon.status).toBe(401);
    const res = await nextRequest("/api/admin/review-audit", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { overall: { sampled: number }; suggested_sample_rate: number } };
    expect(body.data.overall.sampled).toBeGreaterThan(0);
    expect(body.data.suggested_sample_rate).toBe(0.1);
  });
});
