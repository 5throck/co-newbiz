"""Case-level parallelism (design section 1.3).

CPU  — multiprocessing Pool over cases (the grid unit: scenario x variant x
       parameter set); spawn start-method for cross-platform safety.
GPU  — a single process streams case batches to the device: one process per
       GPU avoids memory contention (REQ-W7-2's runtime keeps device memory
       under one owner), and vectorization already parallelizes iterations.
"""

from __future__ import annotations

import multiprocessing
import os
from typing import Any

from .engine import run_case_serial, run_case_worker


def run_cases(cases: list[dict], spec: dict, device_info: Any) -> list[dict]:
    if len(cases) == 1 or device_info.backend == "torch":
        return [run_case_serial(case, spec, device_info) for case in cases]
    return _run_cases_cpu_parallel(cases, spec, device_info)


def _run_cases_cpu_parallel(cases: list[dict], spec: dict, device_info: Any) -> list[dict]:
    """Pool over cases; falls back to serial execution when the platform
    forbids workers (e.g. restricted sandboxes) — never a hard failure."""
    workers = min(len(cases), os.cpu_count() or 1)
    payload = [(case, spec, vars(device_info)) for case in cases]
    try:
        ctx = multiprocessing.get_context("spawn")
        with ctx.Pool(processes=workers) as pool:
            return pool.map(run_case_worker, payload)
    except (OSError, PermissionError, ValueError):
        return [run_case_serial(case, spec, device_info) for case in cases]
