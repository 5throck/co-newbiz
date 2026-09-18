"""Seed policy — the reproducibility contract (design sections 1.3, 1.4).

seed = fnv1a32(case_id + ":" + sha256_hex(canonical_drivers))

Consequences:
- identical job-spec  -> identical seed -> identical result (reproducibility);
- a parameter change  -> a deterministic seed change (the adjusted run is a
  fresh, reproducible sample, never a silent reuse of the old stream).

RNG streams are device-specific, so the full reproduction contract is
"same job-spec + same device" (REQ-W7-4); the result snapshot records the
device that produced it.
"""

from __future__ import annotations

FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193
FNV_MASK = 0xFFFFFFFF


def fnv1a32(key: str) -> int:
    """32-bit FNV-1a — the same primitive the legacy TS generator uses
    (business-case-generator.ts scenarioSeed), keeping hash parity across the
    transition period."""
    h = FNV_OFFSET
    for byte in key.encode("utf-8"):
        h ^= byte
        h = (h * FNV_PRIME) & FNV_MASK
    return h


def derive_seed(case_id: str, inputs_hash: str) -> int:
    return fnv1a32(f"{case_id}:{inputs_hash}")
