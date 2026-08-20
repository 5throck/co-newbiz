#!/usr/bin/env python3
"""
Proxy-chain hop calibration — design v1.0 section 4-5/5-2, meeting M4.

Calibrates a single STATISTICAL hop between two industry time series: OLS
regression with a lead-lag search (the "engine leads ship demand by N
months" question), reporting beta, R-squared, the lag that maximizes fit,
and a 95% confidence interval on beta.

This module does NOT classify a hop as engineering vs. statistical — that
classification happens before calibration is even run (see
guidelines/proxy-chain-hop-classification.md). An engineering hop's fixed
physical coefficient never goes through this script at all; only genuine
statistical hops are calibrated here.

Usage:
    python correlation.py <input_json>

Input JSON shape:
    {
      "from_series": [{"period": "2023-01", "value": 10.0}, ...],
      "to_series":   [{"period": "2023-01", "value": 5.0}, ...],
      "max_lag_months": 6
    }

Output JSON (to stdout):
    {
      "beta": 0.48, "r2": 0.71, "lag_months": 2,
      "ci_low": 0.41, "ci_high": 0.55,
      "grade_eligible": true, "grade_note": "R2>=0.6, single statistical hop path"
    }
"""

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


def _align(from_vals: list[float], to_vals: list[float], lag: int) -> tuple[np.ndarray, np.ndarray]:
    """Shift `from_vals` by `lag` periods relative to `to_vals` (positive lag
    means the from-series leads the to-series by `lag` periods)."""
    if lag >= 0:
        x = from_vals[: len(from_vals) - lag] if lag > 0 else from_vals
        y = to_vals[lag:]
    else:
        x = from_vals[-lag:]
        y = to_vals[: len(to_vals) - (-lag)]
    n = min(len(x), len(y))
    return np.array(x[:n], dtype=float), np.array(y[:n], dtype=float)


def _ols_with_ci(x: np.ndarray, y: np.ndarray) -> dict[str, float]:
    """Simple OLS y = alpha + beta*x, with R^2 and a 95% CI on beta."""
    n = len(x)
    if n < 3:
        raise ValueError("need at least 3 aligned observations to calibrate a hop")

    x_mean, y_mean = x.mean(), y.mean()
    sxx = np.sum((x - x_mean) ** 2)
    if sxx == 0:
        raise ValueError("from_series has zero variance at this lag — cannot regress")

    beta = np.sum((x - x_mean) * (y - y_mean)) / sxx
    alpha = y_mean - beta * x_mean

    y_hat = alpha + beta * x
    residuals = y - y_hat
    ss_res = np.sum(residuals**2)
    ss_tot = np.sum((y - y_mean) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot != 0 else 0.0

    # Standard error of beta, 95% CI via t-distribution approximation
    # (normal approx for simplicity — acceptable for an MVP calibration tool,
    # not a substitute for a full statistics package in a rigor-critical path).
    dof = n - 2
    if dof <= 0:
        se_beta = float("nan")
    else:
        mse = ss_res / dof
        se_beta = float(np.sqrt(mse / sxx))

    # t-critical for 95% CI, dof-dependent approximation (falls back to
    # the normal-distribution critical value 1.96 for larger samples).
    t_crit = 1.96 if dof > 30 else _t_critical_95(dof)

    return {
        "beta": float(beta),
        "r2": float(r2),
        "ci_low": float(beta - t_crit * se_beta) if not np.isnan(se_beta) else None,
        "ci_high": float(beta + t_crit * se_beta) if not np.isnan(se_beta) else None,
    }


def _t_critical_95(dof: int) -> float:
    """Small lookup table for the 95% two-tailed t-critical value —
    avoids a scipy dependency for a handful of common small-sample dof."""
    table = {1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36,
             8: 2.31, 9: 2.26, 10: 2.23, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04}
    if dof in table:
        return table[dof]
    closest = min(table.keys(), key=lambda k: abs(k - dof))
    return table[closest]


def calibrate_hop(
    from_series: list[dict[str, Any]],
    to_series: list[dict[str, Any]],
    max_lag_months: int = 6,
) -> dict[str, Any]:
    from_vals = [p["value"] for p in from_series]
    to_vals = [p["value"] for p in to_series]

    best: dict[str, Any] | None = None
    best_lag = 0

    for lag in range(-max_lag_months, max_lag_months + 1):
        x, y = _align(from_vals, to_vals, lag)
        if len(x) < 3:
            continue
        try:
            result = _ols_with_ci(x, y)
        except ValueError:
            continue
        if best is None or result["r2"] > best["r2"]:
            best = result
            best_lag = lag

    if best is None:
        raise ValueError("no lag in the searched range produced a valid regression")

    # D-M4-1: Grade B requires R^2 >= 0.6 for a single statistical hop.
    grade_eligible = best["r2"] >= 0.6
    grade_note = (
        f"R2={best['r2']:.2f} >= 0.6 — eligible for Grade B if this is the chain's only statistical hop"
        if grade_eligible
        else f"R2={best['r2']:.2f} < 0.6 — caps the chain at Grade C regardless of other hops"
    )

    return {
        "beta": best["beta"],
        "r2": best["r2"],
        "lag_months": best_lag,
        "ci_low": best["ci_low"],
        "ci_high": best["ci_high"],
        "grade_eligible": grade_eligible,
        "grade_note": grade_note,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python correlation.py <input_json>", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        payload = json.load(f)

    result = calibrate_hop(
        payload["from_series"],
        payload["to_series"],
        payload.get("max_lag_months", 6),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
