// 사용자 안내서 위키 인덱스 데이터(읽기 전용). GET /api/wiki는 페이지 요약
// 목록 + 여정 그룹(_Sidebar.md 투영) + 푸터를 한 번에 내린다 — /wiki 인덱스와
// /wiki/[slug]의 왼쪽 열이 이 한 번의 호출로 충족된다(2026-10-23 위키 인앱
// 뷰어 설계 §4/D7). 인증은 모든 읽기 경로와 같은 authenticate().
import { authenticate } from "../../../lib/auth.ts";
import { getWikiFooter, getWikiSidebarGroups, listWikiPages } from "../../../lib/wiki.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const pages = listWikiPages();
  return ok(
    { pages, groups: getWikiSidebarGroups(), footer: getWikiFooter() },
    200,
    { count: pages.length },
  );
}
