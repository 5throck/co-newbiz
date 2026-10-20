// @version 1.0.0
/**
 * S8 technical lens (ADR-0169, slices 1-3): the technicalLens key must survive every
 * writer of opportunity.capability_gap_json (S3/S5 PUT, attainability writeRegister,
 * synergy merge, backfill), the parser/summary view model, the status rules of both
 * lenses, the summary route and the FS gate-brief line. No migration; warning only.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-technical-lens.sqlite");
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
const att = await import("../../app/web-next/lib/capability-attainability.ts");
const tl = await import("../../app/web-next/lib/technical-lens.ts");
const st = await import("../../app/web-next/lib/s8-lens-status.ts");
const { buildS8LensSummary } = await import("../../app/web-next/lib/s8-lens-summary.ts");
const view = await import("../../app/web-next/lib/business-goals-view.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "tl-lead";
const OUTSIDER = "tl-outsider";
let cookie = "";
let outsiderCookie = "";
let projectId = "";
let oppId = "";
const json = JSON.stringify;
const LENS = {
  version: 1,
  subjects: {
    project: { items: { T2: { status: "caution", rationale: "TRL 5", evidence: ["doc-1"], draftedBy: "human", confirmedBy: "u", confirmedAt: NOW, detail: { trlCurrent: 5 } } }, verification: {} },
    "target:abc": { items: {}, verification: { T2: { s8Ref: "target:abc/T2", result: "different", observed: "TRL 4", s8RevisionAt: NOW } } },
  },
  updatedAt: NOW,
  futureKey: { keep: "me" },
};
const storedRaw = () => (db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j;
const storedLens = () => (JSON.parse(storedRaw()) as { technicalLens?: unknown }).technicalLens;

beforeAll(async () => {
  for (const id of [LEAD, OUTSIDER]) {
    await createUser(db, { userId: id, role: "analyst", password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  outsiderCookie = await loginCookie(OUTSIDER, `pw-${OUTSIDER}-12345`);
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "tl 기회", "산업", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "대안 검토", LEAD, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "직접 진출", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  const rows = [
    { id: "r1", capability: "정밀 가공", source: "manual", held: { status: "unmet" }, requiredLevel: "숙련", currentLevel: "기초" },
    { id: "r2", capability: "품질 인증", source: "manual", held: { status: "met", holders: ["A사"] }, requiredLevel: "실무", currentLevel: "실무" },
  ];
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW, technicalLens: LENS }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "tl test" }).project.id;
});

describe("register writers keep technicalLens verbatim", () => {
  test("S3/S5 PUT /api/opportunities/:id/capability-gap carries it over and ignores a client-sent copy", async () => {
    const rows = cg.parseGapRegister(storedRaw()).rows;
    const res = await req(`/api/opportunities/${oppId}/capability-gap`, {
      method: "PUT", headers: { cookie },
      body: json({ rows: rows.map((r) => ({ ...r, note: "수정" })), technicalLens: { version: 1, subjects: { project: { items: { T3: { status: "met" } } } } } }),
    });
    expect(res.status).toBe(200);
    expect(storedLens()).toEqual(LENS); // verbatim, incl. unknown futureKey; the client copy is ignored
    expect(cg.parseGapRegister(storedRaw()).rows[0].note).toBe("수정");
  });

  test("attainability writeRegister keeps it", () => {
    const reg = att.readRegister(db, oppId)!;
    att.writeRegister(db, oppId, reg.rows, { actor: LEAD, action: "capability_attainability.save", target: "t", at: new Date().toISOString() });
    expect(storedLens()).toEqual(LENS);
  });

  test("a register without technicalLens stays without it (no key forged)", () => {
    const out = tl.serializeGapRegister([], NOW, json({ rows: [], updatedAt: NOW }));
    expect("technicalLens" in JSON.parse(out)).toBe(false);
    expect(tl.serializeGapRegister([], NOW, null)).toBe(json({ rows: [], updatedAt: NOW }));
    expect(tl.serializeGapRegister([], NOW, "not json")).toBe(json({ rows: [], updatedAt: NOW }));
  });

  test("every UPDATE of capability_gap_json in app/db/scripts goes through serializeGapRegister", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (["node_modules", ".next", "tests", "data", ".git"].includes(e)) continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) {
          const t = readFileSync(p, "utf8");
          if (/UPDATE opportunity SET[^;`"']*capability_gap_json/.test(t) && !/serializeGapRegister/.test(t)) hits.push(p.replace(PROJECT_ROOT, ""));
        }
      }
    };
    for (const d of ["app", "db", "scripts"]) walk(join(PROJECT_ROOT, d));
    expect(hits).toEqual([]);
  });
});

describe("technicalLens parse and summary", () => {
  test("tolerant normalize: unknown subjects/items dropped, confirmation needs both fields and a status", () => {
    const lens = tl.normalizeTechnicalLens({
      subjects: { project: { items: { T2: { status: "met", confirmedBy: "u" }, T9: { status: "met" } } }, "bad subject": { items: {} }, "target:x": { items: {}, verification: { T5: { s8Ref: "target:x/T5", result: "verified" } } } },
    });
    expect(Object.keys(lens.subjects).sort()).toEqual(["project", "target:x"]);
    expect(lens.subjects.project.items.T2?.confirmedBy).toBeNull();
    expect(lens.subjects.project.items).not.toHaveProperty("T9");
    expect(lens.subjects["target:x"].verification.T5?.result).toBe("verified");
    expect(tl.normalizeTechnicalLens("junk").subjects).toEqual({});
    expect(tl.parseTechnicalLens(null).version).toBe(1);
    expect(tl.isValidSubject("project")).toBe(true);
    expect(tl.isValidSubject("target:abc-1")).toBe(true);
    expect(tl.isValidSubject("target:")).toBe(false);
  });

  const row = (grade: any, confirmed = false) => ({ id: ulid(), capability: "c", source: "manual", requiredNote: "", held: { status: "met", holders: [], evidence: "" }, resolution: null, note: "", requiredLevel: "", currentLevel: "", ...(grade ? { attainability: { closingCostKrwM: null, monthsToAttain: null, grade, rationale: "r", evidence: [], draftedBy: "human", confirmedBy: confirmed ? "u" : null, confirmedAt: confirmed ? NOW : null } } : {}) }) as any;
  test("T1 derives from confirmed ADR-0168 rows; the lens stays 미판정 while T2-T6 have no judgement", () => {
    expect(tl.deriveT1([]).status).toBe("undetermined");
    expect(tl.deriveT1([row("high", true), row("medium", true)]).status).toBe("met");
    expect(tl.deriveT1([row("high", true), row(null)]).status).toBe("undetermined");
    expect(tl.deriveT1([row("high", false)]).status).toBe("undetermined");
    expect(tl.deriveT1([row("low", false), row("high", true)]).status).toBe("caution");
    const s = tl.summarizeTechnicalLens([row("high", true)], null);
    expect(s.total).toBe(6);
    expect(s.judged).toBe(1);
    expect(s.status).toBe("undetermined");
    expect(s.items.map((i) => i.key)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    // 2026-10-20 round 4: unjudged T2-T5 point at their S9 recording home, not a "next release"
    expect(s.items[1].note).toContain("S9 실사·검증");
    expect(s.items[5].note).toContain("0/4");
  });
  test("a fully judged lens is 충족 or 주의; mismatches counted; Brown Field T6 label", () => {
    const item = (status: string) => ({ status, confirmedBy: "u", confirmedAt: NOW, rationale: "r" });
    const lens = tl.normalizeTechnicalLens({ subjects: { project: { items: { T2: item("met"), T3: item("met"), T4: item("met"), T5: item("met") } } } });
    // round 4/5: T6 is the pairing progress — once T2-T5 are judged it is judged too, so a
    // fully judged T1-T5 lens is now fully judged (met here: every item met).
    expect(tl.summarizeTechnicalLens([row("high", true)], lens).status).toBe("met");
    const withMismatch = tl.normalizeTechnicalLens(LENS);
    expect(tl.summarizeTechnicalLens([], withMismatch, { subject: "target:abc", brownfield: true }).mismatchCount).toBe(1);
    expect(tl.summarizeTechnicalLens([], null, { brownfield: true }).items[5].label).toBe(tl.TECH_ITEM_LABEL_T6_BROWNFIELD);
    expect(tl.summarizeTechnicalLens([row("low", true)], lens).cautionCount).toBe(1);
  });
});

describe("financial lens status and strip view", () => {
  const base = { hasAdoptedCase: true, baseIrr: 0.18, hurdleIrr: 0.12, downsideNpvP50: 500, missedGoals: 0, goalCount: 2 };
  test("matrix: 미판정 / 충족 / 주의 (hurdle, missed goal, downside)", () => {
    expect(st.financialLensStatus({ ...base, hasAdoptedCase: false }).status).toBe("undetermined");
    expect(st.financialLensStatus({ ...base, baseIrr: null }).status).toBe("undetermined");
    expect(st.financialLensStatus(base).status).toBe("met");
    expect(st.financialLensStatus({ ...base, baseIrr: 0.1 }).status).toBe("caution");
    expect(st.financialLensStatus({ ...base, missedGoals: 1 }).status).toBe("caution");
    expect(st.financialLensStatus({ ...base, downsideNpvP50: -1 }).status).toBe("caution");
    expect(st.financialLensStatus({ ...base, downsideNpvP50: 0 }).status).toBe("met");
    // no confirmed hurdle: the comparison is skipped, not failed
    expect(st.financialLensStatus({ ...base, hurdleIrr: null, baseIrr: 0.01 }).status).toBe("met");
    expect(st.financialLensStatus({ ...base, baseIrr: 0.1, missedGoals: 2 }).reasons).toHaveLength(2);
  });
  test("strip: icon + text, warning only for technical 주의, goals line, caption", () => {
    const v = st.buildLensStripView({ status: "caution", judged: 6, total: 6, cautionCount: 1, worstItem: "기술 성숙도(TRL)" }, { status: "undetermined", reasons: [] }, { goalCount: 3, met: 2, hasCase: true });
    expect(v.technical.icon).toBe("!");
    expect(v.financial.label).toBe("미판정");
    expect(v.warning).toBe(st.TECHNICAL_CAUTION_WARNING);
    expect(v.goalsText).toBe("목표 3개 중 달성 2개");
    expect(v.caption).toContain("사람이 합니다");
    expect(st.buildLensStripView({ status: "met", judged: 6, total: 6, cautionCount: 0, worstItem: null }, { status: "met", reasons: [] }).warning).toBeNull();
    expect(st.goalsStatusText({ goalCount: 0, met: 0, hasCase: false })).toBe("목표 미설정");
    expect(st.goalsStatusText({ goalCount: 2, met: 0, hasCase: false })).toContain("채택 케이스 없음");
    expect(st.technicalLensBriefLine({ status: "undetermined", judged: 1, total: 6, cautionItems: ["a"] })).toContain("미판정 (판정 1/6, 주의 항목 a)");
  });
});

describe("summary route and gate brief (existing project: no backfill, 미판정)", () => {
  test("GET s8-lens-summary: members read, outsiders 404; both lenses 미판정, no number changes", async () => {
    const r = await req(`/api/projects/${projectId}/s8-lens-summary`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const d = ((await r.json()) as { data: any }).data;
    expect(d.technical.status).toBe("undetermined");
    expect(d.financial.status).toBe("undetermined");
    expect(d.subject).toBe("project");
    expect(d.technical.items[0].key).toBe("T1");
    expect(d.strip.goalsText).toBe("목표 미설정");
    expect((await req(`/api/projects/${projectId}/s8-lens-summary`, { headers: { cookie: outsiderCookie } })).status).toBe(404);
    expect((await req(`/api/projects/${projectId}/s8-lens-summary`)).status).toBe(401);
    // summary reads only: the stored register is unchanged
    expect(storedLens()).toEqual(LENS);
    expect(buildS8LensSummary(db, projectId).technical.mismatchCount).toBe(0);
  });

  test("fs gate manifest and brief carry one informational technical line", async () => {
    const gb = await import("../../app/web-next/lib/gate-brief.ts");
    expect(gb.gateManifest("project", "fs")).toContain("S8 기술적 타당성 요약(참고)");
    const ctx = gb.buildGateContext(db, "project", projectId, "fs");
    expect(ctx).toContain("기술적 타당성: 미판정");
    expect(ctx).toContain("승인 조건이 아닙니다");
    const syn = gb.synthesisGateBrief(db, "project", projectId, "fs", gb.gateManifest("project", "fs")!);
    expect(syn.key_evidence.join("\n")).toContain("기술적 타당성");
  });
});

describe("S8 tab aliases (deep-link compatibility)", () => {
  const r = (t: string | null | undefined, greenfield = false) => view.resolveS8Tab(t, { greenfield });
  test("alias table", () => {
    expect(r(null)).toBe("overview");
    expect(r("bogus")).toBe("overview");
    expect(r("financial")).toBe("overview");
    expect(r("scenarios")).toBe("scenarios");
    expect(r("wacc")).toBe("wacc");
    expect(r("financial-analysis")).toBe("financial-analysis");
    expect(r("goals")).toBe("goals");
    expect(r("technical")).toBe("technical");
    expect(r("technical#T2")).toBe("technical");
    expect(r("capability")).toBe("technical");
    for (const k of ["overview", "params", "target-costing", "decision"] as const) expect(r(k)).toBe(k);
    expect(r("targets", false)).toBe("targets");
    expect(r("targets", true)).toBe("overview");
  });
  test("parts and primary highlight", () => {
    expect(view.partOfS8Tab("goals")).toBe("goals");
    expect(view.partOfS8Tab("technical")).toBe("technical");
    for (const k of ["scenarios", "wacc", "financial-analysis", "overview", "params", "target-costing"] as const) { expect(view.partOfS8Tab(k)).toBe("financial"); expect(view.primaryKeyOfS8Tab(k)).toBe("financial"); }
    expect(view.partOfS8Tab("targets")).toBeNull();
    expect(view.primaryKeyOfS8Tab("targets")).toBe("targets");
    expect(view.partOfS8Tab("decision")).toBeNull();
    expect(view.primaryKeyOfS8Tab("decision")).toBe("decision");
    expect(view.S8_PART_VIEW.technical.purpose).toBe("실현할 수 있는가");
    expect(view.S8_PRIMARY_TAB_ORDER.length).toBeLessThanOrEqual(5);
  });
});
