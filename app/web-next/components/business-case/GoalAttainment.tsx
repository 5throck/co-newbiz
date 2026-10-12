"use client";

// Goal attainment per scenario (ADR-0159): one row per applicable goal, one
// column per case, each cell icon + text (never colour alone). Reference
// evidence only — a miss does not block, re-rank or recommend anything.
// All Korean strings are INTERIM-WORDING.

import { formatDirectionSymbol, formatTargetValue } from "../../lib/business-targets-format.ts";
import { SOURCE_VIEW, attainmentView, summarizeAttainment, type CaseAttainmentEntry } from "../../lib/business-goals-view.ts";

export function AttainmentStatus({ status }: { status: CaseAttainmentEntry["status"] | null }) {
  const v = attainmentView(status);
  return (
    <span className={`status-chip ${v.cls} whitespace-nowrap`}>
      <span aria-hidden="true">{v.icon}</span> {v.label}
    </span>
  );
}

/** Shown once above the comparison when no goal applies at all. Never blocks. */
export function NoGoalsCallout({ onOpenGoals }: { onOpenGoals: () => void }) {
  return (
    <div className="legacy-model-notice mt-3" role="note">
      <span className="status-chip status-not-started"><span aria-hidden="true">–</span> 목표 미설정</span>
      <p className="legacy-model-notice-text">목표와 비교하려면 먼저 사업 목표를 설정하세요. 설정하지 않아도 시나리오 비교는 계속됩니다.</p>
      <button type="button" className="btn-ghost btn-sm" onClick={onOpenGoals}>사업 목표로 이동</button>
    </div>
  );
}

export function GoalAttainmentTable({
  cases,
  attainment,
  goalCount,
}: {
  cases: Array<{ id: string; header: string }>;
  attainment: Record<string, CaseAttainmentEntry[]> | undefined;
  goalCount: number;
}) {
  if (cases.length === 0) return null;
  if (goalCount === 0) {
    return (
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" role="note">
        <AttainmentStatus status={null} /> 적용된 사업 목표가 없어 목표 달성도를 표시하지 않습니다.
      </p>
    );
  }
  // Rows come from the first case that has entries (every case is evaluated against the same goals).
  const rowsSource = cases.map((c) => attainment?.[c.id]).find((e) => e && e.length > 0) ?? [];
  if (rowsSource.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[length:var(--fs-caption)] font-semibold mb-1">목표 달성도 <span className="text-[color:var(--muted-fg)] font-normal">(참고 근거 — 판단은 사람이 합니다)</span></p>
      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table" aria-label="목표 달성도">
          <thead>
            <tr>
              <th scope="col">목표</th>
              {cases.map((c) => <th key={c.id} scope="col">{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowsSource.map((row) => {
              const key = `${row.metric_key}\u0000${row.label}`;
              const src = SOURCE_VIEW[row.source];
              return (
                <tr key={key}>
                  <th scope="row">
                    {row.label}{" "}
                    <span className="section-meta">
                      <span aria-hidden="true">{formatDirectionSymbol(row.direction)}</span> {formatTargetValue(row.target_value, row.unit)} · <span aria-hidden="true">{src.icon}</span> {src.label}
                    </span>
                  </th>
                  {cases.map((c) => {
                    const e = attainment?.[c.id]?.find((x) => `${x.metric_key}\u0000${x.label}` === key);
                    return (
                      <td key={c.id}>
                        <AttainmentStatus status={e?.status ?? null} />
                        {e && e.status !== "manual" && e.actual != null && <span className="section-meta" style={{ display: "block" }}>{formatTargetValue(e.actual, e.unit)}</span>}
                        {e && e.status === "indeterminate" && <span className="section-meta" style={{ display: "block" }}>{e.actual_basis}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="section-meta mt-1">
        {cases.map((c) => {
          const sum = summarizeAttainment(attainment?.[c.id]);
          return `${c.header}: 충족 ${sum.met} · 미달 ${sum.missed} · 판정불가 ${sum.indeterminate} · 수동 확인 ${sum.manual}`;
        }).join("  |  ")}
      </p>
    </div>
  );
}
