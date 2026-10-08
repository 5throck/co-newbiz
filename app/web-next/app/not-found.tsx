import type { Metadata } from "next";
import { StatusPage } from "../components/StatusPage.tsx";

export const metadata: Metadata = { title: "페이지를 찾을 수 없습니다" };

export default function NotFound() {
  return (
    <StatusPage title="페이지를 찾을 수 없습니다">
      주소가 바뀌었거나 존재하지 않는 화면입니다. 검토/안건 보드로 돌아가거나 이전 화면으로 이동하세요.
    </StatusPage>
  );
}
