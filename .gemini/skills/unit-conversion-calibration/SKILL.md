---
name: unit-conversion-calibration
scope: co-newbiz
description: >
  Calibrates a statistical proxy-chain hop via OLS regression with a
  lead-lag search (`python/correlation.py`), reporting beta, R-squared, the
  lag that maximizes fit, and a 95% confidence interval. Never runs against
  an engineering hop — that classification happens before calibration, per
  `guidelines/proxy-chain-hop-classification.md`, not as part of this skill.

  Use when: "calibrate a proxy hop", "lead-lag regression", "unit
  conversion coefficient", "beta calibration for a proxy chain".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: quant-methodologist
prerequisites: none
metadata:
  type: implementation
  triggers:
    - calibrate a proxy hop
    - lead-lag regression
    - unit conversion coefficient
    - beta calibration for a proxy chain
---

## Context

This skill is intentionally narrow: it calibrates one already-classified
statistical hop. Classification (engineering vs. statistical) is a
methodology judgment that happens first, per
`guidelines/proxy-chain-hop-classification.md` — an engineering hop's fixed
physical coefficient never goes through this calibration at all.
`python/correlation.py` searches over a lag window (the "engine leads ship
demand by N months" question) rather than assuming zero lag, since the
correct lag is itself part of what needs discovering, not an input.

## When to Use

- A hop has already been classified as statistical and needs its beta calibrated
- Re-calibrating an existing hop when new time-series data arrives

## Execution Steps

1. **Confirm the hop is classified statistical**, not engineering — this
   skill does not do the classification itself
2. **Prepare the two time series** (`from_series`, `to_series`) with
   period-aligned observations and a `max_lag_months` search window
3. **Run the calibration**: `python correlation.py <input.json>` — OLS
   regression at each candidate lag, selecting the lag that maximizes fit
4. **Read the output**: `beta`, `r2`, `lag_months`, `ci_low`/`ci_high`,
   `grade_eligible`, `grade_note` — a low R² or wide confidence interval is
   a real finding to report, not something to re-run with different
   parameters until it looks better
5. **Feed the result to `proxy-industry-chain`**: the hop's grade
   eligibility (R²≥0.6, per the module's own threshold note) directly
   affects the chain's overall reliability grade

## Output Format

- Calibration result JSON (beta, R², lag_months, confidence interval,
  grade eligibility and note) per hop

## Related Skills

- `proxy-industry-chain` — the chain this hop's calibration feeds
- `growth-projection-modeling` — another consumer of regression-based coefficients, calibrated with the same rigor discipline
