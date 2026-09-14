# Design: ConsistencyChart axis scales to the data

- Date: 2026-09-15
- Status: implemented
- Related: S1 `시장분석 리포트` step 5 (`성장률 정합성 확인`), market-sizing matrix v2

## Problem

User report: the `바텀업` vs `탑다운` CAGR comparison bars rendered in a nonsensical
shape — both bars stretched to the full chart width while the x-axis ran 0–8%,
with end labels reading 22% and 12%.

Cause: `ConsistencyChart` hardcoded the x-axis maximum (`max: 8`). Any deal
whose CAGR exceeded 8% had its bars clipped at the axis edge — the label
positions (22%, 12%) and the axis disagreed. The seed-era data evidently fit
within 8; real analyses do not. The other two hardcoded axis maxima in the same
file (`SegmentMixStack`, `YearlyShareAreaChart` — `max: 100`) are percentage-
composition charts that always sum to 100 and are correct.

## Approach

Derive the axis ceiling from the two plotted CAGR values: take the largest
finite positive value, scale by 1.1 for right-label headroom, round up to a 5%
tick step, and keep 8 as the floor so small-CAGR charts keep their existing
readable scale. 22% → axis 25; 4.4% → axis 8. `min: 0` unchanged.

## Verification

- `bunx tsc --noEmit` clean; `bun run test:unit` green; `design:lint` clean.
- Manual: the humanoid-robot analysis (22% / 12%) renders bars at ~88% / ~48%
  of the axis with the full 0–25% range visible.
