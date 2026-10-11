"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { VALIDATION_STATUS_META, REGISTRY, STEPS } from "../../../lib/market-sizing.ts";
import { StepSection } from "./MarketReport.tsx";
import { RegistryStatus } from "./RegistryStatus.tsx";
import type { SizingReportState } from "./useSizingReport.ts";

export function SizingPipelineTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "pipeline" && (
        <section aria-label="수요 파이프라인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">4-B</span> 수요 파이프라인 — 프로젝트별 신뢰도 티어
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            향후 착공·발주가 예정된 개별 프로젝트를 신뢰도 티어로 구분합니다 — <strong>Tier 1</strong>(실착공·계약 확정)부터
            <strong> Tier 4</strong>(비구속 MOU·초기 검토)까지. 티어가 낮은(숫자가 큰) 항목일수록 수요 불확실성이 크며,
            시장 추정의 상방 근거로만 취급해야 합니다.
          </p>
          {matrix.demandPipeline && matrix.demandPipeline.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table report-table" aria-label="수요 파이프라인 프로젝트">
              <caption className="sr-only">수요 파이프라인 프로젝트 목록</caption>
              <thead>
                <tr><th scope="col" className="w-[6rem]">티어</th><th scope="col">프로젝트</th><th scope="col">상태</th><th scope="col">COD 목표</th><th scope="col">출처</th></tr>
              </thead>
              <tbody>
                {[...matrix.demandPipeline].sort((a, b) => a.tier - b.tier).map((p, i) => (
                  <tr key={`${p.project}-${i}`} className={p.tier === 1 ? "row-selected" : undefined}>
                    <td>
                      <span className={`status-chip ${p.tier === 1 ? "status-green" : p.tier === 2 ? "status-amber" : "status-not-started"}`}>
                        Tier {p.tier}
                      </span>
                    </td>
                    <td className="font-semibold">
                      {p.project}
                      {p.relatedDemandIndustry ? (
                        <span className="block font-normal text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{p.relatedDemandIndustry}</span>
                      ) : null}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">{p.status}</td>
                    <td className="tabular-nums">{p.codTarget ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">
                      {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              수요 파이프라인 데이터가 없습니다 — 재분석 또는 시드 등록 시 프로젝트별 근거가 반영됩니다.
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingRegulationTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "regulation" && (
        <section aria-label="규제 환경" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-B</span> 규제 환경 비교 — 관할권×항목
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            국가·관할권별 규제·인허가 상태를 비교합니다. <strong>1차 소스 직접 확인</strong> 여부가 표시되며,
            미확인(간접 추정) 항목은 법률 검토 전 인용할 수 없습니다.
          </p>
          {matrix.regulatoryComparison && matrix.regulatoryComparison.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table report-table min-w-[52rem]" aria-label="규제 환경 비교">
              <caption className="sr-only">관할권별 규제 비교</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-label">관할권</th>
                  <th scope="col" className="col-type">항목</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="col-type">1차 소스 확인</th>
                  <th scope="col" className="col-text">출처·시점</th>
                </tr>
              </thead>
              <tbody>
                {matrix.regulatoryComparison.map((r, i) => (
                  <tr key={`${r.jurisdiction}-${r.item}-${i}`}>
                    <td className="col-label font-semibold">{r.jurisdiction}</td>
                    <td className="col-type whitespace-normal">{r.item}</td>
                    <td className="whitespace-normal text-[length:var(--fs-caption)]">{r.status}</td>
                    <td className="col-type">
                      <span className={`status-chip ${r.confirmedDirectly ? "status-green" : "status-not-started"}`}>
                        {r.confirmedDirectly ? "직접 확인" : "간접·추정"}
                      </span>
                    </td>
                    <td className="col-text whitespace-normal text-[length:var(--fs-caption)]">
                      {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                      {r.asOf ? ` · ${r.asOf}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              규제 비교 데이터가 없습니다 — 재분석 또는 시드 등록 시 관할권별 규제 조사가 반영됩니다.
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingRiskTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "risk" && (
        <section aria-label="신뢰도·리스크" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">7-A</span> 신뢰도·리스크 — RAG 상한 권고·Kill Criteria·검증 원장
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            데이터 신뢰도가 전체 판단 등급을 캡핑합니다(caps the grade). 아래 Kill Criteria 제안과
            "확인 불가" 선언은 분석가 검토 대상이며, 자동 판정이 아닙니다.
          </p>
          {matrix.ragCapRecommendation && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">RAG 상한 권고</h4>
              <span className={`status-chip ${matrix.ragCapRecommendation.grade === "green" ? "status-green" : matrix.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                상한 {matrix.ragCapRecommendation.grade.toUpperCase()}
              </span>
              <p className="mt-2 mb-0 text-[length:var(--fs-body)]">{matrix.ragCapRecommendation.rationale}</p>
            </div>
          )}
          {matrix.killCriteriaProposals && matrix.killCriteriaProposals.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)] mb-2">Kill Criteria 제안 ({matrix.killCriteriaProposals.length}건 — 분석가 검토 필요)</h4>
              <div className="grid gap-2">
                {matrix.killCriteriaProposals.map((k, i) => (
                  <div key={i} className="sizing-grade-card">
                    <div className="flex items-center gap-2">
                      <span className={`status-chip ${k.severity === "high" ? "status-red" : k.severity === "medium" ? "status-amber" : "status-not-started"}`}>
                        {k.severity === "high" ? "심각" : k.severity === "medium" ? "보통" : "낮음"}
                      </span>
                      <strong className="text-[length:var(--fs-body)]">{k.name}</strong>
                    </div>
                    <p className="mt-1 mb-0 text-[length:var(--fs-caption)]"><strong>기준:</strong> {k.thresholdText}</p>
                    <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{k.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matrix.verificationLedger && matrix.verificationLedger.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">
                검증 원장 ({matrix.verificationLedger.length}건 — 확인/확인불가/판단필요)
              </summary>
              <table className="data-table mt-2" aria-label="검증 원장">
                <caption className="sr-only">주장별 검증 상태</caption>
                <thead>
                  <tr><th scope="col" className="w-[34%]">주장</th><th scope="col">상태</th><th scope="col">비고</th></tr>
                </thead>
                <tbody>
                  {matrix.verificationLedger.map((v, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{v.claim}</td>
                      <td className="sizing-verdict-cell">
                        <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                          {v.status === "confirmed" ? "확인" : v.status === "could_not_verify" ? "확인 불가" : "판단 필요"}
                        </span>
                      </td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{v.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {!matrix.ragCapRecommendation && !matrix.killCriteriaProposals && !matrix.verificationLedger && (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              신뢰도·리스크 데이터가 없습니다 — 재분석 또는 시드 등록 시 반영됩니다.
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingValidateTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix, detail, stepSummaries } = ctx;
  return (
    <>{tab === "validate" && (
      <>
      <StepSection n={6} id="step-6" title="기업 공시 교차검증">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          카테고리 내 상장사의 연차보고서·중간보고서 원문으로 매트릭스의 각 주장을 검증합니다.
          구조적으로 검증 불가능한 항목은 <strong>검증 불가</strong>로 명시합니다(탐색 실패가 아닌 공시 구조의 한계).
        </p>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table report-table" aria-label="기업 공시 교차검증 결과">
          <caption className="sr-only">기업 공시 교차검증 결과</caption>
          <thead>
            <tr><th scope="col" className="w-[34%]">매트릭스 주장</th><th scope="col">판정</th><th scope="col">1차 소스 근거</th></tr>
          </thead>
          <tbody>
            {matrix.crossValidation.map((v) => {
              const meta = VALIDATION_STATUS_META[v.status] ?? VALIDATION_STATUS_META.directional;
              return (
                <tr key={v.claim}>
                  <td className="font-semibold">{v.claim}</td>
                  <td className="sizing-verdict-cell"><span className={`status-chip ${meta.chip}`}>{meta.label}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{v.evidence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </StepSection>

      <StepSection n={7} id="step-7" title="분석 한계 목록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          판단적 보정·소스 불일치·추정 불가 신호를 번호 붙여 고정합니다. 소비자는 이 목록 없이 매트릭스를
          인용할 수 없습니다.
        </p>
        <ol className="sizing-limitations">
          {matrix.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        {matrix.sectionConfidence && matrix.sectionConfidence.length > 0 && (
          <>
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">섹션별 데이터 신뢰도 등급 (A 확정 ~ D 추정 불가)</h4>
            <table className="data-table" aria-label="섹션별 신뢰도 등급">
              <caption className="sr-only">섹션별 데이터 신뢰도 등급</caption>
              <thead>
                <tr><th scope="col">섹션</th><th scope="col">등급</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                {matrix.sectionConfidence.map((s, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{s.section}</td>
                    <td>
                      <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
                        {s.grade}
                      </span>
                    </td>
                    <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </StepSection>

      <StepSection n={8} id="step-8" title="가정 레지스트리 등록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          동결된 매트릭스는 assumption 레지스트리에 조합당 1 row(kind='assumed', rationale + anchor_ref + TTL)로
          등록됩니다. 레지스트리는 append-only — 수정은 새 row로 기록됩니다. 아래는 실제 등록 상태(라이브 조회)입니다.
        </p>
        <RegistryStatus
          sizing={detail.sizing}
          referenceImplementation={REGISTRY.referenceImplementation}
        />
      </StepSection>

      {stepSummaries && stepSummaries.length > 0 && (
        <details className="market-section sizing-step">
          <summary className="cursor-pointer text-[length:var(--fs-body)]">파이프라인 단계별 분석 노트 ({stepSummaries.length}단계)</summary>
          <ol className="mt-3 space-y-2 text-[length:var(--fs-body)]">
            {stepSummaries.map((s) => (
              <li key={s.step}>
                <strong>{s.step}. {STEPS[s.step - 1]?.title ?? s.step}</strong>{" "}
                <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {s.source === "llm" ? "LLM 요약" : "결정론 요약"}
                </span>
                <br />{s.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
      </>
      )}</>
  );
}
