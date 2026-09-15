// Playwright headless web-search fallback (2026-09-15 사용자 요청) — Tavily 쿼터
// 초과(HTTP 432) 등 유료 검색 API를 쓸 수 없을 때, 시스템 Chrome을 headless로
// 띄워 DuckDuckGo HTML 결과 페이지에서 검색 근거를 수집한다. playwright-core는
// 브라우저를 내려받지 않고 시스템 설치 Chrome을 재사용한다(CHROME_PATH 또는
// 플랫폼별 기본 경로). 파싱 대상은 JS 없이 렌더되는 html.duckduckgo.com/html/
// 이므로 headless에서도 안정적이다. 실패 시 항상 [] — 호출자가 결정론 폴백으로
// 떨어지는 기존 계약을 유지한다.
import type { WebSource } from "./web-research.ts";

// 테스트 시임 — 실제 Chrome 기동·네트워크 호출 없이 회귀 테스트를 단일하게
// 만든다(web-research.ts의 setWebResearchOverrideForTests와 같은 취지).
// 프로덕션 코드는 이 함수를 호출하지 않는다.
let testOverride: WebSource[] | null = null;
export function setPlaywrightSearchOverrideForTests(sources: WebSource[] | null): void {
  testOverride = sources;
}

function findChromeBinary(): string | null {
  if (process.env.CHROME_PATH?.trim()) return process.env.CHROME_PATH.trim();
  // Do not probe the filesystem here: under Next/Turbopack, broad fs probes in
  // a route dependency can make output-file tracing think the whole project is
  // relevant. Return the conventional path for the current platform and let
  // chromium.launch fail softly below when Chrome is absent.
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "linux") {
    return process.env.CI ? "/usr/bin/google-chrome" : "/usr/bin/google-chrome-stable";
  }
  return null;
}

/** DuckDuckGo HTML 결과 1페이지를 파싱한다 — 순수 함수(테스트 가능). */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSource[] {
  const out: WebSource[] = [];
  // 결과 블록: <a rel="nofollow" class="result__a" href="...">TITLE</a> ... <a class="result__snippet" ...>SNIPPET</a>
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const titles: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    let url = m[1];
    // DDG는 리다이렉트 래퍼(/l/?uddg=<encoded>)를 쓴다 — 실제 URL을 복원한다.
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(url)) continue;
    titles.push({ url, title: decode(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) snippets.push(decode(m[1]));
  for (let i = 0; i < titles.length && out.length < limit; i++) {
    out.push({
      title: titles[i].title || titles[i].url,
      url: titles[i].url,
      snippet: (snippets[i] ?? "").slice(0, 400),
    });
  }
  return out;
}

/** Playwright headless(시스템 Chrome)로 여러 쿼리를 검색해 근거를 모은다.
 * 검색 엔진은 DuckDuckGo HTML 엔드포인트 — 스크래핑 차단이 가장 온화하고
 * 결과 마크업이 안정적이다. 브라우저는 배치당 1회 기동 후 정리한다. */
export async function playwrightSearch(queries: string[], limit = 10): Promise<WebSource[]> {
  if (testOverride) return testOverride.slice(0, limit);
  const chromeBinary = findChromeBinary();
  if (!chromeBinary || queries.length === 0) return [];
  let chromium: typeof import("playwright-core").chromium;
  try {
    // Keep the optional Playwright fallback outside Turbopack's static module
    // graph. A literal dynamic import("playwright-core") is enough for Next to
    // trace the whole browser package and emit NFT warnings even though this
    // function is a best-effort server-only fallback.
    const dynamicImport = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;
    ({ chromium } = await dynamicImport<typeof import("playwright-core")>("playwright-core"));
  } catch {
    console.error("playwright-search: playwright-core not installed — skipping headless fallback");
    return [];
  }
  let browser: import("playwright-core").Browser | null = null;
  const merged: WebSource[] = [];
  const seen = new Set<string>();
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: chromeBinary,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "ko-KR",
    });
    const page = await context.newPage();
    for (const q of queries) {
      if (merged.length >= limit) break;
      try {
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { timeout: 20_000, waitUntil: "domcontentloaded" });
        const html = await page.content();
        for (const s of parseDuckDuckGoHtml(html, limit)) {
          if (seen.has(s.url)) continue;
          seen.add(s.url);
          merged.push(s);
          if (merged.length >= limit) break;
        }
      } catch (err) {
        // 쿼리 1건 실패는 나머지 쿼리를 막지 않는다.
        console.error(`playwright-search failed for query "${q.slice(0, 60)}":`, err instanceof Error ? err.message : err);
      }
    }
    await context.close();
  } catch (err) {
    console.error("playwright-search launch failed:", err instanceof Error ? err.message : err);
    return merged;
  } finally {
    await browser?.close().catch(() => {});
  }
  return merged;
}
