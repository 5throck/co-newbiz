// @version 1.0.0
/**
 * ADR-0199 / spec 2026-11-16-s6-bulk-ai-eval-versioning Row 2c — the S6 bulk AI evaluation engine and routes A1-A8.
 * Scratch SQLite; the DART client, the LLM and the web-search provider are replaced by the engine's injected seams, so
 * nothing leaves the process.
 *
 * Covers T1, T3-T11, T13-T15, T21, T23, T25 (route-table scan) and the A5/A7/A8 additions.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TMP = mkdtempSync(join(tmpdir(), "bf-bulk-"));
const DB_PATH = join(TMP, "t.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
const savedKey = process.env.DART_API_KEY;
process.env.DART_API_KEY = ["dart", "bulk", "key"].join("-");

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const repo = await import("../../db/repositories/brownfield-eval-draft.repository.ts");
const cache = await import("../../db/repositories/dart-evidence-cache.repository.ts");
const bulk = await import("../../app/web-next/lib/brownfield-eval-bulk.ts");
const { listOrSeedCriteria, addCustomCriterion, updateCriterionRubric } = await import(
  "../../app/web-next/lib/brownfield-eval-criteria.ts"
);
const { InProcessRestPort, isHumanOnly, HUMAN_ONLY_ROUTES } = await import(
  "../../app/web-next/lib/mcp/in-process-port.ts"
);

afterAll(() => {
  bulk.setBulkEvalDepsForTests(null);
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
  if (savedKey === undefined) delete process.env.DART_API_KEY;
  else process.env.DART_API_KEY = savedKey;
});

const NOW = "2026-11-16T03:00:00.000Z";
const ANALYST = "bulk-analyst";
const VIEWER = "bulk-viewer";
let analystCookie = "";
let viewerCookie = "";
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function login(userId: string): Promise<string> {
  const res = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId, password: `pw-${userId}-12345` }),
  });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const post = (path: string, body: unknown, cookie = analystCookie) =>
  req(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = analystCookie) => req(path, { headers: { cookie } });
const data = async (res: Response) => (await res.json()) as { data: any; meta: any; error: any };

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
const OPP = ulid();
const CORP_A = "00000001";
const CORP_B = "00000002";
const REPORT_A = "20260301000101";
const REPORT_B = "20260301000102";
const BODY = [
  "II. 사업의 내용 1. 사업의 개요 당사는 정밀 부품 제조사입니다.",
  "2. 주요 제품 및 서비스 가. 주요 제품 현황 당사의 주요 제품은 선박용 크랭크샤프트입니다. 매출의 70%를 차지합니다.",
  "3. 생산설비 가. 생산능력 연간 12,000톤 규모의 단조 설비를 보유합니다.",
  "4. 연구개발활동 나. 연구개발 비용 당기 연구개발비용은 매출액 대비 3.2%인 45억원입니다. 당사는 핵심 단조 공정 개선을 위해 기술연구소를 운영하며 신규 공정 개발 과제를 지속적으로 수행하고 있습니다.",
  "5. 지적재산권 당사는 국내 특허 42건을 보유하고 있으며 핵심 단조 공정에 관한 특허 포트폴리오를 지속적으로 확대하고 있습니다. 해외 출원도 진행 중입니다.",
  "III. 재무에 관한 사항 요약 재무정보 표시",
].join(" ");
const QUOTE = "연구개발비용은 매출액 대비 3.2%인 45억원";

const T: Record<"A" | "B" | "N", string> = { A: ulid(), B: ulid(), N: ulid() };
const NAME: Record<"A" | "B" | "N", string> = { A: "가나다에이", B: "가나다비", N: "비상장엔" };

beforeAll(async () => {
  for (const [id, role] of [
    [ANALYST, "analyst"],
    [VIEWER, "viewer"],
  ] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await login(ANALYST);
  viewerCookie = await login(VIEWER);

  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    OPP,
    "비밀프로젝트오퍼",
    "선박 부품",
    "selected",
    ANALYST,
    NOW,
  ]);
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
    JSON.stringify({
      rows: [
        { id: "g1", capability: "정밀 단조 역량", resolution: "partner" },
        { id: "g2", capability: "특허 포트폴리오", resolution: "partner" },
      ],
      updatedAt: NOW,
    }),
    OPP,
  ]);
  const mk = (id: string, name: string, corp: string | null) => {
    db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [
      ulid(),
      name,
      corp,
      NOW,
    ]);
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [id, OPP, name, corp, NOW, NOW],
    );
  };
  mk(T.A, NAME.A, CORP_A);
  mk(T.B, NAME.B, CORP_B);
  mk(T.N, NAME.N, null);
  listOrSeedCriteria(OPP, ANALYST, db); // 4 builtin financial + 2 seeded technical
});

// ── injected seams ───────────────────────────────────────────────────────────────────────────────────────────────
const c = {
  fetch: 0,
  fetchYears: [] as number[][],
  list: 0,
  text: 0,
  validate: 0,
  llm: 0,
  llmCompanies: [] as string[],
  web: [] as string[],
  used: 0,
};
let clock = NOW;
let gate: Promise<void> | null = null;
let llmMode: "ok" | "fail" | "disclosure_only" | "insufficient" = "ok";
const webConfigured = true;
let onFetch: (() => void) | null = null;
let dartConfigured = true;
let llmConfigured = true;

const reportFor = (corp: string) => (corp === CORP_A ? REPORT_A : REPORT_B);

function deps(): Partial<import("../../app/web-next/lib/brownfield-eval-bulk.ts").BulkEvalDeps> {
  return {
    now: () => clock,
    isDartConfigured: () => dartConfigured,
    isLlmConfigured: () => llmConfigured,
    budget: () => ({ calls: c.used, budget: 15_000 }),
    validator: (async () => {
      c.validate++;
      return { validated: true };
    }) as any,
    fetcher: (async (corp: string, opts: { fiscalYears?: number[]; years?: number } = {}) => {
      c.fetch++;
      onFetch?.();
      const years = opts.fiscalYears ?? [2021, 2022, 2023, 2024, 2025];
      c.fetchYears.push(years);
      const yearly = years.map((y) => ({
        year: String(y),
        items: [
          { name: "매출액", value: 1_000_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
          { name: "영업이익", value: 100_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
          { name: "당기순이익", value: 60_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
          { name: "자산총계", value: 2_000_000_000, unit: "KRW" },
          { name: "부채총계", value: 800_000_000, unit: "KRW" },
          { name: "자본총계", value: 1_200_000_000, unit: "KRW" },
        ],
      }));
      return {
        corpCode: corp,
        found: true,
        items: [],
        yearly,
        yearOutcomes: years.map((year) => ({ year, outcome: "found" as const })),
        integrity: "ok",
      };
    }) as any,
    listDisclosuresSince: (async (corp: string) => {
      c.list++;
      return {
        complete: true,
        rows: [
          {
            rcept_no: reportFor(corp),
            corp_code: corp,
            corp_name: "x",
            report_nm: "사업보고서 (2025.12)",
            rcept_dt: "20260301",
            flr_nm: null,
            rm: null,
          },
        ],
      };
    }) as any,
    fetchDisclosureText: (async (rcept: string) => {
      c.text++;
      return { available: true, rcept_no: rcept, text: BODY };
    }) as any,
    complete: (async (messages: Array<{ content: string }>) => {
      c.llm++;
      const user = messages[messages.length - 1].content;
      c.llmCompanies.push(user.split("\n")[0] ?? "");
      if (gate) await gate;
      if (llmMode === "fail") return { source: "synthesis", provider: "deterministic", text: "" };
      const ids = [...user.matchAll(/^- (\S+) — /gm)].map((m) => m[1]);
      const rcept = user.includes(REPORT_A) ? REPORT_A : REPORT_B;
      if (llmMode === "disclosure_only") {
        const dd: Record<string, unknown> = {};
        for (const id of ids)
          dd[id] = {
            verdict: "pass",
            rationale: "공시 제목만",
            citations: [
              { kind: "disclosure", ref: rcept, quote: "사업보고서 (2025.12)" },
              { kind: "profile", ref: "profile", quote: "강점" },
            ],
          };
        return { source: "llm", provider: "fake", text: JSON.stringify({ drafts: dd }) };
      }
      if (llmMode === "insufficient") {
        const dd: Record<string, unknown> = {};
        for (const id of ids) dd[id] = { verdict: "insufficient", rationale: "근거 부족" };
        return { source: "llm", provider: "fake", text: JSON.stringify({ drafts: dd }) };
      }
      const drafts: Record<string, unknown> = {};
      ids.forEach((id, i) => {
        // The model only names an evidence number: the first item the first window listed for it, the rest a number
        // that matches nothing (and one "insufficient" answer).
        const first = user.match(new RegExp(`^${id}:\\n\\s+\\[(\\d+)\\]`, "m"));
        drafts[id] =
          i === 0 && first
            ? { verdict: "pass", rationale: "R&D 근거 확인", source_index: Number(first[1]) }
            : { verdict: "pass", rationale: "근거 없는 주장", source_index: 99 };
      });
      return { source: "llm", provider: "fake", text: JSON.stringify({ drafts }) };
    }) as any,
    isWebConfigured: () => webConfigured,
    webSearch: async (q: string) => {
      c.web.push(q);
      return [{ title: "기사", url: "https://news.example.com/a", snippet: "정밀 단조 관련 보도" }];
    },
  };
}

async function settle(runId: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (!bulk.isEngineActive(runId)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("engine did not settle");
}
const runOf = (id: string) => repo.getRun(db, id)!;
const itemOf = (runId: string, key: "A" | "B" | "N") =>
  repo.listRunItems(db, runId).find((i) => i.brownfield_target_id === T[key])!;
const auditActions = () =>
  db
    .query("SELECT action, target, actor_user_id FROM audit_log WHERE action LIKE 'target_eval.%' ORDER BY rowid")
    .all() as Array<{ action: string; target: string; actor_user_id: string }>;
const evalStateCount = () => (db.query("SELECT COUNT(*) n FROM brownfield_target_eval_state").get() as { n: number }).n;
const startRoute = (body: Record<string, unknown> = {}) => post(`/api/brownfield/${OPP}/eval-draft-runs`, body);
const targetsList = async () => (await data(await get(`/api/brownfield/${OPP}/targets`))).data.targets as any[];
const critIds = (cat: "financial" | "technical") =>
  db
    .query(
      "SELECT id, label FROM brownfield_eval_criterion WHERE opportunity_id = ? AND category = ? AND deleted_at IS NULL AND retired_at IS NULL ORDER BY created_at",
    )
    .all(OPP, cat) as Array<{ id: string; label: string }>;
const latest = (key: "A" | "B", cat: "financial" | "technical") => repo.getLatestVersion(db, T[key], cat);

let run1 = "";
let summaryBefore: unknown;

describe("A1 start + engine happy path (T7, T13, T4, T11, T12)", () => {
  test("auth: a viewer cannot start a run (403); drafting is a proposal, so no human-only gate on A1", async () => {
    expect((await post(`/api/brownfield/${OPP}/eval-draft-runs`, {}, viewerCookie)).status).toBe(403);
    expect(isHumanOnly("POST", `/api/brownfield/${OPP}/eval-draft-runs`, {})).toBe(false);
  });

  test("bad bodies are 400; an unknown opportunity is 404", async () => {
    expect((await startRoute({ categories: "all" })).status).toBe(400);
    expect((await startRoute({ web_evidence: "yes" })).status).toBe(400);
    expect((await startRoute({ target_ids: ["nope"] })).status).toBe(400);
    expect((await post(`/api/brownfield/${ulid()}/eval-draft-runs`, {})).status).toBe(404);
  });

  test("start returns 202, reuses the active run (T13), skips the non-DART candidate (T7), and a version only lands on success", async () => {
    summaryBefore = (await targetsList()).map((t) => t.eval_summary);
    bulk.setStartCooldownForTests(0);
    bulk.setBulkEvalDepsForTests(deps());
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    const res = await startRoute({});
    expect(res.status).toBe(202);
    const body = await data(res);
    run1 = body.data.run_id;
    expect(body.meta.reused).toBe(false);
    // while the engine is blocked inside the LLM step: the second start reuses the same run (T13)
    for (let i = 0; i < 200 && c.llm === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const again = await data(await startRoute({}));
    expect(again.data.run_id).toBe(run1);
    expect(again.meta.reused).toBe(true);
    // 0196 dropped 0194's one-active-run partial unique index; the cap is enforced in code now, so a raw second
    // active run row is insertable (the fixture candidate set matches no active run, hence reused=false below).
    db.run(
      "INSERT INTO brownfield_eval_draft_run (id, opportunity_id, categories, status, total_targets, started_by, started_via, started_at, heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), OPP, "both", "running", 1, "x", "ui", NOW, NOW],
    );
    db.run("UPDATE brownfield_eval_draft_run SET status = 'completed' WHERE opportunity_id = ? AND started_by = 'x'", [
      OPP,
    ]);
    // T4: mid-candidate the progress route shows the step and the longlist shows no (previous) version yet
    const prog = (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/latest`))).data;
    expect(prog.run.id).toBe(run1);
    expect(prog.items.find((i: any) => i.brownfield_target_id === T.A).state).toBe("technical_draft");
    expect(prog.budget.reserve).toBe(1500);
    release();
    gate = null;
    await settle(run1);
    expect(runOf(run1).status).toBe("completed");
  });

  test("outcomes: financial + technical versions for DART candidates, skipped_not_dart without any LLM/web call", async () => {
    for (const k of ["A", "B"] as const) {
      const it = itemOf(run1, k);
      expect(it.state).toBe("done");
      expect(it.financial_outcome).toBe("versioned");
      expect(it.technical_outcome).toBe("versioned");
      expect(latest(k, "financial")?.version_no).toBe(1);
      expect(latest(k, "financial")?.evidence_grade).toBe("A");
      expect(latest(k, "technical")?.evidence_grade).toBe("C");
    }
    const n = itemOf(run1, "N");
    expect(n.state).toBe("skipped_not_dart");
    expect(repo.getLatestVersion(db, T.N, "financial")).toBeNull();
    expect(c.llmCompanies.some((x) => x.includes(NAME.N))).toBe(false);
    expect(c.web).toEqual([]); // T15: no web call by default
    const chips = await targetsList();
    expect(chips.find((t) => t.id === T.N).eval_draft.run_item.state).toBe("skipped_not_dart");
    expect(chips.find((t) => t.id === T.A).eval_draft.financial.version_no).toBe(1);
    expect(chips.find((t) => t.id === T.A).eval_draft.technical.evidence_grade).toBe("C");
    // ADR-0200 §8 A8: eval_draft is version history + run state only — no provisional score or draft counts.
    const tech = chips.find((t) => t.id === T.A).eval_draft.technical;
    expect(Object.keys(tech).sort()).toEqual(["checked_at", "evidence_grade", "stale", "version_no"]);
  });

  test("T12: a verdict whose citation is not in the held evidence is downgraded to unverified; valid quotes stay", () => {
    const v = latest("A", "technical")!;
    const p = JSON.parse(v.payload);
    const [first, second] = p.items;
    expect(first.proposed_status).toBe("pass");
    expect(first.citations[0].kind).toBe("business_report");
    expect(first.citations[0].ref.startsWith(`${REPORT_A}:`)).toBe(true);
    expect(first.citations[0].quote.length).toBeGreaterThan(20);
    expect(BODY).toContain(first.citations[0].quote); // engine-derived: a verbatim part of the filing text
    expect(second.proposed_status).toBeNull();
    expect(second.reason).toContain("확인 안됨");
    expect(second.reason_detail).toBe("ref_unknown"); // an evidence number that points at no window lifts nothing
    expect(p.evidence.llm_drafts_returned).toBeGreaterThan(0);
    expect(p.evidence.business_report).toMatchObject({ rcept_no: REPORT_A, available: true });
    expect(p.evidence.business_report.sections_found).toContain("rnd");
    expect(p.llm).toMatchObject({ prompt_key: "s7.screening_draft" });
    expect(JSON.stringify(p)).not.toContain("강점"); // the AI profile text is never copied into the payload
    expect(v.unverified_count).toBe(1);
    expect(v.proposed_count).toBe(1);
  });

  test("T1: identical facts and criteria yield identical proposals, score and input hash for two candidates", () => {
    const a = latest("A", "financial")!;
    const b = latest("B", "financial")!;
    expect(a.input_hash).toBe(b.input_hash);
    expect(a.provisional_score).toBe(b.provisional_score);
    const strip = (v: typeof a) => {
      const p = JSON.parse(v.payload);
      return JSON.stringify([p.items, p.provisional_score, p.criteria_snapshot]);
    };
    expect(strip(a)).toBe(strip(b));
  });

  test("TA2/TA3/TA11: AI results are applied directly with their origin (financial auto_rule, technical ai_draft)", async () => {
    const rows = db
      .query(
        `SELECT s.brownfield_target_id t, c.category, s.status, s.verdict_source src, s.source_version_id v, s.evidence_ref e, s.assessed_by
           FROM brownfield_target_eval_state s JOIN brownfield_eval_criterion c ON c.id = s.criterion_id`,
      )
      .all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.assessed_by).toBe(ANALYST); // the run actor is accountable; the origin says it was not a person's judgement
      expect(r.src).toBe(r.category === "financial" ? "auto_rule" : "ai_draft");
      const key = r.t === T.A ? "A" : "B";
      expect(r.v).toBe(latest(key, r.category)!.id); // TA3: points at this candidate's version of the category
      expect(r.status).not.toBe("pending");
    }
    expect(rows.some((r) => r.category === "financial" && r.src === "auto_rule")).toBe(true);
    const list = await targetsList();
    const a = list.find((t) => t.id === T.A).eval_summary;
    expect(a.unreviewed_total).toBe(a.financial.unreviewed + a.technical.unreviewed);
    expect(a.unreviewed_total).toBeGreaterThan(0);
    expect(a.financial.judged_by_source.auto_rule).toBe(a.financial.scoredWeight);
    expect(a.financial.judged_by_source.human).toBe(0);
    expect(a.financial.score).not.toBeNull(); // the ranking fills at once
    // the run item records what was applied (§4.2)
    const sum = repo.parseApplySummary(itemOf(run1, "A").apply_summary);
    expect(sum.financial?.applied).toBeGreaterThan(0);
    expect(sum.financial?.kept_human).toBe(0);
    // run audit: one apply event per category and candidate (§4.4)
    expect(
      auditActions().filter((x) => x.action === "target_eval.ai_verdict.apply" && x.target.includes(`:${T.A}:`)).length,
    ).toBe(2);
  });

  test("T14: audit events carry the documented target shapes, attributed to the caller", () => {
    const a = auditActions();
    expect(a.find((x) => x.action === "target_eval.bulk_run.start")?.target).toBe(
      `${OPP}:run:${run1}:targets=3:categories=both`,
    );
    expect(a.find((x) => x.action === "target_eval.bulk_run.complete")?.target).toBe(`${OPP}:run:${run1}`);
    expect(a.find((x) => x.action === "target_eval.draft_version.create")?.target).toMatch(
      new RegExp(`^${OPP}:${T.A}:financial:v1:run=${run1}$`),
    );
    expect(a.every((x) => x.actor_user_id === ANALYST)).toBe(true);
  });

  test("DART calls are recorded per item (telemetry) and the start is attributed to the analyst", () => {
    expect(runOf(run1).started_by).toBe(ANALYST);
    expect(runOf(run1).started_via).toBe("ui");
    expect(runOf(run1).web_evidence).toBe(0);
    expect(runOf(run1).force_refresh).toBe(0);
  });
});

async function startAndSettle(body: Record<string, unknown> = {}): Promise<string> {
  const res = await startRoute(body);
  expect(res.status).toBe(202);
  const id = (await data(res)).data.run_id as string;
  await settle(id);
  return id;
}

describe("T23 + T21 — unchanged evidence, warm cache, force_refresh", () => {
  let run2 = "";
  test("second run inside the window: 0 DART calls, 0 LLM calls, outcome `unchanged` pointing at the existing versions", async () => {
    clock = "2026-11-17T03:00:00.000Z";
    const before = { ...c, fetchYears: undefined, llmCompanies: undefined, web: undefined };
    run2 = await startAndSettle({});
    expect(c.fetch).toBe(before.fetch);
    expect(c.list).toBe(before.list);
    expect(c.validate).toBe(before.validate);
    expect(c.text).toBe(before.text);
    expect(c.llm).toBe(before.llm);
    for (const k of ["A", "B"] as const) {
      const it = itemOf(run2, k);
      expect(it.financial_outcome).toBe("unchanged");
      expect(it.technical_outcome).toBe("unchanged");
      expect(it.financial_version_id).toBe(latest(k, "financial")!.id);
      expect(latest(k, "technical")!.version_no).toBe(1); // no new version
    }
    const actions = auditActions().filter((x) => x.action === "target_eval.draft_version.unchanged");
    expect(actions.length).toBe(4);
    expect(actions[0].target).toBe(`${OPP}:${T.A}:financial:v1:run=${run2}`);
    // checked_at advanced without mutating the immutable version
    const chip = (await targetsList()).find((t) => t.id === T.A).eval_draft.financial;
    expect(chip.checked_at > latest("A", "financial")!.created_at).toBe(true);
    // TA7: the unchanged path re-applies the latest version idempotently (same statuses, one apply audit per category)
    expect(
      auditActions().filter((x) => x.action === "target_eval.ai_verdict.apply" && x.target.includes(`run=${run2}`))
        .length,
    ).toBe(4);
    expect(repo.parseApplySummary(itemOf(run2, "A").apply_summary).financial?.kept_human).toBe(0);
    expect(chip.stale).toBe(false);
  });

  test("evidence_key participates in the technical input hash (bump forces a new version)", () => {
    const base = {
      v: 1,
      category: "technical",
      evidence_key: bulk.TECHNICAL_EVIDENCE_KEY,
      disclosures: ["2026-0001"],
      business_report: { rcept_no: "2026-0001", extract: ["extracted", "h"] },
      profile: "p",
      web_evidence: false,
      prompt_key: bulk.TECHNICAL_PROMPT_KEY,
    };
    const h = repo.computeDraftInputHash;
    expect(h(base)).toBe(h({ ...base }));
    expect(h(base)).not.toBe(h({ ...base, evidence_key: "windows-v2" }));
    expect(h({ ...base, evidence_key: "windows-v2" })).toBe(h({ ...base, evidence_key: "windows-v2" }));
  });

  test("force_refresh: validates, re-fetches all 5 years and re-lists, but never re-fetches an existing rcept_no; the flag is stored on the run", async () => {
    clock = "2026-11-18T03:00:00.000Z";
    const b = { fetch: c.fetch, list: c.list, validate: c.validate, text: c.text, years: c.fetchYears.length };
    const run3 = await startAndSettle({ force_refresh: true });
    expect(runOf(run3).force_refresh).toBe(1);
    expect(c.validate - b.validate).toBe(2);
    expect(c.fetch - b.fetch).toBe(2);
    expect(c.list - b.list).toBe(2);
    expect(c.text - b.text).toBe(0);
    expect(c.fetchYears.slice(b.years).every((y) => y.length === 5)).toBe(true);
    expect(itemOf(run3, "A").financial_outcome).toBe("unchanged"); // same values: no new version
  });

  test("any change in criteria, human-judged set or web_evidence produces a new version (technical)", async () => {
    clock = "2026-11-19T03:00:00.000Z";
    addCustomCriterion(OPP, "technical", "추가 기술 항목", "custom", ANALYST);
    const run4 = await startAndSettle({ categories: "technical" });
    expect(itemOf(run4, "A").technical_outcome).toBe("versioned");
    expect(latest("A", "technical")!.version_no).toBe(2);
    // web_evidence flips the hash too (T15: queries carry only company + criterion label)
    c.web.length = 0;
    const run5 = await startAndSettle({ categories: "technical", web_evidence: true });
    expect(runOf(run5).web_evidence).toBe(1);
    expect(latest("A", "technical")!.version_no).toBe(3);
    expect(c.web.length).toBeGreaterThan(0);
    for (const q of c.web) {
      expect(q).not.toContain("비밀프로젝트오퍼"); // opportunity name never leaves the process
      expect(q.startsWith(NAME.A) || q.startsWith(NAME.B)).toBe(true);
    }
    const p = JSON.parse(latest("A", "technical")!.payload);
    expect(p.evidence.web.length).toBeGreaterThan(0);
    expect(p.evidence.web[0]).toMatchObject({ host: "news.example.com" });
  });
});

describe("T3 — replace-on-success", () => {
  test("an LLM failure writes no version and keeps the previous one; the next success numbers v{n+1} without a gap", async () => {
    // change the human-judged set so the hash differs and the LLM is consulted
    const [tech1] = critIds("technical");
    const put = await req(`/api/brownfield/${OPP}/targets/${T.A}/eval-state/${tech1.id}`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ status: "na", note: "해당 없음" }),
    });
    expect(put.status).toBe(200);
    const before = latest("A", "technical")!;
    llmMode = "fail";
    const failedRun = await startAndSettle({ categories: "technical" });
    llmMode = "ok";
    const it = itemOf(failedRun, "A");
    expect(it.technical_outcome).toBe("failed");
    expect(it.state).toBe("failed");
    expect(it.error_message).toContain("llm_error");
    expect(latest("A", "technical")!.id).toBe(before.id); // still the previous version
    const chip = (await targetsList()).find((t) => t.id === T.A).eval_draft;
    expect(chip.technical.version_no).toBe(before.version_no);
    expect(chip.run_item.error).toContain("llm_error");
    const okRun = await startAndSettle({ categories: "technical" });
    expect(itemOf(okRun, "A").technical_outcome).toBe("versioned");
    expect(latest("A", "technical")!.version_no).toBe(before.version_no + 1);
    // the human-judged item is read-only context in the new version, not an item
    const p = JSON.parse(latest("A", "technical")!.payload);
    expect(p.human_items.map((h: any) => h.criterion_id)).toContain(tech1.id);
    expect(p.items.map((i: any) => i.criterion_id)).not.toContain(tech1.id);
    // an unconfigured LLM skips the technical step instead of writing an all-unverified version
    llmConfigured = false;
    addCustomCriterion(OPP, "technical", "또 다른 항목", null, ANALYST);
    const skipRun = await startAndSettle({ categories: "technical" });
    llmConfigured = true;
    expect(itemOf(skipRun, "A").state).toBe("skipped_llm_unconfigured");
    expect(itemOf(skipRun, "A").technical_outcome).toBe("skipped");
    expect(latest("A", "technical")!.version_no).toBe(before.version_no + 1);
  });
});

describe("A5 versions list and A7 PUT link", () => {
  test("lists versions newest first with applied_count / reviewed_count; include=payload returns payloads; bad params are 400", async () => {
    const res = await data(await get(`/api/brownfield/${OPP}/targets/${T.A}/eval-draft-versions?category=technical`));
    const vs = res.data.versions as any[];
    expect(vs.length).toBeGreaterThanOrEqual(3);
    expect(vs[0].version_no).toBeGreaterThan(vs[1].version_no);
    expect(vs[0]).toHaveProperty("applied_count");
    expect(vs[0]).toHaveProperty("reviewed_count", 0);
    expect(vs[0]).not.toHaveProperty("confirmed_count");
    expect(vs[0]).not.toHaveProperty("payload");
    const full = await data(
      await get(`/api/brownfield/${OPP}/targets/${T.A}/eval-draft-versions?category=technical&limit=1&include=payload`),
    );
    expect(full.data.versions[0].payload.schema).toBe(1);
    expect((await get(`/api/brownfield/${OPP}/targets/${T.A}/eval-draft-versions?category=x`)).status).toBe(400);
    expect((await get(`/api/brownfield/${OPP}/targets/${ulid()}/eval-draft-versions`)).status).toBe(404);
  });
});

describe("ADR-0200 origin, writer rules and the human boundary (TA2, TA4, TA12-TA15, TA18)", () => {
  const MCP_PRINCIPAL = {
    userId: ANALYST,
    role: "analyst" as const,
    scopes: ["read", "write", "propose"],
    mustChangePassword: false,
    tokenId: "t",
    clientId: "c",
  };
  const port = () => new InProcessRestPort(MCP_PRINCIPAL);
  const evalUrl = (k: "A" | "B" | "N", crit: string) => `/api/brownfield/${OPP}/targets/${T[k]}/eval-state/${crit}`;
  const humanPut = (k: "A" | "B" | "N", crit: string, body: unknown) =>
    req(evalUrl(k, crit), { method: "PUT", headers: { cookie: analystCookie }, body: JSON.stringify(body) });
  const row = (k: "A" | "B" | "N", crit: string) =>
    db
      .query(
        "SELECT status, note, evidence_ref, assessed_by, verdict_source src, source_version_id v FROM brownfield_target_eval_state WHERE brownfield_target_id=? AND criterion_id=?",
      )
      .get(T[k], crit) as any;
  const proposedIds = (k: "A" | "B", cat: "financial" | "technical") =>
    (JSON.parse(latest(k, cat)!.payload).items as any[]).filter((i) => i.proposed_status).map((i) => i.criterion_id);

  test("TA14: the confirm route A6 is gone — 404, no HUMAN_ONLY_ROUTES entry, no exclusion, no openapi path, no lib; the S7 draft route (Q7) too", async () => {
    const v = latest("A", "technical")!;
    const url = `/api/brownfield/${OPP}/targets/${T.A}/eval-draft-versions/${v.id}/confirm`;
    expect((await post(url, {})).status).toBe(404);
    expect(isHumanOnly("POST", url, {})).toBe(false);
    expect(HUMAN_ONLY_ROUTES.some((r) => r.pattern.includes("/confirm") && r.pattern.includes("eval-draft"))).toBe(
      false,
    );
    expect(readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf8")).not.toContain(
      "eval-draft-version-confirm",
    );
    const openapi = readFileSync("docs/architecture/openapi.yaml", "utf8");
    expect(openapi).not.toContain("eval-draft-versions/{versionId}/confirm");
    expect(openapi).not.toContain("/targets/{targetId}/eval-draft:");
    expect(existsSync("app/web-next/lib/brownfield-eval-confirm.ts")).toBe(false);
    expect((await post(`/api/brownfield/${OPP}/targets/${T.A}/eval-draft`, { category: "financial" })).status).toBe(
      404,
    );
  });

  test("TA2/TA12/TA18: a human save of an unchanged AI verdict flips origin to human, keeps the version, note and evidence; the review audit says changed=0", async () => {
    const v = latest("B", "financial")!;
    const [first, second] = proposedIds("B", "financial");
    const before = row("B", first);
    expect(before).toMatchObject({ src: "auto_rule", v: v.id, assessed_by: ANALYST, evidence_ref: v.id });
    // a bare `확인`: same status + the version it rests on; note / evidence_ref OMITTED
    const ok = await humanPut("B", first, { status: before.status, source_version_id: v.id });
    expect(ok.status).toBe(200);
    const after = row("B", first);
    expect(after).toMatchObject({
      src: "human",
      v: v.id,
      status: before.status,
      note: before.note,
      evidence_ref: before.evidence_ref,
    });
    expect(
      auditActions()
        .filter((x) => x.action === "target_eval.ai_verdict.review")
        .at(-1)?.target,
    ).toBe(`${OPP}:${T.B}:${first}:from=auto_rule:version=${v.id}:changed=0`);
    // evalStateHash covers status+note+evidence_ref: unchanged by a bare accept (ADR-0171 parity)
    const { evalStateHash } = await import("../../app/web-next/lib/brownfield-capability-judgement.ts");
    expect(evalStateHash(after)).toBe(evalStateHash(before));
    // changing the status is also a review; changed=1, note/evidence cleared when omitted (as before ADR-0200)
    const other = row("B", second);
    const flipped = other.status === "fail" ? "pass" : "fail";
    expect((await humanPut("B", second, { status: flipped, source_version_id: v.id })).status).toBe(200);
    expect(row("B", second)).toMatchObject({ src: "human", status: flipped, v: v.id, note: null, evidence_ref: null });
    expect(
      auditActions()
        .filter((x) => x.action === "target_eval.ai_verdict.review")
        .at(-1)?.target,
    ).toBe(`${OPP}:${T.B}:${second}:from=auto_rule:version=${v.id}:changed=1`);
    // sent keys always overwrite; the link survives an unchanged-status edit
    expect((await humanPut("B", second, { status: flipped, note: "사람 메모" })).status).toBe(200);
    expect(row("B", second)).toMatchObject({ note: "사람 메모", v: v.id });
  });

  test("TA4/TA15/TA2: non-human callers store ai_draft, never overwrite a human verdict (409), cannot set na/waived, source_version_id or verdict_source", async () => {
    const [humanCrit] = proposedIds("B", "financial");
    const before = row("B", humanCrit);
    expect(before.src).toBe("human");
    const locked = await port().put(evalUrl("B", humanCrit), { status: "fail", note: "에이전트" });
    expect(locked.error?.code).toBe("human_verdict_locked");
    expect(row("B", humanCrit)).toEqual(before); // byte-equal
    expect(
      auditActions()
        .filter((x) => x.action === "target_eval.agent_verdict.refused")
        .at(-1)?.target,
    ).toBe(`${OPP}:${T.B}:${humanCrit}:reason=human_verdict_locked:via=mcp`);
    // over an AI verdict the write lands as ai_draft, attributed to the delegating user
    const [aiCrit] = proposedIds("A", "technical");
    expect(row("A", aiCrit).src).toBe("ai_draft");
    const wrote = await port().put(evalUrl("A", aiCrit), { status: "partial", note: "에이전트 판정" });
    expect(wrote.error).toBeNull();
    expect(row("A", aiCrit)).toMatchObject({ src: "ai_draft", status: "partial", assessed_by: ANALYST, v: null });
    expect(
      auditActions()
        .filter((x) => x.action === "target_eval.agent_verdict")
        .at(-1)?.target,
    ).toBe(`${OPP}:${T.A}:${aiCrit}:via=mcp`);
    // TA15: na / waived and the draft link are a person's act
    for (const status of ["na", "waived"])
      expect((await port().put(evalUrl("A", aiCrit), { status })).error?.code).toBe("human_only");
    expect(
      (await port().put(evalUrl("A", aiCrit), { status: "pass", source_version_id: latest("A", "technical")!.id }))
        .error?.code,
    ).toBe("human_only");
    expect(row("A", aiCrit).status).toBe("partial");
    // the origin is never taken from the body
    expect((await humanPut("A", aiCrit, { status: "pass", verdict_source: "human" })).status).toBe(400);
    // a human session over the agent's ai_draft lands as human
    expect((await humanPut("A", aiCrit, { status: "pass" })).status).toBe(200);
    expect(row("A", aiCrit)).toMatchObject({ src: "human", status: "pass" });
  });

  test("TA13: Short List promotion is human-only (route, HUMAN_ONLY_ROUTES, exclusion, no MCP tool) and records unreviewed=n", async () => {
    const url = `/api/brownfield/${OPP}/targets/${T.N}/shortlist`;
    expect(isHumanOnly("POST", url, {})).toBe(true);
    expect((await port().post(url, {})).error?.code).toBe("human_only");
    expect([401, 403]).toContain(
      (await req(url, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).status,
    );
    expect(readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf8")).toContain("/targets/{}/shortlist");
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    expect(REGISTRY.some((t: { name: string }) => t.name === "shortlist_candidate")).toBe(false);
    // N has every criterion judged by AI only: promotion warns (counts), never blocks
    const all = [...critIds("financial"), ...critIds("technical")];
    for (const cr of all)
      db.run(
        "INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, verdict_source, source_version_id) VALUES (?,?,?,?,?,?,?,NULL)",
        [ulid(), T.N, cr.id, "pass", ANALYST, NOW, "ai_draft"],
      );
    try {
      const res = await data(await post(url, {}));
      expect(res.data.unreviewed).toBe(all.length);
      expect(res.data.unreviewed_detail).toMatchObject({ ai_draft: all.length });
      const last = db
        .query("SELECT target FROM audit_log WHERE action = 'brownfield_target.shortlist' ORDER BY rowid DESC LIMIT 1")
        .get() as { target: string };
      expect(last.target).toBe(`${OPP}:${T.N}:rank1:unreviewed=${all.length}`);
    } finally {
      db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ?", [T.N]);
      db.run("UPDATE brownfield_target SET status = 'pending', rank = NULL WHERE id = ?", [T.N]);
    }
  });

  test("Q1: rule-only bulk accept is human-only, accepts only auto_rule items of the category as human, leaves ai_draft alone", async () => {
    const url = `/api/brownfield/${OPP}/targets/${T.A}/eval-state/accept-rule`;
    expect(isHumanOnly("POST", url, {})).toBe(true);
    expect((await port().post(url, { category: "financial" })).error?.code).toBe("human_only");
    expect((await post(url, { category: "x" })).status).toBe(400);
    expect((await post(url, { category: "financial" }, viewerCookie)).status).toBe(403);
    const fin = critIds("financial").map((cr) => row("A", cr.id));
    const autoCount = fin.filter((r) => r?.src === "auto_rule" && r.status !== "pending").length;
    expect(autoCount).toBeGreaterThan(0);
    const techBefore = critIds("technical").map((cr) => row("A", cr.id));
    const res = await data(await post(url, { category: "financial" }));
    expect(res.data.accepted).toBe(autoCount);
    for (const cr of critIds("financial")) expect(row("A", cr.id).src).toBe("human");
    expect(critIds("technical").map((cr) => row("A", cr.id))).toEqual(techBefore); // technical / ai_draft untouched
    expect(
      auditActions().filter(
        (x) =>
          x.action === "target_eval.ai_verdict.review" &&
          x.target.includes(`:${T.A}:`) &&
          x.target.includes("from=auto_rule"),
      ).length,
    ).toBe(autoCount);
    expect((await data(await post(url, { category: "financial" }))).data.accepted).toBe(0); // nothing left
  });

  test("defect (b): an AI re-apply with the same status and a new version keeps evidence_ref stable; the version link still moves", async () => {
    const { applyVersionToEvalState } = await import("../../app/web-next/lib/brownfield-eval-apply.ts");
    const v1 = latest("A", "technical")!;
    const payload = JSON.parse(v1.payload);
    const item = payload.items.find((i: any) => i.proposed_status);
    const crit = item.criterion_id;
    db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?", [T.A, crit]);
    expect(
      repo.writeEvalVerdict(db, {
        targetId: T.A,
        criterionId: crit,
        status: item.proposed_status,
        note: "n",
        evidenceRef: v1.id,
        assessedBy: ANALYST,
        source: "ai_draft",
        sourceVersionId: v1.id,
        now: NOW,
      }).ok,
    ).toBe(true);
    const v2 = repo.insertDraftVersion(db, {
      payload,
      provisionalScore: null,
      proposedCount: 1,
      unverifiedCount: 0,
      evidenceGrade: "C",
      targetId: T.A,
      category: "technical",
      runId: v1.run_id,
      inputHash: `h-${ulid()}`,
      createdBy: ANALYST,
      now: NOW,
    });
    applyVersionToEvalState(db, { version: v2, actor: ANALYST, now: NOW });
    expect(row("A", crit)).toMatchObject({ v: v2.id, evidence_ref: v1.id, status: item.proposed_status });
  });
});

describe("T5 / T6 — budget pause, interrupted, manual resume", () => {
  test("T5: the reserve rule pauses before the next candidate; resume is refused while unmet, then continues without duplicates", async () => {
    // The earlier boundary tests turned some verdicts human; hand them back to their engine origin so the run has
    // eligible work for both candidates (human verdicts are, by design, never re-drafted).
    db.run(
      `UPDATE brownfield_target_eval_state SET verdict_source = (SELECT CASE c.category WHEN 'financial' THEN 'auto_rule' ELSE 'ai_draft' END
         FROM brownfield_eval_criterion c WHERE c.id = criterion_id) WHERE brownfield_target_id IN (?, ?)`,
      [T.A, T.B],
    );
    clock = "2026-11-25T03:00:00.000Z";
    c.used = 0;
    let first = true;
    onFetch = () => {
      if (first) {
        first = false;
        c.used = 14_990; // budget nearly spent right after the first candidate's DART fetch
      }
    };
    const runId = await startAndSettle({ force_refresh: true });
    onFetch = null;
    const run = runOf(runId);
    expect(run.status).toBe("paused_budget");
    expect(run.pause_reason).toBe("dart_budget_reserve");
    expect(itemOf(runId, "A").state).toBe("done");
    expect(itemOf(runId, "B").state).toBe("pending"); // resumes at the first non-terminal item
    expect(auditActions().find((x) => x.action === "target_eval.bulk_run.pause")?.target).toBe(
      `${OPP}:run:${runId}:reason=dart_budget_reserve`,
    );
    const vBeforeA = (
      db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_version WHERE brownfield_target_id = ?").get(T.A) as {
        n: number;
      }
    ).n;
    // the reserve is still unmet: 409 budget_reserve
    const refused = await post(`/api/brownfield/${OPP}/eval-draft-runs/${runId}/resume`, {});
    expect(refused.status).toBe(409);
    expect((await data(refused)).error.code).toBe("budget_reserve");
    // budget restored: resume (manual) continues; the force_refresh flag survived on the run header
    c.used = 0;
    expect((await post(`/api/brownfield/${OPP}/eval-draft-runs/${runId}/resume`, {}, viewerCookie)).status).toBe(403);
    const resumed = await post(`/api/brownfield/${OPP}/eval-draft-runs/${runId}/resume`, {});
    expect(resumed.status).toBe(202);
    await settle(runId);
    expect(runOf(runId).status).toBe("completed");
    expect(runOf(runId).resumed_by).toBe(ANALYST);
    expect(runOf(runId).force_refresh).toBe(1);
    expect(itemOf(runId, "B").state).toBe("done");
    // candidate A finished before the pause: the resume must not redo it (B legitimately gets a new version: its human-judged set changed)
    expect(
      (
        db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_version WHERE brownfield_target_id = ?").get(T.A) as {
          n: number;
        }
      ).n,
    ).toBe(vBeforeA);
    expect(auditActions().some((x) => x.action === "target_eval.bulk_run.resume")).toBe(true);
    // a completed run cannot be resumed
    expect((await post(`/api/brownfield/${OPP}/eval-draft-runs/${runId}/resume`, {})).status).toBe(409);
  });

  test("T6: a stale heartbeat marks the run interrupted on read; resume completes it", async () => {
    clock = "2026-11-26T03:00:00.000Z";
    const { run } = repo.createRun(db, {
      opportunityId: OPP,
      categories: "both",
      targetIds: [T.A, T.B],
      webEvidence: false,
      forceRefresh: false,
      startedBy: ANALYST,
      startedVia: "ui",
      now: new Date(Date.now() - 3_600_000).toISOString(),
    });
    // no engine runs for it (as after a process restart); the heartbeat is an hour old
    const prog = (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/${run.id}`))).data;
    expect(prog.run.status).toBe("interrupted");
    expect(prog.run.pause_reason).toBe("heartbeat_stale");
    expect((await get(`/api/brownfield/${ulid()}/eval-draft-runs/${run.id}`)).status).toBe(404);
    const resumed = await post(`/api/brownfield/${OPP}/eval-draft-runs/${run.id}/resume`, {});
    expect(resumed.status).toBe(202);
    await settle(run.id);
    expect(runOf(run.id).status).toBe("completed");
  });

  test("cancel: stops an active run, keeps written versions, leaves remaining items pending; a finished run cannot be cancelled", async () => {
    const { run } = repo.createRun(db, {
      opportunityId: OPP,
      categories: "both",
      targetIds: [T.A, T.B],
      webEvidence: false,
      forceRefresh: false,
      startedBy: ANALYST,
      startedVia: "ui",
      now: NOW,
    });
    const res = await post(`/api/brownfield/${OPP}/eval-draft-runs/${run.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(runOf(run.id).status).toBe("cancelled");
    expect(repo.listRunItems(db, run.id).every((i) => i.state === "pending")).toBe(true);
    expect(auditActions().some((x) => x.action === "target_eval.bulk_run.cancel")).toBe(true);
    expect((await post(`/api/brownfield/${OPP}/eval-draft-runs/${run.id}/cancel`, {})).status).toBe(409);
  });

  test("an unconfigured DART key fails the item with dart_not_configured instead of calling out", async () => {
    dartConfigured = false;
    const id = await startAndSettle({});
    dartConfigured = true;
    expect(itemOf(id, "A").state).toBe("failed");
    expect(itemOf(id, "A").error_message).toBe("dart_not_configured");
  });
});

describe("T25 — cache content isolation", () => {
  test("the three cache tables have no opportunity, user, candidate or verdict column", () => {
    for (const t of ["dart_disclosure", "dart_business_report_extract", "dart_corp_sync_state"]) {
      const cols = (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((x) => x.name);
      for (const banned of [
        "opportunity_id",
        "user_id",
        "created_by",
        "brownfield_target_id",
        "status_verdict",
        "verdict",
      ]) {
        expect(cols).not.toContain(banned);
      }
    }
  });
  test("no route or MCP tool reads the cache tables (route-table scan)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(e) &&
          /dart_disclosure|dart_business_report_extract|dart_corp_sync_state/.test(readFileSync(full, "utf8"))
        )
          hits.push(full);
      }
    };
    walk(join(ROOT, "app/web-next/app/api"));
    walk(join(ROOT, "mcp"));
    expect(hits).toEqual([]);
  });
  test("deleting a candidate leaves the cache rows intact and cascades its versions and run items", () => {
    const disclosures = (db.query("SELECT COUNT(*) n FROM dart_disclosure").get() as { n: number }).n;
    expect(disclosures).toBeGreaterThan(0);
    db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ?", [T.B]);
    db.run("DELETE FROM brownfield_target WHERE id = ?", [T.B]);
    expect((db.query("SELECT COUNT(*) n FROM dart_disclosure").get() as { n: number }).n).toBe(disclosures);
    expect(
      (
        db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_version WHERE brownfield_target_id = ?").get(T.B) as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(cache.getCorpSyncState(db, CORP_B)).not.toBeNull();
  });
});

describe("security review fixes", () => {
  const firstTechItem = () => {
    const v = latest("A", "technical")!;
    return { v, id: (JSON.parse(v.payload).items[0] as { criterion_id: string }).criterion_id };
  };
  const put = (crit: string, body: unknown) =>
    req(`/api/brownfield/${OPP}/targets/${T.A}/eval-state/${crit}`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify(body),
    });

  test("1: source_version_id (and the deprecated confirmed_from_version_id) is human-only and validated (candidate, category, criterion in the payload)", async () => {
    const { v, id } = firstTechItem();
    const finId = critIds("financial")[0].id;
    expect((await put(finId, { status: "pass", source_version_id: v.id })).status).toBe(400); // wrong category
    expect((await put(id, { status: "pass", source_version_id: latest("B", "technical")?.id ?? "x" })).status).toBe(
      400,
    ); // other candidate
    const port = new InProcessRestPort({
      userId: ANALYST,
      role: "analyst",
      scopes: ["read", "write", "propose"],
      mustChangePassword: false,
      tokenId: "t",
      clientId: "c",
    });
    const agent = await port.put(`/api/brownfield/${OPP}/targets/${T.A}/eval-state/${id}`, {
      status: "pass",
      confirmed_from_version_id: v.id,
    });
    expect(agent.error?.code).toBe("human_only");
    const ok = await put(id, { status: "pass", confirmed_from_version_id: v.id }); // deprecated alias still works for a person
    expect(ok.status).toBe(200);
    const stored = db
      .query(
        "SELECT source_version_id v, verdict_source s FROM brownfield_target_eval_state WHERE brownfield_target_id=? AND criterion_id=?",
      )
      .get(T.A, id) as any;
    expect(stored).toEqual({ v: v.id, s: "human" });
  });

  test("2: a verdict backed only by a disclosure title or the profile stays unverified", async () => {
    addCustomCriterion(OPP, "technical", "핵심 인용 게이트 항목", null, ANALYST);
    llmMode = "disclosure_only";
    const id = await startAndSettle({ categories: "technical" });
    llmMode = "ok";
    expect(itemOf(id, "A").technical_outcome).toBe("versioned");
    expect(
      (JSON.parse(latest("A", "technical")!.payload).items as any[]).every((i) => i.proposed_status === null),
    ).toBe(true);
    const pl = JSON.parse(latest("A", "technical")!.payload);
    const codes = new Set((pl.items as any[]).map((i) => i.reason_detail));
    expect(codes.has("no_citation")).toBe(true); // disclosure/profile quotes carry no evidence number
    expect([...codes].every((c) => c === "no_citation" || c === "evidence_unavailable")).toBe(true);
    expect(pl.evidence.llm_drafts_returned).toBeGreaterThan(0);
    expect(pl.evidence.citations_rejected).toBe(0); // no evidence number was named, so nothing was rejected
  });

  test('2b: a verdict of "insufficient" stays unverified without a proposal', async () => {
    addCustomCriterion(OPP, "technical", "핵심 불충분 응답 항목", null, ANALYST);
    llmMode = "insufficient";
    const id = await startAndSettle({ categories: "technical" });
    llmMode = "ok";
    expect(itemOf(id, "A").technical_outcome).toBe("versioned");
    const items = JSON.parse(latest("A", "technical")!.payload).items as any[];
    expect(items.every((i) => i.proposed_status === null)).toBe(true);
  });

  test("3: a promoted opportunity refuses start and resume with 409 already_promoted", async () => {
    db.run("PRAGMA foreign_keys = OFF");
    db.run("UPDATE opportunity SET project_id = 'p-promoted' WHERE id = ?", [OPP]);
    try {
      const start = await startRoute({});
      expect(start.status).toBe(409);
      expect((await data(start)).error.code).toBe("already_promoted");
      const r = repo.listRunItems(db, run1).length ? run1 : run1;
      expect((await post(`/api/brownfield/${OPP}/eval-draft-runs/${r}/resume`, {})).status).toBe(409);
      expect((await get(`/api/brownfield/${OPP}/eval-draft-runs/latest`)).status).toBe(200);
    } finally {
      db.run("UPDATE opportunity SET project_id = NULL WHERE id = ?", [OPP]);
      db.run("PRAGMA foreign_keys = ON");
    }
  });

  test("4: a cancelled engine still finishing blocks a new start; per-user cooldown applies", async () => {
    addCustomCriterion(OPP, "technical", "취소 루프 항목", null, ANALYST);
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    const res = await startRoute({ categories: "technical" });
    const runId = (await data(res)).data.run_id as string;
    for (let i = 0; i < 300 && !bulk.isEngineActive(runId); i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(`/api/brownfield/${OPP}/eval-draft-runs/${runId}/cancel`, {})).status).toBe(200);
    const again = await startRoute({ categories: "technical" });
    expect(again.status).toBe(409);
    const body = await data(again);
    expect(body.error.code).toBe("engine_active");
    expect(body.error.details.run_id).toBe(runId);
    expect(body.error.details.reason).toBe("bulk_block");
    // A single-candidate start is allowed beside the cancelled engine still finishing (it counts toward the cap,
    // but the cap is 3): a fresh single-candidate run starts while the cancelled engine finishes its item.
    const solo = await startRoute({ categories: "technical", target_ids: [T.A] });
    expect(solo.status).toBe(202);
    const soloBody = await data(solo);
    expect(soloBody.meta.reused).toBe(false);
    release();
    gate = null;
    await settle(soloBody.data.run_id as string);
    await settle(runId);
    bulk.setStartCooldownForTests(60_000);
    bulk.noteRunStart(ANALYST);
    const cool = await startRoute({});
    expect(cool.status).toBe(429);
    bulk.setStartCooldownForTests(0);
  });

  test("4: unchanged inputs cost no web call, even with web_evidence on", async () => {
    await startAndSettle({ categories: "technical", web_evidence: true }); // establishes the version
    c.web.length = 0;
    const id = await startAndSettle({ categories: "technical", web_evidence: true });
    expect(itemOf(id, "A").technical_outcome).toBe("unchanged");
    expect(c.web).toEqual([]);
  });

  test("5: stored errors are fixed codes and secrets are redacted", () => {
    expect(
      bulk.redactSecrets("GET https://opendart.fss.or.kr/api/list.json?crtfc_key=SECRET123&corp_code=1 failed"),
    ).not.toContain("SECRET123");
    expect(bulk.errorCodeOf(new Error("llm_failed"))).toBe("llm_error");
    expect(bulk.errorCodeOf(new Error("llm_unparseable"))).toBe("parse_error");
    expect(bulk.errorCodeOf(new Error("DART HTTP 503 https://opendart.fss.or.kr/x?crtfc_key=K"))).toBe("dart_error");
    expect(bulk.errorCodeOf(new Error("whatever"))).toBe("unknown");
    const stored = (
      db
        .query("SELECT error_message e FROM brownfield_eval_draft_run_item WHERE error_message IS NOT NULL")
        .all() as Array<{ e: string }>
    ).map((r) => r.e);
    for (const e of stored)
      expect(e).toMatch(
        /^(technical|financial): (dart_error|llm_error|parse_error|db_error|unknown)|^(dart_not_configured|excluded|llm_unconfigured)$|^.*(dart_error|llm_error)/,
      );
  });
});

describe("per-candidate concurrency (MAX_CONCURRENT_EVAL_ENGINES, ADR-0199 follow-up)", () => {
  const TC: Record<"C" | "D" | "E", string> = { C: ulid(), D: ulid(), E: ulid() };
  let runC = "";
  beforeAll(() => {
    bulk.setStartCooldownForTests(0);
    // md_company.dart_corp_code is UNIQUE — share the fixture companies (A/B corps) and key runs by target id.
    const mk = (id: string, name: string, corp: string | null) => {
      db.run(
        "INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [id, OPP, name, corp, NOW, NOW],
      );
    };
    mk(TC.C, "가나다씨", CORP_A);
    mk(TC.D, "가나다디", CORP_B);
    mk(TC.E, "가나다이", CORP_A);
  });

  const engineCount = () => bulk.activeEngineRunsForOpportunity(OPP).length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function waitForEngines(n: number): Promise<void> {
    for (let i = 0; i < 500; i++) {
      if (engineCount() >= n) return;
      await sleep(10);
    }
    throw new Error(`expected ${n} active engines, saw ${engineCount()}`);
  }
  const startSingle = (id: string) => startRoute({ categories: "technical", target_ids: [id] });

  test("single-candidate starts run beside each other up to the cap; bulk always needs a quiet engine table", async () => {
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    llmMode = "ok";
    const ids: string[] = [];
    for (const key of ["C", "D", "E"] as const) {
      const res = await startSingle(TC[key]);
      expect(res.status).toBe(202);
      const body = await data(res);
      ids.push(body.data.run_id as string);
      expect(body.meta.reused).toBe(false);
    }
    runC = ids[0];
    await waitForEngines(3);
    // the 4th engine is refused at the cap, with the machine-readable reason
    const capped = await startSingle(T.A);
    expect(capped.status).toBe(409);
    const capBody = await data(capped);
    expect(capBody.error.code).toBe("engine_active");
    expect(capBody.error.details.reason).toBe("concurrency_cap");
    // bulk (no target_ids) and multi-id starts refuse on ANY active engine
    for (const body of [{}, { target_ids: [T.A, TC.D] }]) {
      const res = await startRoute(body);
      expect(res.status).toBe(409);
      expect((await data(res)).error.details.reason).toBe("bulk_block");
    }
    // reuse still works per candidate set: the same single start reuses its own active run
    const again = await startSingle(TC.C);
    expect(again.status).toBe(202);
    const againBody = await data(again);
    expect(againBody.meta.reused).toBe(true);
    expect(againBody.data.run_id).toBe(ids[0]);
    release();
    gate = null;
    for (const id of ids) await settle(id);
    expect(engineCount()).toBe(0);
    // candidates C/D/E each got exactly their own technical version, and versions stay uniquely numbered
    for (const key of ["C", "D", "E"] as const) {
      expect(repo.getLatestVersion(db, TC[key], "technical")?.version_no).toBe(1);
    }
    const dupes = db
      .query(
        "SELECT brownfield_target_id, category, version_no, COUNT(*) n FROM brownfield_eval_draft_version GROUP BY brownfield_target_id, category, version_no HAVING n > 1",
      )
      .all();
    expect(dupes).toEqual([]);
  });

  test("two concurrent category commits cannot produce duplicate version_no (MAX+1 inside the insert transaction)", async () => {
    const runId = await startAndSettle({ categories: "technical", target_ids: [TC.C] });
    runC = runId; // the candidate's own latest run is now this one (used by the latest?target_id test)
    const item = repo.listRunItems(db, runId).find((i) => i.brownfield_target_id === TC.C)!;
    type Payload = import("../../db/repositories/brownfield-eval-draft.repository.ts").EvalDraftPayload;
    const payload = (gen: string): Payload =>
      ({
        schema: 1,
        category: "technical",
        criteria_snapshot: [{ criterion_id: "c1", label: "L", weight: 1, source: "custom", rubric: null }],
        items: [{ criterion_id: "c1", proposed_status: null, reason: null, metrics: [], note: null, citations: [] }],
        human_items: [],
        provisional_score: { score: null, scored_weight: 0, total_weight: 1 },
        dart: null,
        evidence: { disclosures: [], business_report: null, profile: { present: false, version_no: null }, web: [] },
        llm: null,
        runner: { user_id: ANALYST, via: "ui" },
        generated_at: gen,
      }) as Payload;
    const mk = (hash: string) =>
      repo.commitCategoryDraft(db, {
        itemId: item.id,
        category: "technical",
        inputHash: hash,
        createdBy: ANALYST,
        now: NOW,
        produce: async () => ({
          payload: payload(hash),
          provisionalScore: null,
          proposedCount: 0,
          unverifiedCount: 1,
          evidenceGrade: "U" as const,
        }),
      });
    const before = repo.getLatestVersion(db, TC.C, "technical")!.version_no;
    const [r1, r2] = await Promise.all([mk("hash-a"), mk("hash-b")]);
    expect(r1.outcome).toBe("versioned");
    expect(r2.outcome).toBe("versioned");
    const nos = [r1.version.version_no, r2.version.version_no].sort((a, b) => a - b);
    expect(nos).toEqual([before + 1, before + 2]);
    expect(r1.version.id).not.toBe(r2.version.id);
  });

  test("latest?target_id returns the candidate's own latest run, not the global latest", async () => {
    const runE = await startAndSettle({ categories: "technical", target_ids: [TC.E] });
    // the global latest is the E run just created; candidate C's own latest is its earlier single run
    const viaC = (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/latest?target_id=${TC.C}`))).data;
    expect(viaC.run.id).toBe(runC);
    const viaE = (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/latest?target_id=${TC.E}`))).data;
    expect(viaE.run.id).toBe(runE);
    const viaNone = (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/latest?target_id=${ulid()}`))).data;
    expect(viaNone.run).toBeNull();
    expect(viaE.items.length).toBe(1);
  });

  test("cooldown: a different single candidate is never delayed; the same candidate and bulk starts are rate-limited", async () => {
    bulk.setStartCooldownForTests(60_000);
    try {
      bulk.noteRunStart(ANALYST, TC.C);
      expect(bulk.startCooldownRemaining(ANALYST, TC.C)).toBeGreaterThan(0);
      expect(bulk.startCooldownRemaining(ANALYST, TC.D)).toBe(0);
      expect(bulk.startCooldownRemaining(ANALYST)).toBe(0); // bulk key is separate
      expect((await startSingle(TC.C)).status).toBe(429); // same candidate within the window
      bulk.noteRunStart(ANALYST); // bulk start noted
      expect((await startRoute({})).status).toBe(429);
      const other = await startSingle(TC.D); // different single candidate: not delayed
      expect(other.status).toBe(202);
      await settle((await data(other)).data.run_id as string);
    } finally {
      bulk.setStartCooldownForTests(0);
    }
  });

  test("GET eval-draft-runs/active lists runs with an active engine, oldest first ({ runs: [] } when none)", async () => {
    const active = async () =>
      (await data(await get(`/api/brownfield/${OPP}/eval-draft-runs/active`))).data.runs as any[];
    expect((await get(`/api/brownfield/${ulid()}/eval-draft-runs/active`)).status).toBe(404);
    expect((await get(`/api/brownfield/${OPP}/eval-draft-runs/active`, "")).status).toBe(401);
    expect(await active()).toEqual([]); // 0 concurrent runs
    addCustomCriterion(OPP, "technical", "병렬 실행 항목", null, ANALYST); // new input hash, so each engine reaches the gated LLM step
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    const ids: string[] = [];
    const first = await startSingle(TC.C);
    ids.push((await data(first)).data.run_id as string);
    await waitForEngines(1);
    const one = await active(); // 1 concurrent run
    expect(one.map((v) => v.run.id)).toEqual([ids[0]]);
    expect(one[0]).toHaveProperty("items");
    expect(one[0]).toHaveProperty("progress");
    expect(one[0]).toHaveProperty("budget");
    for (const key of ["D", "E"] as const) {
      await sleep(5); // distinct started_at ordering
      ids.push((await data(await startSingle(TC[key]))).data.run_id as string);
    }
    await waitForEngines(3);
    const three = await active(); // 3 concurrent runs
    expect(three.map((v) => v.run.id)).toEqual(ids);
    release();
    gate = null;
    for (const id of ids) await settle(id);
    expect(await active()).toEqual([]);
  });
});

describe("security review fixes (PR-A review 3, 4, 6)", () => {
  const port = () =>
    new InProcessRestPort({
      userId: ANALYST,
      role: "analyst",
      scopes: ["read", "write", "propose"],
      mustChangePassword: false,
      tokenId: "t",
      clientId: "c",
    });

  test("3: rubric and weight edits are human-only; the rubric audit records via", async () => {
    const crit = critIds("financial")[0].id;
    const url = `/api/brownfield/${OPP}/eval-criteria/${crit}`;
    // the in-process MCP table carries no route for it; every non-cookie caller is refused by the route guard itself
    const src = readFileSync("app/web-next/app/api/brownfield/[oppId]/eval-criteria/[criterionId]/route.ts", "utf8");
    expect(src).toContain("humanOnlyDenied(");
    const bearer = await req(url, { method: "PATCH", headers: { authorization: "Bearer nope" }, body: "{}" });
    expect([401, 403]).toContain(bearer.status);
    const ok = await req(url, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ rubric: { minYears: 2 } }),
    });
    expect(ok.status).toBe(200);
    const last = db
      .query("SELECT target FROM audit_log WHERE action = 'eval_criterion.rubric_update' ORDER BY rowid DESC LIMIT 1")
      .get() as { target: string };
    expect(last.target).toBe(`${crit}:via=ui`);
  });

  test("4: a write expecting auto_rule never touches a row that became human meanwhile", () => {
    const crit = critIds("financial")[1].id;
    const base = {
      targetId: T.N,
      criterionId: crit,
      status: "pass" as const,
      note: null,
      evidenceRef: null,
      assessedBy: ANALYST,
      now: NOW,
    };
    db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ?", [T.N]);
    const v = latest("A", "financial")!;
    expect(repo.writeEvalVerdict(db, { ...base, source: "auto_rule", sourceVersionId: v.id }).ok).toBe(true);
    // a person's save lands between the read and the bulk-accept write
    expect(repo.writeEvalVerdict(db, { ...base, status: "fail", source: "human", sourceVersionId: null }).ok).toBe(
      true,
    );
    const res = repo.writeEvalVerdict(db, {
      ...base,
      source: "human",
      sourceVersionId: v.id,
      expectSource: "auto_rule",
    });
    expect(res).toMatchObject({ ok: false, reason: "human_verdict_locked" });
    const row = db
      .query(
        "SELECT status, verdict_source s, source_version_id v FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?",
      )
      .get(T.N, crit) as any;
    expect(row).toEqual({ status: "fail", s: "human", v: null });
    db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ?", [T.N]);
  });

  test("6: a refused non-human na/waived write is audited as forbidden_status", async () => {
    const crit = critIds("technical")[0].id;
    const res = await port().put(`/api/brownfield/${OPP}/targets/${T.A}/eval-state/${crit}`, { status: "na" });
    expect(res.error?.code).toBe("human_only");
    const last = auditActions()
      .filter((x) => x.action === "target_eval.agent_verdict.refused")
      .at(-1);
    expect(last?.target).toBe(`${OPP}:${T.A}:${crit}:reason=forbidden_status:via=mcp`);
  });
});
