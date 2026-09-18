"""Engine core — job-spec in, per-case results plus the full input echo out
(design sections 1.2-1.4). The snapshot IS the execution contract (REQ-W5-1).
"""

from __future__ import annotations

import platform
import time
from typing import Any

from . import __version__
from .device import select_device
from .job_spec import parse_job_spec
from .parallel import run_cases


def run_job(raw_spec: Any) -> dict:
    """Parse, select the device, simulate every case, and return the result
    whose `inputs` field echoes the parsed job-spec verbatim."""
    started = time.monotonic()
    spec = parse_job_spec(raw_spec)
    device_info = select_device(spec["device"], spec["iterations"], len(spec["cases"]))
    case_results = run_cases(spec["cases"], spec, device_info)
    elapsed_ms = int((time.monotonic() - started) * 1000)

    return {
        "job_id": spec["job_id"],
        "engine": "python-sim-engine",
        "version": __version__,
        "host": {"python": platform.python_version(), "machine": platform.machine()},
        "device": {"device": device_info.device, "backend": device_info.backend,
                   "precision": device_info.precision, "build": device_info.build,
                   "reason": device_info.reason, "warnings": device_info.warnings},
        "iterations": spec["iterations"],
        "horizon_years": spec["horizon_years"],
        "discount_rate": spec["discount_rate"],
        "cases": case_results,
        "elapsed_ms": elapsed_ms,
    }
