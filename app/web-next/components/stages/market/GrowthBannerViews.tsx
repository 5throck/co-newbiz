"use client";

// A3 (design 2026-09-18-s1-growth-gap-calibration, addendum 2026-11-12b) — the
// S1 growth banner's rendering seam as exported pure views, so the component
// test (tests/unit/market-growth-banner-render.test.ts) pins the CTA tri-state
// and the banner text without mounting the api client. Split out of
// SizingGrowthTabs.tsx to keep both files under the 400-line decomposition cap.
import { useTranslations } from "next-intl";

// The top-down consensus reference chip (design 2026-11-13 §3.3a): the
// displayed topDownCagr's source details (label, capture origin, target year,
// CAGR, record date, optional URL) surfaced next to the consistency display
// instead of living only inside CalibrationPanel. Rendered from the tab's
// existing live GET — no new fetch.
export function ReferenceChip({
  sourceLabel,
  sourceUrl,
  targetYear,
  externalCagrPct,
  capturedFrom,
  createdAt,
}: {
  sourceLabel: string;
  sourceUrl: string | null;
  targetYear: number;
  externalCagrPct: number;
  capturedFrom: string;
  createdAt: string;
}) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  const origin =
    capturedFrom === "user"
      ? t("refCapturedUser")
      : capturedFrom === "web_research"
        ? t("refCapturedWebResearch")
        : t("refCapturedLlmPrior");
  return (
    <p className="mb-2 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
      {t("topDownReferenceChip", {
        label: sourceLabel,
        origin,
        year: targetYear,
        cagr: externalCagrPct.toFixed(1),
        date: createdAt.slice(0, 10),
      })}
      {sourceUrl && (
        <>
          {" "}
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
            {sourceUrl}
          </a>
        </>
      )}
    </p>
  );
}

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
// does not already own the CTA (ctaMode "gap"). variant picks the message:
//  - "newer" (default) — an active reference is newer than the displayed
//    version (C1, amendment 2026-11-12);
//  - "superseded" — the displayed version's consensus cites a since-superseded
//    reference; re-analysis recomputes the consensus (design 2026-11-13 §3.3b,
//    the drone v4 case).
// SizingGrowthTab mounts it only when one of the two staleness conditions
// holds, so "neither renders nothing" is a mount-level fact (pinned by a
// source assertion in the test).
export function GrowthStalenessCard({
  showCta,
  rerunStarted,
  canCurate,
  onRerun,
  rerunError,
  variant = "newer",
}: {
  showCta: boolean;
  rerunStarted: boolean;
  canCurate: boolean;
  onRerun: () => void;
  rerunError: string | null;
  variant?: "newer" | "superseded";
}) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  const message =
    variant === "superseded"
      ? t("consensusCitesSupersededReference")
      : t("recordedExternalReferenceNewerThanTheLatestAnalysis");
  return (
    <div className="sizing-grade-card mt-4" role="status" data-testid="growth-staleness-card">
      <p className="m-0 text-[length:var(--fs-caption)]">{message}</p>
      {showCta && <RerunAction rerunStarted={rerunStarted} canCurate={canCurate} onRerun={onRerun} />}
      {showCta && rerunError && (
        <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">
          {rerunError}
        </p>
      )}
    </div>
  );
}
