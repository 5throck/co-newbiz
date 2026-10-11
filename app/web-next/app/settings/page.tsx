import { redirect } from "next/navigation";

// /settings 인덱스 — 현재 하위 화면은 연결된 앱(ADR-0154) 하나뿐이므로
// 서버 리다이렉트로 보낸다. 두 번째 설정 화면이 생기면 이 자리가 인덱스가 된다
// (design 2026-10-11-ui-label-and-mobile-table-sweep §4).
export default function SettingsIndexPage() {
  redirect("/settings/connected-apps");
}
