"use client";

import { useEffect } from "react";
import { StatusPage } from "../components/StatusPage.tsx";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage title="화면을 표시하지 못했습니다" onRetry={reset} detail={error.digest ? `오류 식별자: ${error.digest}` : undefined}>
      일시적인 문제로 이 화면을 불러오지 못했습니다. 다시 시도하거나 검토/안건 보드로 돌아가세요. 입력 중이던 내용은 저장되지 않았을 수 있습니다.
    </StatusPage>
  );
}
