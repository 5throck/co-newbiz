/**
 * Unit tests for the company competitor registry (ADR-0142, design
 * 2026-09-18-company-competitor-registry-design):
 *  - AI proposal accept and manual register are the ONLY paths that create a
 *    confirmed row, both recording discovery_source + proposal_accepted_at;
 *  - accepting an ai_proposal snapshots the payload cross-check verdict;
 *  - duplicates (excluding excluded rows) are rejected;
 *  - exclude requires a reason, restore works and refuses a name clash;
 *  - the stateless proposal list marks already-accepted names and maps
 *    cross-check verdicts by the "경쟁사 {name}:" claim prefix;
 *  - viewers get 403; every mutation writes an audit row.
 *
 * Real scratch SQLite + the real route handlers (nextRequest harness).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-company-competitor.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;
let viewerCookie: string;
let memberId: string;

function payloadWithCompetitors(): string {
  return JSON.stringify({
    methodology: "company-profile v3",
    schemaVersion: 3,
    profile: {
      companyName: "테스트 계열사",
      strengths: [], weaknesses: [], businessAssessment: "", industryExposure: [],
      researchSources: [{ title: "업체 보도자료", url: "https://example.com/press", snippet: "" }],
      dataSources: { dart: true, dartYear: "2025", webResearchCount: 2 },
      stepSummaries: [],
      competitive: {
        competitors: [
          { name: "경쟁사A", note: "직접 경쟁 [1]" },
          { name: "경쟁사B", note: "간접 경쟁" },
        ],
        positioning: "2위 그룹",
        crossCheck: {
          status: "cross_checked",
          checkedAt: NOW,
          claims: [
            { claim: "경쟁사 경쟁사A: 직접 경쟁 [1]", verdict: "confirmed", source: "dart+research", evidence: "사업보고서 원문 일치", url: "https://dart.example/rpt" },
            { claim: "경쟁사 경쟁사B: 간접 경쟁", verdict: "unverified", source: "research", evidence: "근거 미확보" },
          ],
        },
      },
    },
  });
}

async function createGroupAndMember(): Promise<string> {
  const g = await req("/api/our-company/groups", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ name: "테스트그룹" }),
  });
  expect([200, 201]).toContain(g.status);
  const groupId = ((await g.json()).data as { id: string }).id;
  const m = await req(`/api/our-company/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ company_name: "테스트 계열사", role: "affiliate" }),
  });
  expect([200, 201]).toContain(m.status);
  return ((await m.json()).data as { id: string }).id;
}

beforeAll(async () => {
  await createUser(db, { userId: "analyst-cc", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  await createUser(db, { userId: "viewer-cc", role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "analyst-cc", approvedBy: "test", now: NOW });
  approveUser(db, { userId: "viewer-cc", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("analyst-cc", "pw-analyst-12345");
  viewerCookie = await loginCookie("viewer-cc", "pw-viewer-12345");
  memberId = await createGroupAndMember();
  db.run(
    "INSERT INTO company_profile_version (id, member_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    ["cpv-1", memberId, 1, payloadWithCompetitors(), "analyst-cc", NOW],
  );
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

function auditCount(action: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
}

describe("competitor proposals (stateless, from payload)", () => {
  test("proposals map cross-check verdicts by claim prefix and mark nothing accepted initially", async () => {
    const res = await req(`/api/our-company/members/${memberId}/competitor-proposals`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const { proposals } = (await res.json()).data as { proposals: Array<{ name: string; verdict: string | null; accepted: boolean }> };
    expect(proposals).toHaveLength(2);
    const a = proposals.find((p) => p.name === "경쟁사A")!;
    expect(a.verdict).toBe("confirmed");
    expect(a.accepted).toBe(false);
    expect(a.evidence.some((e) => e.url === "https://dart.example/rpt")).toBe(true);
  });

  test("accepted names are marked in later proposal reads", async () => {
    await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "경쟁사B", discovery_source: "ai_proposal" }),
    });
    const res = await req(`/api/our-company/members/${memberId}/competitor-proposals`, { headers: { cookie: analystCookie } });
    const { proposals } = (await res.json()).data as { proposals: Array<{ name: string; accepted: boolean }> };
    expect(proposals.find((p) => p.name === "경쟁사B")!.accepted).toBe(true);
  });
});

describe("competitor registration (the only write path)", () => {
  test("ai_proposal accept snapshots the cross-check verdict and audits", async () => {
    const auditsBefore = auditCount("competitor.accept");
    const res = await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "경쟁사A", discovery_source: "ai_proposal" }),
    });
    expect(res.status).toBe(201);
    const row = db.query("SELECT * FROM company_competitor WHERE member_id = ? AND name = '경쟁사A'").get(memberId) as {
      discovery_source: string; proposal_accepted_at: string; crosscheck_verdict: string | null; evidence_json: string | null;
    };
    expect(row.discovery_source).toBe("ai_proposal");
    expect(row.proposal_accepted_at).toBeTruthy();
    expect(row.crosscheck_verdict).toBe("confirmed");
    expect(row.evidence_json).toContain("dart.example");
    expect(auditCount("competitor.accept")).toBe(auditsBefore + 1);
  });

  test("manual register records the manual source", async () => {
    const res = await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "수작업 경쟁사", note: "직접 입력", discovery_source: "manual" }),
    });
    expect(res.status).toBe(201);
    const row = db.query("SELECT discovery_source FROM company_competitor WHERE member_id = ? AND name = '수작업 경쟁사'").get(memberId) as { discovery_source: string };
    expect(row.discovery_source).toBe("manual");
    expect(auditCount("competitor.register")).toBe(1);
  });

  test("duplicate confirmed names are rejected", async () => {
    const res = await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "경쟁사A", discovery_source: "manual" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("duplicate_competitor");
  });

  test("viewer role is forbidden", async () => {
    const res = await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "뷰어 시도", discovery_source: "manual" }),
    });
    expect(res.status).toBe(403);
  });

  test("invalid discovery_source is rejected", async () => {
    const res = await req(`/api/our-company/members/${memberId}/competitors`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "잘못된 출처", discovery_source: "web_proposal" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_source");
  });
});

describe("competitor lifecycle (edit / exclude / restore)", () => {
  test("exclude without a reason is rejected; with a reason it soft-excludes", async () => {
    const row = db.query("SELECT id FROM company_competitor WHERE member_id = ? AND name = '경쟁사A'").get(memberId) as { id: string };
    const noReason = await req(`/api/our-company/members/${memberId}/competitors/${row.id}/exclude`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(noReason.status).toBe(400);

    const okRes = await req(`/api/our-company/members/${memberId}/competitors/${row.id}/exclude`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ reason: "실제 경쟁 관계 아님 — 재검토 결과" }),
    });
    expect(okRes.status).toBe(200);
    const after = db.query("SELECT status, exclusion_reason FROM company_competitor WHERE id = ?").get(row.id) as { status: string; exclusion_reason: string };
    expect(after.status).toBe("excluded");
    expect(after.exclusion_reason).toContain("재검토");
  });

  test("restore works after exclusion", async () => {
    const row = db.query("SELECT id FROM company_competitor WHERE member_id = ? AND name = '경쟁사A'").get(memberId) as { id: string };
    const res = await req(`/api/our-company/members/${memberId}/competitors/${row.id}/restore`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const after = db.query("SELECT status FROM company_competitor WHERE id = ?").get(row.id) as { status: string };
    expect(after.status).toBe("confirmed");
  });

  test("PATCH edits the note", async () => {
    const row = db.query("SELECT id FROM company_competitor WHERE member_id = ? AND name = '수작업 경쟁사'").get(memberId) as { id: string };
    const res = await req(`/api/our-company/members/${memberId}/competitors/${row.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ note: "수정된 경쟁 관계" }),
    });
    expect(res.status).toBe(200);
    const after = db.query("SELECT note FROM company_competitor WHERE id = ?").get(row.id) as { note: string };
    expect(after.note).toBe("수정된 경쟁 관계");
  });
});
