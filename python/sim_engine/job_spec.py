"""Job-spec parsing, validation, and canonical serialization.

The job-spec is the engine's execution contract (design section 1.2): what
goes in is exactly what comes back as the result snapshot, so "which
parameters produced this distribution" is structurally guaranteed.

Driver vocabulary (minimum set, extensible):
    normal    {mean, sigma}
    uniform   {low, high}
    triangular{low, expected, high}
    constant  {value}

Every driver may carry `unit` and `source` (provenance label). They are
opaque to the math and echoed verbatim in the result.

Well-known optional case drivers (all default to zero/absent):
    revenue_y1             year-1 revenue anchor (constant scalar)
    revenue_growth         annual growth applied to years 2..H
    opex_ratio, capex_ratio
    initial_investment     year-0 outflow
    fixed_cost_annual, unit_price, unit_variable_cost  — enable bep_volume
    contingent_liabilities [{probability, amount_low, amount_expected,
                             amount_high, timing_year}] — triangular draws
                             integrated into every iteration (ADR-0026).
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

DISTRIBUTIONS = ("normal", "uniform", "triangular", "constant")
DEVICES = ("auto", "cpu", "cuda", "mps", "xpu", "rocm")


class JobSpecError(ValueError):
    """Raised when a job-spec violates the contract — never silently repaired."""


def _normalize_numbers(value: Any) -> Any:
    """Integral floats serialize as integers (100.0 -> 100) so the canonical
    form is byte-identical across Python and TypeScript hashers."""
    if isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() and abs(value) < 1e15 else value
    if isinstance(value, dict):
        return {k: _normalize_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_numbers(v) for v in value]
    return value


def canonical_json(obj: Any) -> str:
    """Deterministic serialization for seed derivation: sorted keys, compact
    separators, integral floats as integers. Any semantically identical
    job-spec hashes identically."""
    return json.dumps(_normalize_numbers(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise JobSpecError(message)


def _check_finite(value: Any, label: str) -> float:
    _require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{label} must be a number")
    value = float(value)
    _require(math.isfinite(value), f"{label} must be finite (got {value})")
    return value


def parse_driver(raw: Any, label: str) -> dict:
    _require(isinstance(raw, dict), f"{label} must be an object")
    dist = raw.get("dist")
    _require(dist in DISTRIBUTIONS, f"{label}.dist must be one of {DISTRIBUTIONS} (got {dist!r})")
    parsed: dict = {"dist": dist}
    if dist == "normal":
        parsed["mean"] = _check_finite(raw.get("mean"), f"{label}.mean")
        sigma = _check_finite(raw.get("sigma"), f"{label}.sigma")
        _require(sigma >= 0, f"{label}.sigma must be >= 0")
        parsed["sigma"] = sigma
    elif dist == "uniform":
        low = _check_finite(raw.get("low"), f"{label}.low")
        high = _check_finite(raw.get("high"), f"{label}.high")
        _require(high >= low, f"{label}: high must be >= low")
        parsed["low"], parsed["high"] = low, high
    elif dist == "triangular":
        low = _check_finite(raw.get("low"), f"{label}.low")
        expected = _check_finite(raw.get("expected"), f"{label}.expected")
        high = _check_finite(raw.get("high"), f"{label}.high")
        _require(low <= expected <= high, f"{label}: triangular requires low <= expected <= high")
        parsed["low"], parsed["expected"], parsed["high"] = low, expected, high
    else:  # constant
        parsed["value"] = _check_finite(raw.get("value"), f"{label}.value")
    for key in ("unit", "source"):
        if key in raw:
            _require(isinstance(raw[key], str), f"{label}.{key} must be a string")
            parsed[key] = raw[key]
    return parsed


def parse_ramp_up(raw: Any, label: str) -> dict:
    """The ramp-up curve is a constant array (utilization by year, ratio
    0..1+) — the one array-valued driver. It multiplies revenue from year 1;
    a curve shorter than the horizon holds its last value (REQ-W1-2)."""
    _require(isinstance(raw, dict) and raw.get("dist", "constant") == "constant",
             f"{label} must be a constant driver with an array value")
    value = raw.get("value")
    _require(isinstance(value, list) and len(value) > 0, f"{label}.value must be a non-empty array")
    curve = []
    for i, v in enumerate(value):
        v = _check_finite(v, f"{label}.value[{i}]")
        _require(v >= 0, f"{label}.value[{i}] must be >= 0")
        curve.append(v)
    parsed = {"dist": "constant", "value": curve}
    for key in ("unit", "source"):
        if key in raw:
            _require(isinstance(raw[key], str), f"{label}.{key} must be a string")
            parsed[key] = raw[key]
    return parsed


def parse_case(raw: Any, index: int) -> dict:
    label = f"cases[{index}]"
    _require(isinstance(raw, dict), f"{label} must be an object")
    case_id = raw.get("case_id")
    _require(isinstance(case_id, str) and case_id, f"{label}.case_id must be a non-empty string")
    raw_drivers = raw.get("drivers")
    _require(isinstance(raw_drivers, dict), f"{label}.drivers must be an object")

    drivers: dict = {}
    for name in ("revenue_y1", "revenue_growth", "opex_ratio", "capex_ratio", "initial_investment",
                 "fixed_cost_annual", "unit_price", "unit_variable_cost"):
        if name in raw_drivers:
            drivers[name] = parse_driver(raw_drivers[name], f"{label}.drivers.{name}")
    _require("revenue_y1" in drivers, f"{label}: drivers.revenue_y1 is required (the year-1 revenue anchor)")
    if "ramp_up" in raw_drivers:
        drivers["ramp_up"] = parse_ramp_up(raw_drivers["ramp_up"], f"{label}.drivers.ramp_up")

    if "contingent_liabilities" in raw_drivers:
        liabilities = raw_drivers["contingent_liabilities"]
        _require(isinstance(liabilities, list), f"{label}.drivers.contingent_liabilities must be a list")
        parsed_liabilities = []
        for j, liab in enumerate(liabilities):
            liab_label = f"{label}.drivers.contingent_liabilities[{j}]"
            _require(isinstance(liab, dict), f"{liab_label} must be an object")
            probability = _check_finite(liab.get("probability"), f"{liab_label}.probability")
            _require(0 <= probability <= 1, f"{liab_label}.probability must be within [0, 1]")
            low = _check_finite(liab.get("amount_low"), f"{liab_label}.amount_low")
            expected = _check_finite(liab.get("amount_expected"), f"{liab_label}.amount_expected")
            high = _check_finite(liab.get("amount_high"), f"{liab_label}.amount_high")
            _require(0 <= low <= expected <= high, f"{liab_label}: amounts require 0 <= low <= expected <= high")
            timing = _check_finite(liab.get("timing_year"), f"{liab_label}.timing_year")
            _require(timing >= 1, f"{liab_label}.timing_year must be >= 1")
            parsed_liabilities.append({
                "probability": probability,
                "amount_low": low,
                "amount_expected": expected,
                "amount_high": high,
                "timing_year": timing,
            })
        drivers["contingent_liabilities"] = parsed_liabilities
    return {"case_id": case_id, "drivers": drivers}


def parse_job_spec(raw: Any) -> dict:
    """Validate a raw job-spec dict. Returns the parsed spec; raises JobSpecError
    with a precise message otherwise."""
    _require(isinstance(raw, dict), "job spec must be a JSON object")
    iterations = raw.get("iterations", 10000)
    _require(isinstance(iterations, int) and not isinstance(iterations, bool), "iterations must be an integer")
    _require(1 <= iterations <= 10_000_000, "iterations must be within [1, 10000000]")
    horizon = raw.get("horizon_years", 5)
    _require(isinstance(horizon, int) and not isinstance(horizon, bool), "horizon_years must be an integer")
    _require(1 <= horizon <= 50, "horizon_years must be within [1, 50]")

    rate = raw.get("discount_rate")
    _require(isinstance(rate, dict), "discount_rate must be an object")
    parsed_rate: dict = {"value": _check_finite(rate.get("value"), "discount_rate.value")}
    for key in ("subject", "source"):
        if key in rate:
            _require(isinstance(rate[key], str), f"discount_rate.{key} must be a string")
            parsed_rate[key] = rate[key]

    device = raw.get("device", "auto")
    _require(device in DEVICES, f"device must be one of {DEVICES} (got {device!r})")

    raw_cases = raw.get("cases")
    _require(isinstance(raw_cases, list) and len(raw_cases) > 0, "cases must be a non-empty list")
    cases = [parse_case(c, i) for i, c in enumerate(raw_cases)]
    ids = [c["case_id"] for c in cases]
    _require(len(ids) == len(set(ids)), "case_id values must be unique")

    return {
        "job_id": raw.get("job_id", ""),
        "seed_policy": raw.get("seed_policy", {}),
        "device": device,
        "iterations": iterations,
        "horizon_years": horizon,
        "discount_rate": parsed_rate,
        "cases": cases,
    }


def driver_expected_value(driver: dict) -> float:
    """The distribution's central value — the deterministic-path evaluation."""
    dist = driver["dist"]
    if dist == "constant":
        return driver["value"]
    if dist == "normal":
        return driver["mean"]
    if dist == "triangular":
        return driver["expected"]
    return (driver["low"] + driver["high"]) / 2.0  # uniform


def case_inputs_hash(drivers: dict) -> str:
    """sha256 of the canonical driver serialization — the input fingerprint the
    seed policy mixes into the seed (design section 1.3)."""
    return hashlib.sha256(canonical_json(drivers).encode("utf-8")).hexdigest()
