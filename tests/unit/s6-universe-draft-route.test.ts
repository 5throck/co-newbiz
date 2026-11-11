// @version 1.0.0
/**
 * S6 universe-criteria draft route — DEC-20261111-05 / design
 * 2026-11-11-s6-universe-viability-criteria §4 + test plan §9.2/§9.3/§9.5.
 *
 * What is locked in, per layer:
 *   §4.1 resolution chain — pinned-first (opportunity.sizing_version_id,
 *     completed-only) → industry FK → name fallback with FK self-exclusion →
 *     honest unset. The verified dev-DB defect shape is replicated: a same-name
 *     industry B (latest completed v2, anchor $38.66B) must never shadow
 *     industry A (v7, anchor $39.88B) while the pin or the FK resolves.
 *   §4.2 payload — segments/regions, chainGrade/chainDirection, qualitative
 *     factors with the sectionConfidence grade, full S3 rows (requiredNote
 *     carried, no 60-char name truncation), fact_industry stage financials or
 *     the honest gap line naming the producing S1 activity.
 *   §4.4 envelope — prompt_version + provenance on non-error envelopes;
 *     viability optional in the parse (honest unset); parse_failed and the
 *     no-grounding/deterministic-fallback envelopes keep their shape.
 *
 * The LLM boundary is mocked at completeOrFallback (committee-suite pattern:
 * spread the pristine module BEFORE mock.module and restore in afterEach), so
 * no network call happens even on a machine with a real provider in .env.
 * Temp DB only.
 */
import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s6-universe-draft.sqlite";
const NOW = "2026-11-11T10:00:00Z";

// Never call a real LLM from a unit test — the provider config is forced off
// here even though completeOrFallback itself is mocked below (defense in
// depth; the deterministic-fallback assertions also rely on the honest shape).
const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);
setEnv("CO_NEWBIZ_LLM_PROVIDER", "none");

if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
for (const s of ["-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const dbMod = await import("../../db/client.ts");
const { resetDb, getDb } = dbMod;
type Db = ReturnType<typeof dbMod.getDb>;
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

// Snapshot of the pristine llm module BEFORE any mock.module mutates it in
// place (dd-tailor-korean.test.ts pattern) — afterEach restores from it.
const PRISTINE_LLM = { ...(await import("../../app/web-next/lib/llm.ts")) };
const llmResets: Array<() => void> = [];
afterEach(() => {
  for (const r of llmResets.splice(0)) r();
});

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { STALE_PIN_FALLBACK_LINE } = await import("../../app/web-next/lib/brownfield-universe.ts");

let db: Db;
let analystCookie = "";
const SHARED_NAME = "원자력 발전소 핵심 부품·장비 공급 산업";
const idA = ulid(); // the opportunity's industry (FK target)
const idB = ulid(); // the drifted same-name industry (the shadow)
const analysisA = ulid();
const analysisB = ulid();
const vA7 = ulid(); // pin target — anchor $39.88B, grade B
const vB2 = ulid(); // the stale shadow — anchor $38.66B, grade C

/** Rich matrix payload for the §4.2 manifest expansion fixtures. */
function matrixPayload(anchor: number, rich: boolean): string {
  return JSON.stringify({
    matrix: {
      industryLabel: "원자력 부품·장비",
      anchor: { total: anchor },
      competitive: { structure: "과점 — 3사 점유" },
      ...(rich
        ? {
            segments: [
              { code: "SEG1", label: "핵심부품" },
              { code: "SEG2", label: "검사장비" },
              { code: "SEG3", label: "유지보수 서비스" },
            ],
            regions: [
              { code: "KR", label: "한국", weight: 60, mix: {}, adjustment: "" },
              { code: "US", label: "미국", weight: 40, mix: {}, adjustment: "" },
            ],
            chainGrade: { grade: "B", statisticalHops: 2, note: "" },
            chainDirection: {
              position: "midstream",
              note: "",
              relatedIndustries: [{ relation: "상류", name: "특수강 소재" }],
            },
            qualitative: {
              opportunityFactors: ["원전 재가동 수요", "수출 인증 수혜"],
              riskFactors: ["규제 지연"],
            },
            sectionConfidence: [{ section: "정성 분석", grade: "B-" }],
          }
        : {}),
    },
  });
}

const REQ = (path: string, init?: RequestInit) => nextRequest(path, init);

/** Install a completeOrFallback mock that captures the messages and returns
 * `reply` as an LLM result (null → deterministic synthesis, the provider-off
 * fallback contract). */
function mockLlm(reply: string | null): { messages: () => unknown[] | null } {
  const state = { messages: null as unknown[] | null };
  const base = { ...PRISTINE_LLM };
  llmResets.push(() => mock.module("../../app/web-next/lib/llm.ts", () => ({ ...base })));
  mock.module("../../app/web-next/lib/llm.ts", () => ({
    ...base,
    completeOrFallback: async (messages: unknown[]) => {
      state.messages = messages;
      if (reply === null) return { source: "synthesis", provider: "deterministic", text: "" } as const;
      return { source: "llm", provider: "mock", text: reply } as const;
    },
  }));
  return { messages: () => state.messages };
}

const criteriaReply = (viability: string | null): string =>
  JSON.stringify({
    criteria: {
      industry: "산업 범위 문장",
      region: "지역 범위 문장",
      size: "규모 조건 문장",
      ...(viability !== null ? { viability } : {}),
      rationale: "S1 v7(신뢰도 B)과 S3 필요 역량 산출물을 인용한 근거 문장.",
    },
  });

interface DraftEnvelope {
  source: string;
  provider: string;
  note: string | null;
  criteria: { industry: string; region: string; size: string; viability: string; rationale: string } | null;
  manifest: string[];
  prompt_version?: string;
  provenance?: {
    s1: {
      resolution: string;
      version_id: string | null;
      version_no: number | null;
      data_confidence_grade: string | null;
      anchor_total_b: number | null;
    };
    chain_financials: "present" | "absent";
  } | null;
}

async function draft(opp: string): Promise<DraftEnvelope> {
  const res = await REQ(`/api/brownfield/${opp}/universe-criteria-draft`, {
    method: "POST",
    headers: { cookie: analystCookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()).data as DraftEnvelope;
}

beforeAll(async () => {
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  const ANALYST = "s6uni-analyst";
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-s6uni-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await REQ("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: ANALYST, password: "pw-s6uni-12345" }),
  });
  analystCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];

  // Industries: A is the opportunity's industry (its own name text). Industry
  // B — the drifted same-name-text row whose name_ko EQUALS the opportunity's
  // market_scope — is inserted INSIDE the name_fallback test, AFTER its
  // opportunity: migration 0126's trg_opportunity_industry_ins re-derives
  // industry_id on insert when the name uniquely matches, so a production
  // opportunity only stays FK-less with a unique name match when the industry
  // row arrived after it (or the name is ambiguous). Inserting B late is that
  // drift shape, and it makes the name join resolve B v2 ($38.66B) exactly as
  // design §9.2 specifies.
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    idA,
    "35111",
    "원자력 발전 부품·장비 산업",
    "NPP parts industry",
    NOW,
  ]);
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisA, idA, "completed", "test", NOW, NOW],
  );
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis) VALUES (?,?,?,?,?,?,?,?,?)",
    [vA7, analysisA, 7, matrixPayload(39.88, false), "test", NOW, "B", 1, "산업 보고서 1건 · 통계 홉 1"],
  );
  // analysisB/vB2 (the shadow's completed v2, anchor $38.66B) are inserted by
  // the name_fallback test together with industry idB — see above.
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function insertOpp(over: Record<string, unknown> = {}): string {
  const id = ulid();
  // Explicit null in `over` must STORE null (the resolution-chain fixtures
  // clear the pin/FK), so the defaults below key on `undefined`, not `??`.
  const pick = <T>(key: string, fallback: T): T => (over[key] === undefined ? fallback : (over[key] as T));
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at, industry_id, sizing_version_id, capability_gap_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      "S6 유니버스 초안 테스트",
      pick<string | null>("market_scope", SHARED_NAME),
      "시스템 통합",
      5000,
      8.0,
      80,
      70,
      "근거",
      "selected",
      "test",
      NOW,
      pick<string | null>("industry_id", idA),
      pick<string | null>("sizing_version_id", vA7),
      pick<string | null>("capability_gap_json", null),
    ],
  );
  return id;
}

const GAP_ROWS = JSON.stringify({
  rows: [
    {
      id: "r1",
      capability: "정밀 가공",
      source: "manual",
      requiredNote:
        "핵심부품은 공차 ±0.01mm 이상의 정밀 가공과 원자력 품질보증 체계를 동시에 갖춘 공급이 필요하다 — 표면처리·검사 설비와 절차 문서가 함께 요구된다.",
      necessity: "essential",
      necessityScopeNote: "",
      held: { status: "none", holders: [], evidence: "" },
      resolution: "build",
      note: "",
      requiredLevel: "양산 수준",
      currentLevel: "",
    },
  ],
});

describe("§4.1 — pinned-first S1 resolution chain", () => {
  test("pinned: the draft quotes $39.88B from industry A v7, provenance.resolution=pinned, manifest carries 고정 버전 v7 · 신뢰도 B", async () => {
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    const m = mockLlm(
      criteriaReply(
        "부품 세그먼트의 이익풀·마진 구조·가격결정력 근거가 아직 없습니다 — 검증 필요: 가치사슬 단계별 재무",
      ),
    );
    const data = await draft(opp);
    const userText = String(
      (m.messages() as Array<{ role: string; content: string }>).find((x) => x.role === "user")?.content ?? "",
    );
    expect(userText).toContain("$39.88B");
    expect(data.prompt_version).toBe("s6.universe_criteria_draft@2");
    expect(data.provenance?.s1.resolution).toBe("pinned");
    expect(data.provenance?.s1.version_id).toBe(vA7);
    expect(data.provenance?.s1.version_no).toBe(7);
    expect(data.provenance?.s1.data_confidence_grade).toBe("B");
    expect(data.provenance?.s1.anchor_total_b).toBeCloseTo(39.88);
    const s1Line = data.manifest.find((l) => l.startsWith("S1 시장분석 ("));
    expect(s1Line).toBeDefined();
    expect(s1Line).toContain("고정 버전 v7");
    expect(s1Line).toContain("신뢰도 B");
    // QA condition 2: the discard note is keyed on the STALE pin only — a
    // completed pin resolves and carries no fall-through line.
    expect(data.manifest).not.toContain(STALE_PIN_FALLBACK_LINE);
  });

  test("pin cleared → industry_fk resolves industry A latest (the shadow B may not win while the FK is set)", async () => {
    const opp = insertOpp({ sizing_version_id: null, capability_gap_json: GAP_ROWS });
    const m = mockLlm(criteriaReply(null));
    const data = await draft(opp);
    const userText = String(
      (m.messages() as Array<{ role: string; content: string }>).find((x) => x.role === "user")?.content ?? "",
    );
    expect(userText).toContain("$39.88B");
    expect(data.provenance?.s1.resolution).toBe("industry_fk");
    expect(data.provenance?.s1.version_no).toBe(7);
    expect(data.manifest.some((l) => l.includes("산업 연동 v7"))).toBeTrue();
  });

  test("industry FK cleared → name_fallback resolves the same-name industry B v2 ($38.66B) with the 명칭 대체 label", async () => {
    // The opportunity is inserted BEFORE industry B exists (trg_opportunity_
    // industry_ins stays silent — nothing matches the name yet), so its
    // industry_id remains NULL and only the name join can resolve.
    const opp = insertOpp({ sizing_version_id: null, industry_id: null, capability_gap_json: GAP_ROWS });
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      idB,
      "35112",
      SHARED_NAME,
      "NPP core parts (shadow)",
      NOW,
    ]);
    db.run(
      "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      [analysisB, idB, "completed", "test", NOW, NOW],
    );
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis) VALUES (?,?,?,?,?,?,?,?,?)",
      [vB2, analysisB, 2, matrixPayload(38.66, false), "test", NOW, "C", 2, "근거 없음"],
    );
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    expect(data.provenance?.s1.resolution).toBe("name_fallback");
    expect(data.provenance?.s1.version_no).toBe(2);
    expect(data.provenance?.s1.anchor_total_b).toBeCloseTo(38.66);
    expect(data.manifest.some((l) => l.includes("명칭 대체 v2"))).toBeTrue();
    expect(JSON.stringify(data.manifest)).toContain("$38.66B");
    // QA condition 2: the pin is ABSENT here (not stale) — no discard note.
    expect(data.manifest).not.toContain(STALE_PIN_FALLBACK_LINE);
  });

  test("nothing resolves → honest unset labels, no anchor, and the draft still proceeds on S3 evidence alone", async () => {
    const opp = insertOpp({
      sizing_version_id: null,
      industry_id: null,
      market_scope: null,
      capability_gap_json: GAP_ROWS,
    });
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    expect(data.provenance?.s1.resolution).toBe("unset");
    expect(data.provenance?.s1.version_id).toBeNull();
    expect(data.provenance?.s1.anchor_total_b).toBeNull();
    expect(data.manifest).toContain("S1 시장분석: 없음 (market_scope 미지정)");
    // The draft ran (S3 evidence alone) — NOT the no-grounding hold.
    expect(data.criteria).not.toBeNull();
    expect(data.criteria?.viability).toBe("");
    expect(data.note).toBeNull();
  });

  test("unset labels: named-but-unresolved market keeps the plain label (s1UnsetLabel)", async () => {
    const { s1UnsetLabel } = await import("../../app/web-next/lib/brownfield-universe.ts");
    const named = insertOpp({ sizing_version_id: null, industry_id: null, market_scope: "존재하지 않는 산업명" });
    expect(s1UnsetLabel(db, named)).toBe("S1 시장분석: 없음");
    const unnamed = insertOpp({ sizing_version_id: null, industry_id: null, market_scope: null });
    expect(s1UnsetLabel(db, unnamed)).toBe("S1 시장분석: 없음 (market_scope 미지정)");
  });

  test("a pin pointing at a non-completed analysis falls through (completed-only pin)", async () => {
    const analysisDraft = ulid();
    const vDraft = ulid();
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [
      analysisDraft,
      idA,
      "in_progress",
      "test",
      NOW,
    ]);
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [vDraft, analysisDraft, 8, matrixPayload(1.23, false), "test", NOW],
    );
    const opp = insertOpp({ sizing_version_id: vDraft, capability_gap_json: GAP_ROWS });
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    // Falls through to industry_fk — the stale in-progress pin is not quoted.
    expect(data.provenance?.s1.resolution).toBe("industry_fk");
    expect(data.provenance?.s1.version_no).toBe(7);
    // QA condition 2 (DEC-20261111-05): the stale pin is discarded OPENLY —
    // the manifest states the fall-through so the reviewer re-checks after
    // completing the pinned analysis (design §4.1 step 1, "not silently
    // ignored").
    expect(data.manifest).toContain(STALE_PIN_FALLBACK_LINE);
    // The stale pin's own figure ($1.23B, v8) never leaks into the context.
    expect(JSON.stringify(data.manifest)).not.toContain("$1.23B");
  });
});

describe("§4.2 — input manifest expansion (S1-declared structure + full S3 rows)", () => {
  test("segments, region mix, chain position, qualitative factors with the section grade, and full requiredNote reach the user message", async () => {
    const rich = ulid();
    db.run(
      "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      [rich, idA, "completed", "test", NOW, NOW],
    );
    const vRich = ulid();
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops) VALUES (?,?,?,?,?,?,?,?)",
      [vRich, rich, 9, matrixPayload(42.0, true), "test", NOW, "A", 0],
    );
    const longCap = "초정밀 5축 가공과 원자력 품질보증(KEPIC) 절차를 함께 갖춘 공급 능력";
    const opp = insertOpp({
      sizing_version_id: vRich,
      capability_gap_json: JSON.stringify({
        rows: [
          {
            id: "r1",
            capability: longCap,
            source: "manual",
            requiredNote:
              "핵심부품은 공차 ±0.01mm 이상의 정밀 가공과 원자력 품질보증 체계를 동시에 갖춘 공급이 필요하다 — 표면처리·검사 설비와 절차 문서가 함께 요구된다.",
            necessity: "partial_essential",
            necessityScopeNote: "검사·문서 범위는 필수, 양산 규모는 선택",
            held: { status: "partial", holders: [], evidence: "" },
            resolution: "partner",
            note: "",
            requiredLevel: "양산 수준",
            currentLevel: "",
          },
        ],
      }),
    });
    const m = mockLlm(criteriaReply(null));
    const data = await draft(opp);
    const userText = String(
      (m.messages() as Array<{ role: string; content: string }>).find((x) => x.role === "user")?.content ?? "",
    );

    // Segment structure — all labels, code in parens.
    expect(userText).toContain("세그먼트: 핵심부품(SEG1) · 검사장비(SEG2) · 유지보수 서비스(SEG3)");
    // Region mix — code + share%.
    expect(userText).toContain("지역 믹스: KR 60% · US 40%");
    // Value-chain position — chainGrade + chainDirection.
    expect(userText).toContain("가치사슬 위치: midstream (사슬 등급 B, hops 2) — 인접: 상류 특수강 소재");
    // Qualitative factors — each block suffixed with the matching sectionConfidence grade.
    expect(userText).toContain("기회 요인: 원전 재가동 수요 · 수출 인증 수혜 (섹션 신뢰도 B-)");
    expect(userText).toContain("위험 요인: 규제 지연 (섹션 신뢰도 B-)");
    // Full S3 row — capability name NOT truncated to 60, requiredNote carried.
    expect(userText).toContain(longCap);
    expect(userText).toContain(
      "필요수준 양산 수준 · 보유 부분 보유 · 필요성 부분 필수 · 검사·문서 범위는 필수, 양산 규모는 선택",
    );
    expect(userText).toContain(
      "— 핵심부품은 공차 ±0.01mm 이상의 정밀 가공과 원자력 품질보증 체계를 동시에 갖춘 공급이 필요하다",
    );
    // The user-message JSON example line asks for viability.
    expect(userText).toContain('"viability"');

    // Manifest carries each added block's name (the UI's proposal-artifact line).
    expect(data.manifest.some((l) => l.startsWith("세그먼트:"))).toBeTrue();
    expect(data.manifest.some((l) => l.startsWith("지역 믹스:"))).toBeTrue();
    expect(data.manifest.some((l) => l.startsWith("가치사슬 위치:"))).toBeTrue();
    expect(data.manifest.some((l) => l.startsWith("기회 요인:"))).toBeTrue();
    expect(data.manifest.some((l) => l.startsWith("위험 요인:"))).toBeTrue();
    expect(data.manifest).toContain("S3 필요 역량 (역량 갭 레지스터)");
  });

  test("segment overflow is counted (≤6 shown + 외 N건), capability overflow likewise", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ code: `S${i}`, label: `세그먼트${i}` }));
    const payload = JSON.stringify({
      matrix: {
        anchor: { total: 10 },
        segments: many,
        regions: [],
      },
    });
    const analysis = ulid();
    db.run(
      "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      [analysis, idA, "completed", "test", NOW, NOW],
    );
    const v = ulid();
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [v, analysis, 1, payload, "test", NOW],
    );
    const rows = Array.from({ length: 14 }, (_, i) => ({
      id: `x${i}`,
      capability: `역량${i}`,
      source: "manual",
      requiredNote: "",
      necessity: "essential",
      necessityScopeNote: "",
      held: { status: "none", holders: [], evidence: "" },
      resolution: null,
      note: "",
      requiredLevel: "",
      currentLevel: "",
    }));
    const opp = insertOpp({ sizing_version_id: v, capability_gap_json: JSON.stringify({ rows }) });
    const m = mockLlm(criteriaReply(null));
    const data = await draft(opp);
    const userText = String(
      (m.messages() as Array<{ role: string; content: string }>).find((x) => x.role === "user")?.content ?? "",
    );
    expect(userText).toContain("외 2건"); // 8 segments, 6 shown
    expect(userText).toContain("외 2건"); // 14 capability rows, 12 shown (same overflow token)
    expect(userText.match(/외 2건/g)?.length).toBe(2);
    expect(data.manifest.some((l) => l.startsWith("세그먼트:"))).toBeTrue();
  });
});

describe("§4.3 — fact_industry stage financials (honest absence vs present)", () => {
  test("0 rows → the gap line names the producing S1 activity and chain_financials=absent", async () => {
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    const GAP =
      "가치사슬 단계별 재무: 데이터 없음 — S1의 가치사슬 단계 재무 분석(value-chain-stage-financials, ADR-0066)이 산출하면 자동 반영";
    expect(data.manifest).toContain(GAP);
    expect(data.provenance?.chain_financials).toBe("absent");
  });

  test("rows present → per-stage financial lines and chain_financials=present", async () => {
    // Insert periods in chronological order — md_period.id is a ulid, so
    // ORDER BY period_id sorts by insertion order; the 2026 period must be
    // the LAST row for operating_margin for the latest-period rule to pick it.
    const period2025 = ulid();
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [period2025, "year", "2025-01-01", "2025-12-31", 2025, NOW],
    );
    const period2026 = ulid();
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [period2026, "year", "2026-01-01", "2026-12-31", 2026, NOW],
    );
    db.run(
      "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), idA, period2025, "operating_margin", 15.0, 1, NOW],
    );
    db.run(
      "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), idA, period2026, "operating_margin", 18.5, 2, NOW],
    );
    db.run(
      "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), idA, period2026, "gross_margin", 30.0, 1, NOW],
    );
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    const m = mockLlm(criteriaReply(null));
    const data = await draft(opp);
    const userText = String(
      (m.messages() as Array<{ role: string; content: string }>).find((x) => x.role === "user")?.content ?? "",
    );
    // Latest period per metric survives within the ≤12-row bound.
    expect(userText).toContain("단계 재무: operating_margin=18.5 (2026, rev2)");
    expect(userText).toContain("단계 재무: gross_margin=30 (2026, rev1)");
    expect(userText).not.toContain("15 (2025, rev1)");
    expect(data.provenance?.chain_financials).toBe("present");
  });
});

describe("§4.4 — parse validity, honest unset, and envelope shape", () => {
  test("response WITHOUT viability parses with viability '' (honest unset)", async () => {
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    expect(data.source).toBe("llm");
    expect(data.criteria).not.toBeNull();
    expect(data.criteria?.viability).toBe("");
    expect(data.prompt_version).toBe("s6.universe_criteria_draft@2");
    expect(data.provenance?.s1.resolution).toBe("pinned");
  });

  test("missing industry → parse_failed envelope unchanged (criteria null, provenance still carried)", async () => {
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    mockLlm(JSON.stringify({ criteria: { region: "지역", size: "규모", viability: "v", rationale: "r" } }));
    const data = await draft(opp);
    expect(data.source).toBe("llm");
    expect(data.criteria).toBeNull();
    expect(data.note).toContain("해석하지 못했습니다");
    expect(data.prompt_version).toBe("s6.universe_criteria_draft@2");
    expect(data.provenance?.s1.resolution).toBe("pinned");
  });

  test("deterministic fallback envelope unchanged (criteria null, provenance present)", async () => {
    const opp = insertOpp({ capability_gap_json: GAP_ROWS });
    mockLlm(null);
    const data = await draft(opp);
    expect(data.source).toBe("synthesis");
    expect(data.provider).toBe("deterministic");
    expect(data.criteria).toBeNull();
    expect(data.note).toContain("LLM 호출 실패");
    expect(data.prompt_version).toBe("s6.universe_criteria_draft@2");
    expect(data.provenance?.s1.resolution).toBe("pinned");
  });

  test("no-grounding envelope keeps provenance null and the S1·S3 note", async () => {
    const opp = insertOpp({
      sizing_version_id: null,
      industry_id: null,
      market_scope: null,
      capability_gap_json: null,
    });
    mockLlm(criteriaReply(null));
    const data = await draft(opp);
    expect(data.source).toBe("synthesis");
    expect(data.criteria).toBeNull();
    expect(data.note).toContain("S1 시장분석·S3 필요 역량");
    expect(data.provenance).toBeNull();
    expect(data.prompt_version).toBe("s6.universe_criteria_draft@2");
  });

  test("parseDraftCriteria caps: industry/region/size 200, viability 400, rationale 600; trims", async () => {
    const { parseDraftCriteria } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/universe-criteria-draft/route.ts"
    );
    expect(parseDraftCriteria(null)).toBeNull();
    expect(parseDraftCriteria({})).toBeNull();
    expect(
      parseDraftCriteria({
        industry: "  인  ",
        region: "r".repeat(300),
        size: "s".repeat(300),
        viability: "v".repeat(500),
        rationale: "r".repeat(900),
      }),
    ).toEqual({
      industry: "인",
      region: "r".repeat(200),
      size: "s".repeat(200),
      viability: "v".repeat(400),
      rationale: "r".repeat(600),
    });
  });
});
