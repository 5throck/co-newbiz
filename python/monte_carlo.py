#!/usr/bin/env python3
"""
Monte Carlo NPV simulation with contingent-liability integration —
design v1.0 section 4-6, ADR-0026.

Contingent liabilities are NOT a narrative footnote — each one carries a
probability, a triangular amount distribution (low/expected/high), and an
expected timing, and is drawn into the NPV distribution on every iteration
(design's explicit rule: "결과는... P50/P95 금액으로 나온다", never a prose
"contingent liability exists" statement).

Determinism: identical seed + identical inputs MUST reproduce an identical
result (design section 12 verification item 13) — this script uses numpy's
seeded Generator exclusively, never the global unseeded RNG.

Usage:
    python monte_carlo.py <input_json>

Input JSON shape:
    {
      "seed": 42,
      "iterations": 10000,
      "discount_rate": 0.10,
      "base_cash_flows": [100, 110, 120, 130, 140],
      "contingent_liabilities": [
        {"probability": 0.3, "amount_low": 10, "amount_expected": 25,
         "amount_high": 60, "timing_year": 2}
      ],
      "include_draws": false
    }

Output JSON (to stdout):
    {"p05": ..., "p50": ..., "p95": ..., "mean": ..., "seed": 42, "iterations": 10000}
    plus, when include_draws is true, "draws": [per-iteration NPV, 4dp rounded].
    Quantiles are computed on the UNROUNDED draws either way, so the pinned
    seeded-reproduction values (design section 12 item 13) do not move.
"""

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


def _npv(cash_flows: list[float], discount_rate: float) -> float:
    return sum(cf / ((1 + discount_rate) ** (t + 1)) for t, cf in enumerate(cash_flows))


def run_simulation(
    seed: int,
    iterations: int,
    discount_rate: float,
    base_cash_flows: list[float],
    contingent_liabilities: list[dict[str, Any]],
    include_draws: bool = False,
) -> dict[str, Any]:
    rng = np.random.default_rng(seed)  # seeded generator — never np.random's global state
    base_npv = _npv(base_cash_flows, discount_rate)

    draws = np.empty(iterations, dtype=float)

    for i in range(iterations):
        total_liability_pv = 0.0
        for cl in contingent_liabilities:
            if rng.random() < cl["probability"]:
                amount = rng.triangular(cl["amount_low"], cl["amount_expected"], cl["amount_high"])
                timing_year = cl.get("timing_year", 0)
                pv = amount / ((1 + discount_rate) ** (timing_year + 1))
                total_liability_pv += pv
        draws[i] = base_npv - total_liability_pv

    result: dict[str, Any] = {
        "seed": seed,
        "iterations": iterations,
        "base_npv": round(base_npv, 2),
        "p05": round(float(np.percentile(draws, 5)), 2),
        "p50": round(float(np.percentile(draws, 50)), 2),
        "p95": round(float(np.percentile(draws, 95)), 2),
        "mean": round(float(np.mean(draws)), 2),
        "std": round(float(np.std(draws)), 2),
    }
    if include_draws:
        result["draws"] = [round(float(d), 4) for d in draws]
    return result


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python monte_carlo.py <input_json>", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        payload = json.load(f)

    result = run_simulation(
        seed=payload["seed"],
        iterations=payload.get("iterations", 10000),
        discount_rate=payload["discount_rate"],
        base_cash_flows=payload["base_cash_flows"],
        contingent_liabilities=payload.get("contingent_liabilities", []),
        include_draws=bool(payload.get("include_draws", False)),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
