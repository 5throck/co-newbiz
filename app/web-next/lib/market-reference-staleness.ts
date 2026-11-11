// market-reference-staleness.ts — S1 growth-consensus staleness pure logic
// (design 2026-09-18-s1-growth-gap-calibration, amendment 2026-11-12). No JSX
// here, so the unit tests can import it directly from the root tsconfig tsc
// pass (which runs without --jsx). The UI surface lives in
// components/stages/market/SizingGrowthTabs.tsx.

// C1 — true when the recorded external reference was created after the latest
// displayed analysis version, i.e. the version's consensus is stale. Pure
// timestamp comparison; missing or unparseable inputs fail closed to not-stale.
export function referenceNewerThanVersion(referenceCreatedAt: string | null | undefined, versionCreatedAt: string | null | undefined): boolean {
  if (!referenceCreatedAt || !versionCreatedAt) return false;
  const ref = Date.parse(referenceCreatedAt);
  const ver = Date.parse(versionCreatedAt);
  if (Number.isNaN(ref) || Number.isNaN(ver)) return false;
  return ref > ver;
}

// C2 — decides where the rerun CTA appears. "gap" is the existing gap gate
// (externalForecast && |gap| >= 20) block, "staleness" is the reference-newer
// banner card, "none" is no CTA. When the gap gate already shows a CTA it wins
// (no duplicate buttons — the existing gap CTA behavior is unchanged).
export function rerunCtaMode(gapPct: number | undefined, referenceNewer: boolean): "gap" | "staleness" | "none" {
  const gapVisible = gapPct !== undefined && Math.abs(gapPct) >= 20;
  if (gapVisible) return "gap";
  return referenceNewer ? "staleness" : "none";
}
