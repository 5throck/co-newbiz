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
// 순수 로직 — route 파일에서 export된 정규화 함수(네트워크·DB 없음)
const { normalizeLlmSuggestions } = await import("../../app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts");
const { parseScreeningDrafts } = await import("../../app/web-next/app/api/brownfield/[oppId]/targets/[targetId]/screening-draft/route.ts");

type Db = ReturnType<typeof GetDb>;
let db: Db;
let analystCookie = "";
let viewerCookie = "";
let oppId = "";

// 검색 미설정 상태를 시뮬레이션한다 — 실제 키가 .env에 설정된 환경에서도
// 테스트가 네트워크 호출 없이 결정론 폴백 경로를 검증하게 한다. Playwright
// headless 폴백도 함께 막아(빈 결과 고정) 테스트가 실제 Chrome을 기동하거나
// 네트워크로 나가지 않게 한다.
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
      method: "POST", headers: { cookie: viewerCookie },
    });
    expect(res.status).toBe(403);
  });

  test("미확정 기회는 404", async () => {
    const res = await req(`/api/brownfield/${ulid()}/target-proposals/web-search`, {
      method: "POST", headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(404);
  });

  test("검색 미설정 → LLM 자체 지식 폴백(미검증), 실패 시 synthesis로 재폴백 + 감사 기록", async () => {
    // llm_knowledge 경로는 별도 액션명(target_proposal.web_search_llm_knowledge)으로
    // 감사 기록을 남긴다 — synthesis 재폴백 시에는 기존 target_proposal.web_search.
    const before = (db.query(
      "SELECT COUNT(*) c FROM audit_log WHERE action IN ('target_proposal.web_search', 'target_proposal.web_search_llm_knowledge')",
    ).get() as { c: number }).c;
    const res = await req(`/api/brownfield/${oppId}/target-proposals/web-search`, {
      method: "POST", headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { source: string; note: string | null; suggestions: Array<{ sources: unknown[]; rationale: string }> };
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
    const after = (db.query(
      "SELECT COUNT(*) c FROM audit_log WHERE action IN ('target_proposal.web_search', 'target_proposal.web_search_llm_knowledge')",
    ).get() as { c: number }).c;
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
      .map((name, i) => `{"company_name":"${name}","rationale":"r","source_indices":[1]}`)
      .join(",");
    const out = normalizeLlmSuggestions(llm(`{"candidates":[${many}]}`), sources, ["새회사2"]);
    expect(out.length).toBe(5);
    expect(out.some((s) => s.company_name === "새회사2")).toBe(false); // 기존 등록분 제외
    expect(out[0].sources[0].url).toBe("https://dart.fss.or.kr/a");
    expect(out[0].reliability).toBe("A"); // dart.fss 공시 도메인
  });

  test("synthesis 응답은 아무것도 만들지 않는다", () => {
    const out = normalizeLlmSuggestions({ source: "synthesis", provider: "deterministic", text: '{"candidates":[1]}' }, sources, []);
    expect(out.length).toBe(0);
  });
});

// ── E: 판정 초안 ──
describe("E — parseScreeningDrafts (판정 초안 정규화, 순수)", () => {
  const evidence = new Map([["t-01", [{ title: "t", url: "https://dart.fss.or.kr/x", snippet: "s" }]]]);
  const open = [{ id: "t-01" }, { id: "t-02" }];

  test("근거 있는 항목만 초안 생성, verdict enum 화이트리스트", () => {
    const out = parseScreeningDrafts(
      { source: "llm", provider: "test", text: '{"drafts":{"t-01":{"verdict":"pass","rationale":"근거 확인","source_index":1},"t-02":{"verdict":"만들어낸값","rationale":"r","source_index":1}}}' },
      evidence,
      open,
    );
    expect(out["t-01"]).toBeDefined();
    expect(out["t-01"].verdict).toBe("pass");
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
    expect((await req(`/api/brownfield/${oppId}/universe-criteria-draft`, { method: "POST", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await req(`/api/brownfield/${ulid()}/universe-criteria-draft`, { method: "POST", headers: { cookie: analystCookie } })).status).toBe(404);
  });

  test("S1·S3 근거가 없으면 LLM을 부르지 않고 제안 보류 (날조 방지)", async () => {
    const res = await req(`/api/brownfield/${oppId}/universe-criteria-draft`, { method: "POST", headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { source: string; criteria: unknown; note: string };
    expect(data.criteria).toBeNull();
    expect(data.note).toContain("S1");
  });
});
