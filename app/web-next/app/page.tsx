import { redirect } from "next/navigation";

// 2026-09-14: 별도 대시보드(추상적 집계 막대그래프)를 정리하고 검토/안건 보드
// (/deals — 실제 클릭 가능한 딜 카드 + HOLD·에이징 상세)를 단일 랜딩 화면으로
// 삼는다. 서버 사이드 리다이렉트라 옛 즐겨찾기·링크도 끊기지 않는다
// (/pipeline 리다이렉트 스텁과 동일 패턴, ADR-0120).
export default function HomeRedirect() {
  redirect("/deals");
}
