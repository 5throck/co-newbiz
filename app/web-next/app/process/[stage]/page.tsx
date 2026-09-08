"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { StageFrame } from "../../../components/StageFrame.tsx";
import { STAGE_META, type StageMetaId } from "../../../lib/stage-meta.ts";

// 단계별 기능 카드 허브 (/process/[stage]) — 좌측 패널의 단계를 클릭하면
// 해당 스테이지의 실행 기능 카드 그리드가 열린다.
// S1~S12 전 단계를 제공한다. 딜 단위(S8+) 작업은 프로젝트 상세·파이프라인으로
// 연결하며, 트랙 전용 단계(S5 GF / S6·S7 BF)는 양쪽 화면으로의 안내를 모두 둔다.

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
  S4: () => [
    { title: "진출방식 결정", desc: "Greenfield/Brownfield 트랙과 5기준 스코어링으로 경로를 결정합니다.", href: "/route-decision" },
    { title: "트랙별 후속 검토 입력", desc: "greenfield: 역량 평가, brownfield: Target Universe 정의.", href: "/route-decision" },
  ],
  S5: () => [
    { title: "역량 평가·진출전략 (greenfield)", desc: "역량 격차 평가와 Build/Partner/Hire/Invest 진출전략을 수립합니다.", href: "/greenfield" },
  ],
  S6: () => [
    { title: "대상 후보 발굴 (brownfield)", desc: "Target Universe를 정의하고 Long List를 구성합니다.", href: "/brownfield" },
  ],
  S7: () => [
    { title: "대상 스크리닝 (brownfield)", desc: "knock-out 스크리닝으로 Long List를 Short List로 축소합니다.", href: "/brownfield" },
  ],
  S8: () => [
    { title: "프로젝트 목록", desc: "승격된 딜의 사업성 분석(Business Case·밸류에이션)을 진행합니다.", href: "/projects" },
    { title: "파이프라인 현황", desc: "S8~S12 퍼널과 게이트 보류 현황을 봅니다.", href: "/pipeline" },
  ],
  S9: () => [
    { title: "프로젝트 실사·검증", desc: "프로젝트 상세에서 DD 체크리스트와 waiver 관리로 실사를 진행합니다.", href: "/projects" },
    { title: "게이트 보류 현황", desc: "DD 게이트 HOLD 항목을 확인합니다.", href: "/pipeline" },
  ],
  S10: () => [
    { title: "투자구조 설계", desc: "프로젝트 상세에서 비히클·4축 검토·자금조달 계획을 설계합니다.", href: "/projects" },
  ],
  S11: () => [
    { title: "투자심사·실행", desc: "Entity IC → Group IC 심사, 차터 기준선, 설립 실행을 진행합니다.", href: "/projects" },
    { title: "투자심사 보류 현황", desc: "Entity/Group IC 게이트 상태를 확인합니다.", href: "/pipeline" },
  ],
  S12: () => [
    { title: "사후 관리", desc: "벤처 스코어카드와 전환 결정(포트폴리오 관리)을 수행합니다.", href: "/projects" },
    { title: "포트폴리오 퍼널", desc: "전체 포트폴리오의 단계 분포를 봅니다.", href: "/pipeline" },
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
        <p className="text-[color:var(--muted-fg)]">S1~S12 중 하나를 선택하세요.</p>
      </main>
    );
  }

  const cards = CARD_SETS[stageId]?.() ?? [];

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
