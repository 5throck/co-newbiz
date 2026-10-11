"use client";

// 접근 불가 프로젝트 상태 (design 2026-10-11-ui-label-and-mobile-table-sweep §4):
// 프로세스 조회가 403/404이면 단계 외피(stage chrome) 없이 한국어 상태 화면을
// 렌더한다. 403과 404를 사용자에게 구분하지 않는다(존재 여부 누출 방지).
import Link from "next/link";

export const PROJECT_NOT_FOUND_HEADING = "프로젝트를 찾을 수 없습니다";
export const PROJECT_NOT_FOUND_TEXT = "프로젝트가 없거나 접근 권한이 없습니다.";

export function ProjectNotFound() {
  return (
    <main className="p-6">
      <section className="status-page" role="alert">
        <h1>{PROJECT_NOT_FOUND_HEADING}</h1>
        <p className="status-page-text">{PROJECT_NOT_FOUND_TEXT}</p>
        <p>
          <Link className="btn-ghost" href="/projects">프로젝트 목록으로</Link>
          {" "}
          <Link className="btn-ghost" href="/deals">검토/안건 보드로</Link>
        </p>
      </section>
    </main>
  );
}
