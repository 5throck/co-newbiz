// DART 회사명 검색 — 회사 등록 모달의 실시간 검색용.
// COA(CORPCODE.xml)에서 정확 일치 → 포함 일치 순으로 상위 후보를 반환한다.
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { isDartConfigured, searchCorpCodes } from "../../../../lib/dart-client.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!isDartConfigured()) return ok({ configured: false, results: [] }, 200);
  if (!q) return ok({ configured: true, results: [] }, 200);
  const results = await searchCorpCodes(q, 8);
  return ok({ configured: true, results }, 200, { count: results.length });
}
