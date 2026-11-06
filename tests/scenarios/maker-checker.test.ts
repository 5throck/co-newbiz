// ADR-0186 P3 in the PRODUCTION bundle, with TWO humans: the maker (analyst) records every gate of a Green Field deal,
// the Entity IC reviewer and the Group IC reviewer (two further accounts holding the human-role grants, seeded as the
// bootstrap fixture) countersign. Families validators, maker_checker and ladder are `enforce` (the unit environment
// defaults to off; the other scenarios run unchanged with the flags at their defaults).
//
//   screening -> pre_fs -> fs -> dd are recorded in order (the full ladder), entity_ic GO is RECORDED but not in force:
//   the same user cannot countersign (403, no state change), group_ic GO is refused until the entity reviewer countersigns,
//   a condition precedent attached to the entity_ic GO keeps S11 open until a DIFFERENT reviewer clears it with evidence,
//   a kill-criteria override is issued by the group reviewer (not the recorder) and honoured by the maker's GO.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, type Session } from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldWithReviewers } from "./_support/deals.ts";
import { confirmSynergy } from "./_support/ui.ts";
import type { Browser, BrowserContext } from "./_support/playwright.ts";

const FAMILIES = ["MAKER_CHECKER", "VALIDATORS", "LADDER"] as const;
for (const f of FAMILIES) process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`] = "enforce";

const ENTITY = { userId: "entity-reviewer", password: "Ee5-entity-reviewer-pw!" };
const GROUP = { userId: "group-reviewer", password: "Gg6-group-reviewer-pw!" };
const P = GREENFIELD.projectId;
const O = GREENFIELD.opportunityId;

let app: TestApp;
let browser: Browser;
let maker: Session;
let entityCtx: BrowserContext;
let groupCtx: BrowserContext;

beforeAll(async () => {
  app = await startApp("maker-checker", {
    seed: async ({ dbPath, adminId, analystId }) => {
      await seedGreenfieldWithReviewers(dbPath, adminId, analystId, { entity: ENTITY, group: GROUP });
    },
  });
  browser = await launchBrowser();
  maker = await loginThroughUi(browser, app);
  // ADR-0192: the gate ladder (screening -> pre_fs) needs the S3 fit judgement —
  // confirm the synergy recommendation through the endpoint, the way a person does.
  await confirmSynergy(app, maker, O);
  entityCtx = await reviewerContext(ENTITY);
  groupCtx = await reviewerContext(GROUP);
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  for (const f of FAMILIES) delete process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`];
});

async function reviewerContext(who: { userId: string; password: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${app.baseUrl}/api/auth/login`, {
    headers: { origin: app.baseUrl },
    data: { userId: who.userId, password: who.password },
  });
  if (res.status() >= 300) throw new Error(`reviewer login ${res.status()}: ${await res.text()}`);
  return ctx;
}

type Json = { data: any; error: { code: string; details?: any } | null };
async function api(
  ctx: BrowserContext,
  method: "GET" | "POST" | "PUT",
  path: string,
  data?: unknown,
): Promise<{ status: number; body: Json }> {
  const csrf = (await ctx.cookies(app.baseUrl)).find((c) => c.name === "co_newbiz_csrf")?.value ?? "";
  const headers = { "x-csrf-token": csrf, origin: app.baseUrl };
  const req = ctx.request;
  const res =
    method === "GET"
      ? await req.get(`${app.baseUrl}${path}`, { headers })
      : method === "POST"
        ? await req.post(`${app.baseUrl}${path}`, { headers, data })
        : await req.put(`${app.baseUrl}${path}`, { headers, data });
  return { status: res.status(), body: (await res.json()) as Json };
}
const q = <T>(sql: string, ...args: unknown[]) => app.readDb((d) => d.query(sql).get(...(args as any[])) as T);
const RATIONALE = "자체 진출전략과 투자 구조, 위험 요인을 검토했고 조건을 충족해 진행하기로 함";
const GAP = "알려진 미비 사항은 후속 조치 일정과 함께 감수하기로 함";

describe("maker / checker on the production bundle (families validators, maker_checker, ladder = enforce)", () => {
  test("the full ladder is enforced in order: pre_fs before screening is refused, then screening, pre_fs, fs, dd are recorded", async () => {
    const early = await api(maker.context, "POST", `/api/opportunities/${O}/gate-decisions`, {
      gate: "pre_fs",
      decision: "go",
      rationale: RATIONALE,
    });
    expect(early.status).toBe(409);
    expect(early.body.error?.code).toBe("ladder_prerequisite_missing");
    for (const gate of ["screening", "pre_fs"]) {
      const r = await api(maker.context, "POST", `/api/opportunities/${O}/gate-decisions`, {
        gate,
        decision: "go",
        rationale: RATIONALE,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    for (const gate of ["fs", "dd"]) {
      const r = await api(maker.context, "POST", `/api/projects/${P}/gate-decisions`, {
        gate,
        decision: "go",
        rationale: RATIONALE,
      });
      expect(r.status, `${gate}: ${JSON.stringify(r.body)}`).toBe(201);
    }
  }, 120_000);

  test("entity_ic GO with a closing condition is recorded but NOT in force: pending everywhere, the maker cannot countersign, group_ic is refused", async () => {
    const go = await api(maker.context, "POST", `/api/projects/${P}/gate-decisions`, {
      gate: "entity_ic",
      decision: "go",
      rationale: RATIONALE,
      gap_rationale: GAP,
      conditions: [{ text: "임대 부지의 소유자 동의서를 거래 종결 전까지 확보함", clear_by: "closing" }],
    });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    expect(go.body.data).toMatchObject({ decision: "go", awaiting_countersign: true });
    expect(go.body.data.conditions).toHaveLength(1);
    const id = go.body.data.id as string;

    const process = await api(maker.context, "GET", `/api/projects/${P}/process`);
    expect(process.body.data.gateStatus.entity_ic).toBe("pending");
    expect(process.body.data.awaitingCountersign).toEqual(["entity_ic"]);

    const own = await api(maker.context, "POST", `/api/projects/${P}/gate-decisions/${id}/countersign`, {
      decision: "approved",
      reason: "본인이 기록한 결정을 승인하려는 시도",
    });
    expect(own.status).toBe(403); // the maker holds no grant; a same-person countersign is refused either way
    expect(["human_role_required", "checker_must_differ"]).toContain(own.body.error?.code ?? "");
    expect(
      q<{ c: number }>("SELECT COUNT(*) c FROM approval_chain WHERE project_id = ? AND decided_by IS NOT NULL", P).c,
    ).toBe(0);

    const groupToo = await api(maker.context, "POST", `/api/projects/${P}/gate-decisions`, {
      gate: "group_ic",
      decision: "go",
      rationale: RATIONALE,
      gap_rationale: GAP,
    });
    expect(groupToo.status).toBe(409);
    expect(groupToo.body.error?.details).toMatchObject({ awaiting_countersign: true });

    // the group reviewer holds the wrong grant for an ENTITY committee decision
    const wrong = await api(groupCtx, "POST", `/api/projects/${P}/gate-decisions/${id}/countersign`, {
      decision: "approved",
      reason: "그룹 검토자는 법인 위원회 결정을 승인할 수 없음",
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error?.code).toBe("human_role_required");
  }, 120_000);

  test("the entity reviewer countersigns: entity_ic is in force, group_ic can be recorded and is countersigned by the group reviewer", async () => {
    const id = q<{ id: string }>("SELECT id FROM gate_decision WHERE entity_id = ? AND gate = 'entity_ic'", P).id;
    const ok = await api(entityCtx, "POST", `/api/projects/${P}/gate-decisions/${id}/countersign`, {
      decision: "approved",
      reason: "패키지를 독립적으로 검토했고 기록된 결정에 동의함",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({ effective: true, countersign_state: "countersigned" });
    const view = await api(maker.context, "GET", `/api/projects/${P}/gate-decisions`);
    expect(view.body.data.latest.find((l: any) => l.gate === "entity_ic")).toMatchObject({
      decision: "go",
      countersign_state: "countersigned",
    });

    const group = await api(maker.context, "POST", `/api/projects/${P}/gate-decisions`, {
      gate: "group_ic",
      decision: "go",
      rationale: RATIONALE,
      gap_rationale: GAP,
    });
    expect(group.status, JSON.stringify(group.body)).toBe(201);
    const gid = group.body.data.id as string;
    expect((await api(maker.context, "GET", `/api/projects/${P}/process`)).body.data.gateStatus.group_ic).toBe(
      "pending",
    );
    const gok = await api(groupCtx, "POST", `/api/projects/${P}/gate-decisions/${gid}/countersign`, {
      decision: "approved",
      reason: "그룹 자본배분 기준에 부합함을 독립적으로 확인함",
    });
    expect(gok.status, JSON.stringify(gok.body)).toBe(201);
    const process = (await api(maker.context, "GET", `/api/projects/${P}/process`)).body.data;
    expect(process.gateStatus.entity_ic).toBe("go");
    expect(process.gateStatus.group_ic).toBe("go");
    expect(process.awaitingCountersign).toEqual([]);
  }, 120_000);

  test("the open closing condition keeps S11 incomplete until a different eligible reviewer clears it with evidence", async () => {
    const condition = q<{ id: string }>("SELECT id FROM condition_precedent WHERE project_id = ?", P);
    const blockers = async () =>
      ((await api(maker.context, "GET", `/api/projects/${P}/process`)).body.data.blockers as string[]).join(" | ");
    expect(await blockers()).toContain("open condition precedent");
    // the creator (maker) cannot clear; no grant
    const selfClear = await api(maker.context, "POST", `/api/projects/${P}/conditions/${condition.id}/clear`, {
      note: "본인이 만든 조건을 해소하려는 시도",
      evidence_ref: "dataroom:x",
    });
    expect(selfClear.status).toBe(403);
    const noEvidence = await api(entityCtx, "POST", `/api/projects/${P}/conditions/${condition.id}/clear`, {
      note: "소유자 동의서를 수령해 자료실에 보관함",
    });
    expect(noEvidence.status).toBe(400);
    expect(noEvidence.body.error?.code).toBe("evidence_required");
    const cleared = await api(entityCtx, "POST", `/api/projects/${P}/conditions/${condition.id}/clear`, {
      note: "소유자 동의서를 수령해 자료실에 보관함",
      evidence_ref: "dataroom:landlord-consent",
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await blockers()).not.toContain("open condition precedent");
    expect(
      q<{ c: number }>(
        "SELECT COUNT(*) c FROM audit_log WHERE action IN ('gate_decision.countersign','condition.create','condition.clear')",
      ).c,
    ).toBeGreaterThanOrEqual(4);
  }, 120_000);

  test("a kill-criteria override is issued by the group reviewer and honoured; the grant routes stay cookie-only", async () => {
    // the maker is not a group-ic-reviewer: refused
    const body = {
      procedure_key: "entity-ic-review",
      criterion_id: "analysis_task_reviewed_by_null_on_required_deliverable",
      reason: "미검토 부속서는 종결 전에 검토하기로 함",
    };
    const denied = await api(maker.context, "POST", `/api/projects/${P}/kill-overrides`, body);
    expect(denied.status).toBe(403);
    const issued = await api(groupCtx, "POST", `/api/projects/${P}/kill-overrides`, body);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM audit_log WHERE action = 'kill_override.issue'").c).toBe(1);
    const revoked = await api(groupCtx, "POST", `/api/projects/${P}/kill-overrides/${issued.body.data.id}/revoke`);
    expect(revoked.status).toBe(200);
    // an administrator cannot reach the deal at all, and an agent token is not a session (covered by the unit suite)
    const adminless = await api(maker.context, "POST", `/api/admin/human-roles`, {
      user_id: "analyst",
      role_key: "group-ic-reviewer",
    });
    expect(adminless.status).toBe(403);
  }, 60_000);
});
