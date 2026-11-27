import { redirect } from "next/navigation";
import { resolveLandingPath } from "../lib/landing.ts";
import { getRscSession } from "../lib/rsc-session.ts";

// 2026-09-14: 별도 대시보드(추상적 집계 막대그래프)를 정리하고 검토/안건 보드
// (/deals — 실제 클릭 가능한 딜 카드 + HOLD·에이징 상세)를 단일 랜딩 화면으로
// 삼는다. 서버 사이드 리다이렉트라 옛 즐겨찾기·링크도 끊기지 않는다
// (/pipeline 리다이렉트 스텁과 동일 패턴, ADR-0120).
//
// 2026-11-27 (ADR-0091 역할–화면 분리 착지 분리): admin은 관리 콘솔만 쓰는
// 역할이므로 로그인 착지 화면은 시스템 대시보드(/admin)다. 나머지 역할
// (analyst·viewer)과 비로그인 방문은 이전과 같이 검토/안건 보드(/deals)로
// 간다. `next` 딥링크는 로그인 화면이 먼저 처리하므로 `/`에는 도달하지 않는다.
export default async function HomeRedirect() {
  const session = await getRscSession();
  redirect(resolveLandingPath(session?.role ?? null));
}
