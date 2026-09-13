/**
 * Unit tests for the S1 linked-industry serial queue (design
 * 2026-09-13-value-chain-linkage — meeting-2026-09-13 panel-review):
 *  - POST /api/market-overview/analyses with after_analysis_id creates a
 *    'pending' row and does NOT start the pipeline;
 *  - anchor validation (missing / self / failed / pending anchors);
 *  - duplicate guards reuse in_progress and pending rows;
 *  - claimNextPendingDependent claims exactly one row (concurrency 1),
 *    demand-side (전방/전전방) before supply-side, only when the root completed;
 *  - cancelPendingDependents fails the whole pending group with a reason;
 *  - recoverQueuePass heals stale in_progress rows and claims ready pendings.
 *
 * The claim/cancel helpers are exercised directly (not through a full
 * runSizingPipeline, which would make LLM calls); the spawn wiring on the
 * pipeline completion path is typechecked + manually verified.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-linked-analysis-chaining.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Test seam — observe claim/cancel state transitions without spawning real pipelines.
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { claimNextPendingDependent, cancelPendingDependents, releaseQueueNext } = await import("../../app/web-next/lib/market-sizing-pipeline.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

let analystCookie: string;
let viewerCookie: string;
let seq = 0;

function seedIndustry(name: string): string {
  const id = ("ind-" + String(++seq).padStart(4, "0")).padEnd(26, "x");
  db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [id, name, name, NOW]);
  return id;
}
function seedAnalysis(industryId: string, status: string, opts: { after?: string | null; relation?: string | null; createdAt?: string; startedAt?: string | null } = {}): string {
  const id = ("ana-" + String(++seq).padStart(4, "0")).padEnd(26, "x");
  db.run(
    `INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, after_analysis_id, linked_relation, started_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, industryId, status, "test", opts.createdAt ?? NOW, opts.after ?? null, opts.relation ?? null, opts.startedAt ?? null],
  );
  return id;
}
function statusOf(id: string): { status: string; error_message: string | null; started_at: string | null } {
  return db.query("SELECT status, error_message, started_at FROM market_sizing_analysis WHERE id = ?").get(id) as never;
}

beforeAll(async () => {
  await createUser(db, { userId: "analyst1", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "analyst1", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "viewer1", role: "viewer", password: "pw-viewer-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "viewer1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("analyst1", "pw-analyst-12345");
  viewerCookie = await loginCookie("viewer1", "pw-viewer-123456");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST /api/market-overview/analyses — serial queue", () => {
  test("viewer cannot create analyses", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: "테스트 산업" }),
    });
    expect(res.status).toBe(403);
  });

  test("running anchor → pending row, pipeline not started (202 deferred)", async () => {
    const rootInd = seedIndustry("루트 산업-큐");
    const linkedInd = seedIndustry("연계 산업-큐");
    const rootAna = seedAnalysis(rootInd, "in_progress");
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: linkedInd, after_analysis_id: rootAna, linked_relation: "전방" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.deferred).toBe(true);
    const row = statusOf(body.data.analysis_id);
    expect(row.status).toBe("pending");
    expect(row.started_at).toBeNull();
  });

  test("pending duplicate request reuses the queued row", async () => {
    const rootInd = seedIndustry("루트 산업-재사용");
    const linkedInd = seedIndustry("연계 산업-재사용");
    const rootAna = seedAnalysis(rootInd, "in_progress");
    const first = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: linkedInd, after_analysis_id: rootAna }),
    });
    expect(first.status).toBe(202);
    const second = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: linkedInd, after_analysis_id: rootAna }),
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.data.reused).toBe(true);
    expect(body.meta.status).toBe("pending");
  });

  test("missing anchor → 400; self anchor → 400", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: "고아 산업", after_analysis_id: "nope" }),
    });
    expect(res.status).toBe(400);

    const ind = seedIndustry("자기 참조 산업");
    const selfAna = seedAnalysis(ind, "in_progress");
    const res2 = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: "자기 참조 산업", after_analysis_id: selfAna }),
    });
    expect(res2.status).toBe(400);
  });

  test("failed anchor → 409; invalid relation → 400", async () => {
    const rootInd = seedIndustry("실패 루트 산업");
    const failedAna = seedAnalysis(rootInd, "failed");
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: "후속 산업-앵커실패", after_analysis_id: failedAna }),
    });
    expect(res.status).toBe(409);

    const res2 = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ name_ko: "후속 산업-관계오류", linked_relation: "대체" }),
    });
    expect(res2.status).toBe(400);
  });
});

describe("serial queue helpers", () => {
  test("claim: demand-side first, one at a time, only after root completed", () => {
    const rootInd = seedIndustry("클레임 루트");
    const root = seedAnalysis(rootInd, "in_progress");
    const back1 = seedIndustry("클레임 후방-1");
    const fwd1 = seedIndustry("클레임 전방-1");
    const fwd2 = seedIndustry("클레임 전방-2");
    // enqueue supply-side first, then two demand-side (out of created order)
    const pBack = seedAnalysis(back1, "pending", { after: root, relation: "후방", createdAt: "2026-09-13T01:00:00.000Z" });
    const pFwd1 = seedAnalysis(fwd1, "pending", { after: root, relation: "전방", createdAt: "2026-09-13T02:00:00.000Z" });
    const pFwd2 = seedAnalysis(fwd2, "pending", { after: root, relation: "전전방", createdAt: "2026-09-13T03:00:00.000Z" });

    // root not completed yet → nothing claims
    expect(claimNextPendingDependent(db, root)).toBeNull();

    // complete the root
    db.run("UPDATE market_sizing_analysis SET status = 'completed', completed_at = ? WHERE id = ?", [NOW, root]);

    const first = claimNextPendingDependent(db, root);
    expect([pFwd1, pFwd2]).toContain(first); // demand-side first despite later created_at
    expect(first).not.toBe(pBack);
    // concurrency 1: while the claimed one is in_progress, nothing else claims
    expect(claimNextPendingDependent(db, root)).toBeNull();
    db.run("UPDATE market_sizing_analysis SET status = 'completed' WHERE id = ?", [first!]);
    const second = claimNextPendingDependent(db, root);
    expect(second).not.toBeNull();
    expect(second).not.toBe(pBack); // still demand-side before supply-side
    db.run("UPDATE market_sizing_analysis SET status = 'completed' WHERE id = ?", [second!]);
    expect(claimNextPendingDependent(db, root)).toBe(pBack); // finally the supply-side
  });

  test("cancelPendingDependents fails the whole group with the reason", () => {
    const rootInd = seedIndustry("취소 루트");
    const root = seedAnalysis(rootInd, "in_progress");
    const d1 = seedAnalysis(seedIndustry("취소 연계-1"), "pending", { after: root });
    seedAnalysis(seedIndustry("취소 연계-2"), "pending", { after: root });
    cancelPendingDependents(db, root, "선행 분석 실패로 시작 취소 — 테스트");
    for (const id of [d1]) {
      const row = statusOf(id);
      expect(row.status).toBe("failed");
      expect(row.error_message).toContain("선행 분석 실패로 시작 취소");
    }
    const count = db.query("SELECT COUNT(*) n FROM market_sizing_analysis WHERE after_analysis_id = ? AND status = 'pending'").get(root) as never as { n: number };
    expect(count.n).toBe(0);
  });

  test("releaseQueueNext starts a queued dependent only after the root completes", () => {
    const rootInd = seedIndustry("릴리즈 루트");
    const root = seedAnalysis(rootInd, "in_progress");
    const dep = seedAnalysis(seedIndustry("릴리즈 연계"), "pending", { after: root, relation: "전방" });

    // root still running → dependent stays pending even if the hook fires
    releaseQueueNext(db, root);
    expect(statusOf(dep).status).toBe("pending");

    // root completes → the hook (fired by the pipeline completion path) starts it
    db.run("UPDATE market_sizing_analysis SET status = 'completed', completed_at = ? WHERE id = ?", [NOW, root]);
    releaseQueueNext(db, root);
    // the fire-and-forget pipeline may complete fast; either way it must have LEFT 'pending'
    expect(statusOf(dep).status).not.toBe("pending");
  });

  test("recoverQueuePass heals stale in_progress and claims ready pendings", async () => {
    const { recoverQueuePass } = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
    const staleInd = seedIndustry("스테일 루트");
    const staleRoot = seedAnalysis(staleInd, "in_progress", { createdAt: "2026-09-01T00:00:00.000Z", startedAt: "2026-09-01T00:00:00.000Z" });
    const orphan = seedAnalysis(seedIndustry("스테일 연계"), "pending", { after: staleRoot, relation: "전방" });

    const readyInd = seedIndustry("준비 루트");
    const readyRoot = seedAnalysis(readyInd, "completed");
    const readyDep = seedAnalysis(seedIndustry("준비 연계"), "pending", { after: readyRoot, relation: "전방" });

    const result = recoverQueuePass(db);

    // stale root → failed + its pending cancelled
    expect(result.healed).toContain(staleRoot);
    expect(statusOf(staleRoot).status).toBe("failed");
    expect(statusOf(orphan).status).toBe("failed");
    // ready pending → claimed and started
    expect(result.started).toContain(readyDep);
    expect(statusOf(readyDep).status).not.toBe("pending");
  });
});
