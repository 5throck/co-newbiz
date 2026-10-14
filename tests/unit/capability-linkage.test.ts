// @version 1.0.0
/**
 * S3-S8 required-capability linkage (ADR-0170, slice 1): row hash, stale detection,
 * invalidation + history, removed rows, S8 read-only S3 fields, stale confirm guard,
 * summary/T1 counts, and source checks of the S3 table and the S8 panel.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-capability-linkage.sqlite");
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
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const lk = await import("../../app/web-next/lib/capability-linkage.ts");
const att = await import("../../app/web-next/lib/capability-attainability.ts");
const tl = await import("../../app/web-next/lib/technical-lens.ts");
const { buildS8LensSummary } = await import("../../app/web-next/lib/s8-lens-summary.ts");

const NOW = new Date().toISOString();
const json = JSON.stringify;
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const mkRow = (over: Record<string, unknown> = {}) =>
  ({ id: "r", capability: "정밀 가공", source: "manual", requiredNote: "", held: { status: "unmet", holders: [], evidence: "" }, resolution: null, note: "", requiredLevel: "숙련", currentLevel: "기초", ...over }) as any;

describe("sha256 and row hash", () => {
  test("pure sha256 matches node:crypto", () => {
    for (const msg of ["", "abc", "필요 역량 ".repeat(40), "x".repeat(55), "y".repeat(56), "z".repeat(64)]) {
      expect(lk.sha256Hex(msg)).toBe(createHash("sha256").update(msg).digest("hex"));
    }
  });
  test("stable across whitespace and holder order; versioned; empty equals missing", () => {
    const a = mkRow({ held: { status: "met", holders: ["B사", "A사"], evidence: " 근거 " }, requiredNote: " n " });
    const b = mkRow({ held: { status: "met", holders: ["A사", "B사"], evidence: "근거" }, requiredNote: "n" });
    expect(lk.capabilityRowHash(a)).toBe(lk.capabilityRowHash(b));
    expect(lk.capabilityRowHash(a)).toMatch(/^v2:[0-9a-f]{16}$/);
    expect(lk.capabilityRowHash(mkRow({ requiredLevel: "" }))).toBe(lk.capabilityRowHash(mkRow({ requiredLevel: undefined })));
  });
  test("changes on every S3-owned field, not on source/note/resolution/attainability/id", () => {
    const base = lk.capabilityRowHash(mkRow());
    const changed: Array<Record<string, unknown>> = [
      { capability: "다른 역량" }, { requiredNote: "x" }, { requiredLevel: "선도" }, { currentLevel: "숙련" },
      { held: { status: "met", holders: [], evidence: "" } }, { held: { status: "unmet", holders: ["A"], evidence: "" } }, { held: { status: "unmet", holders: [], evidence: "e" } },
    ];
    for (const c of changed) expect(lk.capabilityRowHash(mkRow(c))).not.toBe(base);
    const same: Array<Record<string, unknown>> = [{ id: "other" }, { source: "s2_sketch" }, { note: "memo" }, { resolution: "hire" }, { attainability: { grade: "low" } }];
    for (const c of same) expect(lk.capabilityRowHash(mkRow(c))).toBe(base);
  });
});

describe("stale and register linkage (pure)", () => {
  const judged = (over: Record<string, unknown> = {}) => {
    const row = mkRow(over);
    return { ...row, attainability: { closingCostKrwM: 10, monthsToAttain: 3, grade: "medium", rationale: "r", evidence: [], draftedBy: "human", confirmedBy: "u", confirmedAt: NOW, basisHash: lk.capabilityRowHash(row), s3Snapshot: lk.s3SnapshotOf(row) } } as any;
  };
  test("legacy judgement without basisHash is not stale; stamped one is stale after an S3 change", () => {
    const { attainability, ...bare } = judged();
    expect(lk.isStale({ ...bare, attainability: { ...attainability, basisHash: undefined } })).toBe(false);
    expect(lk.isStale(judged())).toBe(false);
    expect(lk.isStale({ ...judged(), requiredLevel: "선도" })).toBe(true);
  });
  test("invalidation clears confirmation, keeps prior values, writes history with snapshot; idempotent", () => {
    const changed = { ...judged(), requiredLevel: "선도" };
    const r1 = lk.applyRegisterLinkage([changed], null, "2026-01-01T00:00:00Z", "u1");
    expect(r1.invalidated).toEqual(["r"]);
    const a = r1.rows[0].attainability!;
    expect(a.confirmedAt).toBeNull();
    expect(a.grade).toBe("medium");
    expect(a.closingCostKrwM).toBe(10);
    expect(a.staleSince).toBe("2026-01-01T00:00:00Z");
    expect(a.history).toHaveLength(1);
    expect(a.history![0]).toMatchObject({ reason: "s3_changed", confirmedBy: "u", grade: "medium", s3Snapshot: { requiredLevel: "숙련" } });
    const again = lk.applyRegisterLinkage(r1.rows, null, "2026-01-02T00:00:00Z", "u1");
    expect(again.invalidated).toEqual([]);
    expect(again.rows[0].attainability!.history).toHaveLength(1);
    expect(lk.s3Changes(r1.rows[0]).map((c) => [c.label, c.before, c.after])).toEqual([["필요 수준", "숙련", "선도"]]);
  });
  test("history capped at 5 and reported", () => {
    let row = judged();
    let trimmedTotal = 0;
    for (let i = 0; i < 7; i++) {
      // re-judge on the current basis, then change S3 again
      row = { ...row, attainability: { ...row.attainability, staleSince: undefined, basisHash: lk.capabilityRowHash(row), confirmedBy: "u", confirmedAt: NOW } };
      row = { ...row, requiredNote: `n${i}` };
      const res = lk.applyRegisterLinkage([row], null, `2026-02-0${i + 1}T00:00:00Z`, "u");
      trimmedTotal += res.trimmed.length;
      row = res.rows[0];
    }
    expect(row.attainability.history).toHaveLength(5);
    expect(trimmedTotal).toBe(2);
  });
  test("an S3 change invalidates the judgement INCLUDING 기대 수준: confirmation cleared, prior text moved to history, pre-fill kept (ADR-0172)", () => {
    const base = judged({ resolution: "hire" });
    const row = { ...base, attainability: { ...base.attainability, expectedLevel: "영입 인력이 자체 수행 가능" } };
    // 기대 수준 is judgement-owned: editing it never changes the S3 hash, so it never stales a row on its own
    expect(lk.isStale({ ...row, attainability: { ...row.attainability, expectedLevel: "다른 기대 수준" } })).toBe(false);
    const edited = { ...row, requiredLevel: "선도" };
    const res = lk.applyRegisterLinkage([edited], json({ rows: [row], updatedAt: NOW }), "2026-03-01T00:00:00Z", "u2");
    expect(res.invalidated).toEqual(["r"]);
    const a = res.rows[0].attainability!;
    expect(a.confirmedBy).toBeNull();
    expect(a.staleSince).toBe("2026-03-01T00:00:00Z");
    expect(a.expectedLevel).toBe("영입 인력이 자체 수행 가능"); // pre-filled for the re-judgement
    expect(a.history?.[0].expectedLevel).toBe("영입 인력이 자체 수행 가능"); // and kept in history
  });
  test("rows deleted in S3 are archived (cap 30); same-state rewrite archives nothing", () => {
    const stored = json({ rows: [judged({ id: "keep" }), judged({ id: "gone" })], updatedAt: NOW });
    const keepOnly = [judged({ id: "keep" })];
    const res = lk.applyRegisterLinkage(keepOnly, stored, "2026-03-01T00:00:00Z", "u2");
    expect(res.archived).toEqual(["gone"]);
    expect(res.removed).toHaveLength(1);
    expect(res.removed[0]).toMatchObject({ rowId: "gone", removedBy: "u2", removedAt: "2026-03-01T00:00:00Z" });
    expect(res.removed[0].attainability?.grade).toBe("medium");
    expect(lk.applyRegisterLinkage(keepOnly, tl.serializeGapRegister(keepOnly, NOW, stored, undefined, res.removed), "2026-03-02T00:00:00Z", "u2").archived).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => judged({ id: `g${i}` }));
    const earlier = Array.from({ length: 3 }, (_, i) => ({ rowId: `old${i}`, capability: "c", requiredLevel: "", currentLevel: "", attainability: null, removedAt: NOW, removedBy: "u" }));
    const big = lk.applyRegisterLinkage([], json({ rows: many, removedCapabilities: earlier, updatedAt: NOW }), "2026-03-03T00:00:00Z", "u2");
    expect(big.removed).toHaveLength(30);
    expect(big.trimmed).toEqual(["old0", "old1", "old2"]); // oldest dropped, reported for the audit
  });
  test("serializer carries removedCapabilities verbatim for writers that pass no list; normalize round-trips the new keys", () => {
    const withRemoved = tl.serializeGapRegister([mkRow()], NOW, null, undefined, [{ rowId: "x", capability: "c", requiredLevel: "", currentLevel: "", attainability: null, removedAt: NOW, removedBy: "u" }]);
    const next = tl.serializeGapRegister([mkRow()], NOW, withRemoved);
    expect(cg.parseRemovedCapabilities(next)).toHaveLength(1);
    const j = judged();
    const [rt] = cg.normalizeGapRows([{ ...j, attainability: { ...j.attainability, staleSince: NOW, history: [{ grade: "low", invalidatedAt: NOW, reason: "s3_changed", basisHash: "v1:abc", s3Snapshot: lk.s3SnapshotOf(mkRow()) }] } }]);
    expect(rt.attainability?.basisHash).toBe(j.attainability.basisHash);
    expect(rt.attainability?.staleSince).toBe(NOW);
    expect(rt.attainability?.history?.[0].grade).toBe("low");
    expect(rt.attainability?.s3Snapshot?.requiredLevel).toBe("숙련");
  });
});

describe("routes", () => {
  const LEAD = "lk-lead";
  let leadCookie = "";
  let projectId = "";
  let oppId = "";
  const url = () => `/api/projects/${projectId}/capability-attainability`;
  const get = async () => ((await (await req(url(), { headers: { cookie: leadCookie } })).json()) as { data: any }).data;
  // ADR-0171: the writable judgement routes are the opportunity-scoped S5 routes; the project route is the S8 read-only summary.
  const oppUrl = () => `/api/opportunities/${oppId}/capability-attainability`;
  const put = (rows: unknown[]) => req(oppUrl(), { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows }) });
  const confirm = (body: unknown = {}) => req(`${oppUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json(body) });
  const s3Put = (rows: unknown[]) => req(`/api/opportunities/${oppId}/capability-gap`, { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows }) });
  const s3Rows = async () => ((await (await req(`/api/opportunities/${oppId}/capability-gap`, { headers: { cookie: leadCookie } })).json()) as any).data.rows as any[];
  const stored = () => cg.parseGapRegister((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j).rows;
  const audits = (action: string) => db.query("SELECT actor_user_id a, target FROM audit_log WHERE action = ? ORDER BY created_at, id").all(action) as Array<{ a: string; target: string }>;

  beforeAll(async () => {
    await createUser(db, { userId: LEAD, role: "analyst", password: `pw-${LEAD}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: LEAD, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await req("/api/auth/login", { method: "POST", body: json({ userId: LEAD, password: `pw-${LEAD}-12345` }) });
    leadCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "lk 기회", "산업", "selected", LEAD, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "t", "대안", LEAD, NOW]);
    db.run(`INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`, [ulid(), oppId, "직접 진출", "M&A", "t", LEAD, NOW, NOW]);
    const rows = [
      { id: "a", capability: "정밀 가공", source: "manual", held: { status: "unmet" }, requiredLevel: "숙련", currentLevel: "기초" },
      { id: "b", capability: "품질 인증", source: "manual", held: { status: "met", holders: ["A사"] }, requiredLevel: "실무", currentLevel: "실무" },
      { id: "c", capability: "물류", source: "manual", held: { status: "partial", holders: ["B사"] }, requiredLevel: "실무", currentLevel: "기초" },
    ];
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), oppId]);
    for (const gate of ["screening", "pre_fs"]) db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
    projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "lk" }).project.id;
  });

  test("S5 PUT rejects every S3-owned field with 400 s3_owned_field", async () => {
    for (const patch of [{ capability: "x" }, { requiredNote: "x" }, { held: { status: "met" } }, { requiredLevel: "숙련" }, { currentLevel: "실무" }]) {
      const r = await put([{ id: "a", ...patch }]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).error.code).toBe("s3_owned_field");
    }
    expect(stored().find((x) => x.id === "a")!.requiredLevel).toBe("숙련");
  });

  test("legacy judgements (no basisHash) read as not stale; a save stamps the basis server-side", async () => {
    const legacy = stored().map((x) => (x.id === "b" ? { ...x, attainability: { closingCostKrwM: null, monthsToAttain: null, grade: "medium", rationale: "", evidence: [], draftedBy: "human", confirmedBy: "old", confirmedAt: NOW } } : x));
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: legacy, updatedAt: NOW }), oppId]);
    let v = await get();
    expect(v.rows.find((x: any) => x.id === "b")).toMatchObject({ stale: false, basis_hash: null, confirmed_by: "old" });
    expect(v.summary.stale).toBe(0);
    const res = await put([{ id: "a", grade: "medium", rationale: "내부 인력으로 가능", closingCostKrwM: 100, monthsToAttain: 6, basisHash: "forged" }]);
    expect(res.status).toBe(200);
    const a = stored().find((x) => x.id === "a")!;
    expect(a.attainability?.basisHash).toBe(lk.capabilityRowHash(a));
    expect(a.attainability?.basisHash).not.toBe("forged");
    expect(a.attainability?.s3Snapshot?.requiredLevel).toBe("숙련");
    expect(((await confirm({})).status)).toBe(200);
    v = await get();
    expect(v.rows.find((x: any) => x.id === "a").confirmed_by).toBe(LEAD);
    // rows that were already confirmed before the deploy stay unstamped (and so not stale) until the one-off stamp (OD-4)
    expect(stored().find((x) => x.id === "b")!.attainability?.basisHash).toBeUndefined();
  });

  test("S3 change invalidates only the changed row: confirmation cleared, history, audit under the caller", async () => {
    const rows = await s3Rows();
    const edited = rows.map((x) => (x.id === "a" ? { ...x, requiredLevel: "선도" } : x));
    expect((await s3Put(edited)).status).toBe(200);
    const a = stored().find((x) => x.id === "a")!;
    const b = stored().find((x) => x.id === "b")!;
    expect(a.attainability?.confirmedAt).toBeNull();
    expect(a.attainability?.grade).toBe("medium"); // prior value stays pre-filled
    expect(a.attainability?.closingCostKrwM).toBe(100);
    expect(a.attainability?.history).toHaveLength(1);
    expect(a.attainability?.history?.[0].confirmedBy).toBe(LEAD);
    expect(a.attainability?.staleSince).toBeTruthy();
    expect(b.attainability?.confirmedAt).toBeTruthy(); // untouched
    const ev = audits("capability_attainability.invalidate");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ a: LEAD, target: `${oppId}#capability-stale:a` });

    const v = await get();
    const va = v.rows.find((x: any) => x.id === "a");
    expect(va).toMatchObject({ stale: true, confirmed_at: null, grade: "medium", history_count: 1 });
    expect(va.s3_changes).toEqual([{ field: "requiredLevel", label: "필요 수준", before: "숙련", after: "선도" }]);
    expect(va.prior.confirmedBy).toBe(LEAD);
    expect(v.summary.stale).toBe(1);
    expect(v.summary.grades.unjudged).toBeGreaterThanOrEqual(2); // a (stale) and c
    expect(v.summary.bannerReasons).toContain("stale");
    expect(v.summary.confirmed).toBe(1);
  });

  test("save without S3 content change keeps confirmation (typo-free re-save of identical S3 data)", async () => {
    const rows = await s3Rows();
    expect((await s3Put(rows)).status).toBe(200);
    expect(stored().find((x) => x.id === "b")!.attainability?.confirmedAt).toBeTruthy();
    expect(audits("capability_attainability.invalidate")).toHaveLength(1); // no new event
  });

  test("lens T1 and gate-brief/strip data count stale rows as unjudged and report 재판정 필요", async () => {
    const lens = buildS8LensSummary(db, projectId);
    expect(lens.technical.staleCount).toBe(1);
    expect(lens.technical.items[0].status).not.toBe("met");
    expect(lens.technical.items[0].note).toContain("재판정 필요 1건");
    expect(lens.strip.technical.staleCount).toBe(1);
    const { technicalLensBriefLine } = await import("../../app/web-next/lib/s8-lens-status.ts");
    expect(technicalLensBriefLine({ status: "undetermined", judged: 0, total: 6, cautionItems: [], staleCount: 2 })).toContain("재판정 필요 2건");
    expect(technicalLensBriefLine({ status: "undetermined", judged: 0, total: 6, cautionItems: [] })).not.toContain("재판정");
  });

  test("confirm on a stale row without a fresh save is rejected; a fresh save re-stamps and unlocks it", async () => {
    const r = await confirm({ row_ids: ["a"] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("stale_requires_rejudge");
    // default confirm (all) skips stale rows; nothing else awaits confirmation but "c" is unjudged -> only stale remain
    const all = await confirm({});
    expect([400, 409]).toContain(all.status);
    // re-judge with the same values: a save is the re-judgement
    expect((await put([{ id: "a", rationale: "내부 인력으로 가능" }])).status).toBe(200);
    const a = stored().find((x) => x.id === "a")!;
    expect(a.attainability?.staleSince).toBeUndefined();
    expect(a.attainability?.basisHash).toBe(lk.capabilityRowHash(a));
    expect(a.attainability?.history).toHaveLength(1); // history kept
    expect((await confirm({ row_ids: ["a"] })).status).toBe(200);
    const v = await get();
    expect(v.rows.find((x: any) => x.id === "a")).toMatchObject({ stale: false, confirmed_by: LEAD });
  });

  test("row deleted in S3 is archived with its judgement, audited, and shown by the S8 GET", async () => {
    const rows = (await s3Rows()).filter((x) => x.id !== "a");
    expect((await s3Put(rows)).status).toBe(200);
    expect(stored().map((x) => x.id)).toEqual(["b", "c"]);
    const removed = cg.parseRemovedCapabilities((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ rowId: "a", capability: "정밀 가공", removedBy: LEAD });
    expect(removed[0].attainability?.grade).toBe("medium");
    expect(audits("capability_attainability.archive_removed")).toEqual([{ a: LEAD, target: `${oppId}#capability-removed:a` }]);
    const v = await get();
    expect(v.removed_capabilities).toHaveLength(1);
    // a later S8 write and an S3 write keep the archive
    await put([{ id: "c", grade: "medium" }]);
    expect((await get()).removed_capabilities).toHaveLength(1);
    expect(cg.parseRemovedCapabilities((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j)).toHaveLength(1);
  });

  test("no lost update: an S3 edit made after the S8 page loaded survives an S8 save with an older page", async () => {
    // c: judged and confirmed on the current S3 basis
    expect((await put([{ id: "c", grade: "medium", rationale: "물류 위탁 가능" }])).status).toBe(200);
    expect((await confirm({ row_ids: ["c"] })).status).toBe(200);
    const loaded = (await get()).rows.find((x: any) => x.id === "c"); // the S8 page "loads" here
    expect(loaded.stale).toBe(false);
    // meanwhile S3 changes held status and levels
    const rows = (await s3Rows()).map((x) => (x.id === "c" ? { ...x, requiredLevel: "숙련", currentLevel: "숙련", held: { ...x.held, status: "met", evidence: "새 근거" } } : x));
    expect((await s3Put(rows)).status).toBe(200);
    const afterS3 = stored().find((x) => x.id === "c")!;
    // the old page still tries to write its stale copy of the S3 values: rejected, nothing written
    const old = await put([{ id: "c", requiredLevel: loaded.required_level, currentLevel: loaded.current_level, grade: "high", rationale: "x" }]);
    expect(old.status).toBe(400);
    expect(((await old.json()) as any).error.code).toBe("s3_owned_field");
    // the old page's real save (S8-owned fields + the hash it showed) merges onto the live register
    const saved = await put([{ id: "c", s3Hash: loaded.s3_hash, grade: "medium", rationale: "물류 위탁 가능(수정)", resolution: "partner" }]);
    expect(saved.status).toBe(200);
    const c = stored().find((x) => x.id === "c")!;
    expect(c.requiredLevel).toBe("숙련");
    expect(c.currentLevel).toBe("숙련");
    expect(c.held).toEqual(afterS3.held);
    expect(c.held.status).toBe("average");
    expect(c.resolution).toBe("partner");
    expect(c.attainability?.rationale).toBe("물류 위탁 가능(수정)");
    // judged on a basis that is no longer current: stale, unconfirmed, must be re-judged
    expect(lk.isStale(c)).toBe(true);
    expect(c.attainability?.confirmedAt).toBeNull();
    const view = (await get()).rows.find((x: any) => x.id === "c");
    expect(view).toMatchObject({ stale: true, confirmed_at: null, required_level: "숙련", held_status: "average" });
    expect((await confirm({ row_ids: ["c"] })).status).toBe(400);
  });

  test("the S8 view exposes held holders and evidence read-only", async () => {
    const v = await get();
    expect(v.rows.find((x: any) => x.id === "b")).toMatchObject({ held_holders: ["A사"], held_evidence: "" });
  });
});

describe("held summary preview", () => {
  test("empty: no parts (single muted 미입력 rendered); filled: labelled parts only", async () => {
    const { heldSummaryParts, holdersPreview, evidencePreview } = await import("../../app/web-next/components/stages/CapabilityHeldDialog.tsx");
    expect(heldSummaryParts([], "  ")).toEqual([]);
    expect(heldSummaryParts(["A사"], "")).toEqual([{ label: "주체", text: "A사" }]);
    expect(heldSummaryParts([], "인증 보유")).toEqual([{ label: "근거", text: "인증 보유" }]);
    expect(heldSummaryParts(["A", "B"], "x").map((p) => p.label)).toEqual(["주체", "근거"]);
    expect(holdersPreview([])).toBe("");
    expect(evidencePreview("")).toBe("");
  });
  test("previews use HeldSummary with no per-field 미입력", () => {
    const root = join(PROJECT_ROOT, "app/web-next/components/stages");
    for (const f of ["synergy/SynergyLinkageTab.tsx", "CapabilityJudgementTable.tsx"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).toContain("<HeldSummary");
      expect(src).not.toContain("holdersPreview(");
      expect(src).not.toContain("evidencePreview(");
    }
    const dlg = readFileSync(join(root, "CapabilityHeldDialog.tsx"), "utf8");
    expect(dlg).not.toContain('? "미입력"');
  });
});

describe("UI source checks", () => {
  const read = (p: string) => readFileSync(join(PROJECT_ROOT, "app/web-next", p), "utf8");
  test("S3 register table has no 5-step level columns; keeps 보유 판정, holders/evidence button, 해소 힌트", () => {
    const src = read("components/stages/synergy/SynergyLinkageTab.tsx");
    // ADR-0172: the narrative 필요 수준 / 보유 수준 columns are back (modal-based, no 5-step select).
    expect(src).not.toContain("LevelSelect");
    expect(src).toContain('<th scope="col">필요 역량</th><th scope="col">필요도</th><th scope="col">필요 수준</th><th scope="col">보유 판정</th>');
    expect(src).toContain('<th scope="col">보유 수준</th><th scope="col">보유 주체·근거</th><th scope="col">해소 힌트</th>');
    expect(src).toContain("${r.capability} 보유 판정");
    expect(src).toContain("${r.capability} 해소 힌트");
    expect(src).toContain("보유 주체·근거 ${canCurate");
    expect(src).not.toContain("보유 주체`}");
    expect(src).not.toContain('placeholder="근거(프로필 인용)"');
    expect(src).toContain("읽기 전용으로 표시됩니다");
    expect(src).not.toContain("<fieldset");
  });
  test("held dialog: portal, dialog role, focus trap, caps, counter, read-only mode", () => {
    const src = read("components/stages/CapabilityHeldDialog.tsx");
    for (const k of ['role="dialog"', 'aria-modal="true"', "useModalFocus(onClose)", "createPortal", "HOLDERS_MAX = 6", "HOLDER_LEN = 120", "EVIDENCE_MAX = 400", "rows={8}", "readOnly ?"]) expect(src).toContain(k);
  });
  test("S8 panel is a read-only summary: shared table, no inputs or save/confirm of its own, S5 link", () => {
    const src = read("components/stages/CapabilityAttainabilityPanel.tsx");
    expect(src).not.toContain("LevelSelect");
    expect(src).not.toContain("<input");
    expect(src).not.toContain("<select");
    expect(src).not.toContain("초안 저장");
    expect(src).not.toContain("판정 확정");
    expect(src).not.toContain("api.put");
    expect(src).not.toContain("api.post");
    expect(src).toContain("editable={false}");
    expect(src).toContain("S5에서 판정");
    expect(src).toContain("/s5`");
    expect(src).toContain("/s3`");
    const tbl = read("components/stages/CapabilityJudgementTable.tsx");
    expect(tbl).toContain("S3 변경 — 재판정 필요");
    expect(tbl).toContain("삭제된 역량 (판정 이력)");
    expect(tbl).toContain("보유 주체·근거 보기");
    expect(tbl).toContain("재판정 필요 {s.stale}");
    expect(tbl).not.toContain("LevelSelect");
  });
});

describe("single register write path (R5)", () => {
  test("only capability-register-write.ts updates opportunity.capability_gap_json in app code and scripts", async () => {
    const { Glob } = await import("bun");
    const offenders: string[] = [];
    for (const pattern of ["app/web-next/{app,lib}/**/*.ts", "scripts/co-newbiz/**/*.ts"]) {
      for await (const f of new Glob(pattern).scan({ cwd: PROJECT_ROOT })) {
        if (f.endsWith("capability-register-write.ts") || f.includes("seed-")) continue;
        if (/SET\s+capability_gap_json/i.test(readFileSync(join(PROJECT_ROOT, f), "utf8"))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
