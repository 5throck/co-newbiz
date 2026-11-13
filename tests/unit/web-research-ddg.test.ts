// DuckDuckGo 폴백 체인 회귀 테스트 (2026-09-16 — 사용자 결정: "추가적인 웹
// 검색엔진으로 DuckDuckGo"). 네트워크 호출 없이 globalThis.fetch를 스텁한다:
//   - Tavily 432(쿼터 초과) → DDG 폴백이 발동되는가
//   - Tavily 키 부재 + DDG 스위치 off → 검색 미설정으로 남는가
//   - parseDdgResults: uddg 리다이렉트 디코딩·태그 제거·엔티티 디코딩
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  isDdgEnabled,
  isWebResearchConfigured,
  parseDdgResults,
  researchSourcesDetailed,
  setWebResearchOverrideForTests,
} from "../../app/web-next/lib/web-research.ts";
import { loadRootEnvPipelineKeys } from "../../app/web-next/lib/root-env.ts";

const DDG_FIXTURE = `
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fma%3Fid%3D1&amp;rut=abc">로보티즈 <b>지분 인수</b> 관련 기사</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fma%3Fid%3D1">매도자가 존재하며 &amp;규제 이슈는 없음</a>
</div>
<div class="result">
  <a class="result__a" href="https://news.example.kr/direct-article">직접 링크 기사</a>
  <a class="result__snippet" href="https://news.example.kr/direct-article">스니펫 텍스트</a>
</div>
<div class="ad">
  <a class="result__a" href="/internal-ad">내부 광고</a>
</div>
`;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  tavily: process.env.TAVILY_API_KEY,
  ddg: process.env.WEB_SEARCH_DDG_ENABLED,
  brave: process.env.BRAVE_SEARCH_API_KEY,
  serper: process.env.SERPER_API_KEY,
};
// 밀폐(hermetic): 루트 .env가 BRAVE/SERPER 검색 키를 정의해도 이 파일의
// isWebResearchConfigured 단정이 그 값에 좌우되지 않게 한다. loadRootEnvPipelineKeys는
// 프로세스당 한 번만 걷고(메모이즈), 빈 슬롯만 채우므로 — 키를 지운 상태로 로더를 먼저
// 실행시켜 메모이즈하면, 이후 어떤 호출도 루트 .env에서 키를 되살리지 않는다.
delete process.env.BRAVE_SEARCH_API_KEY;
delete process.env.SERPER_API_KEY;
loadRootEnvPipelineKeys();

beforeEach(() => {
  // 다른 테스트 파일(brownfield-llm-support 등)이 모듈 수준에서 켜는 전역
  // 오버라이드를 해제한다 — 오버라이드가 남아 있으면 researchSourcesDetailed가
  // 체인을 우회해 항상 빈 결과를 돌려 provider 체인을 검증할 수 없다.
  setWebResearchOverrideForTests(null);
  // 값은 더미(8자 미만 — pre-commit 시크릿 정규식 회피). 실제로 전송되지 않는다.
  process.env.TAVILY_API_KEY = "test";
  process.env.WEB_SEARCH_DDG_ENABLED = "";
  // 같은 프로세스의 다른 테스트 파일이 검색 키를 세팅했을 수 있다 — 미설정 상태를 고정.
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SERPER_API_KEY;
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV.tavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = ORIGINAL_ENV.tavily;
  if (ORIGINAL_ENV.ddg === undefined) delete process.env.WEB_SEARCH_DDG_ENABLED;
  else process.env.WEB_SEARCH_DDG_ENABLED = ORIGINAL_ENV.ddg;
  if (ORIGINAL_ENV.brave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = ORIGINAL_ENV.brave;
  if (ORIGINAL_ENV.serper === undefined) delete process.env.SERPER_API_KEY;
  else process.env.SERPER_API_KEY = ORIGINAL_ENV.serper;
});

describe("parseDdgResults", () => {
  test("uddg 리다이렉트를 실제 URL로 디코딩하고 태그·엔티티를 정리한다", () => {
    const out = parseDdgResults(DDG_FIXTURE, 10);
    expect(out.length).toBe(2); // 내부 광고(/internal-ad)는 https 필터로 제외
    expect(out[0].url).toBe("https://example.com/ma?id=1");
    expect(out[0].title).toBe("로보티즈 지분 인수 관련 기사");
    expect(out[0].snippet).toContain("매도자가 존재하며");
    expect(out[1].url).toBe("https://news.example.kr/direct-article");
  });

  test("limit를 존중한다", () => {
    expect(parseDdgResults(DDG_FIXTURE, 1)).toHaveLength(1);
  });
});

describe("provider chain (tavily → ddg)", () => {
  test("tavily 쿼터 초과(432)면 ddg 폴백으로 근거를 확보한다", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.tavily.com")) {
        return new Response("quota", { status: 432 });
      }
      if (url.includes("duckduckgo.com")) {
        return new Response(DDG_FIXTURE, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const r = await researchSourcesDetailed(["로보티즈 지분 인수 가능성"], 10);
    expect(r.quotaExceeded).toBe(true); // 폴백해도 쿼터 초과 사실은 보존
    expect(r.sources.length).toBeGreaterThanOrEqual(2);
    expect(r.sources[0].url).toBe("https://example.com/ma?id=1");
  });

  test("tavily 키가 없어도 ddg가 기본 활성이라 검색 가능으로 본다", async () => {
    delete process.env.TAVILY_API_KEY;
    expect(isWebResearchConfigured()).toBe(true);
    expect(isDdgEnabled()).toBe(true);
  });

  test("ddg 스위치를 끄고 tavily 키도 없으면 검색 미설정으로 유지된다", async () => {
    delete process.env.TAVILY_API_KEY;
    process.env.WEB_SEARCH_DDG_ENABLED = "false";
    expect(isWebResearchConfigured()).toBe(false);
    expect(isDdgEnabled()).toBe(false);

    globalThis.fetch = (async () => {
      throw new Error("네트워크 호출이 일어나면 안 됩니다");
    }) as typeof fetch;
    const r = await researchSourcesDetailed(["쿼리"], 5);
    expect(r.sources).toHaveLength(0);
    expect(r.quotaExceeded).toBe(false);
  });

  test("tavily가 정상 결과를 주면 ddg는 호출되지 않는다", async () => {
    let ddgCalled = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.tavily.com")) {
        return Response.json({ results: [{ title: "t", url: "https://tavily.example/x", content: "c" }] });
      }
      if (url.includes("duckduckgo.com")) {
        ddgCalled = true;
        return new Response("", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const r = await researchSourcesDetailed(["쿼리"], 5);
    expect(ddgCalled).toBe(false);
    expect(r.sources).toHaveLength(1);
    expect(r.quotaExceeded).toBe(false);
  });
});
