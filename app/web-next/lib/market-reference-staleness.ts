// market-reference-staleness.ts — S1 growth-gap goal line and staleness pure
// logic (design 2026-09-18-s1-growth-gap-calibration amendment 2026-11-12;
// goal-line unification design 2026-11-13-calibration-loop-convergence). No
// JSX and no db imports here, so the client bundle and the unit tests can
// import it directly from the root tsconfig tsc pass (which runs without
// --jsx). The server-side market-calibration.ts is NOT client-safe — it pulls
// the db graph via appendAudit — so the shared CONVERGENCE_GOAL_PCT lives in
// THIS module and the server lib re-exports it.

// The loop's convergence goal line (user decision 2026-11-13): the bottom-up
// vs top-down relative CAGR gap must fall BELOW this value for the loop to be
// converged. At or above it the loop is "unconverged" — driver proposals, the
// unconverged badge, and the re-analysis CTA stay visible. One number for the
// trigger, the CTA gates, and the sweep's feasible-ratio line.
export const CONVERGENCE_GOAL_PCT = 15;

// C1 — true when the recorded external reference was created after the latest
// displayed analysis version, i.e. the version's consensus is stale. Pure
// timestamp comparison; missing or unparseable inputs fail closed to not-stale.
export function referenceNewerThanVersion(
  referenceCreatedAt: string | null | undefined,
  versionCreatedAt: string | null | undefined,
): boolean {
  if (!referenceCreatedAt || !versionCreatedAt) return false;
  const ref = Date.parse(referenceCreatedAt);
  const ver = Date.parse(versionCreatedAt);
  if (Number.isNaN(ref) || Number.isNaN(ver)) return false;
  return ref > ver;
}

// C1b — true when the displayed version was created BEFORE the reference it
// cited was superseded, i.e. the version's consensus cites a reference that
// has since been retired (design 2026-11-13 §3.3b; verified case: drone v4
// created 01:20, reference superseded 01:22 — v4 still shows the old top-down
// with no signal today). A version created after the supersede no longer
// cites the retired row (the fallback ladder resumed at its run), so it must
// NOT banner. Fail-closed false on missing or unparseable inputs.
export function consensusCitesSupersededReference(
  latestSupersededAt: string | null | undefined,
  versionCreatedAt: string | null | undefined,
): boolean {
  if (!latestSupersededAt || !versionCreatedAt) return false;
  const sup = Date.parse(latestSupersededAt);
  const ver = Date.parse(versionCreatedAt);
  if (Number.isNaN(sup) || Number.isNaN(ver)) return false;
  return ver < sup;
}

// C2 — decides where the rerun CTA appears. "gap" is the unconverged-gap gate
// (externalForecast && |gap| >= CONVERGENCE_GOAL_PCT) block, "staleness" is
// the reference-newer banner card, "none" is no CTA. When the gap gate already
// shows a CTA it wins (no duplicate buttons — the gap CTA behavior is
// unchanged apart from the goal-line threshold).
export function rerunCtaMode(gapPct: number | undefined, referenceNewer: boolean): "gap" | "staleness" | "none" {
  const gapVisible = gapPct !== undefined && Math.abs(gapPct) >= CONVERGENCE_GOAL_PCT;
  if (gapVisible) return "gap";
  return referenceNewer ? "staleness" : "none";
}
