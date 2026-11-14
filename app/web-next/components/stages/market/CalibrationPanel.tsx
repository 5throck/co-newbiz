"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { SizingMatrix } from "../../../lib/market-sizing.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useCallback, useEffect } from "react";
import { api } from "../../../lib/api.ts";
import { useTranslations } from "next-intl";
import { SupersedeReferenceButton } from "./SupersedeReferenceButton.tsx";
import { EscalationSection } from "./CalibrationEscalation.tsx";
import { CalibrationProposals } from "./CalibrationProposals.tsx";
import type {
  CalibrationAcceptedRow,
  CalibrationEscalationRow,
  CalibrationProposalRow,
  CalibrationReferenceRow,
  CalibrationTrendRow,
} from "./types.ts";

// ── 성장율 격차 보정 루프 패널 (v1.2.0, design 2026-09-18-s1-growth-gap-calibration;
// 수렴 목표선 통일 design 2026-11-13-calibration-loop-convergence)
// 미수렴(격차 ≥ 목표선 15%) 배지 · 외부 참조 편집 · 드라이버 제안 수용/기각 ·
// 버전 간 격차 추이 · 에스컬레이션 이력(읽기 전용). 수용은 사람의 행위(경계 #2)
// — 수용된 드라이버는 다음 재분석의 제약으로 주입된다.
export function CalibrationPanel({
  industryId,
  matrix,
  onReferenceSaved,
}: {
  industryId: string;
  matrix: SizingMatrix;
  onReferenceSaved?: () => void;
}) {
  const t = useTranslations("stages.s1.calibrationPanel");
  const tc = useTranslations("common");
  const { me } = useAuth();
  const canCurate = canWriteBusiness(me?.role);
  const [proposals, setProposals] = useState<CalibrationProposalRow[]>([]);
  const [accepted, setAccepted] = useState<CalibrationAcceptedRow[]>([]);
  const [gapTrend, setGapTrend] = useState<CalibrationTrendRow[]>([]);
  const [reference, setReference] = useState<CalibrationReferenceRow | null>(null);
  // 에스컬레이션 이력 (design 2026-11-13 §3.2) — 읽기 전용 카드용. 적용 경로는
  // 삭제되었다(×0.85 결정론 스케일링 제거); GET의 escalation 필드는 보존된
  // 결정 기록을 보여주기 위해 남는다.
  const [escalation, setEscalation] = useState<CalibrationEscalationRow | null>(null);
  const [showRefForm, setShowRefForm] = useState(false);
  const [refForm, setRefForm] = useState({
    source_label: "",
    source_url: "",
    target_year: "2030",
    external_cagr_pct: "",
    external_size_b: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{
        proposals: CalibrationProposalRow[];
        accepted: CalibrationAcceptedRow[];
        gapTrend: CalibrationTrendRow[];
        escalation: CalibrationEscalationRow | null;
      }>(`/api/market-overview/industry/${encodeURIComponent(industryId)}/calibration`)
      .then((r) => {
        setProposals(r.data.proposals ?? []);
        setAccepted(r.data.accepted ?? []);
        setGapTrend(r.data.gapTrend ?? []);
        setEscalation(r.data.escalation ?? null);
      })
      .catch(() => {});
    api
      .get<{ reference: CalibrationReferenceRow | null }>(
        `/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`,
      )
      .then((r) => setReference(r.data.reference))
      .catch(() => {});
  }, [industryId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, action: "accept" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/api/market-overview/industry/${encodeURIComponent(industryId)}/calibration/${encodeURIComponent(id)}`,
        { action },
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToProcessTheCalibration"));
    } finally {
      setBusy(false);
    }
  }

  async function saveReference() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`, {
        source_label: refForm.source_label,
        source_url: refForm.source_url || null,
        target_year: Number(refForm.target_year),
        external_cagr_pct: Number(refForm.external_cagr_pct),
        external_size_b: refForm.external_size_b ? Number(refForm.external_size_b) : null,
      });
      setShowRefForm(false);
      // A1 (addendum 2026-11-12b) — success only: the parent (SizingGrowthTab)
      // re-fetches its live reference so the staleness banner raises on this
      // mount. A failed save must not touch the banner.
      load();
      onReferenceSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToRecordTheExternal"));
    } finally {
      setBusy(false);
    }
  }

  // 폐기(amendment 2026-11-12c) — 기록 보존 은퇴(물리 삭제 아님). 성공 후
  // load() 재조회 시 패널이 자연히 "기록된 외부 참조가 없습니다" 상태가 된다.
  async function supersedeReference(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/market-overview/industry/${encodeURIComponent(industryId)}/external-reference`, { id });
      load();
      onReferenceSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("supersedeFailed"));
    } finally {
      setBusy(false);
    }
  }

  const cal = matrix.calibration;
  // 트리거 = 미수렴 (사용자 결정 2026-11-13, design §3.1): 격차 ≥ 목표선이면
  // 미수렴 배지 + 제안, 미만이면 수렴 — 루프 종료, 추이는 계속 표시된다.
  // 결정론 스케일링 에스컬레이션 적용 경로는 삭제되었다 (design §3.2).
  const triggered = cal?.triggered === true;
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: label-only card (pre-existing) — adding a role would change what AT announces on the calibration card (behavior change, not this batch)
    <div className="chart-half sizing-grade-card mt-4" aria-label={t("calibrationLoop")}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h4 className="text-[length:var(--fs-body)] m-0">{t("calibrationLoop2")}</h4>
        {triggered ? (
          <span
            className="status-chip status-red"
            title={t("cagrRelativeGapDriverAttribution", { p1: cal?.gapPct ?? "?" })}
          >
            {t("calibrationNeeded")}
          </span>
        ) : cal ? (
          <span className="status-chip status-green">{t("belowTrigger")}</span>
        ) : null}
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("aPersonAcceptsProposalsOn")}
        </span>
      </div>

      {/* 정직한 과잉 신호 (design 2026-11-14-driver-proposal-dedupe-overshoot
          D-C) — 수용 드라이버 합이 앵커 필요 상향의 개연성 상한(2×)을 넘으면
          스윕 feasible_ratio가 0으로 붕괴한다. 읽기 전용 한 줄 — 자동 제거는
          없고 기각은 아래 제안 행에서 사람이 한다(경계 #2). */}
      {cal?.overshoot?.overshoot === true && (
        <p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("acceptedDriverSumExceedsPlausibilityCap", {
            p1: cal.overshoot.acceptedImpactSumPct.toFixed(1),
            p2: cal.overshoot.neededUpliftPct.toFixed(1),
            p3: cal.overshoot.plausibleCapPct.toFixed(1),
          })}
        </p>
      )}

      {/* 외부 참조 — 출처와 함께 기록. 기록된 참조는 재분석 때 우선 사용된다 */}
      <div className="mb-2">
        {reference ? (
          <p className="mb-1 text-[length:var(--fs-caption)]">
            {t("externalReference")} <strong>{reference.source_label}</strong> — CAGR{" "}
            {reference.external_cagr_pct.toFixed(1)}% @{reference.target_year}
            {tc("year")}
            {reference.external_size_b ? ` · $${reference.external_size_b.toFixed(2)}B` : ""}{" "}
            <span className="status-chip status-not-started">
              {reference.captured_from === "user" ? t("checkSource") : reference.captured_from}
            </span>{" "}
            {canCurate && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setShowRefForm((v) => !v);
                  setRefForm({
                    source_label: reference.source_label,
                    source_url: reference.source_url ?? "",
                    target_year: String(reference.target_year),
                    external_cagr_pct: String(reference.external_cagr_pct),
                    external_size_b: reference.external_size_b ? String(reference.external_size_b) : "",
                  });
                }}
              >
                {tc("edit")}
              </button>
            )}
            {canCurate && (
              <SupersedeReferenceButton
                id={reference.id}
                busy={busy}
                onSupersede={() => void supersedeReference(reference.id)}
              />
            )}
          </p>
        ) : (
          <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("noExternalReferencesRecordedRecording")}{" "}
            {canCurate && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setShowRefForm((v) => !v)}>
                {t("referenceRecord")}
              </button>
            )}
          </p>
        )}
        {canCurate && showRefForm && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              value={refForm.source_label}
              onChange={(e) => setRefForm({ ...refForm, source_label: e.target.value })}
              className="sizing-new-input"
              style={{ width: "14rem" }}
              placeholder={t("sourceReportNameInstitution")}
              aria-label={tc("source")}
            />
            <input
              value={refForm.source_url}
              onChange={(e) => setRefForm({ ...refForm, source_url: e.target.value })}
              className="sizing-new-input"
              style={{ width: "12rem" }}
              placeholder={t("urlOptional")}
              aria-label={t("sourceUrl")}
            />
            <input
              value={refForm.target_year}
              onChange={(e) => setRefForm({ ...refForm, target_year: e.target.value })}
              className="sizing-new-input"
              style={{ width: "5rem" }}
              placeholder={t("targetYear")}
              aria-label={t("targetYear2")}
            />
            <input
              value={refForm.external_cagr_pct}
              onChange={(e) => setRefForm({ ...refForm, external_cagr_pct: e.target.value })}
              className="sizing-new-input"
              style={{ width: "7rem" }}
              placeholder={t("externalCagr")}
              aria-label={t("externalCagrPercent")}
            />
            <input
              value={refForm.external_size_b}
              onChange={(e) => setRefForm({ ...refForm, external_size_b: e.target.value })}
              className="sizing-new-input"
              style={{ width: "8rem" }}
              placeholder={t("sizeOptional")}
              aria-label={t("externalMarketSize")}
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy || !refForm.source_label.trim() || !refForm.external_cagr_pct}
              onClick={() => void saveReference()}
            >
              {tc("record")}
            </button>
          </div>
        )}
      </div>

      {/* 에스컬레이션 이력 — 읽기 전용 (design 2026-11-13 §3.2). ×0.85 결정론
          스케일링 적용 경로는 삭제되었고 보존된 결정 기록만 표시된다. */}
      <EscalationSection escalation={escalation} />

      {/* 드라이버 귀인 제안 + 제외 제안 (amendment 2026-11-13b) — 400행 분해
          한도로 CalibrationProposals.tsx로 추출(마크업·키 불변). */}
      {proposals.length > 0 && (
        <CalibrationProposals proposals={proposals} canCurate={canCurate} busy={busy} onDecide={decide} />
      )}

      {/* 수용된 보정 드라이버 */}
      {accepted.length > 0 && (
        <p className="mb-2 text-[length:var(--fs-caption)]">
          <strong>{t("acceptedCalibrationDrivers")}</strong>{" "}
          {accepted.map((d) => (
            <span
              key={d.id}
              className="status-chip status-green mr-1"
              title={t("p1CagrP2ReflectedIn", { p1: d.direction, p2: d.impact_pct.toFixed(1) })}
            >
              {d.driver}
            </span>
          ))}{" "}
          {t("reduceTheGapWithWith")}
        </p>
      )}

      {/* 버전 간 격차 추이 — 수렴 가시화 */}
      {gapTrend.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("gapTrendAcrossVersions")}
            {gapTrend.length}
            {t("versions")}
          </summary>
          <table className="data-table mt-1" aria-label={t("gapTrendAcrossVersions2")}>
            <thead>
              <tr>
                <th scope="col">{t("version")}</th>
                <th scope="col">{t("ourCagr2")}</th>
                <th scope="col">{t("externalCagr2")}</th>
                <th scope="col">{tc("gap")}</th>
              </tr>
            </thead>
            <tbody>
              {gapTrend.map((row) => (
                <tr key={row.version_no}>
                  <td>v{row.version_no}</td>
                  <td className="tabular-nums">{row.our_cagr_pct != null ? `${row.our_cagr_pct.toFixed(1)}%` : "—"}</td>
                  <td className="tabular-nums">
                    {row.external_cagr_pct != null ? `${row.external_cagr_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="tabular-nums">
                    {row.gap_pct}%{row.triggered ? t("calibrationNeeded2") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {error && (
        <p role="alert" className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}
