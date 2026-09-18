"""Standalone Monte Carlo simulation engine.

Spec of record: docs/designs/2026-09-18-s8-business-case-evaluation-design.md
(section 1 — engine contract, device layer, parallelism, seed policy).

The engine is generic: a job-spec carries any number of cases, each a set of
named drivers with explicit distributions. The web orchestrator is just one
job-spec builder. Execution is deterministic: the seed is a pure function of
(case_id, canonical drivers), and identical job-specs on the same device
reproduce identical results (ADR-0052 section D.4).

CLI:  python3 -m sim_engine <job-spec.json>   (or pipe JSON on stdin)
"""

__version__ = "1.0.0"

from .job import run_job  # noqa: E402  (after __version__ — job.py reads it)
from .job_spec import JobSpecError, parse_job_spec  # noqa: E402

__all__ = ["run_job", "parse_job_spec", "JobSpecError", "__version__"]
