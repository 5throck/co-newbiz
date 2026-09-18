"""Financial metrics — NPV percentiles, IRR, discounted payback / BEP year,
BEP volume (design REQ-W3-1).

Conventions shared with the legacy S8 simulator (business-case-generator.ts):
- flows[0] is the year-0 outflow, undiscounted; year t discounts by (1+r)^-t;
- IRR is bisection on NPV(rate), null when no sign change in [-0.9, 10];
- the discounted payback / BEP year is the (fractionally interpolated) first
  time cumulative discounted FCF on the DETERMINISTIC path crosses zero —
  null when the horizon ends first. Missing value is null, never a guess.
"""

from __future__ import annotations

import math
from typing import Callable, Sequence


def irr(flows: Sequence[float]) -> float | None:
    """IRR by bisection — identical contract to the legacy implementation."""
    def npv(rate: float) -> float:
        return sum(cf / (1.0 + rate) ** i for i, cf in enumerate(flows))

    lo, hi = -0.9, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = npv(mid)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2.0


def discounted_payback_year(initial_investment: float, flows: Sequence[float], rate: float) -> float | None:
    """Fractional year when cumulative discounted FCF first reaches zero.
    0.0 when there is no year-0 outflow; null when the horizon ends first."""
    cumulative = -float(initial_investment)
    if cumulative >= 0:
        return 0.0
    previous = cumulative
    for year, cf in enumerate(flows, start=1):
        discounted = cf / (1.0 + rate) ** year
        cumulative += discounted
        if cumulative >= 0:
            span = cumulative - previous
            fraction = (-previous / span) if span > 0 else 0.0
            return (year - 1) + min(max(fraction, 0.0), 1.0)
        previous = cumulative
    return None


def bep_volume(fixed_cost_annual: float, unit_price: float, unit_variable_cost: float) -> float | None:
    """Break-even volume = annual fixed cost / unit contribution margin.
    Null when the margin is not positive (no finite break-even point)."""
    margin = unit_price - unit_variable_cost
    if margin <= 0 or not math.isfinite(margin):
        return None
    return fixed_cost_annual / margin


def quantile_index(sorted_values: Sequence[float], probability: float) -> float:
    """Empirical-index quantile, matching the legacy TS simulator's q(p) —
    exposed for equivalence tests; production percentiles use the backend's
    interpolated quantile."""
    position = min(len(sorted_values) - 1, max(0, int(probability * len(sorted_values))))
    return float(sorted_values[position])


def root_find(fn: Callable[[float], float], lo: float, hi: float, iterations: int = 200) -> float | None:
    """Shared bisection skeleton; null when no sign change at the bracket."""
    f_lo, f_hi = fn(lo), fn(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(iterations):
        mid = (lo + hi) / 2.0
        f_mid = fn(mid)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0
