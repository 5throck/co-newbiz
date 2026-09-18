"""Array backends behind the engine's math.

NumpyBackend — CPU, float64, numpy Generator. Always available.
TorchBackend — GPU (cuda/rocm/mps/xpu), float32 by default, torch.Generator.

Both expose the same tiny surface the engine needs, so the simulation kernel
is written once and runs on either. Triangular sampling has no torch builtin
and is implemented by inverse-CDF in both backends so the math is identical
(numpy's rng.triangular is the same inverse transform).
"""

from __future__ import annotations

from typing import Any

import numpy as np


class NumpyBackend:
    name = "numpy"

    def generator(self, seed: int) -> Any:
        return np.random.default_rng(seed)

    def normal(self, rng: Any, size: tuple[int, ...], mean: float, sigma: float) -> Any:
        return rng.normal(mean, sigma, size=size)

    def uniform(self, rng: Any, size: tuple[int, ...], low: float, high: float) -> Any:
        return rng.uniform(low, high, size=size)

    def triangular(self, rng: Any, size: tuple[int, ...], low: float, expected: float, high: float) -> Any:
        return rng.triangular(low, expected, high, size=size)

    def bernoulli(self, rng: Any, size: tuple[int, ...], probability: float) -> Any:
        return rng.random(size) < probability

    def cumprod(self, array: Any, axis: int) -> Any:
        return np.cumprod(array, axis=axis)

    def concatenate(self, columns: list[Any], axis: int) -> Any:
        return np.concatenate(columns, axis=axis)

    def full(self, size: tuple[int, ...], value: float) -> Any:
        return np.full(size, value, dtype=np.float64)

    def quantiles(self, array: Any, probabilities: tuple[float, ...]) -> list[float]:
        return [float(v) for v in np.quantile(array, probabilities)]

    def mean(self, array: Any) -> float:
        return float(np.mean(array))

    def variance(self, array: Any) -> float:
        # Population variance (ddof=0) — matches the legacy simulator's std.
        return float(np.var(array))

    def to_list(self, array: Any) -> list[float]:
        return [float(v) for v in array]


class TorchBackend:
    name = "torch"

    def __init__(self, torch_module: Any, device_name: str, precision: str):
        self._torch = torch_module
        self.device = torch_module.device(device_name)
        self.dtype = torch_module.float64 if precision == "float64" else torch_module.float32

    def generator(self, seed: int) -> Any:
        generator = self._torch.Generator(device=self.device)
        generator.manual_seed(seed)
        return generator

    def normal(self, rng: Any, size: tuple[int, ...], mean: float, sigma: float) -> Any:
        tensor = self._torch.empty(size, dtype=self.dtype, device=self.device).normal_(mean, sigma, generator=rng)
        return tensor

    def uniform(self, rng: Any, size: tuple[int, ...], low: float, high: float) -> Any:
        tensor = self._torch.empty(size, dtype=self.dtype, device=self.device).uniform_(low, high, generator=rng)
        return tensor

    def triangular(self, rng: Any, size: tuple[int, ...], low: float, expected: float, high: float) -> Any:
        # Inverse-CDF transform — identical math to numpy's rng.triangular.
        u = self._torch.empty(size, dtype=self.dtype, device=self.device).uniform_(0.0, 1.0, generator=rng)
        span = high - low
        fc = (expected - low) / span if span > 0 else 0.5
        left = self._torch.sqrt(u * fc) * span
        right = span - self._torch.sqrt((1.0 - u) * (1.0 - fc)) * span
        return low + self._torch.where(u < fc, left, right)

    def bernoulli(self, rng: Any, size: tuple[int, ...], probability: float) -> Any:
        u = self._torch.empty(size, dtype=self.dtype, device=self.device).uniform_(0.0, 1.0, generator=rng)
        return u < probability

    def cumprod(self, array: Any, axis: int) -> Any:
        return self._torch.cumprod(array, dim=axis)

    def concatenate(self, columns: list[Any], axis: int) -> Any:
        return self._torch.cat(columns, dim=axis)

    def full(self, size: tuple[int, ...], value: float) -> Any:
        return self._torch.full(size, value, dtype=self.dtype, device=self.device)

    def quantiles(self, array: Any, probabilities: tuple[float, ...]) -> list[float]:
        tensor = self._torch.quantile(array, self._torch.tensor(probabilities, dtype=array.dtype, device=array.device))
        return [float(v) for v in tensor.tolist()]

    def mean(self, array: Any) -> float:
        return float(array.mean().item())

    def variance(self, array: Any) -> float:
        # Population variance — parity with the numpy backend and the legacy TS.
        return float(array.var(unbiased=False).item())

    def to_list(self, array: Any) -> list[float]:
        return [float(v) for v in array.detach().cpu().tolist()]


def backend_for(device_info: Any) -> Any:
    if device_info.backend == "torch":
        torch_module = device_module()
        if torch_module is None:
            raise RuntimeError("torch backend requested but torch is unavailable")
        return TorchBackend(torch_module, device_info.device, device_info.precision)
    return NumpyBackend()


def device_module() -> Any:
    from . import device as device_layer

    return device_layer._torch()
