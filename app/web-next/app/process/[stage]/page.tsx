"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type ProjectSummary } from "../../../lib/api.ts";
import { StageLights } from "../../../components/StageLights.tsx";

// 단계별 기능 카드 허브 (/process/[stage]) — 좌측 패널의 S1~S7 단계를 클릭하면
// 해당 스테이지의 실행 기능 카드 그리드가 열린다. 각 카드는 실제 실행 화면이나
// 딜로 딥링크되며, 딜 카드에는 진척 신호등이 표시된다.

interface Card {
  title: string;
  desc: string;
  href: string;
  external?: boolean;
}

const STAGE_META: Record<string, { name: string; objective: string; cards: (deals: ProjectSummary[]) => Card[] }> = {
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
  S4: {
    name: "진출방식 결정",
    objective: "어떻게 들어갈 것인가? — Greenfield(자체) vs Brownfield(M&A), R&BD vs 사내벤처를 결정합니다.",
    cards: () => [
      { title: "딜 워크플로우", desc: "딜의 워크플로우 탭에서 트랙을 결정·기록합니다.", href: "/projects" },
      { title: "선별된 기회", desc: "트랙 결정을 기다리는 선별 기회 목록.", href: "/opportunities?status=selected" },
    ],
  },
  S5: {
    name: "사업성 분석",
    objective: "돈이 되는가? — Greenfield는 비용·수익 모델, M&A는 밸류에이션(CDD)이 주체입니다.",
    cards: () => [
      { title: "수익성 분석", desc: "시뮬레이션 기반 NPV 포트폴리오 요약.", href: "/profitability" },
      { title: "딜 Business Case", desc: "딜별 비용·수익 모델과 BEP를 워크플로우에서 입력합니다.", href: "/projects" },
    ],
  },
  S6: {
    name: "실사·검증",
    objective: "사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행합니다.",
    cards: () => [
      { title: "딜 실사 (Commercial/Technical/Legal)", desc: "딜 워크플로우의 실사 탭에서 체크리스트를 판정합니다.", href: "/projects" },
      { title: "실사 조사내역·증거", desc: "딜별 조사내역과 증거 참조를 확인합니다.", href: "/projects" },
    ],
  },
  S7: {
    name: "투자심사·실행",
    objective: "투자할 것인가? — IC 패키지를 준비하고 Entity/Group IC 심사를 받습니다.",
    cards: () => [
      { title: "IC 패키지·보고서", desc: "딜 스냅샷·보고서를 생성해 심사 자료로 사용합니다.", href: "/reports" },
      { title: "딜 검토 현황", desc: "딜 워크플로우에서 3단계 검토·사인오프를 진행합니다.", href: "/projects" },
    ],
  },
};

const STAGE_ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"];

export default function ProcessStagePage() {
  const params = useParams<{ stage: string }>();
  const stage = (params?.stage ?? "S1").toUpperCase();
  const meta = STAGE_META[stage];
  const [deals, setDeals] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    api
      .get<ProjectSummary[]>("/api/projects")
      .then((r) => setDeals(r.data))
      .catch(() => setDeals([]));
  }, []);

  if (!meta) {
    return (
      <main>
        <h1>알 수 없는 단계</h1>
        <p className="text-[color:var(--muted-fg)]">S1~S7 중 하나를 선택하세요.</p>
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
        {meta.cards(deals ?? []).map((c) => (
          <Link key={c.title + c.href} href={c.href} className="process-card">
            <strong>{c.title}</strong>
            <p>{c.desc}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-6 mb-2 text-[1rem]">내 딜 진척</h2>
      {deals === null ? (
        <p>불러오는 중...</p>
      ) : deals.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">
          배정된 딜이 없습니다. 관리자는 딜에 접근할 수 없으며, 딜은 기회(S2) 선별 후 승격으로 생성됩니다.
        </p>
      ) : (
        <ul className="process-deal-list">
          {deals.map((d) => (
            <li key={d.id} className="process-deal-row">
              <Link href={`/projects/${d.id}`} className="process-deal-no">
                {d.project_no}
              </Link>
              {d.stage_summary && (
                <StageLights stages={d.stage_summary.stages} routeDecided={d.stage_summary.routeDecided} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
