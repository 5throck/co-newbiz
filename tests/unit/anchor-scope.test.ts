// @version 1.0.0
/**
 * ADR-0179 slice 2 - anchor scope-compatibility check and flags.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-anchor-scope.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
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
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const {
  compareAnchorScope,
  extractSizingVersionScope,
  anchorScopeNoteFragment,
  resolveAnchorScopeFlag,
  ANCHOR_SCOPE_FLAG_LABEL,
  ANCHOR_SCOPE_CONFIDENCE_NOTE,
} = await import("../../app/web-next/lib/anchor-scope.ts");
const bcRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/route.ts");
const paramsRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/params/route.ts");

const NOW = new Date().toISOString();
const ANALYST = "anchor-scope-analyst";
const json = JSON.stringify;
let cookie = "";

const LABEL_MISMATCH = "\uc2dc\uc7a5 \ubc94\uc704 \ubd88\uc77c\uce58";
const LABEL_UNKNOWN = "\uc2dc\uc7a5 \ubc94\uc704 \ubbf8\ud655\uc778";

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function makeOpp(track: "greenfield" | "brownfield"): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
const putScope = (id: string, body: unknown) =>
  nextRequest(`/api/opportunities/${id}/target-scope`, { method: "PUT", headers: { cookie }, body: json(body) });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-anchor-scope-123", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-anchor-scope-123");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- pure check (design \u00a75.2) ---------------------------------------------------------------------
describe("compareAnchorScope", () => {
  const t = (regions: string[]) => ({ regions: regions as never, segments: [], unit_basis: "krw_m_year" as const, set_by: "u", set_at: NOW });

  test("ok: target regions subset of the declared anchor regions", () => {
    const v = compareAnchorScope(t(["we", "kr"]), t(["we"]));
    expect(v.status).toBe("ok");
    expect(v.reason.length).toBeGreaterThan(0);
  });

  test("mismatch: worldwide anchor vs regional target (coverage is not compatibility)", () => {
    expect(compareAnchorScope(t(["worldwide"]), t(["we"])).status).toBe("mismatch");
    expect(compareAnchorScope(t(["worldwide"]), t(["we"])).reason).toContain("worldwide");
  });

  test("mismatch: disjoint declared regions", () => {
    expect(compareAnchorScope(t(["na"]), t(["we"])).status).toBe("mismatch");
  });

  test("unknown: NULL anchor (legacy unscoped) with a set target scope", () => {
    const v = compareAnchorScope(null, t(["we"]));
    expect(v.status).toBe("unknown");
    expect(v.reason).toContain("\ubbf8\uae30\uc7ac");
  });

  test("unknown: NULL target scope (legacy opportunity), whatever the anchor says", () => {
    expect(compareAnchorScope(t(["we"]), null).status).toBe("unknown");
    expect(compareAnchorScope(null, null).status).toBe("unknown");
  });

  test("labels are the design's Korean flags", () => {
    expect(ANCHOR_SCOPE_FLAG_LABEL.mismatch).toBe(LABEL_MISMATCH);
    expect(ANCHOR_SCOPE_FLAG_LABEL.unknown).toBe(LABEL_UNKNOWN);
  });

  test("confidence note states the non-negotiable #4 discipline", () => {
    expect(ANCHOR_SCOPE_CONFIDENCE_NOTE).toContain("\uc2b9\uc778 \uc870\uac74\uc774 \uc544\uB2D9\ub2c8\ub2e4");
    expect(ANCHOR_SCOPE_CONFIDENCE_NOTE).toContain("RAG");
  });
});

// -- sizing-version payload scope extraction (OPEN-2) ---------------------------------------------
describe("extractSizingVersionScope", () => {
  test("extracts a declared scope object", () => {
    const payload = json({ industry_id: "i", scope: { regions: ["we"], segments: ["Stage V"], unit_basis: "krw_m_year" } });
    expect(extractSizingVersionScope(payload)).toEqual({ regions: ["we"], segments: ["Stage V"], unit_basis: "krw_m_year" });
  });

  test("legacy payload without scope, invalid JSON, wrong shapes: null, never throws", () => {
    expect(extractSizingVersionScope(json({ industry_id: "i" }))).toBeNull();
    expect(extractSizingVersionScope("not json")).toBeNull();
    expect(extractSizingVersionScope(null)).toBeNull();
    expect(extractSizingVersionScope(json({ scope: { regions: [] } }))).toBeNull();
    expect(extractSizingVersionScope(json({ scope: "x" }))).toBeNull();
    expect(extractSizingVersionScope(json({ scope: { regions: [42] } }))).toBeNull();
  });
});

// -- run-note fragment: bit-identity + never blocks -----------------------------------------------
describe("anchorScopeNoteFragment", () => {
  const t = (regions: string[]) => ({ regions: regions as never, segments: [], unit_basis: "krw_m_year" as const, set_by: "u", set_at: NOW });

  test("empty string when no target scope is set (run notes byte-identical)", () => {
    expect(anchorScopeNoteFragment(null)).toBe("");
    expect(anchorScopeNoteFragment(undefined)).toBe("");
  });

  test("status + reason when a person-set target scope exists (anchor undeclared today)", () => {
    const f = anchorScopeNoteFragment(t(["we"]));
    expect(f.startsWith("; ")).toBe(true);
    expect(f).toContain("; anchor_scope=unknown");
    expect(f).toContain("anchor_scope_reason=");
  });

  test("ok verdict also emits the provenance pair", () => {
    const f = anchorScopeNoteFragment(t(["we"]), t(["we", "kr"]));
    expect(f).toContain("; anchor_scope=ok;");
  });

  test("never throws on degenerate inputs; always returns a string (never blocks)", () => {
    expect(typeof anchorScopeNoteFragment({} as never)).toBe("string");
    expect(typeof anchorScopeNoteFragment(t([]) as never)).toBe("string");
  });
});

// -- bit-identity at the generation-input seam ----------------------------------------------------
describe("bit-identity while no scope is set", () => {
  test("caseInputsBaseForProject: no scope -> targetScope null; scope set -> only targetScope changes", async () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const before = gen.caseInputsBaseForProject(pid);
    expect(before.targetScope).toBeNull();
    const { targetScope: _a, ...beforeRest } = before;
    const res = await putScope(opp, { regions: ["we"], segments: ["Stage V"], unit_basis: "krw_m_year" });
    expect(res.status).toBe(200);
    const after = gen.caseInputsBaseForProject(pid);
    expect(after.targetScope).toMatchObject({ regions: ["we"] });
    const { targetScope: _b, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
  });
});

// -- source guard: the flags never block generation ----------------------------------------------
describe("source guard: flags never block generation", () => {
  const genSrc = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/business-case-generator.ts"), "utf-8");
  test("the fragment is a pure string interpolation appended to the run note", () => {
    expect(genSrc).toContain("const anchorScopeFragment = anchorScopeNoteFragment(ctx.inputs.targetScope);");
    expect(genSrc).toContain("${anchorScopeFragment}");
  });
  test("no throw / early return wired to the slice-2 fragment", () => {
    const start = genSrc.indexOf("ADR-0179 slice 2");
    const end = genSrc.indexOf("${anchorScopeFragment}") + "${anchorScopeFragment}".length;
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const around = genSrc.slice(start, end);
    expect(around).not.toMatch(/throw |return (notFound|forbidden|badRequest|fail)\(/);
  });
});

// -- read model: additive anchor_scope fields on both GET routes ----------------------------------
describe("read model: additive anchor_scope fields", () => {
  test("business-case GET returns the unknown flag on a legacy unscoped opportunity", async () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const res = await nextRequest(`/api/projects/${pid}/business-case`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.anchor_scope).toMatchObject({ status: "unknown", label: LABEL_UNKNOWN, has_target_scope: false });
    expect(body.data.anchor_scope.confidence_note).toContain("RAG");
  });

  test("params GET mirrors it; setting the scope updates the live flag (still unknown until a scoped anchor lands)", async () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const before = await (await nextRequest(`/api/projects/${pid}/business-case/params`, { headers: { cookie } })).json();
    expect(before.data.anchor_scope).toMatchObject({ status: "unknown", has_target_scope: false });
    expect((await putScope(opp, { regions: ["we"], segments: [], unit_basis: "krw_m_year" })).status).toBe(200);
    const after = await (await nextRequest(`/api/projects/${pid}/business-case/params`, { headers: { cookie } })).json();
    expect(after.data.anchor_scope).toMatchObject({ status: "unknown", has_target_scope: true });
  });

  test("no source opportunity at all: flag null, never an error", () => {
    expect(resolveAnchorScopeFlag(db, "01NOPE00000000000000000000")).toBeNull();
  });
});

// -- UI surfaces the design names -----------------------------------------------------------------
describe("UI surfaces render the flag", () => {
  const vp = readFileSync(join(PROJECT_ROOT, "app/web-next/components/business-case/ValuationMethodology.tsx"), "utf-8");
  const pp = readFileSync(join(PROJECT_ROOT, "app/web-next/components/business-case/ParamsPanel.tsx"), "utf-8");
  const gb = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/gate-brief.ts"), "utf-8");
  test("methodology anchor row chip", () => {
    expect(vp).toContain("methodology-anchor-scope-flag");
    expect(vp).toContain("anchor-scope");
  });
  test("params table capture-row chip", () => {
    expect(pp).toContain("params-anchor-scope-flag");
    expect(pp).toContain("anchor-scope");
  });
  test("gate-brief decision-support line", () => {
    expect(gb).toContain("resolveAnchorScopeFlag");
    expect(gb).toContain("scopeLine");
  });
});
