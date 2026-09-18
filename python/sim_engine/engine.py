"""The simulation kernel (design sections 1.2, 1.3).

Model semantics (shared with the legacy S8 simulator so the transition is
protected by an equivalence test):
- year-1 is the anchor: revenue_y1 has no noise; revenue growth applies to
  years 2..H as revenue_t = revenue_{t-1} * (1 + growth_t);
- FCF_t = revenue_t * (1 - opex_ratio_t - capex_ratio_t);
- NPV = -initial_investment + sum(FCF_t / (1 + rate)^t); contingent
  liabilities are drawn (Bernoulli x triangular) into every iteration and
  subtracted at PV (ADR-0026);
- the deterministic path evaluates every driver at its central value with NO
  liabilities — base_npv matches the legacy `base_npv` contract.

Per-case output carries the FULL echo of the case's inputs (the snapshot IS
the execution contract, REQ-W5-1) plus device metadata (REQ-W7-4).
"""

from __future__ import annotations

import time
from typing import Any

from .backends import NumpyBackend, backend_for
from .device import DeviceInfo
from .job_spec import case_inputs_hash, driver_expected_value
from .metrics import bep_volume, discounted_payback_year, irr as compute_irr
from .rng_policy import derive_seed

PERCENTILES = (0.05, 0.5, 0.95)


def _scalar_driver(drivers: dict, name: str, default: float = 0.0) -> float:
    driver = drivers.get(name)
    return driver_expected_value(driver) if driver else default


def _sample_driver(backend: Any, rng: Any, size: tuple[int, ...], driver: dict) -> Any:
    dist = driver["dist"]
    if dist == "constant":
        return backend.full(size, driver["value"])
    if dist == "normal":
        return backend.normal(rng, size, driver["mean"], driver["sigma"])
    if dist == "uniform":
        return backend.uniform(rng, size, driver["low"], driver["high"])
    return backend.triangular(rng, size, driver["low"], driver["expected"], driver["high"])


def run_case(case: dict, spec: dict, device_info: DeviceInfo) -> dict:
    """Simulate one case. Pure function of (case, spec, device) — safe under
    multiprocessing and trivially reproducible."""
    started = time.monotonic()
    backend = NumpyBackend() if device_info.backend == "numpy" else backend_for(device_info)
    drivers = case["drivers"]
    iterations = spec["iterations"]
    horizon = spec["horizon_years"]
    rate = spec["discount_rate"]["value"]

    warnings: list[str] = list(device_info.warnings)

    # Seed: pure function of (case_id, canonical drivers) — design section 1.3.
    inputs_hash = case_inputs_hash(drivers)
    seed = derive_seed(case["case_id"], inputs_hash)
    rng = backend.generator(seed)

    revenue_y1 = _scalar_driver(drivers, "revenue_y1")
    growth_driver = drivers.get("revenue_growth", {"dist": "constant", "value": 0.0})
    opex_driver = drivers.get("opex_ratio", {"dist": "constant", "value": 0.0})
    capex_driver = drivers.get("capex_ratio", {"dist": "constant", "value": 0.0})
    initial_investment = _scalar_driver(drivers, "initial_investment")

    # Simulated paths — (iterations, horizon). Year 1 column is the anchor
    # (no noise), growth applies to years 2..H exactly like the legacy model.
    growth = _sample_driver(backend, rng, (iterations, horizon - 1), growth_driver)
    growth = backend.concatenate(
        [backend.full((iterations, 1), 0.0), growth], axis=1)
    revenue = backend.full((iterations, 1), revenue_y1)
    revenue = backend.concatenate(
        [revenue, revenue * backend.cumprod(1.0 + growth[:, 1:], axis=1)], axis=1)

    opex = _sample_driver(backend, rng, (iterations, 1), opex_driver)
    capex = _sample_driver(backend, rng, (iterations, 1), capex_driver)
    fcf = revenue * (1.0 - opex - capex)

    discount_factors = [(1.0 + rate) ** -t for t in range(1, horizon + 1)]
    npvs = backend.full((iterations,), -initial_investment)
    for t in range(horizon):
        npvs = npvs + fcf[:, t] * discount_factors[t]

    # Contingent liabilities — drawn into EVERY iteration (ADR-0026).
    for liability in drivers.get("contingent_liabilities", []):
        occurs = backend.bernoulli(rng, (iterations,), liability["probability"])
        amount = backend.triangular(rng, (iterations,), liability["amount_low"],
                                    liability["amount_expected"], liability["amount_high"])
        pv = amount * occurs * (1.0 + rate) ** (-liability["timing_year"])
        npvs = npvs - pv

    p05, p50, p95 = backend.quantiles(npvs, PERCENTILES)
    mean = backend.mean(npvs)
    variance = backend.variance(npvs)

    # Deterministic path — every driver at its central value, no liabilities.
    deterministic_flows: list[float] = []
    revenue_det = revenue_y1
    growth_mean = driver_expected_value(growth_driver)
    opex_mean = driver_expected_value(opex_driver)
    capex_mean = driver_expected_value(capex_driver)
    deterministic_flows.append(-initial_investment)
    for _ in range(horizon):
        deterministic_flows.append(revenue_det * (1.0 - opex_mean - capex_mean))
        revenue_det *= 1.0 + growth_mean
    base_npv = sum(cf / (1.0 + rate) ** t for t, cf in enumerate(deterministic_flows))

    payback = discounted_payback_year(initial_investment, deterministic_flows[1:], rate)

    bep_vol = None
    fixed = drivers.get("fixed_cost_annual")
    price = drivers.get("unit_price")
    variable = drivers.get("unit_variable_cost")
    if fixed and price and variable:
        bep_vol = bep_volume(driver_expected_value(fixed), driver_expected_value(price), driver_expected_value(variable))
    elif fixed or price or variable:
        warnings.append("bep_volume requires fixed_cost_annual, unit_price and unit_variable_cost together — omitted")

    return {
        "case_id": case["case_id"],
        "seed": seed,
        "iterations": iterations,
        "inputs_hash": inputs_hash,
        "npv": {"p05": p05, "p50": p50, "p95": p95, "mean": mean, "std": variance ** 0.5, "base": base_npv},
        "irr": compute_irr(deterministic_flows),
        "payback_discounted_years": payback,
        "bep_year": payback,
        "bep_volume": bep_vol,
        "device": {"device": device_info.device, "backend": device_info.backend,
                   "precision": device_info.precision, "build": device_info.build},
        "warnings": warnings,
        "inputs_echo": {"drivers": drivers, "discount_rate": spec["discount_rate"],
                        "iterations": iterations, "horizon_years": horizon},
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


def _sanitize(value: Any) -> Any:
    """JSON-safety: non-finite floats (NaN/Inf) become null — a missing value
    is stated, never fabricated."""
    if isinstance(value, float) and value != value:  # NaN
        return None
    if isinstance(value, float) and value in (float("inf"), float("-inf")):
        return None
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    return value


def run_case_worker(payload: tuple[dict, dict, dict]) -> dict:
    """Multiprocessing entry — plain-dict args so spawn-based pools pickle it."""
    case, spec, device_dict = payload
    device_info = DeviceInfo(**device_dict)
    return _sanitize(run_case(case, spec, device_info))


def run_case_serial(case: dict, spec: dict, device_info: DeviceInfo) -> dict:
    return _sanitize(run_case(case, spec, device_info))
