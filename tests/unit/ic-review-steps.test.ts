/**
 * S11 투자심사 절차 단계 (2026-10-21) — entity-ic-review / group-investment-review
 * step statuses over a real scratch SQLite: derived steps read their own
 * ledgers (RAG, gate decisions, certainty of funds), the Kill Criteria check
 * requires an explicit verdict for EVERY applicable criterion with the engine's
 * evaluation shown as a proposal, the IC memo is a hash-stamped snapshot, and
 * procedure gaps are informational (they never gate — the GO-gap override
 * contract is unchanged; folding them in is a human decision, design doc).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

// The step-4.5 draft route calls the LLM when one is configured; tests pin the
// deterministic fallback (same convention as capability-judgement-ai.test.ts).
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

const TEST_DB_PATH = "db/data/test-ic-steps.sqlite";
const NOW = "2026-10-21T10:00:00Z";
type Db = ReturnType<typeof GetDb>;
let db: Db;

const ANALYST = "icsteps-analyst";
const VIEWER = "icsteps-viewer";
let analystCookie = "";
let viewerCookie = "";
let projectId = "";

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
function json(body: unknown, cookie: string = analystCookie, method = "POST") {
  return { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) };
}

beforeAll(async () => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string, password: string): Promise<string> => {
    const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login(ANALYST, "pw-analyst-12345");
  viewerCookie = await login(VIEWER, "pw-viewer-12345");

  const opportunityId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, "IC steps 기회", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), opportunityId, "greenfield", "test", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), opportunityId, "직접 진출", "M&A 대안", "test", ANALYST, NOW, NOW],
  );
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opportunityId],
  );
  for (const gate of ["screening", "pre_fs"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", opportunityId, gate, "go", "test", ANALYST, NOW],
    );
  }
  const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
  projectId = promoteOpportunity(opportunityId, { promotedBy: ANALYST, needToKnowBasis: "ic steps test" }).project.id;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  }
});

async function view() {
  const res = await req(`/api/projects/${projectId}/ic-review-steps`, { headers: { cookie: analystCookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data as Awaited<ReturnType<typeof import("../../app/web-next/lib/ic-review-steps.ts")["icReviewStepsView"]>>;
}

describe("ic-review-steps — statuses, records, and informational gaps", () => {
  test("initially: derived steps pending/failed, ledger steps pending, procedure gaps listed", async () => {
    const v = await view();
    expect(v.entity.map((s) => s.id)).toEqual(["1", "2", "3", "4", "4.5", "4.6", "5"]);
    expect(v.group.map((s) => s.id)).toEqual(["1", "2", "3", "4", "4.5", "5"]);
    expect(v.entity.find((s) => s.id === "1")).toMatchObject({ status: "pending" });
    expect(v.entity.find((s) => s.id === "2")).toMatchObject({ status: "pending" });
    expect(v.entity.find((s) => s.id === "4")!.status).toBe("fail"); // nothing recorded yet
    expect(v.entity.find((s) => s.id === "5")).toMatchObject({ status: "pending" });
    expect(v.group.find((s) => s.id === "1")!.status).toBe("fail"); // entity decision absent
    expect(v.gaps.join("\n")).toContain("Kill Criteria");
    expect(v.gaps.join("\n")).toContain("IC 메모");
    // 2026-10-21 (decider): the procedure gaps ride the IC GO gap-rationale contract.
    const pkg = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    const goGaps = ((await pkg.json()).data as { gates: { go_gaps: string[] } }).gates.go_gaps;
    expect(goGaps.some((g) => g.includes("Kill Criteria"))).toBe(true);
    expect(goGaps.some((g) => g.includes("자금확정성"))).toBe(true);
    expect(v.kill_criteria.length).toBeGreaterThan(0);
    const procedures = new Set(v.kill_criteria.map((c) => c.procedure));
    expect(procedures.has("entity-ic-review")).toBe(true);
    expect(procedures.has("greenfield-dd")).toBe(true); // greenfield track
    expect([...procedures].some((p) => p.startsWith("brownfield"))).toBe(false);
  });

  test("step 2: an unknown key, a missing verdict and a viewer are refused; a full pass/fail record lands", async () => {
    const v0 = await view();
    const keys = v0.kill_criteria.map((c) => c.key);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts: { "zz:1": "pass" } } }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts: Object.fromEntries(keys.slice(1).map((k) => [k, "pass"])) } }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts: Object.fromEntries(keys.map((k) => [k, "pass"])) } }, viewerCookie))).status).toBe(403);

    const withFail = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? "fail" : "pass"]));
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts: withFail } }))).status).toBe(201);
    expect((await view()).entity.find((s) => s.id === "2")).toMatchObject({ status: "fail" });

    const allPass = Object.fromEntries(keys.map((k) => [k, "pass"]));
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts: allPass } }))).status).toBe(201);
    const v = await view();
    expect(v.entity.find((s) => s.id === "2")).toMatchObject({ status: "pass" });
    expect(v.gaps.join("\n")).not.toContain("Kill Criteria");
    expect(v.kill_criteria.every((c) => c.verdict === "pass")).toBe(true);
  });

  test("step 4 is a derived fact: unbalanced then evidenced financing flips it to pass; a person can confirm the record", async () => {
    const add = (body: Record<string, unknown>) => req(`/api/projects/${projectId}/deal-structure`, json({ action: "add_financing_entry", ...body }));
    expect((await add({ kind: "source", name: "자기자본", amount_krw_m: 500 })).status).toBe(201);
    expect((await add({ kind: "source", name: "차입", amount_krw_m: 500 })).status).toBe(201);
    expect((await add({ kind: "use", name: "설비투자", amount_krw_m: 1000 })).status).toBe(201);
    let v = await view();
    expect(v.financing.balanced).toBe(true);
    expect(v.entity.find((s) => s.id === "4")!.status).toBe("fail"); // balanced but both sources unevidenced
    expect(v.gaps.join("\n")).toContain("증빙 없는 조달 2건");

    // kind without a reference is not evidence
    expect((await add({ kind: "source", name: "보조금", amount_krw_m: 0, evidence_kind: "subsidy_grant" })).status).toBe(400);

    // replace the unevidenced lines with evidenced ones
    const ds = await req(`/api/projects/${projectId}/deal-structure`, { headers: { cookie: analystCookie } });
    const entries = ((await ds.json()).data as { financing: { entries: Array<{ id: string; kind: string; evidence_ref: string | null }> } }).financing.entries;
    for (const e of entries.filter((x) => x.kind === "source" && !x.evidence_ref)) {
      expect((await req(`/api/projects/${projectId}/deal-structure`, json({ action: "remove_financing_entry", entry_id: e.id }))).status).toBe(200);
    }
    expect((await add({ kind: "source", name: "차입", amount_krw_m: 500, evidence_kind: "commitment_letter", evidence_ref: "은행 커밋먼트 레터 2026-10-15" })).status).toBe(201);
    expect((await add({ kind: "source", name: "자기자본", amount_krw_m: 500, evidence_kind: "internal_approval", evidence_ref: "이사회 결의 #12" })).status).toBe(201);
    v = await view();
    expect(v.financing).toMatchObject({ balanced: true, all_sources_evidenced: true, unevidenced_lines: 0 });
    expect(v.entity.find((s) => s.id === "4")!.status).toBe("pass");

    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "4", evidence_ref: "증빙 일괄 확인" }))).status).toBe(201);
    v = await view();
    expect(v.entity.find((s) => s.id === "4")).toMatchObject({ status: "pass" });
    expect(v.entity.find((s) => s.id === "4")!.detail.confirmed).toBe(true);
    const pkg = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    const deal = ((await pkg.json()).data as { deal_structure: { financing: { certainty: { all_sources_evidenced: boolean } } } }).deal_structure;
    expect(deal.financing.certainty.all_sources_evidenced).toBe(true);
  });

  test("step 3: snapshot_ic_memo records a hash-stamped memo; step 4.5 needs substance; derived steps are refused", async () => {
    const res = await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "snapshot_ic_memo", note: "1차 검토용" }));
    expect(res.status).toBe(201);
    const row = (await res.json()).data as { status: string; payload_json: string };
    expect(row.status).toBe("recorded");
    const payload = JSON.parse(row.payload_json) as { snapshot_hash: string; kill_criteria: unknown; risk_heatmap: { snapshot_hash: string } };
    expect(payload.snapshot_hash).toHaveLength(16);
    expect(payload.risk_heatmap.snapshot_hash).toHaveLength(16);

    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "4.5", payload: { note: "짧음" } }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "4.5", payload: { note: "재무·기술·리스크 차원을 통합해 검토했다" } }))).status).toBe(201);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "1" }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "entity-ic-review", step_id: "5" }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "record", procedure: "unknown-procedure", step_id: "2" }))).status).toBe(400);

    const v = await view();
    expect(v.entity.find((s) => s.id === "3")).toMatchObject({ status: "recorded" });
    expect(v.entity.find((s) => s.id === "4.5")).toMatchObject({ status: "recorded" });
    expect(v.gaps).toEqual([]);
    const pkg = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    const steps = ((await pkg.json()).data as { ic_steps: { entity: Array<{ status: string }>; procedure_gaps: string[] } }).ic_steps;
    expect(steps.procedure_gaps).toEqual([]);
    expect(steps.entity.filter((s) => s.status === "recorded" || s.status === "pass").length).toBeGreaterThanOrEqual(4); // 2·3·4·4.5
  });

  test("step 4.5 draft is a non-persisted LLM/fallback proposal; step 4.6 attaches the hashed briefing pack as the decision deck", async () => {
    const before = db.query("SELECT COUNT(*) AS c FROM ic_review_step_record WHERE project_id = ?").get(projectId) as { c: number };
    const draft = await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "draft_insight_review" }));
    expect(draft.status).toBe(200);
    const d = (await draft.json()).data as { source: string; draft: { synthesis: string; open_questions: string[] } };
    expect(d.source).toBe("synthesis"); // CO_NEWBIZ_LLM_PROVIDER=none → deterministic fallback, no network
    expect(d.draft.synthesis).toContain("결정론 폴백");
    // nothing persisted by a draft
    expect((db.query("SELECT COUNT(*) AS c FROM ic_review_step_record WHERE project_id = ?").get(projectId) as { c: number }).c).toBe(before.c);
    expect((await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "draft_insight_review" }, viewerCookie))).status).toBe(403);

    const deck = await req(`/api/projects/${projectId}/ic-review-steps`, json({ action: "attach_decision_deck" }));
    expect(deck.status).toBe(201);
    const body = (await deck.json()).data as { pack_hash: string; pack: string; record: { step_id: string; evidence_ref: string; status: string } };
    expect(body.pack_hash).toHaveLength(16);
    expect(body.pack.length).toBeGreaterThan(50);
    expect(body.record).toMatchObject({ step_id: "4.6", status: "recorded", evidence_ref: `briefing-pack:${body.pack_hash}` });
    const v = await view();
    expect(v.entity.find((s) => s.id === "4.6")).toMatchObject({ status: "recorded" });
  });

  test("incentives carry their eligibility evidence (the S10 sources-side precondition)", async () => {
    const res = await req(`/api/projects/${projectId}/incentives`, json({ program_name: "지방투자촉진보조금", grantor: "충북", npv_value: 12, evidence_ref: "교부결정 통지 2026-10-15" }));
    expect(res.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/incentives`, { headers: { cookie: analystCookie } });
    const rows = ((await list.json()).data as { incentives: Array<{ program_name: string; evidence_ref: string | null }> }).incentives;
    expect(rows.find((r) => r.program_name === "지방투자촉진보조금")?.evidence_ref).toBe("교부결정 통지 2026-10-15");
  });
});
