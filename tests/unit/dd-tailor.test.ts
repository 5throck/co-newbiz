// @version 1.0.0
/**
 * S9 tailored DD checklists — ADR-0099 regression.
 *
 * Proves four things against the REAL route handlers (nextRequest harness,
 * business-case pattern) and the real scratch SQLite:
 *  (a) the deterministic default executor creates PROPOSED-only items with
 *      source_url = null and source_reliability = 'C' — no fabricated URLs
 *      or grades (ADR-0099 §6 honesty constraint);
 *  (b) boundary #2: proposals are NOT in project_checklist_item_state until
 *      the human approve — approve inserts the state row
 *      (checklist_id 'custom:<domain>') in the same transaction; viewer 403;
 *      a decided item cannot be re-decided;
 *  (c) S9 completion flips only when every applied item is judged AND
 *      mandatory-unmet is 0 — approved custom items count through the state
 *      table, proposed-only items never count and never block;
 *  (d) deny-by-default: a non-member gets 404 on all S9 routes.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-dd-tailor.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_DD_TAILOR_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { DD_WORKSPACE_CHECKLISTS, getChecklistItems } = await import("../../app/web-next/lib/library.ts");
const { makeTavilyDdTailorExecutor, getDdTailorExecutor } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1"; // project member (lead) — the human actor
const VIEWER = "viewer1"; // authenticated but viewer role
const OUTSIDER = "outsider1"; // authenticated analyst, NOT a project member
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";

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

  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "S9 테스트 기회", "반도체 테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "S9 test promoter" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function customItems() {
  return db
    .query("SELECT * FROM project_checklist_item_custom WHERE project_id = ? ORDER BY created_at, id")
    .all(projectId) as Array<{
    id: string;
    domain: string;
    item_label: string;
    source_url: string | null;
    source_reliability: string | null;
    proposed_by_agent: string | null;
    status: string;
  }>;
}

describe("Wave D Tavily provenance executor", () => {
  test("attaches real source URLs from the injected Tavily searcher without approving proposals", async () => {
    const executor = makeTavilyDdTailorExecutor(async () => [
      { title: "Regulator", url: "https://example.gov/industry-risk", snippet: "regulatory update" },
      { title: "Research", url: "https://www.reuters.com/markets/example", snippet: "market update" },
    ]);
    const drafts = await executor("commercial", { projectId, industry: "반도체 테스트 산업" });
    expect(drafts.length).toBeGreaterThanOrEqual(5);
    expect(drafts[0].sourceUrl).toBe("https://example.gov/industry-risk");
    expect(drafts[0].sourceReliability).toBe("A");
    expect(drafts[1].sourceUrl).toBe("https://www.reuters.com/markets/example");
    expect(drafts[1].sourceReliability).toBe("B");
  });

  test("tavily mode remains honest deterministic fallback when no Tavily key is configured", async () => {
    const prevMode = process.env.CO_NEWBIZ_DD_TAILOR_AGENTS;
    const prevKey = process.env.TAVILY_API_KEY;
    process.env.CO_NEWBIZ_DD_TAILOR_AGENTS = "tavily";
    process.env.TAVILY_API_KEY = "";
    const drafts = await getDdTailorExecutor()("legal", { projectId, industry: "반도체 테스트 산업" });
    expect(drafts.every((d) => d.sourceUrl === null && d.sourceReliability === "C")).toBe(true);
    process.env.CO_NEWBIZ_DD_TAILOR_AGENTS = prevMode;
    if (prevKey === undefined) process.env.TAVILY_API_KEY = ""; else process.env.TAVILY_API_KEY = prevKey;
  });
});

describe("S9 tailored DD checklists (ADR-0099)", () => {
  test("(a) default executor proposes honestly: proposed-only, no fabricated sources", async () => {
    const res = await req(`/api/projects/${projectId}/dd-checklist/tailor`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { runId, proposedCount } = (await res.json()).data as { runId: string; proposedCount: number };
    expect(runId).toBeTruthy();
    expect(proposedCount).toBeGreaterThanOrEqual(15); // 5–10 items × 3 domains

    const items = customItems();
    expect(items.length).toBeGreaterThanOrEqual(15);
    const byDomain = new Map<string, number>();
    for (const i of items) byDomain.set(i.domain, (byDomain.get(i.domain) ?? 0) + 1);
    for (const d of ["commercial", "technical", "legal"]) {
      expect(byDomain.get(d)).toBeGreaterThanOrEqual(5);
      expect(byDomain.get(d)).toBeLessThanOrEqual(10);
    }
    for (const item of items) {
      // Honesty constraint (ADR-0099 §6): unsourced, visibly lowest-confidence.
      expect(item.source_url).toBeNull();
      expect(item.source_reliability).toBe("C");
      // Proposed ONLY — the engine never approves its own proposal.
      expect(item.status).toBe("proposed");
      expect(item.approved_by).toBeNull();
    }
    // The chain ran with the ADR-0096 engine — auditable process_run rows.
    const run = db.query("SELECT entity_type, stage, status FROM process_run WHERE id = ?").get(runId) as {
      entity_type: string;
      stage: string;
      status: string;
    };
    expect(run.entity_type).toBe("project");
    expect(run.stage).toBe("s9_dd_checklist_tailoring");
    expect(run.status).toBe("done");

    // The industry label is interpolated from the promoting opportunity's
    // market scope when no project_industry binding exists.
    expect(items.some((i) => i.item_label.includes("반도체 테스트 산업"))).toBe(true);

    // The aggregate read surface exposes the proposals with provenance.
    const ws = await req(`/api/projects/${projectId}/dd`, { headers: { cookie: analystCookie } });
    expect(ws.status).toBe(200);
    const data = (await ws.json()).data as {
      domains: Array<{ domain: string; custom: Array<{ source_url: string | null; source_reliability: string | null; status: string }> }>;
      completion: { total: number };
    };
    expect(data.domains.length).toBe(3);
    for (const d of data.domains) {
      expect(d.custom.length).toBeGreaterThanOrEqual(5);
      for (const c of d.custom) {
        expect(c.status).toBe("proposed");
        expect(c.source_url).toBeNull();
        expect(c.source_reliability).toBe("C");
      }
    }
    expect(data.completion.total).toBe(0);
  });

  test("(b) boundary #2: no state row until the human approves; approve+state is one transaction", async () => {
    // Before any approval: zero custom state rows.
    const customStateCount = () =>
      (db.query("SELECT COUNT(*) n FROM project_checklist_item_state WHERE checklist_id LIKE 'custom:%'").get() as { n: number }).n;
    expect(customStateCount()).toBe(0);

    const first = customItems().find((i) => i.domain === "commercial")!;
    const second = customItems().filter((i) => i.domain === "commercial")[1]!;

    // Viewer cannot approve — approval is a human analyst+ decision.
    const viewerRes = await req(`/api/projects/${projectId}/dd-checklist/tailor/${second.id}/review`, {
      method: "PUT",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(viewerRes.status).toBe(403);
    expect(customStateCount()).toBe(0);

    // Human analyst approves — status flip AND the state row, together.
    const res = await req(`/api/projects/${projectId}/dd-checklist/tailor/${first.id}/review`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);
    expect(customStateCount()).toBe(1);
    const row = db
      .query("SELECT checklist_id, item_id, status FROM project_checklist_item_state WHERE checklist_id LIKE 'custom:%'")
      .get() as { checklist_id: string; item_id: string; status: string };
    expect(row.checklist_id).toBe("custom:commercial");
    expect(row.item_id).toBe(first.id);
    expect(row.status).toBe("pending");
    const approved = db.query("SELECT status, approved_by FROM project_checklist_item_custom WHERE id = ?").get(first.id) as {
      status: string;
      approved_by: string;
    };
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe(ANALYST);

    // A decided item is never re-decided.
    const again = await req(`/api/projects/${projectId}/dd-checklist/tailor/${first.id}/review`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "rejected" }),
    });
    expect(again.status).toBe(404);

    // Reject records the reject with NO state row.
    const rej = await req(`/api/projects/${projectId}/dd-checklist/tailor/${second.id}/review`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "rejected" }),
    });
    expect(rej.status).toBe(200);
    expect(customStateCount()).toBe(1);
    expect((db.query("SELECT status FROM project_checklist_item_custom WHERE id = ?").get(second.id) as { status: string }).status).toBe("rejected");
  });

  test("(c) S9 completion: all judged AND mandatory unmet 0; proposed-only never counts", async () => {
    // Judging a proposal that was never approved is not possible — proposals
    // are not applied items.
    const proposal = customItems().find((i) => i.status === "proposed" && i.domain === "technical")!;
    const judgeProposal = await req(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ checklist_id: "custom:technical", item_id: proposal.id, status: "pass" }),
    });
    expect(judgeProposal.status).toBe(404);

    // Judge every standard item pass.
    for (const [, checklistId] of Object.entries(DD_WORKSPACE_CHECKLISTS)) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        const r = await req(`/api/projects/${projectId}/dd-checklist/state`, {
          method: "PUT",
          headers: { cookie: analystCookie },
          body: JSON.stringify({ checklist_id: checklistId, item_id: item.id, status: "pass" }),
        });
        expect(r.status).toBe(200);
      }
    }

    // Everything standard is judged, but the approved custom item is still
    // pending — S9 must NOT be complete, and the tailoring proposals (many,
    // still 'proposed') must neither block nor satisfy anything. S8 must be
    // satisfied first so the process evaluation actually reaches S9.
    const gen = await req(`/api/projects/${projectId}/business-case/generate`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(gen.status).toBe(201);
    const mid = evaluateProcess({ type: "project", id: projectId });
    expect(mid.completedStages).not.toContain("S9");
    expect(mid.currentStage).toBe("S9");
    expect(mid.requiredArtifacts.join(" ")).toContain("체크리스트");
    expect(customItems().filter((i) => i.status === "proposed").length).toBeGreaterThan(0);

    // Judge the approved custom item pass → S9 completes WITH proposals outstanding.
    const customId = (db.query("SELECT item_id FROM project_checklist_item_state WHERE checklist_id = 'custom:commercial'").get() as { item_id: string }).item_id;
    const done = await req(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ checklist_id: "custom:commercial", item_id: customId, status: "pass" }),
    });
    expect(done.status).toBe(200);
    const complete = evaluateProcess({ type: "project", id: projectId });
    expect(complete.completedStages).toContain("S9");

    // A fail without waiver on a MANDATORY item (approved custom items are
    // approved INTO the gate-relevant set) re-blocks S9 — 필수 미충족 0건.
    const failRes = await req(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ checklist_id: "custom:commercial", item_id: customId, status: "fail" }),
    });
    expect(failRes.status).toBe(200);
    const blocked = evaluateProcess({ type: "project", id: projectId });
    expect(blocked.completedStages).not.toContain("S9");
    expect(blocked.requiredArtifacts.join(" ")).toContain("필수 항목 해소");

    // Waiving the fail restores completion (the 0039/0006 waiver flow is reused).
    db.run(
      `INSERT OR IGNORE INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from)
       VALUES ('chk-commercial-dd-checklist', 'checklist', 'chk-commercial-dd-checklist', 'Commercial Due Diligence Checklist', 'shared', 'v1.0.0', 'mixed', 'commercial-dd-agent', 'checklists/commercial-dd-checklist.yaml', ?)`,
      [NOW],
    );
    db.run(
      `INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [ulid(), projectId, "chk-commercial-dd-checklist", "custom:commercial:" + customId, "test waiver", ANALYST, "lead", ANALYST, NOW, "2099-12-31T00:00:00Z", NOW],
    );
    const waiverId = (db.query("SELECT id FROM waiver WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as { id: string }).id;
    const waive = await req(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ checklist_id: "custom:commercial", item_id: customId, status: "waived", waiver_id: waiverId }),
    });
    expect(waive.status).toBe(200);
    expect(evaluateProcess({ type: "project", id: projectId }).completedStages).toContain("S9");
  });

  test("(d) deny-by-default: a non-member gets 404 on the S9 surface", async () => {
    for (const [path, init] of [
      [`/api/projects/${projectId}/dd`, { headers: { cookie: outsiderCookie } }],
      [`/api/projects/${projectId}/dd-checklist/tailor`, { method: "POST", headers: { cookie: outsiderCookie }, body: JSON.stringify({}) }],
      [`/api/projects/${projectId}/dd-checklist/state`, { method: "PUT", headers: { cookie: outsiderCookie }, body: JSON.stringify({ checklist_id: "x", item_id: "y", status: "pass" }) }],
    ] as const) {
      const res = await req(path, init as RequestInit);
      expect(res.status).toBe(404);
    }
    // Anonymous is rejected outright on the read.
    const anon = await req(`/api/projects/${projectId}/dd`);
    expect(anon.status).toBe(401);
  });
});
