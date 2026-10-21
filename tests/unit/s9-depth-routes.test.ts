/**
 * S9 depth slice (2026-10-21) — route + ledger contract over a real scratch
 * SQLite: management-package person entry (comp-parity/packages), interview
 * claims + cdd-07 triangulation, the risk-assessment ledger (0160) behind the
 * server-built heatmap (lib/risk-heatmap) and its IC-package snapshot,
 * covenant headroom from the latest simulation (S10 fin-03), the backtest
 * bias/kill corpus, and the confidence grade adjustment proposals (0161) that
 * lower — never raise — the RAG data-confidence cap. ADR-0122 #2, ADR-0123 #3.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { approvedConfidenceAdjustment } from "../../db/lib/rag-service.ts";
import { stageArtifactDefsFor } from "../../app/web-next/lib/review/stage-artifacts.ts";
import { buildRiskHeatmap, heatmapSnapshot } from "../../app/web-next/lib/risk-heatmap.ts";
import { covenantHeadroom } from "../../app/web-next/lib/covenant-headroom.ts";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none"; // draft routes must not call a real provider in tests
const TEST_DB_PATH = "db/data/test-s9-depth.sqlite";
const NOW = "2026-10-21T10:00:00Z";
type Db = ReturnType<typeof GetDb>;
let db: Db;

const ANALYST = "s9depth-analyst";
const APPROVER = "s9depth-approver";
const VIEWER = "s9depth-viewer";
let analystCookie = "";
let approverCookie = "";
let viewerCookie = "";
let projectId = "";

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

function count(sql: string, ...params: unknown[]): number {
  return (db.query(sql).get(...(params as string[])) as { c: number }).c;
}
function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
const json = (cookie: string, body: unknown, method = "POST") => ({ method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

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
  await createUser(db, { userId: APPROVER, role: "analyst", password: "pw-approver-1234", createdBy: "test", now: NOW });
  approveUser(db, { userId: APPROVER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string, password: string): Promise<string> => {
    const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login(ANALYST, "pw-analyst-12345");
  viewerCookie = await login(VIEWER, "pw-viewer-12345");
  approverCookie = await login(APPROVER, "pw-approver-1234");

  const opportunityId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, "S9 depth 기회", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
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
  projectId = promoteOpportunity(opportunityId, { promotedBy: ANALYST, needToKnowBasis: "s9 depth test" }).project.id;
  // The approver is a project member so project-scope decisions resolve (visibleProject).
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, APPROVER, "member", ANALYST, NOW, "two-person approval test"],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  }
});

describe("comp-parity/packages — management incentive package person entry (ma-04~06)", () => {
  test("valid package 201 + audited; GET lists it", async () => {
    const res = await req(`/api/projects/${projectId}/comp-parity/packages`, json(analystCookie, {
      executive_ref: "ceo-01", role_title: "대표이사", base_pay: 300_000_000, coc_trigger: true, coc_payout_estimate: 600_000_000,
      accelerated_vesting: true, non_compete_months: 24, flight_risk: "high", evidence_ref: "임원 계약서 §7",
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ executive_ref: "CEO-01", coc_trigger: true });
    expect(count("SELECT COUNT(*) AS c FROM management_package WHERE project_id = ?", projectId)).toBe(1);
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'management_package.recorded'")).toBe(1);
    const list = await req(`/api/projects/${projectId}/comp-parity`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.management_packages as unknown[]).length).toBe(1);
  });

  test("real-name refs, a CoC trigger without a payout, and viewers are refused", async () => {
    expect((await req(`/api/projects/${projectId}/comp-parity/packages`, json(analystCookie, { executive_ref: "홍길동", role_title: "CFO", base_pay: 1 }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/comp-parity/packages`, json(analystCookie, { executive_ref: "CFO-02", role_title: "CFO", base_pay: 1, coc_trigger: true }))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/comp-parity/packages`, json(viewerCookie, { executive_ref: "CFO-02", role_title: "CFO", base_pay: 1 }))).status).toBe(403);
  });
});

describe("interviews — claim + cdd-07 triangulation", () => {
  test("two distinct interviewees on one claim triangulate; an unclaimed interview is counted separately", async () => {
    for (const [who, claim] of [["A 전문가", "상위 고객 이탈 위험 낮음"], ["B 채널", "상위 고객 이탈 위험 낮음"], ["C 전문가", null]] as const) {
      const res = await req(`/api/projects/${projectId}/interviews`, json(analystCookie, { interviewee: who, topic: "고객", response_summary: "요지", evidence_ref: `log#${who}`, claim }));
      expect(res.status).toBe(201);
    }
    const list = await req(`/api/projects/${projectId}/interviews`, { headers: { cookie: analystCookie } });
    const tri = (await list.json()).data.triangulation as { claims: Array<{ claim: string; independent_sources: number; triangulated: boolean }>; unclaimed: number; triangulated_count: number };
    expect(tri.unclaimed).toBe(1);
    expect(tri.triangulated_count).toBe(1);
    expect(tri.claims[0]).toMatchObject({ claim: "상위 고객 이탈 위험 낮음", independent_sources: 2, triangulated: true });
  });
});

describe("risk heatmap — server builder, assessment ledger, IC snapshot", () => {
  let findingId = "";

  test("a negative-impact finding plots high (2×3) with no assessment", async () => {
    const f = await req(`/api/projects/${projectId}/dd/findings`, json(analystCookie, { category: "법무", description: "우발채무 소송", value_impact: -120, evidence_ref: "dd#1" }));
    expect(f.status).toBe(201);
    findingId = (await f.json()).data.id as string;
    const res = await req(`/api/projects/${projectId}/risk-heatmap`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const hm = (await res.json()).data as ReturnType<typeof buildRiskHeatmap>;
    const item = hm.items.find((i) => i.key === `dd:${findingId}`);
    expect(item).toMatchObject({ source: "dd", likelihood: 2, impact: 3, severity: "high", assessed: false, mitigation: null });
    expect(hm.counts.high).toBe(1);
    expect(hm.grid[1][2]).toBe(1);
    expect(hm.covenant_status).toBe("insufficient_evidence");
    expect(hm.snapshot_hash).toHaveLength(16);
    // 판정 대기 스트립 — sources_status names what is on record and what is missing (2026-10-21 decider).
    const st = Object.fromEntries(hm.sources_status.map((s) => [s.source, s]));
    expect(st.dd).toMatchObject({ recorded: 1, plotted: 1, href: "/dd", hint: null });
    expect(st.coc).toMatchObject({ recorded: 0, plotted: 0, href: "/customer-coc" });
    expect(st.coc.hint).toContain("고객 CoC");
    expect(st.inc.recorded).toBe(0);
    expect(st.cov).toMatchObject({ recorded: 0, plotted: 0, href: "/debt" });
    expect(st.cov.hint).toContain("차입 기록");
  });

  test("PUT appends a ledger row with mitigation, refreshes the sidecar, and the heatmap shows the person's value", async () => {
    const key = `dd:${findingId}`;
    const put = await req(`/api/projects/${projectId}/risk-assessment`, json(analystCookie, { key, likelihood: 1, impact: 2, mitigation: "보증보험 가입으로 노출 상한" }, "PUT"));
    expect(put.status).toBe(201);
    expect(count("SELECT COUNT(*) AS c FROM risk_assessment_ledger WHERE project_id = ? AND item_key = ?", projectId, key)).toBe(1);

    const before = buildRiskHeatmap(db, projectId).snapshot_hash;
    const again = await req(`/api/projects/${projectId}/risk-assessment`, json(analystCookie, { key, likelihood: 3, impact: 3 }, "PUT"));
    expect(again.status).toBe(201);
    const get = await req(`/api/projects/${projectId}/risk-assessment?key=${encodeURIComponent(key)}`, { headers: { cookie: analystCookie } });
    const body = (await get.json()).data as { overrides: Record<string, { likelihood: number; impact: number; mitigation: string | null }>; history: unknown[] };
    expect(body.history).toHaveLength(2);
    expect(body.overrides[key]).toMatchObject({ likelihood: 3, impact: 3, mitigation: null });

    const hm = buildRiskHeatmap(db, projectId);
    const item = hm.items.find((i) => i.key === key)!;
    expect(item).toMatchObject({ likelihood: 3, impact: 3, severity: "high", assessed: true, auto: { likelihood: 2, impact: 3 } });
    expect(hm.snapshot_hash).not.toBe(before);
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'risk_assessment.recorded'")).toBe(2);
  });

  test("cov: keys are accepted, bad keys 400, viewers 403", async () => {
    expect((await req(`/api/projects/${projectId}/risk-assessment`, json(analystCookie, { key: "cov:dscr", likelihood: 2, impact: 2 }, "PUT"))).status).toBe(201);
    expect((await req(`/api/projects/${projectId}/risk-assessment`, json(analystCookie, { key: "zzz:1", likelihood: 2, impact: 2 }, "PUT"))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/risk-assessment`, json(viewerCookie, { key: "dd:x", likelihood: 2, impact: 2 }, "PUT"))).status).toBe(403);
  });

  test("the IC package carries the same hash-stamped snapshot", async () => {
    const res = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { risk_heatmap: ReturnType<typeof heatmapSnapshot>; deal_structure: { covenant_headroom: { status: string } } };
    expect(data.risk_heatmap.snapshot_hash).toBe(buildRiskHeatmap(db, projectId).snapshot_hash);
    expect(data.risk_heatmap.top[0]).toMatchObject({ key: `dd:${findingId}`, severity: "high" });
    expect(data.deal_structure.covenant_headroom.status).toBe("insufficient_evidence");
  });
});

describe("covenant headroom — latest simulation's covenant_test rows", () => {
  test("no simulation → insufficient_evidence; a breached DSCR floor plots as a high cov: item", async () => {
    expect(covenantHeadroom(db, projectId)).toMatchObject({ status: "insufficient_evidence", reason: "no_simulation" });
    await req(`/api/projects/${projectId}/debt`, json(analystCookie, { lender: "은행", principal: 500, rate: 5, covenant_json: JSON.stringify({ DSCR_min: 1.3, NetLev_max: 3.5 }) }));
    const runId = ulid();
    const simId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "sim", "h", ANALYST, NOW]);
    db.run("INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)", [simId, runId, 42, 1000, 0.08, NOW]);
    for (const [period, key, threshold, projected, breached] of [
      ["2027", "DSCR", 1.3, 1.45, 0], ["2028", "DSCR", 1.3, 1.25, 1], ["2027", "NetLev", 3.5, 3.2, 0], ["2028", "NetLev", 3.5, 3.4, 0],
    ] as const) {
      db.run("INSERT INTO covenant_test (simulation_id, period_id, covenant_key, threshold, projected_value, breached) VALUES (?,?,?,?,?,?)", [simId, period, key, threshold, projected, breached]);
    }
    const view = covenantHeadroom(db, projectId);
    expect(view.status).toBe("computed");
    const dscr = view.covenants.find((c) => c.covenant_key === "DSCR")!;
    expect(dscr).toMatchObject({ direction: "min", status: "breached", breached_periods: 1, periods: 2, tightest_period: "2028" });
    const lev = view.covenants.find((c) => c.covenant_key === "NetLev")!;
    expect(lev).toMatchObject({ direction: "max", status: "tight", breached_periods: 0 });
    expect(lev.min_headroom_pct).toBeCloseTo(0.0286, 3);

    const debt = await req(`/api/projects/${projectId}/debt`, { headers: { cookie: analystCookie } });
    expect(((await debt.json()).data.headroom as { status: string }).status).toBe("computed");
    const hm = buildRiskHeatmap(db, projectId);
    expect(hm.covenant_status).toBe("computed");
    expect(hm.items.find((i) => i.key === "cov:DSCR")).toMatchObject({ source: "cov", auto: { likelihood: 3, impact: 3 }, severity: "high" });
    expect(hm.items.find((i) => i.key === "cov:NetLev")).toMatchObject({ auto: { likelihood: 3, impact: 2 } });
    expect(hm.sources.cov).toBe(2);
  });
});

describe("review claim acks + project-gate confirmation snapshot (ADR-0182 §5 addendum)", () => {
  test("the tab's prefixed key ('gate:dd') is rejected; a stage-artifact key is accepted (2026-10-21 save-fix regression)", async () => {
    // Regression: ReviewBuckets tab keys are 'gate:<id>' — sending the prefix raw made every save 400.
    expect((await req(`/api/projects/${projectId}/review-acks`, json(analystCookie, { gate: "gate:dd", claim: "c0", acked: true }))).status).toBe(400);
    const defs = stageArtifactDefsFor("S9");
    expect(defs.length).toBeGreaterThan(0);
    const artifactKey = `stage:S9:${defs[0].index}`;
    expect((await req(`/api/projects/${projectId}/review-acks`, json(analystCookie, { gate: artifactKey, claim: "산출물 항목 확인", acked: true }))).status).toBe(201);
    const list = await req(`/api/projects/${projectId}/review-acks?gate=${encodeURIComponent(artifactKey)}`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data as { acks: Array<{ claim: string; acked: boolean }> }).acks).toMatchObject([{ claim: "산출물 항목 확인", acked: true }]);
  });

  test("toggle → append-only rows, latest wins, audit per row; viewer 403; bad gate 400", async () => {
    expect((await req(`/api/projects/${projectId}/review-acks?gate=dd`, { headers: { cookie: analystCookie } })).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/review-acks?gate=bogus`, { headers: { cookie: analystCookie } })).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/review-acks`, json(viewerCookie, { gate: "dd", claim: "c1", acked: true }))).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/review-acks`, json(analystCookie, { gate: "dd", claim: "c1", acked: true }))).status).toBe(201);
    expect((await req(`/api/projects/${projectId}/review-acks`, json(analystCookie, { gate: "dd", claim: "c1", acked: false }))).status).toBe(201);
    expect((await req(`/api/projects/${projectId}/review-acks`, json(analystCookie, { gate: "dd", claim: "c2", acked: true }))).status).toBe(201);
    const list = await req(`/api/projects/${projectId}/review-acks?gate=dd`, { headers: { cookie: analystCookie } });
    const acks = ((await list.json()).data as { acks: Array<{ claim: string; acked: boolean; by: string }> }).acks;
    expect(acks).toMatchObject([
      { claim: "c1", acked: false, by: ANALYST },
      { claim: "c2", acked: true, by: ANALYST },
    ]);
    expect(count("SELECT COUNT(*) AS c FROM review_claim_ack WHERE entity_type = 'project' AND entity_id = ? AND gate = 'dd'", projectId)).toBe(3);
    // gate='dd' rows only — the artifact-key regression test above added its own row under a different gate.
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'review_claim_ack.recorded' AND target LIKE '%:dd:%'")).toBe(3);
  });

  test("project gate decisions persist the confirmation snapshot (the dropped-field bug) and return it parsed", async () => {
    // HOLD — GO needs the S8–S10 stage prerequisites this scratch project does not have;
    // the confirmation snapshot rides any decision.
    const go = await req(`/api/projects/${projectId}/gate-decisions`, json(analystCookie, {
      gate: "entity_ic", decision: "hold", rationale: "테스트 결정", missing_artifacts: ["미완료 산출물"],
      judgement_confirmations: ["c1", "c1", "c2", ""],
    }));
    expect(go.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/gate-decisions`, { headers: { cookie: analystCookie } });
    const row = ((await list.json()).data as { history: Array<{ gate: string; judgement_confirmations: string[] }> }).history.find((h) => h.gate === "entity_ic");
    expect(row?.judgement_confirmations).toEqual(["c1", "c2"]);
  });
});

describe("S10 register lifecycle — delete + status change (2026-10-21 decider)", () => {
  test("site regulatory draft: deterministic fallback (no persistence) + viewer 403 + compose carries the new sections", async () => {
    const s = await req(`/api/projects/${projectId}/sites`, json(analystCookie, { name: "규제 검토 부지", address: "충북 청주시 청원구 OOO 123" }));
    expect(s.status).toBe(201);
    const siteId = ((await s.json()).data.site as { id: string }).id;
    const before = count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'site_regulatory_draft.generate'");
    const draft = await req(`/api/projects/${projectId}/sites/regulatory-draft`, json(analystCookie, { site_id: siteId }));
    expect(draft.status).toBe(200);
    const d = (await draft.json()).data as { source: string; draft: { synthesis: string; items: Array<{ area: string }> } };
    expect(d.source).toBe("synthesis");
    expect(d.draft.synthesis).toContain("결정론 폴백");
    expect(d.draft.items.length).toBeGreaterThan(0);
    expect((await req(`/api/projects/${projectId}/sites/regulatory-draft`, json(viewerCookie, { site_id: siteId }))).status).toBe(403);
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'site_regulatory_draft.generate'")).toBe(before + 1);
    // cleanup — later suites assert on the sites list
    await req(`/api/projects/${projectId}/sites?id=${encodeURIComponent(siteId)}`, { method: "DELETE", headers: { cookie: analystCookie } });
    const compose = await req(`/api/projects/${projectId}/reports/compose`, { method: "POST", headers: { cookie: analystCookie } });
    expect(compose.status).toBe(200);
    const c = (await compose.json()).data as { sections: string[]; content_md: string };
    for (const sec of ["리스크 히트맵", "자금 확정성·커버넌트", "인허가·인증 현황", "마일스톤", "투자심사 절차 상태"]) {
      expect(c.sections).toContain(sec);
    }
    expect(c.content_md).toContain("## 8. 리스크 히트맵 요약");
  });

  test("incentives: create two, delete one, direction change, audit; viewer 403", async () => {
    const a = await req(`/api/projects/${projectId}/incentives`, json(analystCookie, { program_name: "보조금 A", npv_value: 5, evidence_ref: "교부결정" }));
    const b = await req(`/api/projects/${projectId}/incentives`, json(analystCookie, { program_name: "보조금 B", npv_value: 7 }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const idA = ((await a.json()).data as { id: string }).id;
    expect((await req(`/api/projects/${projectId}/incentives`, json(analystCookie, { id: idA, direction: "granted" }, "PUT"))).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/incentives`, json(viewerCookie, { id: idA, direction: "granted" }, "PUT"))).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/incentives?id=${idA}`, { method: "DELETE", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/incentives?id=${idA}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    const list = await req(`/api/projects/${projectId}/incentives`, { headers: { cookie: analystCookie } });
    const rows = ((await list.json()).data as { incentives: Array<{ program_name: string; direction: string }> }).incentives;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ program_name: "보조금 B" });
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action IN ('incentive.deleted','incentive.direction_changed')")).toBe(2);
  });

  test("permits: create, status change, delete (critical-path edges cleaned), certifications likewise", async () => {
    const p = await req(`/api/projects/${projectId}/permits`, json(analystCookie, { kind: "permit", name: "건축허가" }));
    const pid = ((await p.json()).data as { id: string }).id;
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [pid, pid]);
    expect((await req(`/api/projects/${projectId}/permits`, json(analystCookie, { kind: "permit", id: pid, status: "submitted" }, "PUT"))).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/permits`, json(analystCookie, { kind: "permit", id: pid, status: "in_progress" }, "PUT"))).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/permits?kind=permit&id=${pid}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    expect(count("SELECT COUNT(*) AS c FROM permit WHERE project_id = ? AND id = ?", projectId, pid)).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM permit_edge WHERE from_permit_id = ?", pid)).toBe(0);
    const c = await req(`/api/projects/${projectId}/permits`, json(analystCookie, { kind: "certification", name: "ISO 9001" }));
    const cid = ((await c.json()).data as { id: string }).id;
    expect((await req(`/api/projects/${projectId}/permits`, json(analystCookie, { kind: "certification", id: cid, status: "granted" }, "PUT"))).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/permits?kind=certification&id=${cid}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    expect(count("SELECT COUNT(*) AS c FROM certification WHERE project_id = ? AND id = ?", projectId, cid)).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'permit.status_changed' OR action LIKE 'certification.%'")).toBeGreaterThanOrEqual(2);
  });

  test("sites: create two, delete one; the other survives", async () => {
    const a = await req(`/api/projects/${projectId}/sites`, json(analystCookie, { name: "부지 A", infra_score: 80 }));
    const b = await req(`/api/projects/${projectId}/sites`, json(analystCookie, { name: "부지 B", infra_score: 60 }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const idA = ((await a.json()).data.site as { id: string }).id;
    expect((await req(`/api/projects/${projectId}/sites?id=${idA}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    const list = await req(`/api/projects/${projectId}/sites`, { headers: { cookie: analystCookie } });
    const rows = ((await list.json()).data as { sites: Array<{ name: string }> }).sites;
    expect(rows.map((r) => r.name)).toEqual(["부지 B"]);
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'site.deleted' AND target LIKE ?", `${projectId}:%`)).toBe(2); // 부지 A + 규제 검토 부지(초안 테스트 정리)
  });
});

describe("report snapshot lifecycle — body reopen + archive (2026-10-21 decider)", () => {
  let sid = "";
  test("save (no render) → single GET returns markdown → archive hides it from the list, ?archived=1 surfaces it", async () => {
    const save = await req(`/api/projects/${projectId}/reports`, json(analystCookie, { title: "초안 1", content_md: "# 초안\n\n내용", formats: [] }));
    expect(save.status).toBe(201);
    sid = ((await save.json()).data as { snapshot: { id: string } }).snapshot.id;
    const one = await req(`/api/projects/${projectId}/reports/${sid}`, { headers: { cookie: analystCookie } });
    expect(one.status).toBe(200);
    expect(((await one.json()).data as { content_md: string }).content_md).toContain("# 초안");
    let list = await req(`/api/projects/${projectId}/reports`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data as { reports: unknown[] }).reports).toHaveLength(1);
    expect((await req(`/api/projects/${projectId}/reports/${sid}`, { method: "DELETE", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/reports/${sid}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    list = await req(`/api/projects/${projectId}/reports`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data as { reports: unknown[] }).reports).toHaveLength(0);
    list = await req(`/api/projects/${projectId}/reports?archived=1`, { headers: { cookie: analystCookie } });
    const archived = ((await list.json()).data as { reports: Array<{ id: string; archived_at: string | null }> }).reports;
    expect(archived.find((r) => r.id === sid)?.archived_at).toBeTruthy();
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'report_snapshot.archived'")).toBe(1);
  });
});

describe("milestones — person-managed schedule (2026-10-21 decider)", () => {
  test("create → derived status → done toggle → delete; summary counts; viewer 403; no confirmed baseline → import 400", async () => {
    expect((await req(`/api/projects/${projectId}/milestones?summary=1`, { headers: { cookie: analystCookie } })).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/milestones`, json(viewerCookie, { title: "x", due_date: "2027-03-01" }))).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/milestones`, json(analystCookie, { title: "잘못된 기한", due_date: "2027-3-1" }))).status).toBe(400);
    const m = await req(`/api/projects/${projectId}/milestones`, json(analystCookie, { title: "상위 고객 계약 갱신", category: "contract", due_date: "2027-01-10", owner: "영업" }));
    expect(m.status).toBe(201);
    const mid = ((await m.json()).data as { id: string }).id;
    let list = await req(`/api/projects/${projectId}/milestones`, { headers: { cookie: analystCookie } });
    let data = (await list.json()).data as { milestones: Array<{ id: string; status: string; days_to_due: number | null }>; summary: { total: number; open: number; done: number; overdue: number; due_soon: number } };
    const row = data.milestones.find((x) => x.id === mid)!;
    expect(["overdue", "due_soon", "planned"]).toContain(row.status);
    expect(row.days_to_due).not.toBeNull();
    expect(data.summary.total).toBe(1);

    expect((await req(`/api/projects/${projectId}/milestones/${mid}`, json(analystCookie, { done: true }, "PUT"))).status).toBe(200);
    list = await req(`/api/projects/${projectId}/milestones`, { headers: { cookie: analystCookie } });
    data = (await list.json()).data as typeof data;
    expect(data.milestones.find((x) => x.id === mid)!.status).toBe("done");
    expect(data.summary.done).toBe(1);

    // import: no confirmed baseline → 400 with guidance (idempotent source stays empty)
    const imp = await req(`/api/projects/${projectId}/milestones/import-baseline`, { method: "POST", headers: { cookie: analystCookie } });
    expect(imp.status).toBe(400);
    expect(((await imp.json()) as { error: { message: string } }).error.message).toContain("실행 기준선");

    expect((await req(`/api/projects/${projectId}/milestones/${mid}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(200);
    expect((await req(`/api/projects/${projectId}/milestones/${mid}`, { method: "DELETE", headers: { cookie: analystCookie } })).status).toBe(404);
    expect(count("SELECT COUNT(*) AS c FROM project_milestone WHERE project_id = ?", projectId)).toBe(0);
  });
});

describe("confidence grade adjustment proposals — proposed, human-approved, cap only tightens", () => {
  let proposalId = "";

  test("propose (org, C) → listed as proposed with bias; viewer 403; short rationale 400", async () => {
    expect((await req(`/api/portfolio/backtest/proposals`, json(viewerCookie, { action: "propose", scope: "org", proposed_grade: "C", rationale: "viewer cannot propose" }))).status).toBe(403);
    expect((await req(`/api/portfolio/backtest/proposals`, json(analystCookie, { action: "propose", scope: "org", proposed_grade: "C", rationale: "short" }))).status).toBe(400);
    const res = await req(`/api/portfolio/backtest/proposals`, json(analystCookie, { action: "propose", scope: "org", proposed_grade: "C", rationale: "과대 예측 편향 — 시장 전망 가정의 체계적 낙관" }));
    expect(res.status).toBe(201);
    proposalId = (await res.json()).data.id as string;
    expect(approvedConfidenceAdjustment(db, projectId)).toBeNull();
    const list = await req(`/api/portfolio/backtest/proposals`, { headers: { cookie: analystCookie } });
    const data = (await list.json()).data as { proposals: Array<{ id: string; status: string }>; bias: { direction: string } };
    expect(data.proposals.find((p) => p.id === proposalId)?.status).toBe("proposed");
    expect(data.bias.direction).toBe("insufficient_evidence");
  });

  test("approve by a DIFFERENT person → the adjustment applies (C); self-decision and a second decision are refused; a later project-scope B cannot loosen it", async () => {
    expect((await req(`/api/portfolio/backtest/proposals`, json(approverCookie, { action: "approve", id: proposalId, decision_rationale: "ok" }))).status).toBe(400);
    const self = await req(`/api/portfolio/backtest/proposals`, json(analystCookie, { action: "approve", id: proposalId, decision_rationale: "스스로 승인 시도" }));
    expect(self.status).toBe(400);
    expect(((await self.json()) as { error: { code: string } }).error.code).toBe("self_decision_not_allowed");
    const ok = await req(`/api/portfolio/backtest/proposals`, json(approverCookie, { action: "approve", id: proposalId, decision_rationale: "편향 근거 확인 — 캡 하향 승인" }));
    expect(ok.status).toBe(200);
    expect(approvedConfidenceAdjustment(db, projectId)).toBe("C");
    expect((await req(`/api/portfolio/backtest/proposals`, json(approverCookie, { action: "reject", id: proposalId, decision_rationale: "다시 결정 시도" }))).status).toBe(400);

    const second = await req(`/api/portfolio/backtest/proposals`, json(analystCookie, { action: "propose", scope: "project", project_id: projectId, proposed_grade: "B", rationale: "프로젝트 단위 완화 시도 — 허용되지 않아야 함" }));
    expect(second.status).toBe(201);
    expect((await req(`/api/portfolio/backtest/proposals`, json(approverCookie, { action: "approve", id: (await second.json()).data.id, decision_rationale: "프로젝트 B 승인" }))).status).toBe(200);
    expect(approvedConfidenceAdjustment(db, projectId)).toBe("C");
    expect(count("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'confidence_grade_adjustment.%'")).toBe(4);
  });
});

describe("backtest — bias + kill-with-learning corpus (runs last: it closes the project)", () => {
  test("org bias is insufficient_evidence with one deal; a killed deal stays in the corpus labelled killed", async () => {
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      ["bc-s9depth", projectId, "greenfield_cost", "백테스트 케이스", 5, ANALYST, NOW],
    );
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "bc-s9depth", "base", "p50", 5000, 0.14, "seed=42", NOW],
    );
    const adopt = await req(`/api/projects/${projectId}/business-case/adopt`, json(analystCookie, { model_id: "bc-s9depth", goals_ack: { acknowledged: true, note: "test" } }));
    expect(adopt.status).toBeLessThan(300);
    let res = await req(`/api/portfolio/backtest`, { headers: { cookie: analystCookie } });
    let data = (await res.json()).data as { rows: Array<{ project_id: string; corpus: string; status: string }>; org: { bias: { direction: string }; killed_in_corpus: number } };
    expect(data.rows.find((r) => r.project_id === projectId)).toMatchObject({ corpus: "active", status: "insufficient_evidence" });
    expect(data.org.bias.direction).toBe("insufficient_evidence");
    expect(data.org.killed_in_corpus).toBe(0);

    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "recorder", "h", ANALYST, NOW]);
    db.run(
      `INSERT INTO venture_transition_decision (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), runId, projectId, "2026-Q4", "kill_with_learning_captured", "venture-portfolio-ic", NOW, "시장 축소", "진입 시점 가정이 낙관적이었다", NOW],
    );
    db.run("UPDATE md_project SET closed_at = ? WHERE id = ?", [NOW, projectId]);
    res = await req(`/api/portfolio/backtest`, { headers: { cookie: analystCookie } });
    data = (await res.json()).data as typeof data;
    expect(data.rows.find((r) => r.project_id === projectId)?.corpus).toBe("killed");
    expect(data.org.killed_in_corpus).toBe(1);
  });
});
