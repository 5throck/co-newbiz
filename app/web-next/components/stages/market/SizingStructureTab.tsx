"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { segmentsOf } from "../../../lib/market-sizing.ts";
import { ColGroup } from "../../ui.tsx";
import { chainLinkColPct } from "./constants.ts";
import { StepSection } from "./MarketReport.tsx";
import { POSITION_LABELS } from "./marketFormat.ts";
import { StepSensitivityChart } from "./SizingCharts.tsx";
import type { SizingReportState } from "./useSizingReport.ts";

export function SizingStructureTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix, canCurate, onAddLinked, view, retiringLinkId, retireLink, approving, approveProposal, chainLinkError, manualLink, setManualLink, linkSaving, submitManualLink, linkSaved, legacyRelation, setLegacyRelation, legacyAssigning, assignLegacyRelation, detail } = ctx;
  return (
    <>{tab === "structure" && (
      <>
      <StepSection n={1} id="step-1" title="시장 구조 정의 (분석 축·산업 사슬 방향)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          시장을 <strong>권역 × 최종수요 세그먼트 × 시나리오</strong> 3축으로 나누고, 산업이 가치사슬에서
          어디에 위치하는지(상류·중류·하류)에 따라 분석 방향을 정합니다 — 하류 산업은 전방/전전방(수요처)을,
          상류 산업은 후방/후후방(공급처)을 분석해야 수요·공급 구조가 온전히 파악됩니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <table className="data-table sizing-axes-table" aria-label="분석 축 정의">
              <caption className="sr-only">분석 축 정의</caption>
              <thead><tr><th scope="col">구분</th><th scope="col">값</th></tr></thead>
              <tbody>
                <tr><td className="font-semibold">권역 (Region)</td><td>{matrix.regions.map((r) => r.label).join(" / ")} ({matrix.regions.length}개)</td></tr>
                <tr><td className="font-semibold">최종수요 세그먼트</td><td>{segmentsOf(matrix).map((seg) => seg.label).join(" / ")} ({segmentsOf(matrix).length}개)</td></tr>
                <tr><td className="font-semibold">시나리오</td><td>비관 / 기본 / 낙관 (3개, CAGR 밴드)</td></tr>
              </tbody>
            </table>
          </div>
          <div className="chart-half sizing-grade-card">
            <span className="status-chip status-amber">체인 등급 {matrix.chainGrade.grade}</span>
            <p className="mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.chainGrade.note}</p>
            <p className="mt-1 text-[length:var(--fs-caption)]">통계 hop {matrix.chainGrade.statisticalHops}개 · 분석 hop은 등급에 불가산</p>
          </div>
        </div>
        <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">
          산업 사슬 방향 — 위치: {POSITION_LABELS[matrix.chainDirection.position] ?? matrix.chainDirection.position}
        </h4>
        <table className="data-table" aria-label="산업 사슬 방향 분석">
          <caption className="sr-only">산업 사슬 방향 분석</caption>
          <thead>
            <tr><th scope="col" className="w-[8rem]">방향</th><th scope="col">인접 산업</th><th scope="col">분석 포인트</th></tr>
          </thead>
          <tbody>
            {matrix.chainDirection.relatedIndustries.map((r, i) => (
              <tr key={i}>
                <td className="font-semibold">{r.relation}</td>
                <td>{r.name}</td>
                <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.chainDirection.note}</p>

        {/* 가치사슬 연계 — 링크 + 승인 대기 제안 + 등급 (S1 산출물, ADR-0126) */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1">
          <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">가치사슬 연계</h4>
          {canCurate && onAddLinked && (
            <button type="button" className="btn-ghost btn-sm" onClick={onAddLinked} title="이 리포트의 가치사슬 인접 산업 중 추가로 분석할 산업을 고릅니다.">
              연계 산업 이어서 분석
            </button>
          )}
        </div>
        {view.chain.links.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
            이 산업에 등록된 가치사슬 연계 링크가 없습니다 — 아래 승인 대기 제안에서 등록하거나, 신규 분석 산업은 드라이버 민감도가 구조 증거를 대신합니다.
          </p>
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-56" aria-label="가치사슬 연계 링크">
            <caption className="sr-only">가치사슬 연계 링크</caption>
            <ColGroup widths={chainLinkColPct(canCurate ? 7 : 6)} />
            <thead>
              <tr><th scope="col">관계</th><th scope="col">산업</th><th scope="col">hop</th><th scope="col">계수/β</th><th scope="col">시차(월)</th><th scope="col">근거</th>{canCurate && <th scope="col">관리</th>}</tr>
            </thead>
            <tbody>
              {view.chain.links.map((l, i) => (
                <tr key={`${l.industry_id}-${l.direction}-${i}`}>
                  <td className="font-semibold">{l.relation ?? (l.direction === "upstream" ? "후방 (공급처)" : "전방 (수요처)")}</td>
                  <td>{l.name_ko}</td>
                  <td>{l.hop_type === "engineering" ? "engineering" : l.hop_type === "statistical" ? "statistical" : "구조 (승인)"}</td>
                  <td className="tabular-nums">{l.hop_type === "engineering" ? l.coefficient : l.beta !== null ? `β ${l.beta} (R² ${l.r2})` : "—"}</td>
                  <td className="tabular-nums">{l.lag_months ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.evidence_ref}</td>
                  {canCurate && (
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={retiringLinkId === l.id}
                        onClick={() => void retireLink(l.id)}
                      >
                        {retiringLinkId === l.id ? "회수 중..." : "회수"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {/* ADR-0126 — S1 시장 구조 정의가 도출한 인접 산업 중 산업 마스터와
            매칭된 것을 승인 대기 제안으로 제시한다. 등록은 사람의 행위다. */}
        {canCurate && (view.proposals?.length ?? 0) > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">승인 대기 제안</span> — 시장 구조 정의(Step 1)에서 도출된 인접 산업입니다. 승인하면 구조(structural) 링크로 등록됩니다 (변환 계수는 통계 보정 후 부여).</p>
            <div className="flex flex-wrap gap-2">
              {view.proposals!.map((p) => (
                <span key={p.industry_id} className="control-chip">
                  <span className="font-semibold">{p.relation}</span> · {p.name_ko}
                  <button type="button" className="btn-ghost btn-sm ml-1" disabled={approving === p.industry_id} onClick={() => void approveProposal(p)}>
                    {approving === p.industry_id ? "등록 중..." : "승인"}
                  </button>
                </span>
              ))}
            </div>
            {chainLinkError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{chainLinkError}</p>}
          </div>
        )}
        {(view.unmatchedProposals?.length ?? 0) > 0 && (
          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            미매칭 후보 (산업 마스터에 없어 등록 불가 — 시장분석 산업 편집에서 먼저 등록하세요): {view.unmatchedProposals!.map((u) => `${u.relation} ${u.name}`).join(", ")}
          </p>
        )}
        {/* ADR-0126 — 제안이 없어도 사람이 직접 연계를 등록할 수 있다 (같은 승인 행위). */}
        {canCurate && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">＋ 직접 등록 (산업 마스터에서 선택)</summary>
            <div className="sizing-new-form mt-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">대상 산업 *</span>
                  <select
                    value={manualLink.industry_id}
                    onChange={(e) => setManualLink({ ...manualLink, industry_id: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                    style={{ minWidth: "12rem" }}
                  >
                    <option value="">선택...</option>
                    {(view.linkableIndustries ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name_ko}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">관계 *</span>
                  <select value={manualLink.relation} onChange={(e) => setManualLink({ ...manualLink, relation: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                    <option value="전방">전방 (수요처)</option>
                    <option value="전전방">전전방 (수요처, 2hop)</option>
                    <option value="후방">후방 (공급처)</option>
                    <option value="후후방">후후방 (공급처, 2hop)</option>
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">근거 *</span>
                  <input value={manualLink.evidence_ref} onChange={(e) => setManualLink({ ...manualLink, evidence_ref: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 12rem" }} />
                </label>
                <button type="button" className="btn-ghost btn-sm" disabled={linkSaving || !manualLink.industry_id || !manualLink.evidence_ref.trim()} onClick={() => void submitManualLink()}>
                  {linkSaving ? "등록 중..." : "등록"}
                </button>
              </div>
              {linkSaved && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mt-1 mb-0">링크가 등록되었습니다.</p>}
            </div>
          </details>
        )}
        {view.chain.grade && (
          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            <span className="status-chip status-green mr-1">체인 등급 {view.chain.grade.reliability_grade}</span>
            {view.chain.grade.grade_rationale}
          </p>
        )}

        {/* ADR-0129 — relation 미태깅 레거시 구조 링크(ADR-0126 시절 등록) 검토 큐.
            은퇴하지 않고 relation만 지정하면 되므로 별도 섹션으로 분리한다. */}
        {canCurate && view.chain.legacyUntagged.length > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1">
              <span className="font-semibold">레거시 검토</span> — 관계가 지정되지 않은 이전 방식의 구조 링크입니다. 관계를 지정하세요.
            </p>
            <div className="flex flex-wrap gap-2">
              {view.chain.legacyUntagged.map((l) => (
                <span key={l.id} className="control-chip">
                  <span className="font-semibold">{l.direction === "upstream" ? "후방 (공급처)" : "전방 (수요처)"}</span> · {l.name_ko}
                  <select
                    value={legacyRelation[l.id] ?? "전방"}
                    onChange={(e) => setLegacyRelation({ ...legacyRelation, [l.id]: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm ml-1"
                  >
                    <option value="전방">전방</option>
                    <option value="전전방">전전방</option>
                    <option value="후방">후방</option>
                    <option value="후후방">후후방</option>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-1"
                    disabled={legacyAssigning === l.id}
                    onClick={() => void assignLegacyRelation(l.id)}
                  >
                    {legacyAssigning === l.id ? "지정 중..." : "지정"}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <StepSensitivityChart sensitivities={detail.driver_sensitivities} />
      </StepSection>
      </>
      )}</>
  );
}
