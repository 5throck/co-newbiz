"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { StageFrame } from "../../../components/StageFrame.tsx";
import { STAGE_META, type StageMetaId } from "../../../lib/stage-meta.ts";

// 단계별 기능 카드 허브 (/process/[stage]) — 좌측 패널의 단계를 클릭하면
// 해당 스테이지의 실행 기능 카드 그리드가 열린다.
//
// S4 이후(트랙 결정·딜 워크플로우)는 flow.spec v2.0.0 재설계에 따라
// 재구축 예정 — 현재는 S1~S3(기회 발굴)만 제공한다.

interface Card {
  title: string;
  desc: string;
  href: string;
}

const CARD_SETS: Partial<Record<StageMetaId, () => Array<Card>>> = {
  S1: () => [
    { title: "시장 데이터·체인", desc: "수집된 시장 시계열과 추이를 조회합니다.", href: "/market" },
    { title: "벤치마킹 사례", desc: "공개된 유사 딜 사례를 업종·유형별로 조회합니다.", href: "/benchmarks" },
  ],
  S2: () => [
    { title: "기회 퍼널", desc: "기회를 등록하고 identified→assessed→selected로 진행합니다.", href: "/opportunities" },
    { title: "기회 등록", desc: "새 기회를 바로 등록합니다.", href: "/opportunities" },
  ],
  S3: () => [
    { title: "적합성 평가 대상", desc: "평가 중인 기회를 확인하고 시너지 점수를 기록합니다.", href: "/opportunities?status=assessed" },
    { title: "전략적 적합성 체크리스트", desc: "knock-out 항목과 스코어카드 기준을 확인합니다.", href: "/library" },
  ],
};

export default function ProcessStagePage() {
  const params = useParams<{ stage: string }>();
  const stageId = (params?.stage ?? "S1").toUpperCase() as StageMetaId;
  const stage = stageId;
  const meta = STAGE_META.find((x) => x.id === stageId);

  if (!meta) {
    return (
      <main>
        <h1>알 수 없는 단계</h1>
        <p className="text-[color:var(--muted-fg)]">S1~S3 중 하나를 선택하세요.</p>
      </main>
    );
  }

  const cards = CARD_SETS[stageId]?.() ?? [];

  if (cards.length === 0) {
    // S4+ 재구축 전까지 빈 그리드 대신 미제공 상태를 명시한다 — 스테이지가
    // 조용히 비어 보이면 게이트 산출물이 없는 것으로 오독될 수 있다.
    return (
      <StageFrame stageId={stage as StageMetaId}>
        <h2 className="mb-2 text-[1rem]">실행 기능</h2>
        <p className="text-[color:var(--muted-fg)]">
          {stageId} 단계의 실행 기능은 flow.spec v2.0.0 재설계에 따라 재구축 예정입니다.
          딜 단위 작업은 딜 상세 화면에서 진행하세요.
        </p>
      </StageFrame>
    );
  }

  return (
    <StageFrame stageId={stage as StageMetaId}>
      <h2 className="mb-2 text-[1rem]">실행 기능</h2>
      <div className="process-cards">
        {cards.map((c: Card) => (
          <Link key={c.title + c.href} href={c.href} className="process-card">
            <strong>{c.title}</strong>
            <p>{c.desc}</p>
          </Link>
        ))}
      </div>
    </StageFrame>
  );
}
