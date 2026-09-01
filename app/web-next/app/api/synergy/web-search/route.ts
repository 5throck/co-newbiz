// 외부 검색 — 비상장 회사 등 확인용 (TAVILY 웹 리서치, 출처 명기).
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { isWebResearchConfigured, tavilySearch } from "../../../../lib/web-research.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!isWebResearchConfigured()) return ok({ configured: false, results: [] }, 200);
  if (!q) return ok({ configured: true, results: [] }, 200);
  const results = await tavilySearch(`${q} 회사 소개 신용평가 실적`, { maxResults: 6 });
  return ok({ configured: true, results }, 200, { count: results.length });
}
