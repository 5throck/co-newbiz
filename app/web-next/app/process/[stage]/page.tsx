"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

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

const STAGE_META: Record<string, { name: string; objective: string; cards: () => Card[] }> = {
  S1: {
    name: "시장분석",
    objective: "어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악합니다.",
    cards: () => [
      { title: "시장 데이터·체인", desc: "수집된 시장 시계열과 추이를 조회합니다.", href: "/market" },
      { title: "벤치마킹 사례", desc: "공개된 유사 딜 사례를 업종·유형별로 조회합니다.", href: "/benchmarks" },
    ],
  },
  S2: {
    name: "기회 발굴",
    objective: "무엇을 할 것인가? — 가치사슬상 사업 기회를 등록·평가합니다.",
    cards: () => [
      { title: "기회 퍼널", desc: "기회를 등록하고 identified→assessed→selected로 진행합니다.", href: "/opportunities" },
      { title: "기회 등록", desc: "새 기회를 바로 등록합니다.", href: "/opportunities" },
    ],
  },
  S3: {
    name: "시너지·전략적 적합성",
    objective: "우리가 해야 하는가? — 자사 역량과의 시너지를 평가합니다.",
    cards: () => [
      { title: "적합성 평가 대상", desc: "평가 중인 기회를 확인하고 시너지 점수를 기록합니다.", href: "/opportunities?status=assessed" },
      { title: "전략적 적합성 체크리스트", desc: "knock-out 항목과 스코어카드 기준을 확인합니다.", href: "/library" },
    ],
  },
};

const STAGE_ORDER = ["S1", "S2", "S3"];

export default function ProcessStagePage() {
  const params = useParams<{ stage: string }>();
  const stage = (params?.stage ?? "S1").toUpperCase();
  const meta = STAGE_META[stage];

  if (!meta) {
    return (
      <main>
        <h1>알 수 없는 단계</h1>
        <p className="text-[color:var(--muted-fg)]">S1~S3 중 하나를 선택하세요.</p>
      </main>
    );
  }

  const stageIdx = STAGE_ORDER.indexOf(stage);

  return (
    <main>
      <ol className="stage-stepper" aria-label="프로세스 스테이지">
        {STAGE_ORDER.map((id, i) => (
          <li key={id} className={`stage-step ${i === stageIdx ? "stage-step-current" : ""}`}>
            <span className="stage-step-id">{id}</span>
          </li>
        ))}
      </ol>
      <h1>
        {stage} {meta.name}
      </h1>
      <p className="mt-[0.15rem] mb-4 text-[color:var(--muted-fg)] text-[0.9rem]">{meta.objective}</p>

      <h2 className="mb-2 text-[1rem]">실행 기능</h2>
      <div className="process-cards">
        {meta.cards().map((c) => (
          <Link key={c.title + c.href} href={c.href} className="process-card">
            <strong>{c.title}</strong>
            <p>{c.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
