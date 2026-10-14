// @version 1.0.0
/**
 * ADR-0172 slice 1: holding assessment unification (S3 side + data layer) — compat reader,
 * narrative caps, coverage weights, caution matrix, hash v2 + v1 compatibility, S3 table
 * structure/modals, and the S3 PUT round trip. Temp DB only.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-holding-assessment.sqlite");
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
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const lk = await import("../../app/web-next/lib/capability-linkage.ts");

const NOW = new Date().toISOString();
const json = JSON.stringify;
const norm = (over: Record<string, unknown> = {}) => cg.normalizeGapRows([{ id: "r", capability: "정밀 가공", ...over }])[0];
const row = (over: Record<string, unknown> = {}) => ({ ...norm(), ...over }) as any;

describe("held status compat reader", () => {
  test("new keys pass through; met -> average (+hint); unmet -> none; unknown -> unevaluated", () => {
    for (const k of ["leading", "average", "partial", "none", "unevaluated"]) expect(norm({ held: { status: k, holders: ["A"] } }).held.status).toBe(k);
    const met = norm({ held: { status: "met", holders: ["A"] } });
    expect(met.held).toMatchObject({ status: "average", legacyStatus: "met", reassessHint: true });
    const unmet = norm({ held: { status: "unmet" } });
    expect(unmet.held.status).toBe("none");
    expect(unmet.held.legacyStatus).toBe("unmet");
    expect(unmet.held.reassessHint).toBeUndefined();
    expect(norm({ held: { status: "bogus" } }).held.status).toBe("unevaluated");
    expect(norm({ held: { status: "partial" } }).held.legacyStatus).toBeUndefined();
  });
  test("round-trip keeps the hint until a person changes the status; a new key never carries a stale marker", () => {
    const again = cg.normalizeGapRows(JSON.parse(JSON.stringify([norm({ held: { status: "met" } })])))[0];
    expect(again.held).toMatchObject({ status: "average", legacyStatus: "met", reassessHint: true });
    const resaved = norm({ held: { status: "leading", legacyStatus: "met", reassessHint: true, evidence: "e" } });
    expect(resaved.held.legacyStatus).toBeUndefined();
    expect(resaved.held.reassessHint).toBeUndefined();
  });
  test("labels and chips", () => {
    expect(cg.HELD_STATUS_LABEL).toEqual({ leading: "업계 리딩", average: "업계 평균", partial: "부분 보유", none: "미보유", unevaluated: "미판정" });
    expect(cg.HELD_STATUS_CHIP.none).toBe("status-red");
    expect(cg.NECESSITY_LABEL).toEqual({ essential: "필수", partial_essential: "부분 필수", optional: "선택" });
  });
});

describe("necessity and narrative caps", () => {
  test("necessity normalizes; scope note only for partial_essential, cap 120; alias necessityNote accepted", () => {
    expect(norm().necessity).toBe("");
    expect(norm({ necessity: "essential", necessityScopeNote: "x" }).necessityScopeNote).toBe("");
    expect(norm({ necessity: "bogus" }).necessity).toBe("");
    const p = norm({ necessity: "partial_essential", necessityScopeNote: "가".repeat(200) });
    expect(p.necessityScopeNote).toHaveLength(120);
    expect(norm({ necessity: "partial_essential", necessityNote: "범위" }).necessityScopeNote).toBe("범위");
  });
  test("requiredLevel/currentLevel are narrative, cap 400; existing short text untouched", () => {
    const r = norm({ requiredLevel: "가".repeat(500), currentLevel: "자체 경험 약간" });
    expect(r.requiredLevel).toHaveLength(400);
    expect(r.currentLevel).toBe("자체 경험 약간");
    expect(norm().requiredLevel).toBe("");
  });
  test("column order constant", () => {
    expect([...cg.CAPABILITY_COLUMN_ORDER]).toEqual(["capability", "necessity", "requiredLevel", "heldStatus", "currentLevel", "holders"]);
  });
});

describe("coverage (보유율)", () => {
  const r = (status: string, necessity = "") => norm({ held: { status }, necessity });
  test("weights leading 1, average 1, partial 0.5, none 0; unevaluated excluded", () => {
    const s = cg.summarizeGap([r("leading"), r("average"), r("partial"), r("none"), r("unevaluated")]);
    expect(s).toMatchObject({ total: 5, evaluated: 4, leading: 1, average: 1, partial: 1, none: 1, unevaluated: 1 });
    expect(s.coveragePct).toBe(63); // (1+1+0.5+0)/4 = 62.5
    expect(cg.summarizeGap([r("unevaluated")]).coveragePct).toBeNull();
  });
  test("legacy met keeps its coverage weight (reads as average)", () => {
    expect(cg.summarizeGap([r("met"), r("unmet")]).coveragePct).toBe(50);
  });
  test("essentialCoveragePct over 필수 rows only", () => {
    const s = cg.summarizeGap([r("none", "essential"), r("leading", "essential"), r("leading", "optional"), r("average")]);
    expect(s.essentialCoveragePct).toBe(50);
    expect(cg.summarizeGap([r("leading", "optional")]).essentialCoveragePct).toBeNull();
  });
});

describe("caution matrix (decision support only)", () => {
  const f = (n: string, h: string) => cg.necessityFlag(n as any, h as any)?.label ?? null;
  test("필수", () => { expect([f("essential", "leading"), f("essential", "average"), f("essential", "partial"), f("essential", "none"), f("essential", "unevaluated")]).toEqual([null, null, "큰 격차 주의", "큰 격차 주의", "미판정"]); });
  test("부분 필수", () => { expect([f("partial_essential", "average"), f("partial_essential", "partial"), f("partial_essential", "none")]).toEqual([null, "확인 필요", "격차"]); });
  test("선택 and 미정", () => {
    expect([f("optional", "leading"), f("optional", "none"), f("optional", "unevaluated")]).toEqual(["영향 낮음", "영향 낮음", "미판정"]);
    expect([f("", "none"), f("", "leading")]).toEqual([null, null]);
  });
  test("미기술 notes only on 필수 rows with empty narrative", () => {
    const labels = (o: any) => cg.gapCautions(row(o)).map((c) => c.label);
    expect(labels({ necessity: "essential", held: { status: "average", holders: [], evidence: "" } })).toEqual(["필요 수준 미기술", "보유 수준 미기술"]);
    expect(labels({ necessity: "essential", requiredLevel: "a", currentLevel: "b", held: { status: "average", holders: [], evidence: "" } })).toEqual([]);
    expect(labels({ necessity: "optional", held: { status: "average", holders: [], evidence: "" } })).toEqual(["영향 낮음"]);
    expect(labels({ necessity: "essential", held: { status: "unevaluated", holders: [], evidence: "" } })).toEqual(["미판정", "필요 수준 미기술"]);
  });
});

describe("AI held-draft normalizer", () => {
  test("new scale + 보유 수준 narrative; leading needs comparative evidence; legacy keys mapped; garbage rejected", () => {
    expect(cg.normalizeHeldDraft({ status: "leading", evidence: "업계 1위 근거", holders: ["A"], currentLevel: "상세" })).toMatchObject({ status: "leading", currentLevel: "상세" });
    expect(cg.normalizeHeldDraft({ status: "leading", evidence: "" })?.status).toBe("average");
    expect(cg.normalizeHeldDraft({ status: "met", evidence: "e" })?.status).toBe("average");
    expect(cg.normalizeHeldDraft({ status: "unevaluated", holders: ["A"], currentLevel: "x" })).toMatchObject({ holders: [], currentLevel: "", evidence: "" });
    expect(cg.normalizeHeldDraft({ status: "great" })).toBeNull();
    expect(cg.normalizeHeldDraft({ status: "none", currentLevel: "x".repeat(900) })?.currentLevel).toHaveLength(400);
  });
  test("the draft route never writes necessity or requiredLevel", () => {
    const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/api/opportunities/[id]/capability-gap/llm-draft/route.ts"), "utf8");
    expect(src).toContain("normalizeHeldDraft");
    expect(src).not.toMatch(/necessity:\s*d\./);
    expect(src).not.toMatch(/requiredLevel:\s*d\./);
  });
});

describe("row hash v2 and v1 compatibility", () => {
  const base = () => row({ requiredLevel: "숙련 필요", currentLevel: "기초", held: { status: "partial", holders: ["B", "A"], evidence: "e" } });
  test("v2 prefix; covers necessity, scope note, requiredLevel text, status, currentLevel text, holders, evidence", () => {
    const h = lk.capabilityRowHash(base());
    expect(h).toMatch(/^v2:[0-9a-f]{16}$/);
    const diffs: any[] = [{ necessity: "essential" }, { necessityScopeNote: "n" }, { requiredLevel: "x" }, { currentLevel: "x" }, { requiredNote: "x" }, { held: { status: "none", holders: ["B", "A"], evidence: "e" } }, { held: { status: "partial", holders: ["A"], evidence: "e" } }, { held: { status: "partial", holders: ["B", "A"], evidence: "z" } }];
    for (const d of diffs) expect(lk.capabilityRowHash({ ...base(), ...d })).not.toBe(h);
    for (const d of [{ id: "o" }, { note: "m" }, { source: "s1_factors" }, { resolution: "hire" }]) expect(lk.capabilityRowHash({ ...base(), ...d })).toBe(h);
  });
  const stamped = (r: any, hash: string) => ({ ...r, attainability: { closingCostKrwM: null, monthsToAttain: null, grade: "medium", rationale: "", evidence: [], draftedBy: "human", confirmedBy: "u", confirmedAt: NOW, basisHash: hash, staleSince: undefined } });
  test("v1 stamp on an untouched row is not stale (including a legacy met read as average)", () => {
    const plain = base();
    expect(lk.isStale(stamped(plain, lk.capabilityRowHashV1(plain)))).toBe(false);
    const legacy = norm({ held: { status: "met", holders: ["A"], evidence: "e" }, requiredLevel: "r", currentLevel: "c" });
    const v1 = lk.capabilityRowHashV1(legacy);
    expect(v1).toMatch(/^v1:/);
    expect(lk.isStale(stamped(legacy, v1))).toBe(false);
  });
  test("v1 stamp goes stale when a v1 field really changed, and on first necessity entry", () => {
    const plain = base();
    const stamp = lk.capabilityRowHashV1(plain);
    expect(lk.isStale(stamped({ ...plain, currentLevel: "changed" }, stamp))).toBe(true);
    expect(lk.isStale(stamped({ ...plain, necessity: "essential" }, stamp))).toBe(true);
    // a person re-selecting a held status on a legacy-met row is a real change
    const legacy = norm({ held: { status: "met" } });
    const s = lk.capabilityRowHashV1(legacy);
    expect(lk.isStale(stamped({ ...legacy, held: { status: "average", holders: [], evidence: "" } }, s))).toBe(true);
  });
  test("v2 stamp: first necessity entry invalidates; unchanged row is fresh", () => {
    const plain = base();
    const stamp = lk.capabilityRowHash(plain);
    expect(lk.isStale(stamped(plain, stamp))).toBe(false);
    expect(lk.isStale(stamped({ ...plain, necessity: "optional" }, stamp))).toBe(true);
  });
  test("register write re-stamps an untouched v1 judgement as v2 and invalidates the necessity-entry row", () => {
    const a = stamped({ ...base(), id: "a" }, lk.capabilityRowHashV1(base()));
    const b = stamped({ ...base(), id: "b", necessity: "essential" }, lk.capabilityRowHashV1(base()));
    const res = lk.applyRegisterLinkage([a, b], null, NOW, "u");
    expect(res.invalidated).toEqual(["b"]);
    const ra = res.rows.find((x: any) => x.id === "a")!;
    expect(ra.attainability?.basisHash).toBe(lk.capabilityRowHash(ra));
    expect(ra.attainability?.confirmedBy).toBe("u");
  });
  test("s3 changes list 필요도", () => {
    const plain = base();
    const snap = lk.s3SnapshotOf(plain);
    const r = { ...plain, necessity: "essential", attainability: { ...stamped(plain, lk.capabilityRowHash(plain)).attainability, s3Snapshot: snap } };
    expect(lk.s3Changes(r as any).map((c) => c.label)).toContain("필요도");
  });
});

describe("S3 table and modals (source structure)", () => {
  const read = (p: string) => readFileSync(join(PROJECT_ROOT, "app/web-next", p), "utf8");
  test("canonical column order and per-field controls", () => {
    const src = read("components/stages/synergy/SynergyLinkageTab.tsx");
    const heads = ["필요 역량", "필요도", "필요 수준", "보유 판정", "보유 수준", "보유 주체·근거", "해소 힌트"].map((h) => src.indexOf(`<th scope="col">${h}</th>`));
    expect(heads.every((i) => i >= 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
    for (const k of ["${r.capability} 필요도", "${r.capability} 필수 범위", "${r.capability} 보유 판정", "재판정 권장", "gapCautions(r)", 'field="필요 수준"', 'field="보유 수준"', "readOnly={!canCurate}"]) expect(src).toContain(k);
    expect(src).toContain("NECESSITY_NOTE_CAP");
    expect(src).not.toContain("LevelSelect");
  });
  test("narrative dialog: portal, dialog role, focus trap, 400 counter, read-only mode, 입력/수정/보기 labels", () => {
    const src = read("components/stages/CapabilityNarrativeDialog.tsx");
    for (const k of ['role="dialog"', 'aria-modal="true"', "useModalFocus(onClose)", "createPortal", "NARRATIVE_CAP", "readOnly ?", "ClampedText", "미입력", "narrativeButtonLabel"]) expect(src).toContain(k);
    expect(cg.NARRATIVE_CAP).toBe(400);
  });
  test("button label helper", async () => {
    const { narrativeButtonLabel } = await import("../../app/web-next/components/stages/CapabilityNarrativeDialog.tsx");
    expect([narrativeButtonLabel("", false), narrativeButtonLabel("x", false), narrativeButtonLabel("x", true), narrativeButtonLabel("", true)]).toEqual(["입력", "수정", "보기", "보기"]);
  });
  test("S5 shows the S3 narrative read-only (no LevelSelect import)", () => {
    const src = read("components/stages/GreenfieldStage.tsx");
    expect(src).not.toContain("LevelSelect");
    expect(src).toContain("필요 수준 (S3)");
  });
});

describe("S3 PUT route round trip", () => {
  const USER = "ha-analyst";
  let cookie = "";
  let oppId = "";
  const req = (path: string, init?: RequestInit) => nextRequest(path, init);
  const url = () => `/api/opportunities/${oppId}/capability-gap`;
  const put = (rows: unknown[]) => req(url(), { method: "PUT", headers: { cookie }, body: json({ rows }) });
  const stored = () => cg.parseGapRegister((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j).rows;

  beforeAll(async () => {
    await createUser(db, { userId: USER, role: "analyst", password: `pw-${USER}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await req("/api/auth/login", { method: "POST", body: json({ userId: USER, password: `pw-${USER}-12345` }) });
    cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "ha 기회", "산업", "selected", USER, NOW]);
    // pre-ADR-0172 stored register: legacy keys, short level text
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{ id: "a", capability: "A", source: "manual", held: { status: "met", holders: ["X"] }, requiredLevel: "숙련", currentLevel: "자체 경험" }, { id: "b", capability: "B", source: "manual", held: { status: "unmet" } }], updatedAt: NOW }), oppId]);
  });

  test("GET reads legacy keys through the compat reader", async () => {
    const res = await req(url(), { headers: { cookie } });
    const rows = ((await res.json()) as any).data.rows;
    expect(rows[0].held).toMatchObject({ status: "average", legacyStatus: "met", reassessHint: true });
    expect(rows[1].held.status).toBe("none");
    expect(rows[0].necessity).toBe("");
  });

  test("PUT accepts necessity, scope note, narrative and new keys; rewrites keys only on save", async () => {
    const rows = [
      { id: "a", capability: "A", source: "manual", necessity: "partial_essential", necessityNote: "인증 범위", held: { status: "leading", holders: ["X"], evidence: "업계 비교 근거" }, requiredLevel: "가".repeat(450), currentLevel: "보유 서술" },
      { id: "b", capability: "B", source: "manual", necessity: "bogus", held: { status: "unmet" } },
    ];
    const res = await put(rows);
    expect(res.status).toBe(200);
    const s = stored();
    expect(s[0]).toMatchObject({ necessity: "partial_essential", necessityScopeNote: "인증 범위", currentLevel: "보유 서술" });
    expect(s[0].held.status).toBe("leading");
    expect(s[0].held.legacyStatus).toBeUndefined();
    expect(s[0].requiredLevel).toHaveLength(400);
    expect(s[1].necessity).toBe("");
    expect(s[1].held.status).toBe("none");
    const raw = JSON.parse((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j);
    expect(raw.rows[0].held.status).toBe("leading");
    expect(raw.rows[1].held.status).toBe("none"); // legacy key rewritten by the person's save
  });
});
