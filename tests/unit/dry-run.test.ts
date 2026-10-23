// @version 1.0.0
/**
 * Row 5 — 드라이런 실험 레인 백엔드 (2026-09-15-runtime-pm-agent-orchestration
 * §6.6/§6.7/§6.8, 화면 설계 2026-10-24 §6/§13). 검증 범위:
 *   - 마이그레이션 0171/0172 (llm_call_log 드라이런 플래그 + dry_run_session)
 *   - PM 관문은 오버라이드 경로에서도 유효 (PmGateError — 관문 우회 없음)
 *   - 오버라이드 실행은 운영 completeOrFallback 경로를 재사용 (모의 provider)
 *   - 런 장부 플래그: is_dry_run=1 + dry_run_group_id 기록, 운영 호출은 무플래그
 *   - 비즈니스 테이블 무기록 (execute가 만지는 건 dry_run_session + llm_call_log 뿐)
 *   - 동적 프롬프트(s8.business_case_prose, committee.position) 드라이런 거부
 *   - 선호 기록(3상+비고), 제안 패키지 형태, suggest 제안 전용 + 미구성 폴백
 *   - /api/flows/runs 드라이런 기본 제외 + includeDryRun=1 포함
 *   - 인증 매트릭스 (admin 쓰기 403 role_forbidden — ADR-0146, viewer 403)
 * flows-api.test.ts / llm-structured.test.ts 의 패턴(nextRequest + 실제 SQLite +
 * 모의 fetch)을 따른다. 실제 provider는 접촉하지 않는다.
 */
import { test, expect, beforeAll, afterAll, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-dry-run.sqlite");
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

const {
  createDryRunSession, executeDryRun, recordPreference, buildExportPackage, renderExportMarkdown,
  suggestDryRunImprovement, estimateDryRunCost, dryRunnablePromptCheck, purgeExpiredDryRunSessions,
} = await import("../../app/web-next/lib/dry-run.ts");
const { completeOrFallback, PmGateError } = await import("../../app/web-next/lib/llm.ts");

const NOW = new Date().toISOString();
const PASSWORDS: Record<string, string> = {
  root: "pw-root-12345",
  alice: "pw-alice-12345",
  bob: "pw-bob-123456",
};
let adminCookie: string;
let analystCookie: string;
let viewerCookie: string;

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

// ── LLM 모의 (llm-structured.test.ts 패턴) ──────────────────────────────────
const ENV_KEYS = ["CO_NEWBIZ_LLM_PROVIDER", "CO_NEWBIZ_LLM_BASE_URL", "CO_NEWBIZ_LLM_API_KEY", "CO_NEWBIZ_LLM_MODEL", "CO_NEWBIZ_LLM_CAPS"];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function configure(provider: string, model = "test-model") {
  process.env.CO_NEWBIZ_LLM_PROVIDER = provider;
  process.env.CO_NEWBIZ_LLM_API_KEY = "tk-fake";
  process.env.CO_NEWBIZ_LLM_MODEL = model;
  process.env.CO_NEWBIZ_LLM_BASE_URL = "https://llm.test";
  process.env.CO_NEWBIZ_LLM_CAPS = "";
}
function unconfigure() {
  process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
}
function mockReplies(replies: unknown[]) {
  let i = 0;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const openaiText = (text: string, usage: Record<string, unknown> = { prompt_tokens: 50, completion_tokens: 10 }) => ({
  choices: [{ message: { content: text } }],
  usage,
});

function tableCounts(): Map<string, number> {
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
  const out = new Map<string, number>();
  for (const t of tables) out.set(t, (db.query(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c);
  return out;
}

beforeAll(async () => {
  for (const [userId, role] of [["root", "admin"], ["alice", "analyst"], ["bob", "viewer"]] as const) {
    await createUser(db, { userId, role, password: PASSWORDS[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await loginCookie("root", "pw-root-12345");
  analystCookie = await loginCookie("alice", "pw-alice-12345");
  viewerCookie = await loginCookie("bob", "pw-bob-123456");
  unconfigure();
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

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  calls = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});

async function errCode(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code;
}

// ── 마이그레이션 ─────────────────────────────────────────────────────────────
describe("migrations 0171/0172 (§6.8 D7)", () => {
  test("llm_call_log has is_dry_run / dry_run_group_id and the group index", () => {
    const cols = (db.query("PRAGMA table_info(llm_call_log)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("is_dry_run");
    expect(cols).toContain("dry_run_group_id");
    const idx = (db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='llm_call_log'").all() as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toContain("idx_llm_call_log_dry_run_group");
  });
  test("dry_run_session exists with the preference (3-state) and TTL columns", () => {
    const cols = Object.fromEntries((db.query("PRAGMA table_info(dry_run_session)").all() as Array<{ name: string; dflt_value: unknown }>).map((c) => [c.name, true]));
    for (const c of ["id", "status", "prompt_key", "activity_id", "base_agent_key", "override_agent_key", "override_system",
      "preference", "preference_note", "base_output", "override_output", "base_run_call_id", "override_run_call_id",
      "cost_usd", "created_by", "created_at", "expires_at", "finished_at"]) {
      expect(cols[c]).toBe(true);
    }
    const check = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='dry_run_session'").get() as { sql: string };
    expect(check.sql).toContain("CHECK (preference IN ('base', 'override', 'tie')");
  });
});

// ── PM 관문 (오버라이드 경로 포함) ───────────────────────────────────────────
describe("PM gateway enforcement with dry-run overrides (ADR-0183 D2)", () => {
  test("agentOverride not on the roster throws PmGateError before any provider call", async () => {
    configure("openai");
    mockReplies([openaiText("x")]);
    await expect(
      completeOrFallback([{ role: "user", content: "x" }], () => "fb", {
        agent: { key: "pm", purpose: "t" },
        dryRun: { groupId: "dr_x", agentOverride: "not-in-roster" },
      }),
    ).rejects.toBeInstanceOf(PmGateError);
    expect(calls).toHaveLength(0);
  });
  test("a non-rostered base agent fails even with a valid override", async () => {
    configure("openai");
    mockReplies([openaiText("x")]);
    await expect(
      completeOrFallback([{ role: "user", content: "x" }], () => "fb", {
        agent: { key: "ghost", purpose: "t" },
        dryRun: { groupId: "dr_x", agentOverride: "pm" },
      }),
    ).rejects.toBeInstanceOf(PmGateError);
    expect(calls).toHaveLength(0);
  });
  test("the gateway is independent of LLM configuration (dry-run fallback path also declared)", async () => {
    unconfigure();
    mockReplies([{}]);
    await expect(
      completeOrFallback([{ role: "user", content: "x" }], () => "fb", {
        agent: { key: "pm", purpose: "t" },
        dryRun: { groupId: "dr_x", agentOverride: "ghost" },
      }),
    ).rejects.toBeInstanceOf(PmGateError);
  });
});

// ── 오버라이드 실행 경로 + 런 장부 플래그 ────────────────────────────────────
describe("override execution via the production completeOrFallback path", () => {
  test("promptOverride replaces the system message; agentOverride swaps the roster key; ledger rows are flagged", async () => {
    configure("openai");
    mockReplies([openaiText("BASE-OUT"), openaiText("OVERRIDE-OUT")]);
    const base = await completeOrFallback(
      [{ role: "system", content: "BASE-SYSTEM" }, { role: "user", content: "u" }],
      () => "fb", { agent: { key: "pm", purpose: "p" }, dryRun: { groupId: "dr_grp1" } },
    );
    const override = await completeOrFallback(
      [{ role: "system", content: "BASE-SYSTEM" }, { role: "user", content: "u" }],
      () => "fb", { agent: { key: "pm", purpose: "p" }, dryRun: { groupId: "dr_grp1", promptOverride: "OVERRIDE-SYSTEM", agentOverride: "risk-officer" } },
    );
    expect(base.text).toBe("BASE-OUT");
    expect(override.text).toBe("OVERRIDE-OUT");
    // 오버라이드 시스템 메시지가 실제 provider 요청 본문에 들어갔다(운영 경로 재사용).
    expect((calls[1].body as { messages: Array<{ role: string; content: string }> }).messages[0]).toEqual({ role: "system", content: "OVERRIDE-SYSTEM" });
    expect((calls[0].body as { messages: Array<{ role: string; content: string }> }).messages[0]).toEqual({ role: "system", content: "BASE-SYSTEM" });
    const rows = db.query("SELECT agent_key, is_dry_run, dry_run_group_id FROM llm_call_log WHERE dry_run_group_id = 'dr_grp1' ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ agent_key: "pm", is_dry_run: 1, dry_run_group_id: "dr_grp1" });
    expect(rows[1]).toMatchObject({ agent_key: "risk-officer", is_dry_run: 1, dry_run_group_id: "dr_grp1" });
  });
  test("production calls without a dryRun context are unflagged (behavior unchanged)", async () => {
    configure("openai");
    mockReplies([openaiText("PROD")]);
    await completeOrFallback([{ role: "user", content: "x" }], () => "fb", { agent: { key: "pm", purpose: "prod" } });
    const row = db.query("SELECT is_dry_run, dry_run_group_id FROM llm_call_log WHERE purpose = 'prod' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    expect(row.is_dry_run).toBe(0);
    expect(row.dry_run_group_id).toBeNull();
  });
  test("dry-run synthesis fallback is flagged too (LLM-unconfigured, no error)", async () => {
    unconfigure();
    const r = await completeOrFallback([{ role: "user", content: "x" }], () => "FB-TEXT", { agent: { key: "pm", purpose: "p" }, dryRun: { groupId: "dr_grp2" } });
    expect(r.source).toBe("synthesis");
    const row = db.query("SELECT is_dry_run, dry_run_group_id, source FROM llm_call_log WHERE dry_run_group_id = 'dr_grp2'").get() as Record<string, unknown>;
    expect(row.is_dry_run).toBe(1);
    expect(row.source).toBe("synthesis");
  });
});

// ── 세션 수명주기 ────────────────────────────────────────────────────────────
describe("dry-run session lifecycle", () => {
  test("dynamic prompts and unknown keys are rejected (v1 boundary)", () => {
    expect(dryRunnablePromptCheck("s8.business_case_prose")).toMatchObject({ ok: false, code: "dynamic_prompt" });
    expect(dryRunnablePromptCheck("committee.position")).toMatchObject({ ok: false, code: "dynamic_prompt" });
    expect(dryRunnablePromptCheck("no.such_key")).toMatchObject({ ok: false, code: "unknown_prompt" });
    const r = createDryRunSession({ promptKey: "committee.position", createdBy: "alice" });
    expect(r.ok).toBe(false);
    const r2 = createDryRunSession({ promptKey: "s2.discover", overrideAgentKey: "not-in-roster", createdBy: "alice" });
    expect(r2.ok).toBe(false);
  });

  test("cost estimate: measured from the latest same agent+purpose llm call, else unknown-confirm", () => {
    db.run(
      `INSERT INTO llm_call_log (id, agent_key, purpose, source, provider, model, ok, latency_ms, created_by, created_at, cost_usd)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), "market-intelligence-agent", "S2 기회 발굴 — 산업 근거 기반 기회 후보 도출", "llm", "openai", "gpt-x", 1, 100, "system", "2026-10-01T00:00:00.000Z", 0.0123],
    );
    const e = estimateDryRunCost("market-intelligence-agent", "S2 기회 발굴 — 산업 근거 기반 기회 후보 도출");
    expect(e.basis).toBe("measured");
    expect(e.costUsd).toBeCloseTo(0.0123, 8);
    const e2 = estimateDryRunCost("market-intelligence-agent", "no-such-purpose");
    expect(e2.basis).toBe("unknown");
    expect(e2.costUsd).toBeNull();
    expect(e2.maxTokens).toBeGreaterThan(0);
    expect(e2.note).toContain("확인");
  });

  test("create (no execution) -> execute touches ONLY dry_run_session + llm_call_log (business-table isolation)", async () => {
    const created = createDryRunSession({ promptKey: "s2.discover", overrideSystem: "OVERRIDE-SYSTEM", createdBy: "alice" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.session.status).toBe("active");
    expect(created.session.activity_id).toBe("opportunity-discovery");

    configure("openai");
    mockReplies([openaiText("B"), openaiText("O")]);
    const before = tableCounts();
    const r = await executeDryRun(created.session.id);
    const after = tableCounts();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.base).toMatchObject({ text: "B", source: "llm" });
    expect(r.result.override).toMatchObject({ text: "O", source: "llm" });
    expect(r.result.base.callId).toBeTruthy();
    expect(r.result.override.callId).toBeTruthy();
    expect(r.result.session.status).toBe("closed");
    for (const [t, c] of before) {
      if (t === "dry_run_session" || t === "llm_call_log") continue;
      expect(after.get(t)).toBe(c);
    }
    expect((after.get("dry_run_session") ?? 0) - (before.get("dry_run_session") ?? 0)).toBe(0); // UPDATE, not insert
    expect((after.get("llm_call_log") ?? 0) - (before.get("llm_call_log") ?? 0)).toBe(2);
    const sess = db.query("SELECT base_output, override_output, base_output_source, cost_usd, status FROM dry_run_session WHERE id = ?").get(created.session.id) as Record<string, unknown>;
    expect(sess.base_output).toBe("B");
    expect(sess.override_output).toBe("O");
    expect(sess.base_output_source).toBe("llm");
    expect(sess.status).toBe("closed");
  });

  test("execute without overrides is refused; LLM-unconfigured execute returns synthesis for both legs with source flags", async () => {
    const s = createDryRunSession({ promptKey: "s2.discover", createdBy: "alice" });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const refused = await executeDryRun(s.session.id);
    expect(refused.ok).toBe(false);
    unconfigure();
    db.run("UPDATE dry_run_session SET override_agent_key = 'pm' WHERE id = ?", [s.session.id]);
    const r = await executeDryRun(s.session.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.base.source).toBe("synthesis");
    expect(r.result.override.source).toBe("synthesis");
    expect(r.result.base.text).toContain("폴백");
    expect(r.result.session.base_output_source).toBe("synthesis");
    const rows = db.query("SELECT source, is_dry_run FROM llm_call_log WHERE dry_run_group_id = ?").all(s.session.id) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.is_dry_run).toBe(1);
  });

  test("preference recording: 3-state + note, refused before execution", async () => {
    const s = createDryRunSession({ promptKey: "s2.discover", overrideSystem: "X", createdBy: "alice" });
    if (!s.ok) throw new Error("unreachable");
    unconfigure();
    await executeDryRun(s.session.id);
    const bad = recordPreference(s.session.id, "nope");
    expect(bad.ok).toBe(false);
    const r = recordPreference(s.session.id, "override", "근거 문장이 더 구체적");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.preference).toBe("override");
    expect(r.session.preference_note).toBe("근거 문장이 더 구체적");
    // 실행 전 세션(새 세션)은 기록 불가.
    const s2 = createDryRunSession({ promptKey: "s2.discover", overrideSystem: "X", createdBy: "alice" });
    if (!s2.ok) throw new Error("unreachable");
    expect(recordPreference(s2.session.id, "base").ok).toBe(false);
  });

  test("export package shape + markdown", async () => {
    const s = createDryRunSession({ promptKey: "s2.discover", overrideSystem: "OVERRIDE-SYS-LINE", createdBy: "alice" });
    if (!s.ok) throw new Error("unreachable");
    expect(buildExportPackage(s.session.id).ok).toBe(false); // 실행 전 내보내기 불가
    unconfigure();
    await executeDryRun(s.session.id);
    recordPreference(s.session.id, "tie");
    const r = buildExportPackage(s.session.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg).toMatchObject({ promptKey: "s2.discover", baseAgentKey: "market-intelligence-agent", proposalOnly: true });
    expect(r.pkg.baseSystem.length).toBeGreaterThan(0);
    expect(r.pkg.effectiveOverrideSystem).toBe("OVERRIDE-SYS-LINE");
    expect(r.pkg.diff.changed).toBe(true);
    expect(r.pkg.preference).toBe("tie");
    expect(r.pkg.catalogVersion).toBeTypeOf("string");
    expect(r.pkg.evidence.baseRunCallId).toBeTruthy();
    const md = renderExportMarkdown(r.pkg);
    expect(md).toContain("제안 전용");
    expect(md).toContain("s2.discover");
    expect(md).toContain("OVERRIDE-SYS-LINE");
  });

  test("TTL purge removes expired sessions on read (v1 cleanup mechanism)", async () => {
    const s = createDryRunSession({ promptKey: "s2.discover", createdBy: "alice" });
    if (!s.ok) throw new Error("unreachable");
    db.run("UPDATE dry_run_session SET expires_at = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", s.session.id]);
    expect(purgeExpiredDryRunSessions()).toBeGreaterThanOrEqual(1);
    expect(db.query("SELECT id FROM dry_run_session WHERE id = ?").get(s.session.id)).toBeNull();
  });
});

// ── 라우트 + 인증 매트릭스 ───────────────────────────────────────────────────
describe("dry-run routes and the auth matrix (ADR-0146)", () => {
  test("401 unauthenticated, 403 admin role_forbidden on write, 403 viewer role_required", async () => {
    expect((await req("/api/flows/dry-run/sessions", { method: "POST", body: JSON.stringify({ promptKey: "s2.discover" }) })).status).toBe(401);
    const admin = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ promptKey: "s2.discover" }) });
    expect(admin.status).toBe(403);
    expect(await errCode(admin)).toBe("role_forbidden");
    const viewer = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: viewerCookie }, body: JSON.stringify({ promptKey: "s2.discover" }) });
    expect(viewer.status).toBe(403);
    expect(await errCode(viewer)).toBe("role_required");
    // 읽기는 viewer도 가능(analyst+ = admin만 차단).
    expect((await req("/api/flows/dry-run/sessions", { headers: { cookie: viewerCookie } })).status).toBe(200);
    expect((await req("/api/flows/dry-run/sessions", { headers: { cookie: adminCookie } })).status).toBe(403);
  });

  test("POST create validates and returns the cost estimate without executing", async () => {
    const bad = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s8.business_case_prose" }) });
    expect(bad.status).toBe(422);
    expect(await errCode(bad)).toBe("dynamic_prompt");
    const ghost = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s2.discover", overrideAgentKey: "ghost" }) });
    expect(ghost.status).toBe(400);
    expect(await errCode(ghost)).toBe("unknown_agent");
    const okRes = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s2.discover", overrideSystem: "OVR" }) });
    expect(okRes.status).toBe(201);
    const body = (await okRes.json()) as { data: { session: { id: string; status: string }; estimate: { basis: string; costUsd: number | null } } };
    expect(body.data.session.status).toBe("active");
    // s2.discover 의 agent+purpose 는 앞선 테스트에서 실측 행을 심었으므로 measured 정책이 적용된다.
    expect(body.data.estimate.basis).toBe("measured");
    expect(body.data.estimate.costUsd).toBeGreaterThan(0);
    // 실행 전 상태로 남는다(생성은 실행하지 않는다).
    expect((db.query("SELECT base_output FROM dry_run_session WHERE id = ?").get(body.data.session.id) as { base_output: string | null } | null)?.base_output).toBeNull();
    // audit 기록.
    expect(db.query("SELECT id FROM audit_log WHERE action = 'dry_run.session.create' AND target = ?").get(body.data.session.id)).toBeTruthy();
    return body.data.session.id as string;
  });

  test("execute route (LLM-unconfigured -> synthesis legs), preference route, export route", async () => {
    const mk = await req("/api/flows/dry-run/sessions", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s2.discover", overrideSystem: "OVR-ROUTE" }) });
    const { data: mkData } = (await mk.json()) as { data: { session: { id: string } } };
    const sessionId = mkData.session.id;

    const viewerExec = await req(`/api/flows/dry-run/sessions/${sessionId}/execute`, { method: "POST", headers: { cookie: viewerCookie }, body: "{}" });
    expect(viewerExec.status).toBe(403);
    const noOverride = await req(`/api/flows/dry-run/sessions/${sessionId}/execute`, { method: "POST", headers: { cookie: viewerCookie }, body: "{}" });
    expect(noOverride.status).toBe(403); // viewer는 쓰기 자체가 차단

    unconfigure();
    const exec = await req(`/api/flows/dry-run/sessions/${sessionId}/execute`, { method: "POST", headers: { cookie: analystCookie }, body: "{}" });
    expect(exec.status).toBe(200);
    const execBody = (await exec.json()) as { data: { base: { source: string; text: string }; override: { source: string } }; meta: { note: string } };
    expect(execBody.data.base.source).toBe("synthesis");
    expect(execBody.data.override.source).toBe("synthesis");
    expect(execBody.meta.note).toContain("is_dry_run");

    const pref = await req(`/api/flows/dry-run/sessions/${sessionId}/preference`, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ preference: "base", note: "노트" }) });
    expect(pref.status).toBe(200);
    const badPref = await req(`/api/flows/dry-run/sessions/${sessionId}/preference`, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ preference: "wrong" }) });
    expect(badPref.status).toBe(400);

    const exp = await req(`/api/flows/dry-run/sessions/${sessionId}/export`, { method: "POST", headers: { cookie: analystCookie } });
    expect(exp.status).toBe(200);
    const expBody = (await exp.json()) as { data: { filename: string; contentType: string; markdown: string; pkg: { proposalOnly: boolean } } };
    expect(expBody.data.filename).toMatch(/^dry-run-proposal-dr_/);
    expect(expBody.data.contentType).toContain("text/markdown");
    expect(expBody.data.pkg.proposalOnly).toBe(true);

    const detail = await req(`/api/flows/dry-run/sessions/${sessionId}`, { headers: { cookie: analystCookie } });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { data: { ledger: { runs: number }; preference: string } };
    expect(detailBody.data.ledger.runs).toBe(2);
    expect(detailBody.data.preference).toBe("base");
  });

  test("suggest route: proposal-only shape, roster filtering, LLM-unconfigured fallback", async () => {
    unconfigure();
    const r1 = await req("/api/flows/dry-run/suggest", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s2.discover" }) });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { data: { proposalOnly: boolean; available: boolean; reason: string | null; proposal: unknown } };
    expect(b1.data.proposalOnly).toBe(true);
    expect(b1.data.available).toBe(false);
    expect(b1.data.reason).toContain("제안 생성 불가");
    expect(b1.data.proposal).toBeNull();

    // 미구성에서도 감사 기록은 남는다(관문 통과 시도의 흔적).
    expect(db.query("SELECT id FROM audit_log WHERE action = 'dry_run.suggest'").get()).toBeTruthy();

    configure("openai");
    const reply = JSON.stringify({
      type: "agent_reassignment",
      rationale: "근거",
      candidateAgents: [
        { key: "risk-officer", rationale: "r1" },
        { key: "ghost-agent", rationale: "r2" },
      ],
    });
    mockReplies([openaiText(reply)]);
    const r2 = await req("/api/flows/dry-run/suggest", { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ promptKey: "s2.discover", evidence: { note: "최근 실패" } }) });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { data: { available: boolean; proposal: { type: string; candidateAgents: Array<{ key: string }>; rationale: string }; evidence: { note: string | null } } };
    expect(b2.data.available).toBe(true);
    expect(b2.data.proposal.type).toBe("agent_reassignment");
    expect(b2.data.proposal.candidateAgents.map((c) => c.key)).toEqual(["risk-officer"]); // 로스터 외 키는 탈락
    expect(b2.data.evidence.note).toBe("최근 실패");
    // 제안 호출 자체가 카탈로그 활동(pm.flow_suggest)으로 장부를 통과한다(§6.7).
    const ledger = db.query("SELECT agent_key, purpose, is_dry_run FROM llm_call_log WHERE is_dry_run = 0 ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    expect(ledger.agent_key).toBe("pm");
    expect(String(ledger.purpose)).toContain("개선 제안");
  });
});

// ── /api/flows/runs 드라이런 제외 ────────────────────────────────────────────
describe("flows/runs dry-run exclusion (§6.6)", () => {
  function seedCall(purpose: string, dry: boolean, cost: number | null) {
    db.run(
      `INSERT INTO llm_call_log (id, agent_key, purpose, source, provider, model, ok, latency_ms, created_by, created_at, cost_usd, is_dry_run, dry_run_group_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), "pm", purpose, "llm", "openai", "gpt-x", 1, 10, "system", NOW, cost, dry ? 1 : 0, dry ? "dr_seed" : null],
    );
  }
  test("default excludes dry-run rows from llmCalls AND summary; includeDryRun=1 includes them with the group id", async () => {
    seedCall("prod-purpose", false, 0.01);
    seedCall("dry-purpose", true, 0.02);
    // 다른 테스트가 남긴 행도 있고 요약은 7d 창이므로, 같은 창 조건의 DB 집계와 비교한다.
    const win = new Date(Date.now() - 7 * 86400_000).toISOString();
    const prodCount = (db.query("SELECT COUNT(*) AS c FROM llm_call_log WHERE is_dry_run = 0 AND created_at >= ?").get(win) as { c: number }).c;
    const dryCount = (db.query("SELECT COUNT(*) AS c FROM llm_call_log WHERE is_dry_run = 1 AND created_at >= ?").get(win) as { c: number }).c;
    expect(dryCount).toBeGreaterThan(0);

    const def = await req("/api/flows/runs", { headers: { cookie: analystCookie } });
    const defBody = (await def.json()) as { data: { llmCalls: Array<Record<string, unknown>>; summary: { calls: number } }; meta: { includeDryRun: boolean; includeDryRunNote?: string } };
    expect(defBody.data.llmCalls.some((c) => c.is_dry_run === 1)).toBe(false);
    expect(defBody.data.summary.calls).toBe(prodCount);
    expect(defBody.meta.includeDryRun).toBe(false);
    expect(defBody.meta.includeDryRunNote).toBeTypeOf("string");

    const incl = await req("/api/flows/runs?includeDryRun=1", { headers: { cookie: analystCookie } });
    const inclBody = (await incl.json()) as { data: { llmCalls: Array<Record<string, unknown>>; summary: { calls: number } }; meta: { includeDryRunNote?: string } };
    const dryRows = inclBody.data.llmCalls.filter((c) => c.is_dry_run === 1);
    expect(dryRows.length).toBeGreaterThanOrEqual(1);
    expect(dryRows.every((c) => c.dry_run_group_id !== null)).toBe(true);
    expect(dryRows.some((c) => c.dry_run_group_id === "dr_seed")).toBe(true);
    expect(inclBody.data.summary.calls).toBe(prodCount + dryCount);
    expect(inclBody.meta.includeDryRunNote).toBeUndefined();
  });
});
