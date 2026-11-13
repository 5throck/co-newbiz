"use client";

// Split from CalibrationPanel.tsx — the proposals area outgrew the 400-line
// cap when the exclusion-proposal card joined it (design 2026-11-13-
// calibration-loop-convergence amendment 2026-11-13b; same Wave U-3 split
// precedent as CalibrationEscalation). Markup and locale keys unchanged.
// 수용·기각(제외 확정 포함)은 사람의 행위(경계 #2) — 이 컴포넌트는 표시와
// 버튼만 담당하고 결정 기록은 onDecide(패널의 decide 흐름)가 한다. 제외 확정은
// 되돌릴 수 없는 결정이므로 파괴적 액션 표준(useConfirm + ConfirmDialog,
// SupersedeReferenceButton과 같은 패턴)으로 명시적 확인을 요구한다.
import { useTranslations } from "next-intl";
import { useConfirm } from "../../crud.tsx";
import type { CalibrationProposalRow } from "./types.ts";

export function CalibrationProposals({
  proposals,
  canCurate,
  busy,
  onDecide,
}: {
  proposals: CalibrationProposalRow[];
  canCurate: boolean;
  busy: boolean;
  onDecide: (id: string, action: "accept" | "dismiss") => void;
}) {
  const t = useTranslations("stages.s1.calibrationPanel");
  const tc = useTranslations("common");
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <div className="mb-2">
        <p className="text-[length:var(--fs-caption)] font-semibold mb-1">
          {t("driverAttributionProposal")} {proposals.length}
          {t("itemSAnalysisOfThe")}
        </p>
        <div className="grid gap-1">
          {proposals.map((d) =>
            d.is_exclusion ? (
              // 드라이버 제외 제안 (amendment 2026-11-13b) — 격차 악화 + leave-
              // one-out 근거를 rationale로 노출한다. 확정은 기각(dismiss) 흐름
              // 하나뿐이고, 수용 버튼은 없다(행 종류의 의미 유지 — 서버도 400).
              // 버튼은 즉시 실행하지 않고 확인 다이얼로그를 연다(파괴적 액션).
              <div key={d.id} className="sizing-grade-card mb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[length:var(--fs-caption)]">{d.driver}</strong>
                  <span className="status-chip status-amber">{t("exclusionReviewChip")}</span>
                  <span className="status-chip status-not-started tabular-nums">CAGR ±{d.impact_pct.toFixed(1)}%p</span>
                </div>
                <p className="mb-1 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] whitespace-pre-line">
                  {d.rationale}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("exclusionConfirmNote")}
                  </p>
                  {canCurate && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        confirm(t("exclusionConfirmTitle"), () => onDecide(d.id, "dismiss"), {
                          body: t("exclusionConfirmBody", { p1: d.driver }),
                          confirmLabel: t("confirmExclusion"),
                          tone: "danger",
                        })
                      }
                    >
                      {t("confirmExclusion")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
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
                      onClick={() => void onDecide(d.id, "accept")}
                    >
                      {tc("accept")}
                    </button>
                  )}
                  {canCurate && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void onDecide(d.id, "dismiss")}
                    >
                      {tc("dismiss")}
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
