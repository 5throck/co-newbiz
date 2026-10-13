// @version 1.0.0
/**
 * S11 IC package & project-keyed establishment — ADR-0100 regression.
 *
 * Proves, against the REAL route handlers (nextRequest harness) and the real
 * scratch SQLite:
 *  (a) the 0070 backfill populates entity_establishment_step.project_id from
 *      the opportunity backlink, and reads resolve project-keyed rows;
 *  (b) the IC package aggregates the adopted business case + its simulations,
 *      DD completion, the RAG proposal, gate history, and establishment
 *      progress — one deny-by-default read;
 *  (c) the project establishment route mirrors the opportunity route's
 *      semantics: step-5 sequence enforcement, viewer 403, non-member 404;
 *  (d) boundary #2: the RAG grade travels ONLY as a labeled proposal and the
 *      GET route performs no gate writes (and exposes no write verb at all);
 *  (e) S11 completion flips only when BOTH gates are go AND establishment is
 *      5/5 (origin internal).
 */

import { judgeAllStandardDdItems } from "./_dd-standard.ts";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-ic-package.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
let standardCount = 0;

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = new Date().toISOString();

/** S10 투자구조 설계 완료 픽스처 (flow.spec v2.2.0 술어) — 4축 검토 완료된
 * 가설 1건 + sources == uses > 0 인 자금조달 행. 정합 술어 검사가 S10을
 * 통과하도록 직접 INSERT 한다 (거버넌스 레이어는 별도 테스트에서 검증). */
function seedS10Complete(pid: string) {
  db.run(
    `INSERT INTO deal_structure_hypothesis
       (id, project_id, asset_or_stock, stake_type, instrument_mix, vehicle,
        tax_structure_note, liability_isolation_note, financing_leverage_note,
        exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [ulid(), pid, "stock", "majority", "mixed", "spc",
     "법인세 특례 검토", "SPC 자산 격리", "AC 대출 60%", "5년 후 매각",
     ANALYST, NOW, "SPC 경유 구조 — 4축 검토 완료"],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "source", "출자금 + AC 대출", 1000, ANALYST, NOW],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "use", "주식 인수 대금", 1000, ANALYST, NOW],
  );
}

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1"; // project member (lead)
const VIEWER = "viewer1"; // authenticated, viewer role
const OUTSIDER = "outsider1"; // authenticated analyst, NOT a member
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
let sourceOppId = "";

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

  // Promote a greenfield opportunity into a project (ADR-0095) — the
  // promoter becomes the lead member, which gives the deny-by-default checks
  // a real membership boundary.
  sourceOppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [sourceOppId, "S11 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), sourceOppId, "greenfield", "test route", "M&A 대안 검토 후 제외", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), sourceOppId, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), sourceOppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", sourceOppId, gate, "go", "test", ANALYST, NOW]);
  }
  projectId = promoteOpportunity(sourceOppId, { promotedBy: ANALYST, needToKnowBasis: "S11 test promoter" }).project.id;
  seedS10Complete(projectId);
  // S11 establishment applies to origin∈{internal,joint} (ADR-0047) — pin it.
  db.run("UPDATE md_project SET origin = 'internal', establishment_mode = 'new_entity' WHERE id = ?", [projectId]);

  // S8 artifact: one case + one persisted simulation percentile.
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
    ["bc-ic1", projectId, "greenfield_cost", "투자심의 자료 케이스", 5, ANALYST, NOW, "{}"],
  );
  // S11 charter baseline JSON exists from promotion (ADR-0104); the human
  // CONFIRMATION act is exercised through the confirm endpoint in describe (e).
  db.run("UPDATE md_project SET charter_json = ? WHERE id = ?", [JSON.stringify({ versions: [{ version: 1, purpose: "IC 테스트 목적" }] }), projectId]);
  db.run(
    "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "bc-ic1", "base", "p50", 12000, 0.14, "seed=42", NOW, 2.5, 2.5],
  );

  // S9 artifact: one judged state row (approved-custom path — judged pass),
  // plus one finding.
  db.run(
    "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, "custom:commercial", ulid(), "pass", ANALYST, NOW],
  );
  standardCount = judgeAllStandardDdItems(db, projectId, ANALYST, NOW);
  db.run(
    "INSERT INTO dd_finding (id, project_id, category, description, value_impact, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), projectId, "commercial", "핵심 고객 계약 변경 통제 조항 발견", -500, NOW],
  );

  // AI-proposed RAG: overall amber + data_confidence amber (the cap).
  const runId = ulid();
  db.run(
    "INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)",
    [runId, projectId, "h-ic", "rag-engine", NOW],
  );
  for (const dimension of ["overall", "data_confidence"]) {
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, projectId, dimension, "amber", "테스트 근거", NOW],
    );
  }
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(a) migration 0070 — project_id backfill from the opportunity backlink", () => {
  test("backfill UPDATE populates project_id on legacy opportunity-keyed rows", () => {
    // A legacy row: written through the opportunity route before 0070 —
    // opportunity_id set, project_id NULL.
    db.run(
      `INSERT INTO entity_establishment_step
         (id, opportunity_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["ees-legacy-1", sourceOppId, 1, "done", "internal", "ef-01", null, "legacy row", ANALYST, NOW],
    );
    expect(
      (db.query("SELECT project_id FROM entity_establishment_step WHERE id = 'ees-legacy-1'").get() as { project_id: string | null }).project_id,
    ).toBeNull();

    // Run the migration's own backfill statement, verbatim from the file.
    const sql = readFileSync(join(PROJECT_ROOT, "db/migrations/0070_entity_establishment_project_key.sql"), "utf8");
    const update = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .match(/UPDATE entity_establishment_step[\s\S]*?WHERE project_id IS NULL;/)?.[0];
    expect(update).toBeTruthy();
    db.run(update!);

    const row = db
      .query("SELECT project_id, opportunity_id FROM entity_establishment_step WHERE id = 'ees-legacy-1'")
      .get() as { project_id: string; opportunity_id: string };
    expect(row.project_id).toBe(projectId);
    expect(row.opportunity_id).toBe(sourceOppId); // origin of record is kept
  });

  test("0070 is additive-only: ALTER + backfill UPDATE + index (ADR-0014)", () => {
    const sql = readFileSync(join(PROJECT_ROOT, "db/migrations/0070_entity_establishment_project_key.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN project_id TEXT REFERENCES md_project(id)");
    expect(sql).toContain("WHERE project_id IS NULL");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_ees_project");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });
});

describe("(b) the IC package aggregates the S11 read surface", () => {
  test("adopted case + simulations + DD completion + RAG proposal + gates + establishment", async () => {
    // Adopt the S8 case — a human action through the adopt endpoint.
    const adopt = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ model_id: "bc-ic1", goals_ack: { acknowledged: true, note: "test: 목표 비교 없이 진행" } }),
    });
    expect(adopt.status).toBe(201);

    const res = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const pkg = (await res.json()).data as {
      business_case: { adopted: { id: string; simulations: unknown[] } | null };
      dd: { completion: { total: number; pending: number; unassessed: number; mandatoryUnmet: number }; findings: unknown[] };
      rag: { grade: string | null; isProposal: boolean; confidence_cap: string | null };
      gates: { latest: Array<{ gate: string; decision: string | null }> };
      establishment: { done: number; total: number; complete: boolean; progress: string };
    };

    expect(pkg.business_case.adopted?.id).toBe("bc-ic1");
    expect(pkg.business_case.adopted!.simulations.length).toBe(1);
    // ADR-0160 addendum (b) / ADR-0162: in-scope projects also carry judged / judgeable / workspace_judgeable / excluded.
    expect(pkg.dd.completion).toMatchObject({ total: 1 + standardCount, pending: 0, unassessed: 0, mandatoryUnmet: 0 });
    expect(pkg.dd.findings.length).toBe(1);
    expect(pkg.rag.grade).toBe("amber");
    expect(pkg.rag.confidence_cap).toBe("amber");
    // No gates recorded yet.
    expect(pkg.gates.latest.map((g) => g.decision)).toEqual([null, null]);
    // Establishment progress counts the backfilled legacy row.
    expect(pkg.establishment).toMatchObject({ done: 1, total: 5, complete: false, progress: "1/5" });
  });

  test("deny-by-default: non-member 404, admin excluded, unauthenticated 401", async () => {
    expect((await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: outsiderCookie } })).status).toBe(404);
    expect((await req(`/api/projects/${projectId}/ic-package`)).status).toBe(401);
  });
});

describe("(c) project establishment route — sequence, roles, membership", () => {
  test("step 5 cannot be done before steps 1–4 (sequence enforcement)", async () => {
    const res = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 5, status: "done", origin: "internal" }),
    });
    expect(res.status).toBe(400);
  });

  test("steps 1–4 done, then step 5 completes the record", async () => {
    // ADR-0165: the legacy ef-01 row is already done, so a plain PUT is refused
    // until it is reopened (the reopen ADOPTS the legacy row onto the project key).
    const refused = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 1, status: "done", origin: "internal", checklist_item: "ef-01", note: "n" }),
    });
    expect(refused.status).toBe(409);
    const reopened = await req(`/api/projects/${projectId}/establishment/reopen`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 1, reason: "legacy 행 재기록을 위해 재개합니다" }),
    });
    expect(reopened.status).toBe(200);
    for (const n of [1, 2, 3, 4]) {
      const res = await req(`/api/projects/${projectId}/establishment`, {
        method: "PUT", headers: { cookie: analystCookie },
        // Step 1 re-uses the legacy row's checklist key (ef-01), so the upsert
        // ADOPTS the backfilled row instead of duplicating it — the opportunity
        // view and the project view must stay one ledger.
        body: JSON.stringify({ step_no: n, status: "done", origin: "internal", checklist_item: n === 1 ? "ef-01" : null, evidence_url: `https://dataroom.example/ef-0${n}` }),
      });
      expect(res.status).toBe(200);
    }
    // Adoption in place: the legacy row now carries the project key exactly once.
    const dup = (db
      .query("SELECT COUNT(*) c FROM entity_establishment_step WHERE opportunity_id = ? AND step_no = 1")
      .get(sourceOppId) as { c: number }).c;
    expect(dup).toBe(1);
    const final = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 5, status: "done", origin: "internal", evidence_url: "https://dataroom.example/ef-12" }),
    });
    expect(final.status).toBe(200);
    const data = (await final.json()).data as { complete: boolean; progress: string };
    expect(data).toMatchObject({ complete: true, progress: "5/5" });

    // Project route and opportunity route read the SAME rows (one ledger).
    const oppView = await req(`/api/opportunities/${sourceOppId}/establishment`, { headers: { cookie: analystCookie } });
    expect(oppView.status).toBe(200);
    const opp = (await oppView.json()).data as { complete: boolean; progress: string };
    expect(opp).toMatchObject({ complete: true, progress: "5/5" });
  });

  test("viewer PUT is 403; non-member is 404; invalid vocabulary is 400", async () => {
    const viewer = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: viewerCookie },
      body: JSON.stringify({ step_no: 1, status: "in_progress", origin: "internal" }),
    });
    expect(viewer.status).toBe(403);

    const outsider = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: outsiderCookie },
      body: JSON.stringify({ step_no: 1, status: "in_progress", origin: "internal" }),
    });
    expect(outsider.status).toBe(404);

    const badStatus = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 1, status: "approved", origin: "internal" }),
    });
    expect(badStatus.status).toBe(400);

    const badOrigin = await req(`/api/projects/${projectId}/establishment`, {
      method: "PUT", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 1, status: "done", origin: "external" }),
    });
    expect(badOrigin.status).toBe(400);
  });
});

describe("(d) boundary #2 — RAG is a labeled proposal; the read writes nothing", () => {
  test("payload flags isProposal; GET performs no gate_decision writes; no write verb exists", async () => {
    const before = (db.query("SELECT COUNT(*) n FROM gate_decision WHERE entity_type = 'project'").get() as { n: number }).n;

    const res = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const pkg = (await res.json()).data as { rag: { isProposal: boolean; grade: string | null } };
    expect(pkg.rag.isProposal).toBe(true); // AI 제안 — 승인 기록이 아니다
    expect(pkg.rag.grade).toBe("amber");

    const after = (db.query("SELECT COUNT(*) n FROM gate_decision WHERE entity_type = 'project'").get() as { n: number }).n;
    expect(after).toBe(before);

    // The route file exports GET only — the IC read can never confirm anything.
    const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/api/projects/[id]/ic-package/route.ts"), "utf8");
    expect(src).toContain("export async function GET");
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});

describe("(e) S11 completion — both gates go AND establishment 5/5", () => {
  test("one gate go is not enough", async () => {
    const res = await req(`/api/projects/${projectId}/gate-decisions`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ gate: "entity_ic", decision: "go", rationale: "투자심의 자료 검토 후 인적 결재" }),
    });
    expect(res.status).toBe(201);

    const before = evaluateProcess({ type: "project", id: projectId });
    expect(before.gateStatus.entity_ic).toBe("go");
    expect(before.completedStages).not.toContain("S11");
    expect(before.blockers.join("\n")).toContain("그룹 투자심의위원회");
  });

  test("both gates go + charter confirmed + 5/5 flips S11 complete (origin internal)", async () => {
    const res = await req(`/api/projects/${projectId}/gate-decisions`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ gate: "group_ic", decision: "go", rationale: "그룹 투자심사 인적 결재" }),
    });
    expect(res.status).toBe(201);

    // Charter baseline confirmation — the human act behind S11's completionCriteria.
    const confirm = await req(`/api/projects/${projectId}/charter/confirm`, {
      method: "POST", headers: { cookie: analystCookie }, body: "{}",
    });
    expect(confirm.status).toBe(200);

    // ADR-0161: a greenfield S11 reached after the rule also needs the human
    // execution-baseline confirmation (blocking for a not-yet-completed S11).
    const pending = evaluateProcess({ type: "project", id: projectId });
    expect(pending.completedStages).not.toContain("S11");
    expect(pending.requiredArtifacts).toContain("실행 기준선 확인 (greenfield)");
    { const base = `/api/projects/${projectId}/execution-baseline`;
      const entries = { permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-03-01" }], hiring_plan: [{ role_family: "생산", quarter: "2027-Q1", headcount: 10 }], kpi_targets: [{ metric_key: "revenue_vs_case", target_value: 100, due: "2028-Q4" }] };
      expect((await req(base, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ action: "record_entries", entries }) })).status).toBe(201);
      const first = await req(base, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ action: "confirm", rationale: "IC 승인 조건 기준 실행 기준선 확인 (테스트)" }) });
      let st = first.status;
      if (st === 409) {
        const open = ((await first.json()) as { meta: { open_findings: Array<{ code: string }> } }).meta.open_findings;
        st = (await req(base, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ action: "confirm", rationale: "IC 승인 조건 기준 실행 기준선 확인 (테스트)", acknowledged_findings: open.map((f) => ({ code: f.code, rationale: "테스트 픽스처: 확인" })) }) })).status;
      }
      expect(st).toBe(201); }

    const after = evaluateProcess({ type: "project", id: projectId });
    expect(after.gateStatus).toMatchObject({ entity_ic: "go", group_ic: "go" });
    expect(after.completedStages).toContain("S11");
    expect(after.currentStage).toBe("S12");
  });

  test("backsliding one establishment step un-completes S11", () => {
    db.run("UPDATE entity_establishment_step SET status = 'halted' WHERE project_id = ? AND step_no = 5", [projectId]);
    const halted = evaluateProcess({ type: "project", id: projectId });
    expect(halted.completedStages).not.toContain("S11");
    db.run("UPDATE entity_establishment_step SET status = 'done' WHERE project_id = ? AND step_no = 5", [projectId]);
    expect(evaluateProcess({ type: "project", id: projectId }).completedStages).toContain("S11");
  });

  test("ADR-0165: reopening a step after the gate drops S11 and progress but leaves gate decisions untouched", async () => {
    const gatesBefore = (db.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?").get(projectId) as { c: number }).c;
    const res = await req(`/api/projects/${projectId}/establishment/reopen`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ step_no: 5, reason: "게이트 이후 거버넌스 베이스라인 재확인" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ complete: false, progress: "4/5" });
    const after = evaluateProcess({ type: "project", id: projectId });
    expect(after.gateStatus).toMatchObject({ entity_ic: "go", group_ic: "go" });
    expect(after.completedStages).not.toContain("S11");
    expect((db.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?").get(projectId) as { c: number }).c).toBe(gatesBefore);
    db.run("UPDATE entity_establishment_step SET status = 'done' WHERE project_id = ? AND step_no = 5", [projectId]);
  });
});
