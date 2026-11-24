"use client";

// S8 프로젝트 단계 (/projects/[id]/business-case) — ADR-0120 Wave 3: 본문은 공유
// 컴포넌트 components/stages/BusinessCaseStage.tsx로 추출되었다. 이 페이지는 main 셸만
// 제공하는 래퍼다 — /deals/[id]/s8 탭도 동일 컴포넌트를 소비한다
// (URL ?tab= 동기는 페이지 모드에서만 동작한다).
import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BusinessCaseStage } from "../../../../components/stages/BusinessCaseStage.tsx";
import { s8BareTabRedirect } from "../../../../lib/business-goals-view.ts";

function BusinessCasePageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Defect remediation 2 (2026-11-24, DEC-20261124-01): a bare URL (absent `?tab=`) must never
  // commit the stage body — an effect-time redirect inside BusinessCaseStage paints the
  // 재무적 타당성 lens for one frame first. Decide here, render nothing while the replace is
  // pending, and mount the stage only when a `?tab=` is present. The decision helper keys on the
  // raw param: null (absent) or the legacy `overview` (the 개요 tab's key; 2026-11-24 sub-tab
  // rename) redirect; every other explicit value still opens the stage.
  const bareDest = s8BareTabRedirect(params.id, searchParams.get("tab"));
  useEffect(() => {
    if (bareDest) router.replace(bareDest, { scroll: false });
  }, [bareDest, router]);
  if (bareDest) return null;
  return (
    <main>
      <BusinessCaseStage projectId={params.id} />
    </main>
  );
}

export default function BusinessCasePageRoute() {
  return (
    <Suspense fallback={null}>
      <BusinessCasePageInner />
    </Suspense>
  );
}
