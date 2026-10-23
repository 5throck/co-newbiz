// 위키 한 페이지 본문(읽기 전용). slug는 wiki.generated.ts의 키 집합에서만
// 해석한다 — 클라이언트가 통제하는 경로 구성요소가 fs에 닿지 않는다(/api/
// library/[docId]와 같은 포즈, 2026-10-23 위키 인앱 뷰어 설계 D3). 키에 없는
// slug는 404 봉투.
import { authenticate } from "../../../../lib/auth.ts";
import { decodePathSegment, getWikiPage } from "../../../../lib/wiki.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { slug: rawSlug } = await params;
  // 세그먼트는 인코딩된 채 도달할 수 있다(클라이언트의 이중 인코딩 URL이 Next의
  // 한 번 해제를 거치고 남는 꼴) — 한 번 더 풀어 키 집합 조회에 맡긴다. 이미
  // 디코딩된 원값과 malformed 시퀀스(%zz)는 원값 통과라 500이 되지 않는다.
  const slug = decodePathSegment(rawSlug);
  const page = getWikiPage(slug);
  if (!page) return notFound(`No wiki page with slug ${slug}.`);
  return ok(page, 200);
}
