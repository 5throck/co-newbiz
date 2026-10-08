"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState, useEffect } from "react";
import { api } from "../../../lib/api.ts";
import { type SizingMatrix } from "../../../lib/market-sizing.ts";
import { StepSensitivityChart } from "./SizingCharts.tsx";
import { SizingReport } from "./SizingReport.tsx";
import type { IndustryDetail, AnalysisDetail, VersionInfo } from "./types.ts";

/* ── 산업 리포트: 버전 페이로드의 매트릭스를 렌더링한다 (ADR-0112 — 모든 분석 동일 경로) ── */

export function MarketReport({ detail, analysisId, analysisDate, onAddLinked }: { detail: IndustryDetail; analysisId: string | null; analysisDate: string | null; onAddLinked?: () => void }) {
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!analysisId) return;
    api.get<AnalysisDetail>(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}`)
      .then((r) => setAnalysis(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "분석 결과 불러오기 실패"));
  }, [analysisId]);

  const matrix: SizingMatrix | null = analysis?.versions[0]?.payload?.matrix ?? null;
  const stepSummaries = analysis?.versions[0]?.payload?.stepSummaries ?? null;
  // provenance는 데이터가 스스로 말한다: 수동 연구 시드(frozen-research)인지 파이프라인 산출인지.
  const manualResearch = matrix?.provenance === "frozen-research";
  const llmUsed = stepSummaries?.every((s) => s.source === "llm") ?? false;

  return (
    <>
      <div className="sizing-report-header">
        <h2>
          {detail.industry.name_ko} 시장 분석 리포트
          {detail.industry.ksic_code && <code className="dd-item-id ml-2">{detail.industry.ksic_code}</code>}
        </h2>
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
          방법론: systematic-market-sizing v1.1
          {manualResearch ? " · 연구문서 기반 수동 분석(분석가 확정)" : " · 8단계 파이프라인 산출"}
          {analysisDate && <> · 분석일: <strong>{analysisDate}</strong></>}
        </p>
      </div>
      <VersionBar versions={detail.versions} />
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!analysis && (
        <p className="market-section">분석 결과를 불러오는 중...</p>
      )}
      {analysis && !matrix && (
        <section aria-label="분석 없음" className="market-section sizing-step">
          <p className="text-[color:var(--muted-fg)] italic">
            이 산업의 정식 분석 기록(버전)이 없습니다. 목록에서 "신규 산업 분석"으로 8단계 파이프라인을 실행하세요.
          </p>
          <StepSensitivityChart stepNumber={1} sensitivities={detail.driver_sensitivities} />
        </section>
      )}
      {matrix && (
        <>
          {/* ADR-0131 — LLM이 미구성이거나 실패해 일부/전체 단계가 결정론 합성
              폴백으로 채워진 버전은 시장 규모·CAGR 등 핵심 수치가 자리표시자
              (0, 1 등)일 수 있다. 기존의 일반 "추정치" 안내와 별개로, 이 버전이
              실제로 그런 상태인지 명시적으로 경고한다(2026-09-13 휴머노이드
              로봇 리포트 사고 — 경고 없이 $1B/-10000%가 실제 값처럼 보였음). */}
          {stepSummaries && !llmUsed && (
            <p className="market-section text-[length:var(--fs-caption)] text-[color:var(--red-fg)] font-semibold" role="alert" style={{ border: "1px solid var(--red-border, currentColor)", borderRadius: "0.5rem", padding: "0.6rem 0.8rem" }}>
              ⚠️ 이 버전은 {stepSummaries.every((s) => s.source !== "llm") ? "전체" : "일부"} 단계가 LLM 미구성/실패로 결정론 합성(더미) 값으로 채워졌습니다 —
              시장 규모·성장률 등 수치를 신뢰하지 마세요. LLM 구성을 확인한 뒤 재분석하세요.
            </p>
          )}
          {matrix.provenance === "llm-estimate" && (
            <p className="market-section sizing-note-list text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
              이 매트릭스는 파이프라인 LLM이 생성한 추정치입니다 — 수치는 앵커 삼각검증(2단계)과
              기업 공시 교차검증(6단계)을 거친 동결 매트릭스가 아니며, 정식 인용 전 분석가 확정이 필요합니다.
              {llmUsed && <> (8단계 전체 LLM 요약 사용)</>}
            </p>
          )}
          {/* Wave C-3 (D-2): the grade shown here IS the stored one (market_sizing_version.data_confidence_grade),
              the same value the S1 predicate and the RAG data_confidence cap read. */}
          {analysis?.versions[0]?.data_confidence_grade && (
            <p className="market-section text-[length:var(--fs-caption)]" role="note" data-testid="data-confidence-grade">
              <strong>데이터 신뢰도 등급 {analysis.versions[0].data_confidence_grade}</strong> (저장된 등급 — RAG 상한 기준)
              {analysis.versions[0].confidence_basis && <> · {analysis.versions[0].confidence_basis}</>}
            </p>
          )}
          <SizingReport detail={detail} matrix={matrix} stepSummaries={stepSummaries} analysisId={analysisId} onAddLinked={onAddLinked} />
        </>
      )}
    </>
  );
}

/* ── 버전 관리 바 ── */
export function VersionBar({ versions }: { versions: VersionInfo[] }) {
  if (!versions || versions.length === 0) return null;
  return (
    <details className="market-section sizing-version-bar">
      <summary className="cursor-pointer text-[length:var(--fs-caption)]">
        버전 이력 ({versions.length}개 버전) — 최신 v{versions[0].version_no}
      </summary>
      <table className="data-table mt-2" aria-label="분석 버전 이력">
        <caption className="sr-only">분석 버전 이력</caption>
        <thead>
          <tr><th scope="col">버전</th><th scope="col">변경 내용</th><th scope="col">작성</th><th scope="col">일시</th></tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version_no}>
              <td className="font-semibold tabular-nums">v{v.version_no}</td>
              <td className="text-[length:var(--fs-caption)]">{v.changelog ?? "—"}</td>
              <td className="text-[length:var(--fs-caption)]">{v.created_by}</td>
              <td className="text-[length:var(--fs-caption)] tabular-nums">{v.created_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/* ═══════════════ 8단계 리포트 ═══════════════ */

export function StepSection({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={`단계 ${n}: ${title}`} className="market-section sizing-step">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">{n}</span> {title}
      </h3>
      {children}
    </section>
  );
}