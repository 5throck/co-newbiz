// 위키 한 페이지 본문(읽기 전용). slug는 wiki.generated.ts의 키 집합에서만
// 해석한다 — 클라이언트가 통제하는 경로 구성요소가 fs에 닿지 않는다(/api/
// library/[docId]와 같은 포즈, 2026-10-23 위키 인앱 뷰어 설계 D3). 키에 없는
// slug는 404 봉투.
import { authenticate } from "../../../../lib/auth.ts";
import { getWikiPage } from "../../../../lib/wiki.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const page = getWikiPage(slug);
  if (!page) return notFound(`No wiki page with slug ${slug}.`);
  return ok(page, 200);
}
