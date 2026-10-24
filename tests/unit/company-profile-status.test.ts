// @version 1.0.0
/**
 * Company-profile analysis status reporting — the S3 affiliate analysis used
 * to report `status: "in_progress"` whenever no version row existed, so a
 * pipeline that died mid-run (the route only console.error'd) left the UI
 * polling "분석 중..." forever. These tests pin the in-process job registry
 * contract: analyze → completed, pipeline crash → failed (+error surfaced by
 * the profile GET), no job → in_progress.
 *
 * Runs the real Route Handlers via nextRequest() against a scratch SQLite
 * file (same harness as api.test.ts) with DART/TAVILY/LLM keys blanked so
 * the pipeline takes its deterministic offline path — no network.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-profile-status.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// loadRootEnvPipelineKeys never overrides set values — blank these before any
// route module loads so validateCorpCode/researchSources/complete all take
// their unconfigured branches regardless of the operator's root .env.
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
// bun test runs every file in one process, so a module-level blank leaks into
// sibling files still in flight. Remember the originals; afterAll restores them.
const BLANKED_ENV_KEYS = ["DART_API_KEY", "TAVILY_API_KEY", "WEB_SEARCH_DDG_ENABLED"] as const;
const BLANKED_ENV_ORIGINALS = BLANKED_ENV_KEYS.map((k) => [k, process.env[k]] as const);
process.env.DART_API_KEY = "";
process.env.TAVILY_API_KEY = "";
// DuckDuckGo fallback is on by default and does real HTTP; switch it off.
process.env.WEB_SEARCH_DDG_ENABLED = "false";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { startCompanyProfilePipeline, getProfileJobStatus, resolveMemberSubject, _profileJobs } = await import(
  "../../app/web-next/lib/company-profile-pipeline.ts"
);

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(25);
  }
}

/** 그룹 1개 + 계열사 1개를 API로 만들고 member id를 돌려준다. */
async function seedMember(name: string): Promise<string> {
  const g = await req("/api/our-company/groups", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ name }) });
  const groupId = ((await g.json()) as { data: { id: string } }).data.id;
  const m = await req(`/api/our-company/groups/${groupId}/members`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ company_name: name, role: "hq" }),
  });
  expect(m.status).toBe(201);
  const detail = await req(`/api/our-company/groups/${groupId}`, { headers: { cookie: analystCookie } });
  const members = ((await detail.json()) as { data: { members: Array<{ id: string }> } }).data.members;
  return members[members.length - 1].id;
}

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("alice", "pw-alice-12345");
});

afterAll(async () => {
  _profileJobs.clear();
  for (const [k, v] of BLANKED_ENV_ORIGINALS) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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

describe("company-profile analysis status", () => {
  test("no version and no job → in_progress", async () => {
    const memberId = await seedMember("status-idle");
    const res = await req(`/api/our-company/members/${memberId}/profile`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe("in_progress");
  });

  test("a recorded pipeline failure is reported by the profile GET with its error", async () => {
    const memberId = await seedMember("status-failed");
    _profileJobs.set(`member:${memberId}`, { status: "failed", error: "boom: deterministic seed", startedAt: NOW, failedAt: NOW });
    const res = await req(`/api/our-company/members/${memberId}/profile`, { headers: { cookie: analystCookie } });
    const body = (await res.json()) as { data: { status: string; error?: string } };
    expect(body.data.status).toBe("failed");
    expect(body.data.error).toBe("boom: deterministic seed");
    _profileJobs.delete(`member:${memberId}`);
  });

  test("analyze runs the offline pipeline to a completed version", async () => {
    const memberId = await seedMember("status-completed");
    const start = await req(`/api/our-company/members/${memberId}/analyze`, { method: "POST", headers: { cookie: analystCookie }, body: "{}" });
    expect(start.status).toBe(200);
    expect(((await start.json()) as { data: { status: string } }).data.status).toBe("in_progress");

    const done = await waitFor(() => {
      const job = getProfileJobStatus({ kind: "member", id: memberId });
      if (job?.status === "failed") throw new Error(`pipeline failed: ${job.error}`);
      return job === null ? true : null; // 성공 시 레지스트리가 지워진다
    });
    expect(done).toBe(true);

    const res = await req(`/api/our-company/members/${memberId}/profile`, { headers: { cookie: analystCookie } });
    const body = (await res.json()) as { data: { status: string; profile: { companyName: string; schemaVersion?: number } | null; versions: Array<{ version_no: number }> } };
    expect(body.data.status).toBe("completed");
    expect(body.data.profile?.companyName).toBe("status-completed");
    expect(body.data.versions).toHaveLength(1);
    expect(body.data.versions[0].version_no).toBe(1);
  });

  test("a pipeline crash (member gone mid-flight) is recorded as failed", async () => {
    const memberId = await seedMember("status-crash");
    // 실제 크래시 경로: 파이프라인 실행 중 회사 행이 사라진 경우 재현 — 구독 정보는
    // 삭제 전에 해소해 두고(라우트가 하는 것과 동일), 행을 지운 뒤 러너를 직접
    // 실행하면 company_profile_version.member_id FK 위반으로 실패가 기록된다.
    const subject = resolveMemberSubject(db, memberId);
    db.run("DELETE FROM company_group_member WHERE id = ?", [memberId]);
    // 러너의 console.error는 설계된 서버 로그 — 실패를 기다리는 동안 출력 침묵.
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      startCompanyProfilePipeline(db, subject, "alice");
      const job = await waitFor(() => {
        const j = getProfileJobStatus({ kind: "member", id: memberId });
        return j?.status === "failed" ? j : null;
      });
      expect(job.error).toBeTruthy();
    } finally {
      console.error = originalConsoleError;
    }
  });
});
