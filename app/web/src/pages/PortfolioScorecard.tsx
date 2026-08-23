import { useEffect, useState } from "react";
import {
  getPortfolioScorecard,
  type PortfolioScorecard,
  type PortfolioScorecardMeta,
  type PortfolioScorecardRow,
  type ScorecardClassRollup,
  type ScorecardStatus,
  type ScorecardVentureClass,
} from "../api.ts";
import { SourceTooltip } from "../components/SourceTooltip.tsx";

// 포트폴리오 스코어카드 (Portfolio Scorecard) — E.4's final link: the
// workspace-level rollup of per-venture measure results for one review
// cycle, membership-filtered server-side. A top-level route like /glossary
// (no project binding), not a ProjectDetail tab.
//
// House rules honored here:
//   - status is never color-only — icon + label + color on every chip
//     (FR-SYS-05), reusing the grade-badge classes the RAG card set
//   - figures carry source tooltips (FR-SYS-03) built only from row/API
//     provenance columns (run_id, observed_at, evidence_ref) — never
//     hand-typed
//   - the membership scope warning renders whenever meta.scope_incomplete
//     is true; the excluded-projects count comes from meta, not local math

// Class order fixed by ADR-0060's R5 taxonomy; the enum value stays visible
// next to the Korean label because measure_key/class are API enums.
const CLASS_ORDER: ScorecardVentureClass[] = ["driving", "enabling", "emergent", "passive", "jv"];

const CLASS_LABELS: Record<ScorecardVentureClass, string> = {
  driving: "주도형",
  enabling: "지원형",
  emergent: "신흥형",
  passive: "수동형",
  jv: "합작형(JV)",
};

// icon + label + color together — same shape as RagCard's GRADE_META.
const STATUS_META: Record<ScorecardStatus, { icon: string; label: string; className: string }> = {
  on_target: { icon: "●", label: "충족", className: "grade-green" },
  deviation: { icon: "▲", label: "이탈", className: "grade-amber" },
  insufficient_evidence: { icon: "○", label: "근거부족", className: "grade-incomplete" },
};

const SECTION_LABELS: Record<"financial" | "strategic", string> = {
  financial: "재무",
  strategic: "전략",
};

function StatusChip({ status }: { status: ScorecardStatus }) {
  const m = STATUS_META[status] ?? { icon: "?", label: status, className: "grade-incomplete" };
  return (
    <span className={`grade-badge ${m.className}`}>
      <span aria-hidden="true">{m.icon}</span> {m.label}
    </span>
  );
}

// Fixed CLASS_ORDER first, then any unexpected class value in first-seen
// order — the enum is closed per the API contract, so the tail is defensive
// only and never silently drops rows.
function classesInOrder(rows: PortfolioScorecardRow[]): ScorecardVentureClass[] {
  const present = new Set(rows.map((r) => r.venture_class));
  const known = CLASS_ORDER.filter((c) => present.has(c));
  const unknown = [...present].filter((c) => !CLASS_ORDER.includes(c));
  return [...known, ...unknown];
}

function rollupsInOrder(rollup: ScorecardClassRollup[]): ScorecardClassRollup[] {
  const known = CLASS_ORDER.map((c) => rollup.find((r) => r.venture_class === c)).filter(
    (r): r is ScorecardClassRollup => r !== undefined,
  );
  const unknown = rollup.filter((r) => !CLASS_ORDER.includes(r.venture_class));
  return [...known, ...unknown];
}

// Per-row provenance for a scorecard figure: run_id + observed_at come from
// the row itself; evidence_ref maps to the tooltip's anchor_ref ("근거
// 참조") — an empty string is omitted rather than rendered as a placeholder.
function rowProvenance(row: PortfolioScorecardRow) {
  return {
    run_id: row.run_id,
    assessed_at: row.observed_at,
    anchor_ref: row.evidence_ref === "" ? undefined : row.evidence_ref,
  };
}

function ScorecardTable({ section, rows }: { section: "financial" | "strategic"; rows: PortfolioScorecardRow[] }) {
  return (
    <section className="scorecard-section" aria-label={`${SECTION_LABELS[section]} 지표`}>
      <h2>{SECTION_LABELS[section]}</h2>
      {rows.length === 0 ? (
        <p className="empty-state">{SECTION_LABELS[section]} 섹션에 표시할 행이 없습니다.</p>
      ) : (
        <table className="data-table scorecard-table">
          <caption className="sr-only">{SECTION_LABELS[section]} 지표 — 벤처 클래스별 분류</caption>
          <thead>
            <tr>
              <th scope="col">벤처</th>
              <th scope="col">측정</th>
              <th scope="col">목표</th>
              <th scope="col">실적</th>
              <th scope="col">상태</th>
            </tr>
          </thead>
          <tbody>
            {classesInOrder(rows).map((vc) => {
              const groupRows = rows.filter((r) => r.venture_class === vc);
              const ventures = new Set(groupRows.map((r) => r.project_id)).size;
              return [
                <tr key={`group-${section}-${vc}`} className="class-group-row">
                  <th colSpan={5}>
                    {CLASS_LABELS[vc] ?? vc} ({vc}) · 벤처 {ventures} · 측정 {groupRows.length}
                  </th>
                </tr>,
                ...groupRows.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-primary">{row.project_no}</td>
                    <td>
                      <code>{row.measure_key}</code>
                    </td>
                    <td>
                      <SourceTooltip provenance={rowProvenance(row)}>
                        <span>{row.target_value ?? "—"}</span>
                      </SourceTooltip>
                    </td>
                    <td>
                      <SourceTooltip provenance={rowProvenance(row)}>
                        <span>{row.actual_value ?? "—"}</span>
                      </SourceTooltip>
                    </td>
                    <td>
                      <StatusChip status={row.status} />
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ScorecardBody({ data, meta }: { data: PortfolioScorecard; meta: PortfolioScorecardMeta | null }) {
  // The insufficient_evidence list carries project_id only; project_no is
  // resolved from the section rows (the same payload), falling back to the
  // id when no row exposes it — never a fabricated number.
  const projectNoById = new Map(
    [...data.financial, ...data.strategic].map((r) => [r.project_id, r.project_no]),
  );
  const availableCycles = meta?.review_cycles_available ?? data.provenance.review_cycles_available;

  if (data.review_cycle === null) {
    return <p className="empty-state">기록된 스코어카드가 없습니다.</p>;
  }

  return (
    <>
      <section aria-label="벤처 클래스 요약" className="scorecard-section">
        <h2>클래스 요약</h2>
        <ul className="scorecard-rollup-grid">
          {rollupsInOrder(data.class_rollup).map((r) => (
            <li key={r.venture_class} className="scorecard-rollup-card">
              <div className="scorecard-rollup-head">
                <strong>
                  {CLASS_LABELS[r.venture_class] ?? r.venture_class} <span className="cell-sub">({r.venture_class})</span>
                </strong>
              </div>
              <SourceTooltip provenance={{ as_of: meta?.as_of }}>
                <p className="cell-sub">
                  벤처 {r.ventures} · 측정 {r.measures}
                </p>
              </SourceTooltip>
              <ul className="scorecard-rollup-rows">
                <li>
                  <StatusChip status="on_target" /> {r.on_target}
                </li>
                <li>
                  <StatusChip status="deviation" /> {r.deviation}
                </li>
                <li>
                  <StatusChip status="insufficient_evidence" /> {r.insufficient_evidence}
                </li>
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <ScorecardTable section="financial" rows={data.financial} />
      <ScorecardTable section="strategic" rows={data.strategic} />

      {data.insufficient_evidence.length > 0 && (
        <section aria-label="근거부족 항목" className="scorecard-section">
          <h2>근거부족 항목</h2>
          <table className="data-table">
            <caption className="sr-only">근거가 부족해 평가되지 못한 측정 항목</caption>
            <thead>
              <tr>
                <th scope="col">벤처</th>
                <th scope="col">섹션</th>
                <th scope="col">측정</th>
              </tr>
            </thead>
            <tbody>
              {data.insufficient_evidence.map((item, i) => (
                <tr key={`${item.project_id}-${item.section}-${item.measure_key}-${i}`}>
                  <td className="cell-primary">{projectNoById.get(item.project_id) ?? item.project_id}</td>
                  <td>{SECTION_LABELS[item.section] ?? item.section}</td>
                  <td>
                    <code>{item.measure_key}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="scorecard-footer">
        <h2>출처 및 이력</h2>
        <p className="cell-sub">
          적용 리뷰 사이클: {data.review_cycle}
          {data.resolved_from === "latest" ? " (최신 자동 선택)" : ""}
        </p>
        <p className="cell-sub">
          관련 분석 실행(run):{" "}
          {data.provenance.runs.length > 0 ? data.provenance.runs.map((run) => <code key={run}>{run}</code>) : "—"}
        </p>
        <p className="cell-sub">가용 리뷰 사이클: {availableCycles.length > 0 ? availableCycles.join(", ") : "—"}</p>
        {meta && (
          <p className="cell-sub">
            멤버십 범위 내 프로젝트 {meta.projects_visible}개 중 {meta.projects_with_rows_total}개가 스코어카드 행을
            보유합니다.
          </p>
        )}
      </footer>
    </>
  );
}

export function PortfolioScorecard() {
  // "" selects the server's latest cycle; an explicit "YYYY-Qn" re-fetches.
  const [cycle, setCycle] = useState("");
  const [data, setData] = useState<PortfolioScorecard | null>(null);
  const [meta, setMeta] = useState<PortfolioScorecardMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(cycleParam: string) {
    try {
      const res = await getPortfolioScorecard(cycleParam === "" ? undefined : cycleParam);
      setData(res.data);
      setMeta(res.meta);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "스코어카드를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    load("");
  }, []);

  const cycleOptions = meta?.review_cycles_available ?? data?.provenance.review_cycles_available ?? [];

  return (
    <main>
      <h1>포트폴리오 스코어카드</h1>

      <p className="helper-note">
        참조: CVC 성공확률 20–30% 구간(ILLUSTRATIVE) — 이 밴드를 넘는 자금 투입은 명시적 근거가 필요합니다.
      </p>

      <div className="scorecard-cycle-bar">
        <label htmlFor="review_cycle">리뷰 사이클</label>
        <select
          id="review_cycle"
          value={cycle}
          onChange={(e) => {
            setCycle(e.target.value);
            load(e.target.value);
          }}
        >
          <option value="">최신</option>
          {cycleOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {data?.review_cycle != null && (
          <span className="cell-sub">
            적용 사이클: {data.review_cycle}
            {data.resolved_from === "latest" ? " (최신 자동 선택)" : ""}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {meta?.scope_incomplete === true && (
        <p role="alert" className="scope-banner">
          권한 범위 외 {meta.projects_excluded}개 프로젝트가 제외되었습니다 — 이 롤업은 전체 포트폴리오가 아닌
          멤버십 범위 보기입니다.
        </p>
      )}

      {data === null ? (
        !error && <p>불러오는 중...</p>
      ) : (
        <ScorecardBody data={data} meta={meta} />
      )}
    </main>
  );
}
