"use client";

// A3 (design 2026-09-18-s1-growth-gap-calibration, addendum 2026-11-12b) — the
// S1 growth banner's rendering seam as exported pure views, so the component
// test (tests/unit/market-growth-banner-render.test.ts) pins the CTA tri-state
// and the banner text without mounting the api client. Split out of
// SizingGrowthTabs.tsx to keep both files under the 400-line decomposition cap.
import { useTranslations } from "next-intl";

// The rerun action: started-status / button / null tri-state, shared by the
// gap block and the staleness card.
export function RerunAction({
  rerunStarted,
  canCurate,
  onRerun,
}: {
  rerunStarted: boolean;
  canCurate: boolean;
  onRerun: () => void;
}) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  if (rerunStarted) {
    return (
      <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mt-1 mb-0">
        {t("startedTheListAnalysisDate")}
      </p>
    );
  }
  if (!canCurate) return null;
  return (
    <button type="button" className="btn-ghost btn-sm mt-1" onClick={onRerun}>
      {t("nowReflectingTheLatestExternal")}
    </button>
  );
}

// The staleness card: banner text plus the rerun action only when the gap gate
// does not already own the CTA (ctaMode "gap"). SizingGrowthTab mounts it only
// when the reference is newer than the displayed version, so "not-newer renders
// neither" is a mount-level fact (pinned by a source assertion in the test).
export function GrowthStalenessCard({
  showCta,
  rerunStarted,
  canCurate,
  onRerun,
  rerunError,
}: {
  showCta: boolean;
  rerunStarted: boolean;
  canCurate: boolean;
  onRerun: () => void;
  rerunError: string | null;
}) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  return (
    <div className="sizing-grade-card mt-4" role="status" data-testid="growth-staleness-card">
      <p className="m-0 text-[length:var(--fs-caption)]">{t("recordedExternalReferenceNewerThanTheLatestAnalysis")}</p>
      {showCta && <RerunAction rerunStarted={rerunStarted} canCurate={canCurate} onRerun={onRerun} />}
      {showCta && rerunError && (
        <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">
          {rerunError}
        </p>
      )}
    </div>
  );
}
