// DART corp_code 웹 폴백 검색 + 교차 검증 (k-dart 스킬 보조 경로).
// OpenDART 직접 검색(list.json)이 실패·공백일 때 인터넷 검색(Tavily)으로
// 후보 corp code를 수집하고, 다음 두 경로로 교차 검증한다:
//  1) DART 기업개황(company.json) 역조회 — 코드 존재 + 이름 일치 (1차 정답)
//  2) DART 자체가 응답하지 않을 때 — 서로 다른 웹 소스 2곳 이상이 같은 코드를
//     언급하면 "미검증 후보"로만 반환(validated=false 아님, null)
import { tavilySearch, type WebSource } from "./web-research.ts";
import { validateCorpCode } from "./dart-client.ts";

export interface CorpCodeCandidate {
  corp_code: string;
  corp_name: string | null;
  source: "web";
  /** true=DART 기업개황으로 이름까지 확인 / false=DART 조회됐으나 이름 불일치 / null=DART 검증 불가(다중 소스만) */
  validated: boolean | null;
  sources: string[];
}

/** DART corp_code는 8자리 16진수 (예: 00126380) — 스니펫·URL에서 후보를 추출한다.
 *  DART 사이트 링크(naviCrpCik=…, corpCode=…)의 URL 파라미터도 동일한 8자리 코드다. */
function parseCorpCodes(text: string): string[] {
  const bare = text.match(/\b[0-9a-fA-F]{8}\b/g) ?? [];
  const params = [...text.matchAll(/(?:naviCrpCik|corpCode)=([0-9A-Fa-f]{8})/g)].map((m) => m[1]);
  return [...new Set([...bare, ...params])];
}

export async function webFallbackCorpCodes(query: string, limit = 5): Promise<CorpCodeCandidate[]> {
  const sources: WebSource[] = await research([
    `${query} DART 고유번호 corp_code`,
    `${query} 전자공시 사업보고서 고유번호`,
    `site:dart.fss.or.kr ${query}`,
    `"${query}" dart.fss.or.kr corpCode OR naviCrpCik`,
  ]);
  if (sources.length === 0) return [];

  // 코드 → 그 코드를 언급한 서로 다른 소스 URL 목록
  const mentions = new Map<string, { urls: Set<string>; snippet: string | null }>();
  for (const s of sources) {
    for (const code of parseCorpCodes(`${s.title} ${s.snippet} ${s.url}`)) {
      const entry = mentions.get(code) ?? { urls: new Set<string>(), snippet: null };
      entry.urls.add(s.url);
      entry.snippet ??= s.snippet;
      mentions.set(code, entry);
    }
  }
  // 기업명이 스니펫에 함께 등장한 코드만 후보로 (완전 무관 코드 필터)
  const q = query.trim();
  const ranked = [...mentions.entries()]
    .filter(([, m]) => m.snippet !== null)
    .sort((a, b) => b[1].urls.size - a[1].urls.size)
    .slice(0, limit);

  const candidates: CorpCodeCandidate[] = [];
  for (const [code, m] of ranked) {
    const v = await validateCorpCode(code, q);
    // 이름 불일치(false)는 폐기, DART 검증 실패(null)는 다중 소스면 후보 유지
    if (v.validated === false && v.corpName === undefined) continue;
    if (v.validated === null && m.urls.size < 2) continue;
    candidates.push({
      corp_code: code,
      corp_name: v.corpName ?? (m.snippet?.includes(q) ? q : null),
      source: "web",
      validated: v.validated,
      sources: [...m.urls].slice(0, 3),
    });
  }
  return candidates.slice(0, limit);
}

async function research(queries: string[]): Promise<WebSource[]> {
  const results = await Promise.all(queries.map((q) => tavilySearch(q, { maxResults: 5 })));
  const seen = new Set<string>();
  const merged: WebSource[] = [];
  for (const list of results) {
    for (const s of list) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      merged.push(s);
    }
  }
  return merged;
}
