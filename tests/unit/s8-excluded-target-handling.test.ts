// @version 1.0.0
/**
 * S8 excluded-target handling (ADR-0206, design 2026-11-24-s8-excluded-target-handling §10).
 *
 * Covers: the pure stale rule (staleS8Records), source filtering in listBusinessCases (default vs the
 * includeExcludedTargets opt-out, adoption never filtered), the DB wrapper resolveS8Staleness, gate-integrity
 * family `target` (off / shadow / enforce, fs + dd + entity_ic + group_ic, HOLD/KILL pass, 409 on the route and in
 * the decision write), and every downstream consumer (ic-package, report, lens summary, target-check,
 * deal-structure-recommendation, milestones/suggest, ic-gap-override, IC memo).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s8-excluded-target-handling.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const BC = await import("../../app/web-next/lib/business-case.ts");
const { goStaleTargetCheck } = await import("../../app/web-next/lib/gate-write-checks.ts");
const { recordGateDecisionRow } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const { icGoGapItems } = await import("../../app/web-next/lib/ic-gap-override.ts");
const { buildIcMemo } = await import("../../app/web-next/lib/ic-review-steps.ts");
const { SPEC_VERSION } = await import("../../app/web-next/lib/spec-activities.generated.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const USER = "ex-analyst";
const ANALYST_PW = "pw-ex-analyst-12345";
const NOW = "2026-11-24T00:00:00Z";
let cookie = "";
let clock = 0;
/** Strictly increasing ISO timestamps so "latest record wins" is deterministic. */
const at = (): string => new Date(Date.parse(NOW) + ++clock * 1000).toISOString();

const SCENARIOS = ["base", "upside", "downside"] as const;
const VARIANTS = ["market_forward", "historical"] as const;

interface Fx {
  projectId: string;
  oppId: string;
  a: string;
  b: string;
  aCases: string[];
  bCases: string[];
  aBaseMf: string;
  nullCase: string;
}

function insertCase(
  projectId: string,
  name: string,
  targetId: string | null,
  scenario: string | null,
  variant: string,
): string {
  const id = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, "valuation", name, 5, "t", NOW, variant, targetId],
  );
  if (scenario) {
    for (const [pct, npv] of [
      ["p05", 100],
      ["p50", 700],
    ] as const) {
      db.run(
        "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), projectId, id, scenario, pct, npv, 0.11, NOW],
      );
    }
  }
  return id;
}

/** Brownfield project, two shortlisted targets A and B with 6 cases each (3 scenarios x 2 variants) + 1 target-less case. */
function makeProject(tag: string): Fx {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    oppId,
    `opp ${tag}`,
    "selected",
    "test",
    NOW,
  ]);
  const a = ulid();
  const b = ulid();
  for (const [id, name, rank] of [
    [a, `AAA-${tag}`, 1],
    [b, `BBB-${tag}`, 2],
  ] as const) {
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, oppId, name, "shortlisted", rank, NOW, NOW],
    );
  }
  const projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, track, source_opportunity_id, created_at) VALUES (?,?,?,?,?)", [
    projectId,
    `NP-EX-${tag}`,
    "brownfield",
    oppId,
    NOW,
  ]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, USER, "member", "test", NOW, "excluded target test"],
  );
  const mk = (t: string, targetId: string) => {
    const ids: string[] = [];
    for (const sc of SCENARIOS)
      for (const v of VARIANTS) ids.push(insertCase(projectId, `[${t}] ${sc} ${v}`, targetId, sc, v));
    return ids;
  };
  const aCases = mk(`AAA-${tag}`, a);
  const bCases = mk(`BBB-${tag}`, b);
  const nullCase = insertCase(projectId, "legacy target-less", null, null, "market_forward");
  return { projectId, oppId, a, b, aCases, bCases, aBaseMf: aCases[0], nullCase };
}

function selectTargetRow(projectId: string, targetId: string): void {
  const t = at();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ulid(),
      "project",
      projectId,
      projectId,
      SPEC_VERSION,
      "s8_target_select",
      "done",
      "web",
      USER,
      t,
      t,
      JSON.stringify({ target_id: targetId, rationale: "test selection" }),
    ],
  );
}
function adoptRow(projectId: string, modelId: string): void {
  const t = at();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ulid(),
      "project",
      projectId,
      projectId,
      SPEC_VERSION,
      "s8_case_adopt",
      "done",
      "web",
      USER,
      t,
      t,
      JSON.stringify({ model_id: modelId }),
    ],
  );
}
function exclude(fx: Fx, targetId: string): void {
  db.run("UPDATE brownfield_target SET status = 'excluded' WHERE id = ?", [targetId]);
  void fx;
}
/** Selected + adopted A (a healthy S8). */
function healthy(tag: string): Fx {
  const fx = makeProject(tag);
  selectTargetRow(fx.projectId, fx.a);
  adoptRow(fx.projectId, fx.aBaseMf);
  return fx;
}
function counts(projectId: string): { selections: number; adoptions: number } {
  const n = (stage: string) =>
    (
      db.query("SELECT COUNT(*) AS n FROM process_run WHERE project_id = ? AND stage = ?").get(projectId, stage) as {
        n: number;
      }
    ).n;
  return { selections: n("s8_target_select"), adoptions: n("s8_case_adopt") };
}
async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await nextRequest(path, {
    method: init.method ?? "GET",
    headers: { cookie },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  } | null;
  return { status: res.status, json, data: json?.data ?? {}, error: json?.error };
}
const gateBody = (gate: string, decision: "go" | "hold" | "kill") => ({
  gate,
  decision,
  rationale: "정성 검토 결과 다음 단계 진행 여부를 판단한 근거를 기록함",
  ...(decision === "hold" ? { missing_artifacts: ["DD report"] } : {}),
  ...(decision === "kill" ? { learning_capture: "lesson captured for the stale-target test" } : {}),
});
const ctx = (fx: Fx, gate: string) => ({ entityType: "project" as const, entityId: fx.projectId, gate, actor: USER });
const errorCode = async (r: Response | null): Promise<string | null> =>
  r ? ((await r.json()) as { error: { code: string } }).error.code : null;

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: ANALYST_PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: USER, password: ANALYST_PW }),
  });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

// The repo .env configures an LLM provider; the LLM-backed routes must fall back deterministically and never reach the network.
const origFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;

afterEach(() => {
  delete process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET;
});

afterAll(() => {
  globalThis.fetch = origFetch as typeof fetch;
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("staleS8Records (pure matrix)", () => {
  const SHORT = new Set(["A"]);
  const rec = (
    selection: string | null,
    adopted: string | null | undefined,
    shortlistedIds: ReadonlySet<string> = SHORT,
  ) =>
    BC.staleS8Records({
      selection: selection === null ? null : { target_id: selection },
      adoptedCase: adopted === undefined ? null : { target_id: adopted },
      shortlistedIds,
    });

  test("none / none is not stale", () => {
    expect(rec(null, undefined)).toEqual({ selection: null, adoption: null, any: false });
  });
  test("selection and adoption on a shortlisted target are current", () => {
    expect(rec("A", "A")).toEqual({ selection: null, adoption: null, any: false });
  });
  test("selection of an excluded target is stale", () => {
    expect(rec("X", undefined)).toEqual({ selection: "selected_target_excluded", adoption: null, any: true });
  });
  test("adopted case of an excluded target is stale", () => {
    expect(rec("A", "X")).toEqual({ selection: null, adoption: "adopted_target_excluded", any: true });
  });
  test("target-less adoption is never stale", () => {
    expect(rec("A", null)).toEqual({ selection: null, adoption: null, any: false });
    expect(rec(null, null)).toEqual({ selection: null, adoption: null, any: false });
  });
  test("adopted case of another shortlisted target than the selection is a mismatch", () => {
    expect(rec("A", "B", new Set(["A", "B"]))).toEqual({
      selection: null,
      adoption: "adopted_target_mismatch",
      any: true,
    });
  });
  test("adoption without any selection is not a mismatch", () => {
    expect(rec(null, "A")).toEqual({ selection: null, adoption: null, any: false });
  });
  test("both excluded: both stale, the excluded reason wins over mismatch", () => {
    expect(rec("X", "Y")).toEqual({
      selection: "selected_target_excluded",
      adoption: "adopted_target_excluded",
      any: true,
    });
  });
  test("selection excluded, adoption on a different shortlisted target: selection stale + mismatch", () => {
    expect(rec("X", "A")).toEqual({
      selection: "selected_target_excluded",
      adoption: "adopted_target_mismatch",
      any: true,
    });
  });
});

describe("listBusinessCases source filter (default vs includeExcludedTargets)", () => {
  test("default hides the excluded target's 6 cases; the opt-out returns all and flags them", () => {
    const fx = makeProject("list1");
    const all = BC.listBusinessCases(fx.projectId, { includeExcludedTargets: true });
    expect(all.cases.length).toBe(13); // 6 A + 6 B + 1 target-less
    expect(BC.listBusinessCases(fx.projectId).cases.length).toBe(13);
    exclude(fx, fx.b);
    const def = BC.listBusinessCases(fx.projectId);
    expect(def.cases.length).toBe(7); // 6 A + target-less
    expect(def.cases.some((c) => c.target_id === fx.b)).toBe(false);
    expect(def.cases.some((c) => c.id === fx.nullCase)).toBe(true);
    expect(def.cases.every((c) => c.target_excluded === undefined)).toBe(true);
    const opt = BC.listBusinessCases(fx.projectId, { includeExcludedTargets: true });
    expect(opt.cases.length).toBe(13);
    expect(opt.cases.filter((c) => c.target_excluded).length).toBe(6);
    expect(opt.cases.filter((c) => c.target_excluded).every((c) => c.target_id === fx.b)).toBe(true);
  });

  test("archived excluded-target cases are filtered by default too", () => {
    const fx = makeProject("list2");
    db.run("UPDATE business_case_model SET archived_at = ?, archived_by = 'u' WHERE id = ?", [NOW, fx.bCases[0]]);
    exclude(fx, fx.b);
    expect(BC.listBusinessCases(fx.projectId).archived.length).toBe(0);
    expect(BC.listBusinessCases(fx.projectId, { includeExcludedTargets: true }).archived.length).toBe(1);
  });

  test("the adoption record is never filtered and carries stale; selection/adoption rows stay byte-identical", () => {
    const fx = healthy("list3");
    const before = db
      .query(
        "SELECT id, stage, status, started_by, started_at, meta_json FROM process_run WHERE project_id = ? ORDER BY id",
      )
      .all(fx.projectId);
    expect(BC.listBusinessCases(fx.projectId).adoption).toMatchObject({ modelId: fx.aBaseMf, stale: null });
    exclude(fx, fx.a);
    const l = BC.listBusinessCases(fx.projectId);
    expect(l.cases.some((c) => c.id === fx.aBaseMf)).toBe(false); // hidden from the list...
    expect(l.adoption).toMatchObject({ modelId: fx.aBaseMf, stale: "adopted_target_excluded" }); // ...but the record is as recorded
    expect(l.targetSelection?.targetId).toBe(fx.a);
    const after = db
      .query(
        "SELECT id, stage, status, started_by, started_at, meta_json FROM process_run WHERE project_id = ? ORDER BY id",
      )
      .all(fx.projectId);
    expect(after).toEqual(before); // no auto-invalidation
    expect(counts(fx.projectId)).toEqual({ selections: 1, adoptions: 1 });
  });

  test("staleness payload names the targets and lists the stale ids", () => {
    const fx = healthy("list4");
    const ok = BC.listBusinessCases(fx.projectId).staleness;
    expect(ok).toMatchObject({ selection: null, adoption: null, any: false, target_ids: [] });
    expect(ok.selected_target).toEqual({ id: fx.a, name: "AAA-list4" });
    exclude(fx, fx.a);
    const st = BC.listBusinessCases(fx.projectId).staleness;
    expect(st).toMatchObject({
      selection: "selected_target_excluded",
      adoption: "adopted_target_excluded",
      any: true,
      target_ids: [fx.a],
    });
    expect(st.adopted_target).toEqual({ id: fx.a, name: "AAA-list4" });
    expect(BC.resolveS8Staleness(fx.projectId)).toEqual(st); // DB wrapper == list-embedded state
  });

  test("a re-selection to another shortlisted target makes the old adoption a mismatch", () => {
    const fx = healthy("list5");
    selectTargetRow(fx.projectId, fx.b);
    expect(BC.resolveS8Staleness(fx.projectId)).toMatchObject({
      selection: null,
      adoption: "adopted_target_mismatch",
      any: true,
    });
    adoptRow(fx.projectId, fx.bCases[0]); // human re-adopts a B case
    expect(BC.resolveS8Staleness(fx.projectId).any).toBe(false);
  });

  test("greenfield / target-less projects are never stale", () => {
    const projectId = ulid();
    db.run("INSERT INTO md_project (id, project_no, track, created_at) VALUES (?,?,?,?)", [
      projectId,
      "NP-EX-GF",
      "greenfield",
      NOW,
    ]);
    const c = insertCase(projectId, "gf case", null, "base", "market_forward");
    adoptRow(projectId, c);
    expect(BC.resolveS8Staleness(projectId)).toMatchObject({ any: false, selected_target: null, adopted_target: null });
    expect(BC.listBusinessCases(projectId).cases.length).toBe(1);
  });
});

describe("goStaleTargetCheck (family `target`)", () => {
  test("default is enforce: blocks fs / dd / entity_ic / group_ic while stale, 409 target_not_shortlisted with details", async () => {
    const fx = healthy("gate1");
    exclude(fx, fx.a);
    for (const gate of ["fs", "dd", "entity_ic", "group_ic"]) {
      const denied = goStaleTargetCheck(ctx(fx, gate));
      expect(denied?.status).toBe(409);
      const body = (await (denied as Response).json()) as { error: { code: string; details: Record<string, unknown> } };
      expect(body.error.code).toBe("target_not_shortlisted");
      expect(body.error.details).toEqual({
        selection: "selected_target_excluded",
        adoption: "adopted_target_excluded",
        target_ids: [fx.a],
      });
    }
  });

  test("a current S8 is not blocked; opportunity carriers and unknown gates are out of scope", () => {
    const fx = healthy("gate2");
    expect(goStaleTargetCheck(ctx(fx, "fs"))).toBeNull();
    exclude(fx, fx.a);
    expect(goStaleTargetCheck({ ...ctx(fx, "fs"), entityType: "opportunity" })).toBeNull();
    expect(goStaleTargetCheck(ctx(fx, "screening"))).toBeNull();
  });

  test("off: no block; shadow: no block but a would-block audit row", async () => {
    const fx = healthy("gate3");
    exclude(fx, fx.a);
    process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET = "off";
    expect(goStaleTargetCheck(ctx(fx, "fs"))).toBeNull();
    expect(
      db
        .query(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'gate_integrity.would_block:target_not_shortlisted' AND target = ?",
        )
        .get(`project:${fx.projectId}:fs`),
    ).toEqual({ n: 0 });
    process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET = "shadow";
    expect(goStaleTargetCheck(ctx(fx, "fs"))).toBeNull();
    expect(
      db
        .query(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'gate_integrity.would_block:target_not_shortlisted' AND target = ?",
        )
        .get(`project:${fx.projectId}:fs`),
    ).toEqual({ n: 1 });
    process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET = "enforce";
    expect(await errorCode(goStaleTargetCheck(ctx(fx, "fs")))).toBe("target_not_shortlisted");
  });

  test("a stale selection alone (no adoption) blocks; the mismatch blocks", async () => {
    const fx = makeProject("gate4");
    selectTargetRow(fx.projectId, fx.a);
    exclude(fx, fx.a);
    expect(await errorCode(goStaleTargetCheck(ctx(fx, "dd")))).toBe("target_not_shortlisted");
    const fy = healthy("gate4b");
    selectTargetRow(fy.projectId, fy.b);
    expect(await errorCode(goStaleTargetCheck(ctx(fy, "fs")))).toBe("target_not_shortlisted");
  });
});

describe("POST gate-decisions (route + decision write)", () => {
  test("fs GO -> 409 target_not_shortlisted while stale; HOLD and KILL are recorded", async () => {
    const fx = healthy("route1");
    exclude(fx, fx.a);
    const go = await api(`/api/projects/${fx.projectId}/gate-decisions`, {
      method: "POST",
      body: gateBody("fs", "go"),
    });
    expect(go.status).toBe(409);
    expect(go.error?.code).toBe("target_not_shortlisted");
    expect(go.error?.details).toMatchObject({
      selection: "selected_target_excluded",
      adoption: "adopted_target_excluded",
    });
    const hold = await api(`/api/projects/${fx.projectId}/gate-decisions`, {
      method: "POST",
      body: gateBody("fs", "hold"),
    });
    expect(hold.status).toBe(201);
    const kill = await api(`/api/projects/${fx.projectId}/gate-decisions`, {
      method: "POST",
      body: gateBody("fs", "kill"),
    });
    expect(kill.status).toBe(201);
  });

  test("dd and entity_ic GO are refused too (group_ic is covered by the direct check)", async () => {
    const fx = healthy("route2");
    exclude(fx, fx.a);
    for (const gate of ["dd", "entity_ic"]) {
      const r = await api(`/api/projects/${fx.projectId}/gate-decisions`, {
        method: "POST",
        body: gateBody(gate, "go"),
      });
      expect(r.status).toBe(409);
      expect(r.error?.code).toBe("target_not_shortlisted");
    }
  });

  test("escape hatch: with the family off the stale GO is not refused for this reason", async () => {
    const fx = healthy("route3");
    exclude(fx, fx.a);
    process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET = "off";
    const r = await api(`/api/projects/${fx.projectId}/gate-decisions`, { method: "POST", body: gateBody("fs", "go") });
    expect(r.error?.code).not.toBe("target_not_shortlisted");
  });

  test("after a human re-selects and re-adopts a shortlisted target the GO is no longer refused as stale", async () => {
    const fx = healthy("route4");
    exclude(fx, fx.a);
    expect(
      (await api(`/api/projects/${fx.projectId}/gate-decisions`, { method: "POST", body: gateBody("fs", "go") })).error
        ?.code,
    ).toBe("target_not_shortlisted");
    selectTargetRow(fx.projectId, fx.b);
    adoptRow(fx.projectId, fx.bCases[0]);
    expect(BC.resolveS8Staleness(fx.projectId).any).toBe(false);
    const r = await api(`/api/projects/${fx.projectId}/gate-decisions`, { method: "POST", body: gateBody("fs", "go") });
    expect(r.error?.code).not.toBe("target_not_shortlisted"); // other S8 prerequisites may still apply
  });

  test("recordGateDecisionRow re-reads the family inside the write: legacy and contract paths refuse, HOLD passes, shadow passes", () => {
    const fx = healthy("write1");
    exclude(fx, fx.a);
    const base = {
      entityType: "project" as const,
      entityId: fx.projectId,
      gate: "fs",
      storedRationale: "rationale text for the write-path test",
      missingArtifactsJson: null,
      actor: USER,
      gateEvaluationId: null,
      learningCapture: null,
      judgementConfirmationsJson: null,
      now: at(),
    };
    const rows = () =>
      (db.query("SELECT COUNT(*) AS n FROM gate_decision WHERE entity_id = ?").get(fx.projectId) as { n: number }).n;
    const legacy = recordGateDecisionRow(db, { ...base, decision: "go", extras: null });
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.failure).toMatchObject({ status: 409, code: "target_not_shortlisted" });
    expect(rows()).toBe(0);
    const contract = recordGateDecisionRow(db, {
      ...base,
      decision: "go",
      extras: { snapshotHash: null, acknowledgements: [], briefId: null, divergenceReason: null, killOverrideId: null },
    });
    expect(contract.ok).toBe(false);
    if (!contract.ok) expect(contract.failure.code).toBe("target_not_shortlisted");
    expect(rows()).toBe(0);
    const hold = recordGateDecisionRow(db, { ...base, decision: "hold", missingArtifactsJson: '["x"]', extras: null });
    expect(hold.ok).toBe(true);
    process.env.CO_NEWBIZ_GATE_INTEGRITY_TARGET = "shadow";
    const shadow = recordGateDecisionRow(db, { ...base, decision: "go", extras: null });
    expect(shadow.ok).toBe(true);
  });
});

describe("downstream consumers", () => {
  test("GET business-case: filtered cases + staleness; adoption stale", async () => {
    const fx = healthy("c1");
    exclude(fx, fx.a);
    const r = await api(`/api/projects/${fx.projectId}/business-case`);
    expect(r.status).toBe(200);
    const d = r.data as {
      cases: Array<{ target_id: string | null }>;
      staleness: Record<string, unknown>;
      adoption: Record<string, unknown>;
    };
    expect(d.cases.some((c) => c.target_id === fx.a)).toBe(false);
    expect(d.cases.length).toBe(7);
    expect(d.staleness).toMatchObject({
      selection: "selected_target_excluded",
      adoption: "adopted_target_excluded",
      any: true,
    });
    expect(d.adoption).toMatchObject({ modelId: fx.aBaseMf, stale: "adopted_target_excluded" });
  });

  test("ic-package: current adoption shows figures and a same-target sibling only; stale shows the state and no figures", async () => {
    const fx = healthy("ic1");
    const ok = await api(`/api/projects/${fx.projectId}/ic-package`);
    expect(ok.status).toBe(200);
    const bc = (
      ok.data as {
        business_case: { adopted: { id: string } | null; comparison: Array<{ variant: string; name: string }> };
      }
    ).business_case;
    expect(bc.adopted?.id).toBe(fx.aBaseMf);
    // base scenario siblings exist for A (historical) AND for B (both variants): only A's own may appear
    expect(bc.comparison.map((c) => c.name)).toEqual([`[AAA-ic1] base historical`]);
    exclude(fx, fx.a);
    const stale = await api(`/api/projects/${fx.projectId}/ic-package`);
    const sbc = stale.data as { business_case: Record<string, unknown>; staleness: Record<string, unknown> };
    expect(sbc.business_case.adopted).toBeNull();
    expect(sbc.business_case.stale).toBe("adopted_target_excluded");
    expect(sbc.business_case.comparison).toBeUndefined();
    expect(JSON.stringify(sbc.business_case)).not.toContain("AAA-ic1");
    expect(sbc.staleness).toMatchObject({ any: true });
  });

  test("ic-package: a mismatch (re-selected, not yet re-adopted) also omits the adopted figures", async () => {
    const fx = healthy("ic2");
    selectTargetRow(fx.projectId, fx.b);
    const r = await api(`/api/projects/${fx.projectId}/ic-package`);
    const bc = (r.data as { business_case: Record<string, unknown> }).business_case;
    expect(bc.adopted).toBeNull();
    expect(bc.stale).toBe("adopted_target_mismatch");
  });

  test("report compose: stale -> no adopted-case figures in the draft and `stale` set", async () => {
    const fx = healthy("rep1");
    const ok = await api(`/api/projects/${fx.projectId}/reports/compose`, { method: "POST", body: {} });
    expect(ok.status).toBe(200);
    expect(ok.data.stale).toBeNull();
    expect(String(ok.data.content_md)).toContain("AAA-rep1");
    exclude(fx, fx.a);
    const st = await api(`/api/projects/${fx.projectId}/reports/compose`, { method: "POST", body: {} });
    expect(st.status).toBe(200);
    expect(st.data.stale).toBe("adopted_target_excluded");
    const md = String(st.data.content_md);
    expect(md).not.toContain("AAA-rep1");
    expect(md).not.toContain("NPV p05");
  });

  test("s8-lens-summary: stale -> state stale_target with no figures from the stale adoption", async () => {
    const fx = healthy("lens1");
    const ok = await api(`/api/projects/${fx.projectId}/s8-lens-summary`);
    expect(ok.data).toMatchObject({ state: "ok" });
    expect((ok.data as { strip: { goalsText: string } }).strip).toBeDefined();
    exclude(fx, fx.a);
    const st = await api(`/api/projects/${fx.projectId}/s8-lens-summary`);
    const d = st.data as {
      state: string;
      financial: { baseIrr: number | null };
      goals: { goal_count: number };
      staleness: { any: boolean };
    };
    expect(d.state).toBe("stale_target");
    expect(d.staleness.any).toBe(true);
    expect(d.financial.baseIrr).toBeNull();
  });

  test("target-check: stale -> `stale` reason and no judged case", async () => {
    const fx = healthy("tc1");
    // a project goal makes the route take its judged-case path (otherwise it answers the unresolved-scope state)
    db.run(
      "INSERT INTO project_business_goal (id, project_id, metric_key, label, direction, target_value, rationale, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), fx.projectId, "irr", null, "gte", 0.05, "goal for the stale target-check test", USER, NOW],
    );
    const ok = await api(`/api/projects/${fx.projectId}/target-check`);
    expect(ok.status).toBe(200);
    expect(ok.data.stale).toBeNull();
    expect(ok.data.judged_case_id).toBe(fx.aBaseMf);
    exclude(fx, fx.a);
    const st = await api(`/api/projects/${fx.projectId}/target-check`);
    expect(st.data).toMatchObject({ stale: "selected_target_excluded", judged_case_id: null, adopted_case_id: null });
  });

  test("deal-structure-recommendation and milestones/suggest -> 409 target_not_shortlisted while stale", async () => {
    const fx = healthy("dsr1");
    exclude(fx, fx.a);
    for (const path of ["deal-structure-recommendation", "milestones/suggest"]) {
      const r = await api(`/api/projects/${fx.projectId}/${path}`, { method: "POST", body: {} });
      expect(r.status).toBe(409);
      expect(r.error?.code).toBe("target_not_shortlisted");
    }
    const fy = healthy("dsr2");
    for (const path of ["deal-structure-recommendation", "milestones/suggest"]) {
      const r = await api(`/api/projects/${fy.projectId}/${path}`, { method: "POST", body: {} });
      expect(r.status).not.toBe(409);
    }
  });

  test("ic-gap-override: a stale adoption is its own gap (replacing the 'none adopted' line)", () => {
    const fx = healthy("gap1");
    expect(icGoGapItems(fx.projectId).some((g) => g.includes("Short List에서 제외됨"))).toBe(false);
    exclude(fx, fx.a);
    const gaps = icGoGapItems(fx.projectId);
    expect(gaps).toContain("채택된 Business Case의 대상이 Short List에서 제외됨 (S8)");
    expect(gaps).not.toContain("채택된 Business Case 없음 (S8)");
  });

  test("IC memo: stale -> no adopted-case financials, state under could_not_verify", () => {
    const fx = healthy("memo1");
    const ok = buildIcMemo(db, fx.projectId).memo as {
      business_case: { id: string } | null;
      could_not_verify?: unknown;
    };
    expect(ok.business_case?.id).toBe(fx.aBaseMf);
    expect(ok.could_not_verify).toBeUndefined();
    exclude(fx, fx.a);
    const st = buildIcMemo(db, fx.projectId).memo as {
      business_case: unknown;
      s8_stale: string;
      could_not_verify: Array<{ item: string; reason: string }>;
    };
    expect(st.business_case).toBeNull();
    expect(st.s8_stale).toBe("adopted_target_excluded");
    expect(st.could_not_verify).toEqual([{ item: "adopted_business_case", reason: "adopted_target_excluded" }]);
  });
});
