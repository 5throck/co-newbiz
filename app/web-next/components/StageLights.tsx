"use client";

// 딜 카드용 미니 신호등 스트립 — S5(사업성)/S6(실사)/S7(투자심사)의 진척 상태를
// 색+아이콘+라벨로 표시한다(색만 의존 금지). 트랙 미결정이면 S5 잠금 표시.

export interface StageLight {
  id: string;
  status: "complete" | "current" | "locked";
}

const LABELS: Record<string, string> = { S5: "사업성", S6: "실사", S7: "투자심사" };
const ICONS: Record<string, string> = { complete: "●", current: "◐", locked: "○" };

export function StageLights({
  stages,
  routeDecided,
}: {
  stages: StageLight[];
  routeDecided: boolean;
}) {
  return (
    <ul className="stage-lights" aria-label="단계별 진척">
      {!routeDecided && <li className="stage-light sl-locked" title="진출방식 결정 전">🔒 트랙 미결정</li>}
      {stages.map((s) => (
        <li key={s.id} className={`stage-light sl-${s.status}`} title={`${s.id} ${LABELS[s.id] ?? ""}: ${s.status === "complete" ? "완료" : s.status === "current" ? "진행중" : "대기"}`}>
          <span aria-hidden="true">{ICONS[s.status]}</span>
          <span>{LABELS[s.id] ?? s.id}</span>
        </li>
      ))}
    </ul>
  );
}
