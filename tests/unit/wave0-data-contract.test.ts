/**
 * Wave 0 data-contract routes (construction plan M1) — real scratch SQLite +
 * the nextRequest harness. Covers: role boundaries (viewer 403 on writes),
 * member visibility (outsider 404), validation 400s, provenance
 * (discovery_source), the public safe-share flow (create → access → log →
 * revoke → indistinguishable not_found), agent-runs transparency surface, and
 * the backtest honest-degradation path. ADR-0122/0123; data contract B1–B9.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-wave0.sqlite";
const NOW = "2026-09-12T10:00:00Z";
type Db = ReturnType<typeof GetDb>;
let db: Db;

const ANALYST = "wave0-analyst";
const VIEWER = "wave0-viewer";
let analystCookie = "";
let viewerCookie = "";
let projectId = "";
let opportunityId = "";

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

function count(sql: string, ...params: unknown[]): number {
  return (db.query(sql).get(...params) as { c: number }).c;
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

  // Seed: opportunity (S1–S3 complete, selected) → route → S5 → gates → promote.
  opportunityId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, "Wave0 기회", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
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
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
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
  projectId = promoteOpportunity(opportunityId, { promotedBy: ANALYST, needToKnowBasis: "wave0 test" }).project.id;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  }
});

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

describe("Wave 0 — antitrust / incentives / sites / permits / debt", () => {
  test("antitrust: POST creates (analyst), viewer 403, GET lists", async () => {
    const res = await req(`/api/projects/${projectId}/antitrust`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ market_definition: "로봇용 정밀 감속기", hhi_before: 1420, hhi_after: 1610 }),
    });
    expect(res.status).toBe(201);
    const viewer = await req(`/api/projects/${projectId}/antitrust`, {
      method: "POST", headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ market_definition: "x" }),
    });
    expect(viewer.status).toBe(403);
    const list = await req(`/api/projects/${projectId}/antitrust`, { headers: { cookie: analystCookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()).data.screenings as unknown[]).length).toBe(1);
    expect((await req(`/api/projects/${projectId}/antitrust`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" }, body: "{}",
    })).status).toBe(400);
  });

  test("incentives: POST matches legacy NOT NULL columns; GET lists", async () => {
    const res = await req(`/api/projects/${projectId}/incentives`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ program_name: "지방 이전 지원금", npv_value: 38, direction: "prospective" }),
    });
    expect(res.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/incentives`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.incentives as unknown[]).length).toBe(1);
  });

  test("sites: POST + ranked GET", async () => {
    const res = await req(`/api/projects/${projectId}/sites`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "A지구 산업단지", infra_score: 88, rank: 1 }),
    });
    expect(res.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/sites`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.sites as unknown[]).length).toBe(1);
  });

  test("permits: kind required; permit and certification land in separate lists", async () => {
    expect((await req(`/api/projects/${projectId}/permits`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    })).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/permits`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "permit", name: "산업단지 입주 승인", statutory_days: 30 }),
    })).status).toBe(201);
    expect((await req(`/api/projects/${projectId}/permits`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "certification", name: "ISO 9001" }),
    })).status).toBe(201);
    const list = await req(`/api/projects/${projectId}/permits`, { headers: { cookie: analystCookie } });
    const data = (await list.json()).data as { permits: unknown[]; certifications: unknown[] };
    expect(data.permits.length).toBe(1);
    expect(data.certifications.length).toBe(1);
  });

  test("debt: POST matches legacy schema (no audit-timestamp columns); GET lists instruments", async () => {
    const res = await req(`/api/projects/${projectId}/debt`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ principal: 450, rate: 5.1, rate_type: "floating" }),
    });
    expect(res.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/debt`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.instruments as unknown[]).length).toBe(1);
  });
});

describe("Wave 0 — interviews / customer-coc / comp-parity", () => {
  test("interviews: evidence_ref mandatory; roundtrip", async () => {
    expect((await req(`/api/projects/${projectId}/interviews`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ interviewee: "PM", topic: "t", response_summary: "r" }),
    })).status).toBe(400);
    const res = await req(`/api/projects/${projectId}/interviews`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ interviewee: "SI 업계 PM", topic: "수주 파이프라인", response_summary: "상승", evidence_ref: "interview-log#1" }),
    });
    expect(res.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/interviews`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.interviews as unknown[]).length).toBe(1);
  });

  test("customer-coc: direction validated; >=30% flagged", async () => {
    expect((await req(`/api/projects/${projectId}/customer-coc`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ counterparty: "K", direction: "partner" }),
    })).status).toBe(400);
    await req(`/api/projects/${projectId}/customer-coc`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ counterparty: "대형 유통 K", direction: "customer", coc_clause_present: true, concentration_pct: 34 }),
    });
    const list = await req(`/api/projects/${projectId}/customer-coc`, { headers: { cookie: analystCookie } });
    const row = ((await list.json()).data.contracts as Array<{ flagged: number }>)[0];
    expect(row.flagged).toBe(1);
  });

  test("comp-parity: GET returns aggregates (empty is honest)", async () => {
    const list = await req(`/api/projects/${projectId}/comp-parity`, { headers: { cookie: analystCookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()).data as { parity: unknown[] }).parity.length).toBe(0);
  });
});

describe("Wave 0 — target proposals (provenance A1/A2, opportunity-keyed)", () => {
  test("POST accepts with discovery_source; row carries provenance", async () => {
    const res = await req(`/api/brownfield/${opportunityId}/target-proposals`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "테스트중공업", discovery_source: "master_proposal" }),
    });
    expect(res.status).toBe(201);
    const row = db.query(
      "SELECT discovery_source, proposal_accepted_at FROM brownfield_target WHERE id = ?",
    ).get(((await res.json()).data as { id: string }).id) as { discovery_source: string; proposal_accepted_at: string };
    expect(row.discovery_source).toBe("master_proposal");
    expect(row.proposal_accepted_at).not.toBeNull();
    expect((await req(`/api/brownfield/${opportunityId}/target-proposals`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "x", discovery_source: "gpt_said_so" }),
    })).status).toBe(400);
  });

  // Regression (2라운드 회의): accept-proposal POST used to do its own inline
  // INSERT and never called createTarget() — so md_company/평가 기준 시딩,
  // which now lives inside createTarget(), would have silently never run on
  // this path even though it's the one the Universe-tab "확정" button uses.
  test("accept-proposal path also resolves md_company + seeds eval criteria (createTarget consolidation)", async () => {
    const res = await req(`/api/brownfield/${opportunityId}/target-proposals`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "웹검색확정테스트", discovery_source: "web_proposal" }),
    });
    expect(res.status).toBe(201);
    const mc = db.query("SELECT id FROM md_company WHERE name_ko = ?").get("웹검색확정테스트") as { id: string } | undefined;
    expect(mc).toBeTruthy();
    const criteria = db.query("SELECT COUNT(*) c FROM brownfield_eval_criterion WHERE opportunity_id = ? AND category = 'financial' AND source = 'builtin'").get(opportunityId) as { c: number };
    expect(criteria.c).toBe(3);
  });

  test("viewer POST is 403 (analyst+ floor)", async () => {
    const res = await req(`/api/brownfield/${opportunityId}/target-proposals`, {
      method: "POST", headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "뷰어시도", discovery_source: "manual" }),
    });
    expect(res.status).toBe(403);
  });

  // Regression: the route used to be keyed by PROJECT id and resolve the
  // opportunity through md_project.source_opportunity_id — so before S7→S8
  // promotion (exactly when S6 runs) GET always 404'd and POST failed with
  // not_promoted, and the /brownfield screen's proposal section was silently
  // empty. The opportunity-keyed route must work with no md_project row.
  test("works pre-promotion — no md_project row exists yet (S6 regression)", async () => {
    const preId = ulid();
    db.run(
      `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
         attractiveness_score, synergy_score, rationale, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [preId, "브라운필드 사전검증", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
    );
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
      [ulid(), preId, "brownfield", "test", ANALYST, NOW],
    );
    const list = await req(`/api/brownfield/${preId}/target-proposals`, { headers: { cookie: analystCookie } });
    expect(list.status).toBe(200);
    const post = await req(`/api/brownfield/${preId}/target-proposals`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "사전검증로봇", discovery_source: "web_proposal" }),
    });
    expect(post.status).toBe(201);
    const row = db.query("SELECT discovery_source FROM brownfield_target WHERE opportunity_id = ? AND company_name = ?")
      .get(preId, "사전검증로봇") as { discovery_source: string };
    expect(row.discovery_source).toBe("web_proposal");
    // duplicate registration is rejected (same company, not excluded)
    const dup = await req(`/api/brownfield/${preId}/target-proposals`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ company_name: "사전검증로봇", discovery_source: "manual" }),
    });
    expect(dup.status).toBe(400);
  });
});

describe("Wave 0 — agent runs transparency (read-only)", () => {
  test("GET returns runs; PROPOSAL count present; zero writes", async () => {
    const before = count("SELECT COUNT(*) c FROM gate_decision");
    const res = await req(`/api/projects/${projectId}/agent-runs`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { runs: unknown[]; proposals: number };
    expect(Array.isArray(data.runs)).toBe(true);
    expect(Array.isArray(data.proposals)).toBe(true);
    expect(count("SELECT COUNT(*) c FROM gate_decision")).toBe(before);
  });
});

describe("Wave 0 — safe-share flow (public access + log + revoke)", () => {
  let token = "";

  test("POST creates a link (analyst); viewer 403", async () => {
    const res = await req(`/api/projects/${projectId}/share-links`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "IC 요약", recipient: "재무 자문사 A", payload: { summary: "…" }, expires_in_days: 5 }),
    });
    expect(res.status).toBe(201);
    token = ((await res.json()).data as { token: string }).token;
    expect(token).not.toBe("");
    expect((await req(`/api/projects/${projectId}/share-links`, {
      method: "POST", headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "x", recipient: "y", payload: {} }),
    })).status).toBe(403);
  });

  test("public access grants + logs; revoke makes it indistinguishably dead", async () => {
    const pub = await req(`/api/share/${token}`);
    expect(pub.status).toBe(200);
    expect(((await pub.json()).data as { found: boolean }).found).toBe(true);
    expect(count("SELECT COUNT(*) c FROM share_access")).toBe(1);

    await req(`/api/projects/${projectId}/share-links?link_id=${(db.query("SELECT id FROM share_link WHERE token = ?").get(token) as { id: string }).id}`, {
      method: "DELETE", headers: { cookie: analystCookie },
    });
    const dead = await req(`/api/share/${token}`);
    expect(((await dead.json()).data as { found: boolean }).found).toBe(false);
  });
});

describe("Wave 0 — backtest (honest degradation) + comments", () => {
  test("backtest: adopted case without scorecard → insufficient_evidence, never fabricated", async () => {
    // Adopt requires a case; seed one + adopt so latestAdoption resolves.
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      ["bc-wave0", projectId, "greenfield_cost", "백테스트 케이스", 5, ANALYST, NOW],
    );
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "bc-wave0", "base", "p50", 5000, 0.14, "seed=42", NOW],
    );
    await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ model_id: "bc-wave0" }),
    });
    const res = await req(`/api/portfolio/backtest`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const rows = ((await res.json()).data as { rows: Array<{ project_id: string; status: string }> }).rows;
    const mine = rows.find((r) => r.project_id === projectId);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe("insufficient_evidence");
  });

  test("comments: project entity membership-gated; roundtrip", async () => {
    const post = await req(`/api/comments`, {
      method: "POST", headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ entity_type: "project", entity_id: projectId, body: "Group IC 보완 근거 확인 요청" }),
    });
    expect(post.status).toBe(201);
    const list = await req(`/api/comments?entity_type=project&entity_id=${projectId}`, { headers: { cookie: analystCookie } });
    expect(((await list.json()).data.comments as unknown[]).length).toBe(1);
  });
});
