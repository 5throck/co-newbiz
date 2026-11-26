"""Device layer — GPU/CPU hybrid execution (design section 1.4, REQ-W7-1..6).

One runtime (PyTorch) covers all four vendor targets: CUDA builds = NVIDIA,
ROCm builds = AMD (HIP reports through the cuda API), MPS = Apple Silicon,
XPU = Intel oneAPI. torch is a lazy, OPTIONAL dependency: the CPU path is
pure numpy and always works; when torch is missing or no compatible GPU is
present the engine degrades to CPU and records that fact in the result's
warnings — never a hard failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Auto-detection order (REQ-W7-1, user-set 2026-09-18):
# NVIDIA first, then Apple Silicon, then Intel, then AMD, then CPU.
AUTO_ORDER = ("cuda", "mps", "xpu", "rocm")

# Below this work volume (iterations x cases) per-run transfer overhead
# dominates and CPU wins even when a GPU exists (REQ-W7-6). Calibrated by
# measurement; see design section 10.3.
GPU_WORK_THRESHOLD = 200_000

_torch_cache: dict[str, Any] = {"loaded": False, "module": None}


def _torch():
    """Lazy one-time torch import; None when absent (CPU-only deployment)."""
    if not _torch_cache["loaded"]:
        try:
            import torch  # type: ignore

            _torch_cache["module"] = torch
        except Exception:  # ImportError or broken install — degrade, never crash
            _torch_cache["module"] = None
        _torch_cache["loaded"] = True
    return _torch_cache["module"]


@dataclass
class DeviceInfo:
    device: str          # cpu | cuda | mps | xpu | rocm
    backend: str         # numpy | torch
    precision: str       # float64 (CPU) | float32 (GPU — Metal lacks fp64)
    build: str = ""      # torch build flavor, e.g. 2.4.0+rocm6.1
    warnings: list[str] = field(default_factory=list)
    reason: str = ""


def _torch_device_available(torch_module: Any, name: str) -> bool:
    if name == "cuda":
        return bool(torch_module.cuda.is_available()) and not _is_rocm(torch_module)
    if name == "rocm":
        return bool(torch_module.cuda.is_available()) and _is_rocm(torch_module)
    if name == "mps":
        backend = getattr(torch_module.backends, "mps", None)
        return bool(backend is not None and backend.is_available())
    if name == "xpu":
        xpu = getattr(torch_module, "xpu", None)
        return bool(xpu is not None and xpu.is_available())
    return False


def _is_rocm(torch_module: Any) -> bool:
    version = getattr(torch_module.version, "hip", None)
    return bool(getattr(torch_module, "version", None) is not None and version is not None)


def select_device(requested: str, iterations: int, n_cases: int) -> DeviceInfo:
    """Resolve the execution device. `auto` applies the GPU payoff heuristic;
    an explicit request that cannot be satisfied degrades to CPU with a
    recorded warning (REQ-W7-3) instead of failing the job."""
    if requested == "cpu":
        return DeviceInfo("cpu", "numpy", "float64", reason="requested device=cpu")

    if requested == "auto":
        work = iterations * n_cases
        if work < GPU_WORK_THRESHOLD:
            # Decide BEFORE touching torch: importing it costs ~0.5s per process,
            # which CPU-sized jobs must never pay (even with torch installed).
            return DeviceInfo("cpu", "numpy", "float64",
                              reason=f"work={work} below GPU payoff threshold {GPU_WORK_THRESHOLD} (REQ-W7-6)")
    torch_module = _torch()
    if requested == "auto":
        if torch_module is None:
            return DeviceInfo("cpu", "numpy", "float64",
                              warnings=["torch not installed — CPU fallback (REQ-W7-3)"],
                              reason="auto: no torch runtime")
        for name in AUTO_ORDER:
            if _torch_device_available(torch_module, name):
                return DeviceInfo(name, "torch", "float32", build=str(getattr(torch_module, "__version__", "")),
                                  reason=f"auto: {name} available, work={work}")
        return DeviceInfo("cpu", "numpy", "float64",
                          warnings=["no compatible GPU detected — CPU fallback"],
                          reason="auto: no GPU among " + ",".join(AUTO_ORDER))

    # Explicit device request.
    if torch_module is None:
        return DeviceInfo("cpu", "numpy", "float64",
                          warnings=[f"requested device={requested} but torch is not installed — CPU fallback (REQ-W7-3)"],
                          reason="explicit request unsupported")
    if not _torch_device_available(torch_module, requested):
        return DeviceInfo("cpu", "numpy", "float64",
                          warnings=[f"requested device={requested} is not available on this host — CPU fallback (REQ-W7-4)"],
                          reason="explicit request unsupported")
    precision = "float64" if requested in ("cuda", "rocm") and _gpu_supports_fp64(torch_module) else "float32"
    return DeviceInfo(requested, "torch", precision, build=str(getattr(torch_module, "__version__", "")),
                      reason=f"requested device={requested}")


def _gpu_supports_fp64(torch_module: Any) -> bool:
    """Probe fp64 support on the resolved CUDA-class device; consumers treat a
    False probe as float32 anyway."""
    try:
        tensor = torch_module.zeros(1, dtype=torch_module.float64, device=torch_module.cuda.current_device())
        return bool(tensor is not None)
    except Exception:
        return False


def describe_runtime() -> dict:
    """Read-only runtime probe behind `python -m sim_engine --device-info`: what
    torch is installed, which accelerators it can drive, and what `auto` would
    pick for a job large enough to clear the GPU payoff threshold. Used by
    scripts/co-newbiz/setup-python-env.ts and the web app's misconfiguration
    warning; it never runs a simulation."""
    torch_module = _torch()
    torch_info: dict[str, Any] = {"installed": torch_module is not None}
    if torch_module is not None:
        torch_info["version"] = str(getattr(torch_module, "__version__", ""))
        torch_info["hip"] = getattr(getattr(torch_module, "version", None), "hip", None)
        available: dict[str, bool] = {}
        for name in AUTO_ORDER:
            try:
                available[name] = _torch_device_available(torch_module, name)
            except Exception:  # a broken accelerator stack must not break the probe
                available[name] = False
        torch_info["available"] = available
    info = select_device("auto", GPU_WORK_THRESHOLD, 1)
    return {
        "torch": torch_info,
        "gpu_work_threshold": GPU_WORK_THRESHOLD,
        "device": {"device": info.device, "backend": info.backend, "precision": info.precision,
                   "build": info.build, "reason": info.reason, "warnings": info.warnings},
    }
