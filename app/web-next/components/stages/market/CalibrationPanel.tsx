"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { SizingMatrix } from "../../../lib/market-sizing.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useCallback, useEffect } from "react";
import { api } from "../../../lib/api.ts";
import { useTranslations } from "next-intl";
import { EscalationSection } from "./CalibrationEscalation.tsx";
import type {
  CalibrationAcceptedRow,
  CalibrationEscalationRow,
  CalibrationProposalRow,
  CalibrationReferenceRow,
  CalibrationTrendRow,
} from "./types.ts";

// ── 성장율 격차 보정 루프 패널 (v1.2.0, design 2026-09-18-s1-growth-gap-calibration)
// 20% 트리거 배지 · 외부 참조 편집 · 드라이버 제안 수용/기각 · 버전 간 격차 추이.
// 수용은 사람의 행위(경계 #2) — 수용된 드라이버는 다음 재분석의 제약으로 주입된다.
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
  const [escalation, setEscalation] = useState<CalibrationEscalationRow | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateRationale, setEscalateRationale] = useState("");
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

  async function applyEscalation() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/market-overview/industry/${encodeURIComponent(industryId)}/calibration/escalate`, {
        rationale: escalateRationale,
      });
      setShowEscalate(false);
      setEscalateRationale("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToApplyEscalation"));
    } finally {
      setBusy(false);
    }
  }

  const cal = matrix.calibration;
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

      {/* 에스컬레이션 — 결정론 스케일링 (사람 결정, 경계 #2). LLM 재분석이
          수렴선에 도달하지 못할 때 외부 참조 × (1−15%)를 조정 CAGR로 채택. */}
      <EscalationSection
        escalation={escalation}
        offer={triggered && (cal?.gapPct ?? 0) > 15}
        externalCagrPct={cal?.externalCagrPct ?? "?"}
        canCurate={canCurate}
        busy={busy}
        showForm={showEscalate}
        rationale={escalateRationale}
        onRationale={setEscalateRationale}
        onShowForm={() => setShowEscalate(true)}
        onCancel={() => setShowEscalate(false)}
        onApply={() => void applyEscalation()}
      />

      {/* 드라이버 귀인 제안 */}
      {proposals.length > 0 && (
        <div className="mb-2">
          <p className="text-[length:var(--fs-caption)] font-semibold mb-1">
            {t("driverAttributionProposal")} {proposals.length}
            {t("itemSAnalysisOfThe")}
          </p>
          <div className="grid gap-1">
            {proposals.map((d) => (
              <div key={d.id} className="sizing-grade-card mb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[length:var(--fs-caption)]">{d.driver}</strong>
                  <span className={`status-chip ${d.direction === "upside" ? "status-in-progress" : "status-amber"}`}>
                    {d.direction === "upside" ? t("upsideFactor") : t("downsideFactor")}
                  </span>
                  <span className="status-chip status-not-started tabular-nums">CAGR ±{d.impact_pct.toFixed(1)}%p</span>
                </div>
                <p className="mb-1 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{d.rationale}</p>
                <div className="flex gap-2">
                  {canCurate && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void decide(d.id, "accept")}
                    >
                      {tc("accept")}
                    </button>
                  )}
                  {canCurate && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void decide(d.id, "dismiss")}
                    >
                      {tc("dismiss")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
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
