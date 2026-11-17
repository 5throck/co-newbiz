"use client";

// S3 score evaluation tab: the capability-coverage factor is computed when the analysis runs. When the register had no
// judged rows then (factor excluded) but has judged rows now, the stored breakdown is stale — offer the deterministic
// rescore (append-only new version; a changed score voids the human confirmation, as in the existing rescore).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../../lib/api.ts";
import { useConfirm } from "../../crud.tsx";

type StoredFactor = { key?: unknown; value?: unknown };

/** True when the stored capability factor was excluded but judged capability rows exist now. */
export function isCapabilityStale(factors: unknown, judgedNow: number): boolean {
  const list = Array.isArray(factors) ? (factors as StoredFactor[]) : [];
  return list.some((f) => f?.key === "capability_coverage" && typeof f.value !== "number") && judgedNow > 0;
}

export function CapabilityRescoreNotice({
  analysisId,
  canCurate,
  onRefresh,
  refreshSynState,
}: {
  analysisId: string | undefined;
  canCurate: boolean;
  onRefresh?: () => void;
  refreshSynState?: () => Promise<void> | void;
}) {
  const t = useTranslations("stages.s3.synergyTabs");
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!canCurate || !analysisId) return null;

  async function rescore() {
    if (busy || !analysisId) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<{ message: string }>(
        `/api/synergy/analyses/${encodeURIComponent(analysisId)}/rescore`,
        {},
      );
      setNote(r.data.message);
      onRefresh?.();
      await refreshSynState?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("recalculationFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="capability-rescore-notice">
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={busy}
        onClick={() =>
          confirm(t("recomputeSavedRecordsFromThe"), () => void rescore(), {
            body: t("recomputesTheSavedS1Market"),
            confirmLabel: t("recalculate"),
          })
        }
      >
        {busy ? t("recalculating") : t("recomputeUnderTheCurrentScheme")}
      </button>
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("capabilityFilledAfterAnalysis")}
      </span>
      {note && (
        <p role="status" className="w-full text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
          {note}
        </p>
      )}
      {confirmDialog}
    </div>
  );
}
