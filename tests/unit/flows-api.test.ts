// @version 1.0.0
/**
 * GET /api/flows + GET /api/flows/runs — 플로우 콘솔 API (design
 * 2026-09-15-runtime-pm-agent-orchestration §6.5 / screen design 2026-10-24).
 * admin-business-read-guard.test.ts 와 동일한 nextRequest + 실제 SQLite 패턴.
 * 검증 범위: ADR-0146 읽기 게이트(admin 403 role_forbidden, viewer/analyst 통과),
 * 블루프린트 응답 형태(생성 프러젝션 전용), 런 장부 3단 확장·필터·커서,
 * 프로젝트 가시성(멤버십), 요약 집합(synthesis 실패 제외), 0170 인덱스.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-flows-api.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const PASSWORDS: Record<string, string> = {
  root: "pw-root-12345",
  alice: "pw-alice-12345",
  bob: "pw-bob-123456",
  carol: "pw-carol-123456",
};
let adminCookie: string;
let analystCookie: string;
let viewerCookie: string;
let outsiderCookie: string; // 프로젝트 비멤버 analyst — 가시성 검증용

// 픽스처: alice이 멤버인 프로젝트 1개 + 기회 1개, 각각 런 3단(activity→agent)과
// llm_call_log 행. 시간 순서: OLDER < MID < NEWER — 커서 검증용.
const OLDER = "2026-10-01T00:00:00.000Z";
const MID = "2026-10-15T00:00:00.000Z";
const NEWER = "2026-10-20T00:00:00.000Z";
let projectId: string;
let opportunityId: string;

function seedRun(entityType: "project" | "opportunity", entityId: string, runId: string, stage: string, startedAt: string, status = "done") {
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [runId, entityType, entityId, entityType === "project" ? entityId : null, "2.10.1", stage, status, "agent", "alice", startedAt, startedAt],
  );
  db.run(
    `INSERT INTO activity_run (id, process_run_id, activity_id, status, source, started_at, finished_at) VALUES (?,?,?,?,?,?,?)`,
    [ulid(), runId, "market-research", status, "agent", startedAt, startedAt],
  );
  db.run(
    `INSERT INTO agent_run (id, process_run_id, activity_id, agent_key, status, source, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), runId, "market-research", "market-intelligence-agent", status, "agent", startedAt, startedAt],
  );
}

function seedCall(opts: {
  agentKey: string;
  purpose: string;
  ok?: number;
  source?: "llm" | "synthesis";
  contextType?: string | null;
  contextId?: string | null;
  createdAt: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  error?: string | null;
}) {
  db.run(
    `INSERT INTO llm_call_log (id, agent_key, purpose, context_type, context_id, source, provider, model, ok, error,
                               latency_ms, created_by, created_at, input_tokens, output_tokens, cost_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ulid(), opts.agentKey, opts.purpose, opts.contextType ?? null, opts.contextId ?? null,
      opts.source ?? "llm", "openai", "gpt-test", opts.ok ?? 1, opts.error ?? null,
      100, "system", opts.createdAt, opts.inputTokens ?? null, opts.outputTokens ?? null, opts.costUsd ?? null,
    ],
  );
}

beforeAll(async () => {
  for (const [userId, role] of [
    ["root", "admin"],
    ["alice", "analyst"],
    ["bob", "viewer"],
    ["carol", "analyst"],
  ] as const) {
    await createUser(db, { userId, role, password: PASSWORDS[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await loginCookie("root", "pw-root-12345");
  analystCookie = await loginCookie("alice", "pw-alice-12345");
  viewerCookie = await loginCookie("bob", "pw-bob-123456");
  outsiderCookie = await loginCookie("carol", "pw-carol-123456");

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-FLOWS", NOW]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, "alice", "lead", "root", NOW, "flows api test"]);

  opportunityId = ulid();
  seedRun("project", projectId, ulid(), "S8", NEWER);
  seedRun("opportunity", opportunityId, ulid(), "S3", MID);
  seedRun("project", projectId, ulid(), "S1", OLDER, "failed");

  // 카탈로그 purpose(pm-catalog.generated.ts의 정확한 문자열)와 미매핑 purpose.
  seedCall({ agentKey: "market-intelligence-agent", purpose: "S1 시장규모 산정 — 근거 기반 도출", contextType: "project", contextId: projectId, createdAt: NEWER, inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
  seedCall({ agentKey: "market-intelligence-agent", purpose: "S1 시장규모 산정 — 근거 기반 도출", contextType: "project", contextId: projectId, createdAt: MID, ok: 0, error: "boom" });
  seedCall({ agentKey: "market-intelligence-agent", purpose: "외부 단발 목적", source: "synthesis", createdAt: OLDER, ok: 0, error: "synth fail — 요약 집계에서 제외되어야 한다" });
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

async function errCode(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code;
}

describe("GET /api/flows — blueprint (generated projections only)", () => {
  test("auth matrix: admin 403 role_forbidden, analyst/viewer 200 (ADR-0146)", async () => {
    for (const [cookie, status, code] of [
      [adminCookie, 403, "role_forbidden"],
      [analystCookie, 200, undefined],
      [viewerCookie, 200, undefined],
    ] as const) {
      const res = await req("/api/flows", { headers: { cookie } });
      expect(res.status).toBe(status);
      expect(await errCode(res)).toBe(code);
    }
    const res = await req("/api/flows");
    expect(res.status).toBe(401);
  });

  test("envelope + provenance + llmConfigured", async () => {
    const res = await req("/api/flows", { headers: { cookie: analystCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.specVersion).toBeTypeOf("string");
    expect(body.data.catalogVersion).toBeTypeOf("string");
    expect(body.data.sources.flowSpecYaml).toBeTypeOf("string");
    expect(typeof body.data.llmConfigured).toBe("boolean");
    expect(body.meta.as_of).toBeTypeOf("string");
  });

  test("12 stages with names, direct track projection, activities, agents, skills and prompts", async () => {
    const body = await req("/api/flows", { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    const stages = body.data.stages as Array<Record<string, unknown>>;
    expect(stages.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"]);
    // design 2026-10-25 §6.1: name·applicableTracks는 SPEC_STAGES 직접 투영이다 —
    // PM_CATALOG trackScope 합집합 유도(임시 방편)는 제거되었다. 모든 단계가
    // 스펙 값과 정확히 일치하는지 단언한다.
    const spec = (await import("js-yaml")).load(await Bun.file(join(PROJECT_ROOT, "process", "flow.spec.yaml")).text()) as {
      stages: Array<{ id: string; name: string; applicableTracks: string[] }>;
    };
    for (const [i, stage] of stages.entries()) {
      expect(typeof stage.name).toBe("string");
      expect((stage.name as string).length).toBeGreaterThan(0);
      expect(stage.name).toBe(spec.stages[i]!.name);
      expect(stage.applicableTracks).toEqual(spec.stages[i]!.applicableTracks);
      expect(Array.isArray(stage.activities)).toBe(true);
      for (const activity of stage.activities as Array<Record<string, unknown>>) {
        expect(typeof activity.agent).toBe("string");
        expect(Array.isArray(activity.skills)).toBe(true);
        expect(Array.isArray(activity.procedure)).toBe(true);
        for (const prompt of activity.prompts as Array<Record<string, unknown>>) {
          expect(typeof prompt.key).toBe("string");
          expect(typeof prompt.purpose).toBe("string");
        }
      }
    }
    // S6/S7은 greenfield에서 스킵되는 단계 — 직접 투영이 스펙 값을 그대로 운반한다.
    const s6 = stages.find((s) => s.id === "S6");
    expect((s6!.applicableTracks as string[]).sort()).toEqual(["brownfield"]);
  });

  test("specialistMarkers come from SPECIALIST_TRACK_AFFINITY (kind + note, awareness-only)", async () => {
    const body = await req("/api/flows", { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    const markers = body.data.specialistMarkers as Array<Record<string, unknown>>;
    expect(markers.length).toBe(4);
    for (const m of markers) {
      expect(typeof m.stageId).toBe("string");
      expect(typeof m.activityId).toBe("string");
      expect(["affinity", "scoped", "override"]).toContain(m.kind as string);
      expect((m.note as string).length).toBeGreaterThan(0);
    }
    const override = markers.find((m) => `${m.stageId}.${m.activityId}` === "S11.investment-structuring");
    expect(override!.kind).toBe("override");
    const kinds = markers.map((m) => m.kind).sort();
    expect(kinds).toEqual(["affinity", "affinity", "override", "scoped"]);
  });

  test("dynamic items (agentKey null) and prompt system text, agents roster", async () => {
    const body = await req("/api/flows", { headers: { cookie: viewerCookie } }).then((r: Response) => r.json());
    const dynamic = (body.data.prompts as Array<Record<string, unknown>>).filter((p) => p.agentKey === null);
    const keys = dynamic.map((p) => p.key).sort();
    expect(keys).toContain("s8.business_case_prose");
    expect(keys).toContain("committee.position");
    const prose = (body.data.prompts as Array<Record<string, unknown>>).find((p) => p.key === "s8.business_case_prose");
    expect(typeof prose!.system).toBe("string");
    expect((prose!.system as string).length).toBeGreaterThan(0);
    const agents = body.data.agents as Array<Record<string, unknown>>;
    expect(agents.some((a) => a.key === "market-intelligence-agent")).toBe(true);
    expect(agents[0]).toHaveProperty("domain");
  });

  test("GET does not appendAudit (read-only route convention)", async () => {
    const before = (db.query("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }).c;
    await req("/api/flows", { headers: { cookie: analystCookie } });
    await req("/api/flows/runs", { headers: { cookie: analystCookie } });
    const after = (db.query("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

describe("GET /api/flows/runs — run ledger", () => {
  test("auth matrix: admin 403 role_forbidden, analyst/viewer 200 (ADR-0146)", async () => {
    for (const [cookie, status, code] of [
      [adminCookie, 403, "role_forbidden"],
      [analystCookie, 200, undefined],
      [viewerCookie, 200, undefined],
    ] as const) {
      const res = await req("/api/flows/runs", { headers: { cookie } });
      expect(res.status).toBe(status);
      expect(await errCode(res)).toBe(code);
    }
  });

  test("three sections with the run→activity→agent expansion inlined", async () => {
    const body = await req("/api/flows/runs", { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    const data = body.data;
    expect(typeof data.llmConfigured).toBe("boolean");
    expect(data.processRuns.length).toBe(3);
    expect(data.llmCalls.length).toBe(3);
    const expanded = data.processRuns.find((r: Record<string, unknown>) => r.stage === "S8");
    expect(expanded.activities.length).toBe(1);
    expect(expanded.activities[0].activity_id).toBe("market-research");
    expect(expanded.activities[0].agentRuns.length).toBe(1);
    expect(expanded.activities[0].agentRuns[0].agent_key).toBe("market-intelligence-agent");
    // llm_call 행은 0130 사용량 열을 그대로 노출한다.
    const call = data.llmCalls.find((c: Record<string, unknown>) => c.cost_usd !== null);
    expect(call.input_tokens).toBe(100);
    expect(call.output_tokens).toBe(50);
    expect(call.cost_usd).toBeCloseTo(0.01);
    expect(typeof call.catalogMatched).toBe("boolean");
  });

  test("project visibility: non-member analyst sees only opportunity runs", async () => {
    const body = await req("/api/flows/runs", { headers: { cookie: outsiderCookie } }).then((r: Response) => r.json());
    expect(body.data.processRuns.length).toBe(1);
    expect(body.data.processRuns[0].entity_type).toBe("opportunity");
    // 프로젝트 컨텍스트 llm_call도 가려진다(무컨텍스트 synthesis 1행만).
    expect(body.data.llmCalls.length).toBe(1);
  });

  test("filter: agentKey, ok, source, entityType+entityId", async () => {
    const byAgent = await req(`/api/flows/runs?agentKey=market-intelligence-agent`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(byAgent.data.processRuns.length).toBe(3);
    expect(byAgent.data.llmCalls.length).toBe(3);

    const failures = await req(`/api/flows/runs?ok=0`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    // 런 사상: failed process_run 1건 + llm 실패 2건(synthesis 실패 포함 — ok 필터는 소스를 가리지 않는다).
    expect(failures.data.processRuns.length).toBe(1);
    expect(failures.data.llmCalls.length).toBe(2);
    expect(failures.data.llmCalls.every((c: Record<string, unknown>) => c.ok === 0)).toBe(true);

    const llmOnly = await req(`/api/flows/runs?source=llm`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(llmOnly.data.llmCalls.length).toBe(2);

    const byEntity = await req(`/api/flows/runs?entityType=project&entityId=${projectId}`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(byEntity.data.processRuns.length).toBe(2);
    expect(byEntity.data.llmCalls.length).toBe(2);
  });

  test("cursor: before returns strictly older rows; nextBefore meta feeds the next page", async () => {
    const first = await req(`/api/flows/runs?limit=2`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(first.data.processRuns.map((r: Record<string, unknown>) => r.stage)).toEqual(["S8", "S3"]);
    expect(first.meta.nextBefore.processRuns).toBe("2026-10-15T00:00:00.000Z");
    const second = await req(`/api/flows/runs?limit=2&before=${first.meta.nextBefore.processRuns}`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(second.data.processRuns.map((r: Record<string, unknown>) => r.stage)).toEqual(["S1"]);
  });

  test("summary window: errors exclude synthesis, catalog provenance, per-stage error counts", async () => {
    const body = await req(`/api/flows/runs?window=30d`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    const summary = body.data.summary;
    expect(summary.window).toBe("30d");
    expect(summary.calls).toBe(3);
    expect(summary.llmCalls).toBe(2); // synthesis 제외
    expect(summary.errors).toBe(1); // synthesis 실패는 오류율 분모·분자 모두 제외
    expect(summary.errorRate).toBeCloseTo(0.5);
    expect(summary.inputTokens + summary.outputTokens).toBe(150);
    expect(summary.costUsd).toBeCloseTo(0.01);
    // 카탈로그 purpose 매칭 실패 1건이 S1으로 귀속, synthesis 실패는 집계에서 제외.
    expect(summary.errorsByStage["S1"]).toBe(1);
    expect(summary.unmappedErrors).toBe(0);
  });

  test("invalid filters are 400 bad_request", async () => {
    for (const qs of ["ok=2", "source=banana", "entityType=project", "window=forever"]) {
      const res = await req(`/api/flows/runs?${qs}`, { headers: { cookie: analystCookie } });
      expect(res.status).toBe(400);
      expect(await errCode(res)).toBe("invalid_filter");
    }
  });

  test("limit clamps to 1..500 (audit-log convention)", async () => {
    const res = await req(`/api/flows/runs?limit=9999`, { headers: { cookie: analystCookie } });
    const body = await res.json();
    expect(body.meta.limit).toBe(500);
    const resZero = await req(`/api/flows/runs?limit=0`, { headers: { cookie: analystCookie } });
    expect((await resZero.json()).meta.limit).toBe(1);
  });

  test("includeDryRun=1 includes dry-run rows; the note appears only when the filter is off (Row 5 wiring)", async () => {
    const on = await req(`/api/flows/runs?includeDryRun=1`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(on.meta.includeDryRun).toBe(true);
    expect(on.meta.includeDryRunNote).toBeUndefined();
    const off = await req(`/api/flows/runs`, { headers: { cookie: analystCookie } }).then((r: Response) => r.json());
    expect(off.meta.includeDryRun).toBe(false);
    expect(off.meta.includeDryRunNote).toBeTypeOf("string");
  });
});

describe("migration 0170 — idx_agent_run_agent_key", () => {
  test("index exists on agent_run(agent_key, started_at DESC)", () => {
    const row = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_run_agent_key'")
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.sql).toContain("agent_key");
    expect(row!.sql).toContain("started_at");
  });
});
