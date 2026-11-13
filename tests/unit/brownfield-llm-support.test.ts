/**
 * S6/S7 LLM 지원 라우트 (ADR-0118 계약) — B 웹검색 후보 제안 / E 판정 초안의
 * 순수 로직 + 라우트 경계(viewer 403, 미확정 기회 404, 검색 미설정 synthesis
 * 폴백)를 검증한다. ADR-0118 §5가 미뤄뒀던 S6 웹검색 제안이 "근거 없는 이름을
 * 절대 반환하지 않는다"는 것을 회귀로 잠근다.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-brownfield-llm.sqlite";
const NOW = "2026-09-15T10:00:00Z";

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
const { setPlaywrightSearchOverrideForTests } = await import("../../app/web-next/lib/playwright-search.ts");
// 순수 로직 — route 파일에서 export된 정규화·부착 함수(네트워크·DB 없음)
const { normalizeLlmSuggestions, buildPrompt, enrichSuggestions } = await import(
  "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
);
const { parseScreeningDrafts } = await import(
  "../../app/web-next/app/api/brownfield/[oppId]/targets/[targetId]/screening-draft/route.ts"
);

type Db = ReturnType<typeof GetDb>;
let db: Db;
let analystCookie = "";
let viewerCookie = "";
let oppId = "";

// 검색 미설정 상태를 시뮬레이션한다 — 실제 키가 .env에 설정된 환경에서도
// 테스트가 네트워크 호출 없이 결정론 폴백 경로를 검증하게 한다. Playwright
// headless 폴백도 함께 막아(빈 결과 고정) 테스트가 실제 Chrome을 기동하거나
// 네트워크로 나가지 않게 한다.
// Root cause of the intermittent full-suite failure: loadRootEnvPipelineKeys
// injects the real LLM provider from the repo-root .env, so the web-search route
// made a live network LLM call (up to 60s with retry) and exceeded the 20s test
// timeout under parallel suite load. Assigning "" blocks the .env injection
// (it only fills undefined keys) and makes getProviderConfig return null, which
// pins the deterministic synthesis path. The assertions are unchanged.
process.env.CO_NEWBIZ_LLM_PROVIDER = "";
process.env.CO_NEWBIZ_LLM_API_KEY = "";
process.env.CO_NEWBIZ_LLM_BASE_URL = "";
process.env.CO_NEWBIZ_LLM_MODEL = "";
setWebResearchOverrideForTests({ configured: false, sources: [] });
setPlaywrightSearchOverrideForTests([]);

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

beforeAll(async () => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  const ANALYST = "bf-llm-analyst";
  const VIEWER = "bf-llm-viewer";
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");

  const login = async (userId: string, password: string): Promise<string> => {
    const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login(ANALYST, "pw-analyst-12345");
  viewerCookie = await login(VIEWER, "pw-viewer-12345");

  oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [oppId, "LLM지원 브라운필드", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
  );
});

// ── B: 웹검색 후보 제안 ──
describe("B — 웹검색 후보 제안 (route boundary)", () => {
  test("viewer는 403", async () => {
    const res = await req(`/api/brownfield/${oppId}/target-proposals/web-search`, {
      method: "POST",
      headers: { cookie: viewerCookie },
    });
    expect(res.status).toBe(403);
  });

  test("미확정 기회는 404", async () => {
    const res = await req(`/api/brownfield/${ulid()}/target-proposals/web-search`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(404);
  });

  test("검색 미설정 → LLM 자체 지식 폴백(미검증), 실패 시 synthesis로 재폴백 + 감사 기록", async () => {
    // llm_knowledge 경로는 별도 액션명(target_proposal.web_search_llm_knowledge)으로
    // 감사 기록을 남긴다 — synthesis 재폴백 시에는 기존 target_proposal.web_search.
    const before = (
      db
        .query(
          "SELECT COUNT(*) c FROM audit_log WHERE action IN ('target_proposal.web_search', 'target_proposal.web_search_llm_knowledge')",
        )
        .get() as { c: number }
    ).c;
    const res = await req(`/api/brownfield/${oppId}/target-proposals/web-search`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as {
      source: string;
      note: string | null;
      suggestions: Array<{ sources: unknown[]; rationale: string }>;
    };
    // TAVILY_API_KEY 미설정이면 llmKnowledgeFallback으로 간다 — 그 LLM 호출이
    // (테스트 환경의 실제 프로바이더 설정에 따라) 실패하면 synthesis로 재폴백한다.
    // 어느 쪽이든 "실시간 웹 검색이 설정되지 않았습니다" 사유가 note에 남는다.
    expect(["llm_knowledge", "synthesis"]).toContain(data.source);
    expect(data.note).toContain("실시간 웹 검색이 설정되지 않았습니다");
    expect(Array.isArray(data.suggestions)).toBe(true);
    if (data.source === "synthesis") {
      // 결정론 폴백 제안은 기업 마스터에서 온다 — 근거 URL을 꾸며내지 않는다.
      for (const s of data.suggestions) expect(s.sources.length).toBe(0);
    } else {
      // llm_knowledge 제안은 항상 미검증 라벨을 rationale에 명시한다.
      for (const s of data.suggestions) expect(s.rationale).toContain("미검증");
    }
    const after = (
      db
        .query(
          "SELECT COUNT(*) c FROM audit_log WHERE action IN ('target_proposal.web_search', 'target_proposal.web_search_llm_knowledge')",
        )
        .get() as { c: number }
    ).c;
    expect(after).toBe(before + 1);
  }, 20000);
});

describe("B — normalizeLlmSuggestions (화이트리스트 정규화, 순수)", () => {
  const sources = [
    { title: "t1", url: "https://dart.fss.or.kr/a", snippet: "s1" },
    { title: "t2", url: "https://reuters.com/b", snippet: "s2" },
    { title: "t3", url: "https://blog.example.com/c", snippet: "s3" },
  ];
  const llm = (text: string) => ({ source: "llm" as const, provider: "test", text });

  test("근거 인용 없는 후보는 폐기 — 근거 없는 이름은 날조로 간주", () => {
    const out = normalizeLlmSuggestions(
      llm('{"candidates":[{"company_name":"근거없는회사","rationale":"r","source_indices":[]}]}'),
      sources,
      [],
    );
    expect(out.length).toBe(0);
  });

  test("출처 복원·신뢰도 등급·기존 후보 중복 제거·5건 상한", () => {
    const many = Array.from({ length: 7 }, (_, i) => `새회사${i}`)
      .map((name) => `{"company_name":"${name}","rationale":"r","source_indices":[1]}`)
      .join(",");
    const out = normalizeLlmSuggestions(llm(`{"candidates":[${many}]}`), sources, ["새회사2"]);
    expect(out.length).toBe(5);
    expect(out.some((s) => s.company_name === "새회사2")).toBe(false); // 기존 등록분 제외
    expect(out[0].sources[0].url).toBe("https://dart.fss.or.kr/a");
    expect(out[0].reliability).toBe("A"); // dart.fss 공시 도메인
  });

  test("synthesis 응답은 아무것도 만들지 않는다", () => {
    const out = normalizeLlmSuggestions(
      { source: "synthesis", provider: "deterministic", text: '{"candidates":[1]}' },
      sources,
      [],
    );
    expect(out.length).toBe(0);
  });
});

// ── design 2026-11-11-target-identity-resolution §4 (D2): 서버 사이드 부착 ──
describe("D2 — dart_corp_name 통과·프롬프트 계약·enrichSuggestions", () => {
  const sources = [
    { title: "t1", url: "https://dart.fss.or.kr/a", snippet: "s1" },
    { title: "t2", url: "https://reuters.com/b", snippet: "s2" },
  ];
  const llm = (text: string) => ({ source: "llm" as const, provider: "test", text });

  test("normalizeLlmSuggestions은 dart_corp_name(문자열)을 통과시키고 다른 타입은 폐기한다", () => {
    const out = normalizeLlmSuggestions(
      llm(
        '{"candidates":[' +
          '{"company_name":"이름만","rationale":"r","source_indices":[1]},' +
          '{"company_name":"이름과코드명","dart_corp_name":"정확한법인명","rationale":"r","source_indices":[1]},' +
          '{"company_name":"코드오답","dart_corp_code":"00159218","rationale":"r","source_indices":[1]},' +
          '{"company_name":"숫자오답","dart_corp_name":12345,"rationale":"r","source_indices":[1]}' +
          "]}",
      ),
      sources,
      [],
    );
    expect(out.length).toBe(4);
    const withName = out.find((s) => s.company_name === "이름과코드명");
    expect(withName?.dart_corp_name).toBe("정확한법인명");
    // 모델이 코드 필드를 몰래 싣거나 숫자를 줘도 이름 외에는 아무것도 남지 않는다.
    for (const s of out) {
      expect(s.dart_corp_code).toBeUndefined();
      if (s.company_name !== "이름과코드명") expect(s.dart_corp_name).toBeUndefined();
    }
    expect(out.find((s) => s.company_name === "숫자오답")?.dart_corp_name).toBeUndefined();
  });

  test("buildPrompt 출력 계약은 dart_corp_name을 '선택'으로 요구하고 8자리 코드는 절대 요구하지 않는다", () => {
    const prompt = buildPrompt(
      { name: "기회", market_scope: null },
      {},
      [],
      [],
      [{ title: "t", url: "https://example.com/a", snippet: "s" }],
    );
    expect(prompt).toContain('"dart_corp_name":"DART 공시에 등록된 정확한 법인명(확실할 때만, 모르면 생략)"');
    expect(prompt).not.toContain("dart_corp_code");
  });

  test("enrichSuggestions — exact-unique 히트에만 코드를 붙인다", async () => {
    const cache = [
      { corp_name: "비에이치아이", corp_code: "00409788" },
      { corp_name: "파워로직스", corp_code: "00269612" },
    ];
    const out = await enrichSuggestions(
      [
        { company_name: "비에이치아이(BHI)", rationale: "r", sources: [], reliability: "A" },
        { company_name: "파워(Power)", rationale: "r", sources: [], reliability: "B" }, // zero hit on canonical 파워
      ],
      async (q) => cache.filter((r) => r.corp_name.includes(q)),
    );
    expect(out[0].dart_corp_code).toBe("00409788"); // canonical 비에이치아이 — unique exact hit
    expect(out[1].dart_corp_code).toBeUndefined(); // 파워 exact hit 없음 → 미부착
  });

  test("enrichSuggestions — 다수 exact 히트(태웅 5건)에는 아무것도 붙이지 않는다", async () => {
    const cache = ["00216267", "01494631", "01411203", "01697593", "00186799"].map((corp_code) => ({
      corp_name: "태웅",
      corp_code,
    }));
    const out = await enrichSuggestions(
      [{ company_name: "태웅(Taeung)", rationale: "r", sources: [], reliability: "C" }],
      async () => cache,
    );
    expect(out[0].dart_corp_code).toBeUndefined();
  });

  test("enrichSuggestions — 검색이 던져도 제안은 온전하고 응답은 실패하지 않는다 (best-effort)", async () => {
    const out = await enrichSuggestions(
      [{ company_name: "어딘가회사", rationale: "r", sources: [], reliability: "C" }],
      async () => {
        throw new Error("cache read failed");
      },
    );
    expect(out.length).toBe(1);
    expect(out[0].company_name).toBe("어딘가회사");
    expect(out[0].dart_corp_code).toBeUndefined();
  });

  test("enrichSuggestions — company_name 미적중 시 dart_corp_name으로 같은 규칙을 1회 반복한다", async () => {
    const cache = [{ corp_name: "파워로직스", corp_code: "00269612" }];
    const searched: string[] = [];
    const out = await enrichSuggestions(
      [
        {
          company_name: "파워(Power)",
          dart_corp_name: "파워로직스(주)",
          rationale: "r",
          sources: [],
          reliability: "A",
        },
      ],
      async (q) => {
        searched.push(q);
        return cache.filter((r) => r.corp_name.includes(q));
      },
    );
    expect(searched).toEqual(["파워", "파워로직스"]); // 1회 반복 — 무한 재검색 없음
    expect(out[0].dart_corp_code).toBe("00269612"); // dart_corp_name의 canonical 형태로 exact-unique 적중
  });
});

// ── E: 판정 초안 ──
describe("E — parseScreeningDrafts (판정 초안 정규화, 순수)", () => {
  const evidence = new Map([["t-01", [{ title: "t", url: "https://dart.fss.or.kr/x", snippet: "s" }]]]);
  const open = [{ id: "t-01" }, { id: "t-02" }];

  test("근거 있는 항목만 초안 생성, verdict enum 화이트리스트(5단 척도)", () => {
    const out = parseScreeningDrafts(
      {
        source: "llm",
        provider: "test",
        text: '{"drafts":{"t-01":{"verdict":"confirmed","rationale":"근거 확인","source_index":1},"t-02":{"verdict":"만들어낸값","rationale":"r","source_index":1}}}',
      },
      evidence,
      open,
    );
    expect(out["t-01"]).toBeDefined();
    expect(out["t-01"].verdict).toBe("confirmed");
    expect(out["t-01"].source_url).toBe("https://dart.fss.or.kr/x");
    expect(out["t-02"]).toBeUndefined(); // 비정상 verdict → 초안 없음
  });

  test("synthesis(LLM 실패)는 빈 초안 — 미판정 유지", () => {
    const out = parseScreeningDrafts({ source: "synthesis", provider: "deterministic", text: "" }, evidence, open);
    expect(Object.keys(out).length).toBe(0);
  });
});

// ── D: 유니버스 기준 초안 (route boundary) ──
describe("D — 유니버스 선정 기준 초안 (route boundary)", () => {
  test("viewer는 403, 미확정 기회는 404", async () => {
    expect(
      (
        await req(`/api/brownfield/${oppId}/universe-criteria-draft`, {
          method: "POST",
          headers: { cookie: viewerCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(`/api/brownfield/${ulid()}/universe-criteria-draft`, {
          method: "POST",
          headers: { cookie: analystCookie },
        })
      ).status,
    ).toBe(404);
  });

  test("S1·S3 근거가 없으면 LLM을 부르지 않고 제안 보류 (날조 방지)", async () => {
    const res = await req(`/api/brownfield/${oppId}/universe-criteria-draft`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { source: string; criteria: unknown; note: string };
    expect(data.criteria).toBeNull();
    expect(data.note).toContain("S1");
  });
});

// ── design 2026-11-13-proposal-ignore-suppression (DEC-20261113-04): 추출기
//    억제 핀 + 프롬프트 무시 이력 블록(§5.4, §5.5). 억제는 완전 키 일치뿐 —
//    isSimilar(퍼지)는 기존 이름 중복 제거에만 남는다(§4.3). ──
describe("억제 — normalizeLlmSuggestions / normalizeLlmKnowledgeSuggestions (순수, §5.4)", () => {
  const sources = [
    { title: "t1", url: "https://dart.fss.or.kr/a", snippet: "s1" },
    { title: "t2", url: "https://reuters.com/b", snippet: "s2" },
  ];
  const llm = (text: string) => ({ source: "llm" as const, provider: "test", text });

  test("억제 집합의 키 변주는 전부 폐기 — 한양·(주)한양 모두 억제 키 한양에 걸린다", async () => {
    const { normalizeLlmSuggestions } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const { companyKey } = await import("../../app/web-next/lib/name-similarity.ts");
    const suppressed = new Set([companyKey("주식회사 한양")]);
    const out = normalizeLlmSuggestions(
      llm(
        '{"candidates":[' +
          '{"company_name":"한양","rationale":"r","source_indices":[1]},' +
          '{"company_name":"(주)한양","rationale":"r","source_indices":[1]},' +
          '{"company_name":"한양전자","rationale":"r","source_indices":[1]}' +
          "]}",
      ),
      sources,
      [],
      suppressed,
    );
    expect(out.map((s) => s.company_name)).toEqual(["한양전자"]); // exact-key만 억제 — 퍼지 없음
  });

  test("억제 집합이 비어 있으면(무시 1회) 통과 — 라우트가 ignore_count 칩을 붙인다", async () => {
    const { normalizeLlmKnowledgeSuggestions } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const out = normalizeLlmKnowledgeSuggestions(
      llm('{"candidates":[{"company_name":"한양","rationale":"미검증 근거"}]}'),
      [],
      new Set(), // 1회 무시 — 임계값 미달, 억제 집합에 없다
    );
    expect(out.map((s) => s.company_name)).toEqual(["한양"]);
    expect(out[0].reliability).toBe("C"); // 미검증 라벨 계약은 그대로
  });

  test("llm_knowledge 경로도 같은 억제 집합을 적용한다", async () => {
    const { normalizeLlmKnowledgeSuggestions } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const { companyKey } = await import("../../app/web-next/lib/name-similarity.ts");
    const out = normalizeLlmKnowledgeSuggestions(
      llm(
        '{"candidates":[{"company_name":"주식회사 한양","rationale":"r"},{"company_name":"다른회사","rationale":"r"}]}',
      ),
      [],
      new Set([companyKey("한양(주)")]),
    );
    expect(out.map((s) => s.company_name)).toEqual(["다른회사"]);
  });
});

describe("프롬프트 무시 이력 블록 — 재제안 금지 힌트(어드바이저리, §5.5)", () => {
  const sources = [{ title: "t", url: "https://example.com/a", snippet: "s" }];

  test("무시 이력이 있으면 buildPrompt에 재제안 금지 블록과 원문 이름이 들어간다", async () => {
    const { buildPrompt } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const prompt = buildPrompt({ name: "기회", market_scope: null }, {}, [], [], sources, ["(주)한양"]);
    expect(prompt).toContain("이전 제안에서 무시된 후보(재제안 금지):");
    expect(prompt).toContain("- (주)한양");
  });

  test("무시 이력이 없으면 블록 자체가 없다", async () => {
    const { buildPrompt } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const prompt = buildPrompt({ name: "기회", market_scope: null }, {}, [], [], sources);
    expect(prompt).not.toContain("재제안 금지");
  });

  test("buildKnowledgePrompt도 같은 블록 계약을 공유한다", async () => {
    const { buildKnowledgePrompt } = await import(
      "../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts"
    );
    const withHint = buildKnowledgePrompt({ name: "기회", market_scope: null }, {}, [], [], ["주식회사 한양"]);
    expect(withHint).toContain("이전 제안에서 무시된 후보(재제안 금지):");
    expect(withHint).toContain("- 주식회사 한양");
    const without = buildKnowledgePrompt({ name: "기회", market_scope: null }, {}, [], []);
    expect(without).not.toContain("재제안 금지");
  });
});
