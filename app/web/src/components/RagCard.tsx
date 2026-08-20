import type { RagDimension } from "../api.ts";

// RAG signal card — ui-spec.md §3's display contract:
//   - never color-only (icon + label + color together, FR-SYS-05)
//   - never render an overall grade without all six dimensions assessed —
//     a partial assessment shows "평가 미완료", never a default color
//   - the rationale line is mandatory, visible without an extra click

export const ALL_DIMENSIONS = ["financial", "market", "data_confidence", "regulatory", "technical", "risk"] as const;

const DIMENSION_LABELS: Record<string, string> = {
  financial: "재무성",
  market: "시장",
  data_confidence: "데이터 신뢰도",
  regulatory: "규제·인허가",
  technical: "기술·실행",
  risk: "리스크",
};

const GRADE_META: Record<string, { icon: string; label: string; className: string }> = {
  green: { icon: "●", label: "Green (양호)", className: "grade-green" },
  amber: { icon: "▲", label: "Amber (주의)", className: "grade-amber" },
  red: { icon: "■", label: "Red (위험)", className: "grade-red" },
};

function worstGrade(grades: string[]): "green" | "amber" | "red" {
  if (grades.includes("red")) return "red";
  if (grades.includes("amber")) return "amber";
  return "green";
}

function GradeBadge({ grade }: { grade: string }) {
  const meta = GRADE_META[grade] ?? { icon: "?", label: grade, className: "grade-unknown" };
  return (
    <span className={`grade-badge ${meta.className}`}>
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}

export function RagSignalCard({ dimensions }: { dimensions: RagDimension[] }) {
  const byDimension = new Map(dimensions.map((d) => [d.dimension, d]));
  const complete = ALL_DIMENSIONS.every((d) => byDimension.has(d));

  return (
    <div className="rag-card" role="group" aria-label="RAG 신호등">
      <div className="rag-overall">
        <span className="rag-overall-label">종합 등급</span>
        {complete ? (
          <GradeBadge grade={worstGrade(dimensions.map((d) => d.grade))} />
        ) : (
          <span className="grade-badge grade-incomplete">
            <span aria-hidden="true">○</span> 평가 미완료
          </span>
        )}
      </div>
      <ul className="rag-dimensions">
        {ALL_DIMENSIONS.map((dim) => {
          const row = byDimension.get(dim);
          return (
            <li key={dim} className="rag-dimension-row">
              <span className="rag-dimension-name">{DIMENSION_LABELS[dim]}</span>
              {row ? (
                <>
                  <GradeBadge grade={row.grade} />
                  <p className="rag-rationale">{row.rationale}</p>
                </>
              ) : (
                <span className="grade-badge grade-incomplete">
                  <span aria-hidden="true">○</span> 미평가
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
