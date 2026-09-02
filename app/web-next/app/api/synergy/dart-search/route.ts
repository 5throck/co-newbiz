// DART 회사명 검색 — 회사 등록 폼의 실시간 검색용.
// 1차: OpenDART 목록 API(list.json, k-dart 스킬 계열) + 로컬 md_company.
// 2차(폴백): DART 검색 실패·공백 시 인터넷 검색(Tavily)으로 corp code 후보 수집.
// 교차 검증: 후보 코드는 DART 기업개황(company.json) 역조회로 이름 일치를 확인하고,
//   DART 자체가 응답하지 않으면 서로 다른 소스 2곳 이상 일치 시에만 미검증 후보로 반환.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { isDartConfigured, searchCorpCodesWithMeta } from "../../../../lib/dart-client.ts";
import { webFallbackCorpCodes } from "../../../../lib/corp-code-fallback.ts";
import { isWebResearchConfigured } from "../../../../lib/web-research.ts";

export interface SearchResult {
  corp_code: string;
  corp_name: string;
  source: "dart" | "local" | "web";
  validated?: boolean | null;
  sources?: string[];
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const webReady = isWebResearchConfigured();
  if (!isDartConfigured() && !webReady) {
    return ok({ configured: false, results: [] }, 200);
  }
  if (!q) return ok({ configured: true, results: [] }, 200);

  // 1차 — DART 직접 검색
  const meta = isDartConfigured() ? await searchCorpCodesWithMeta(q, 8) : { results: [] as never[], error: "DART_API_KEY 미구성" };

  // 로컬 마스터 — DART bulk 목록이 차단돼도 md_company에 등록된 회사는 결과에 포함
  const db = getDb();
  const local = db
    .query(
      `SELECT dart_corp_code AS corp_code, name_ko AS corp_name FROM md_company
       WHERE dart_corp_code IS NOT NULL AND (name_ko LIKE '%' || ? || '%' OR name_en LIKE '%' || ? || '%') LIMIT 5`,
    )
    .all(q, q) as Array<{ corp_code: string; corp_name: string }>;

  const merged = new Map<string, SearchResult>();
  for (const r of meta.results) merged.set(r.corp_code, { ...r, source: "dart", validated: true });
  for (const r of local) {
    if (!merged.has(r.corp_code)) merged.set(r.corp_code, { ...r, source: "local", validated: true });
  }

  // 2차 — 웹 폴백 (DART 직접 검색이 실패했거나 후보가 없을 때만)
  const dartFailed = meta.results.length === 0 && Boolean(meta.error);
  let fallbackUsed = false;
  if (merged.size === 0 && webReady) {
    const candidates = await webFallbackCorpCodes(q, 5);
    if (candidates.length > 0) {
      fallbackUsed = true;
      for (const c of candidates) {
        if (merged.has(c.corp_code)) continue;
        merged.set(c.corp_code, {
          corp_code: c.corp_code,
          corp_name: c.corp_name ?? q,
          source: "web",
          validated: c.validated,
          sources: c.sources,
        });
      }
    }
  }

  const results = [...merged.values()];
  const error =
    results.length === 0
      ? dartFailed
        ? `${meta.error} — 웹 폴백${fallbackUsed ? "을 시도했지만" : "을 사용할 수 없어"} 결과가 없습니다.`
        : "DART 검색 결과가 없습니다 — DART 전자공시시스템(https://dart.fss.or.kr)에서 corp code를 직접 확인 후 입력하세요."
      : null;

  return ok({ configured: true, results, error, fallback_used: fallbackUsed }, 200, { count: results.length });
}
