"""CLI — read a job-spec JSON (file argument or stdin), write the result JSON
to stdout; contract errors go to stderr with exit code 2 (usage/validation)
so callers can distinguish them from crashes (exit 1).

    python3 -m sim_engine job.json
    cat job.json | python3 -m sim_engine
    python3 -m sim_engine --version
"""

from __future__ import annotations

import json
import sys

from . import JobSpecError, __version__
from .job import run_job


def _read_input(argv: list[str]) -> str:
    if argv:
        with open(argv[0], "r", encoding="utf-8") as handle:
            return handle.read()
    return sys.stdin.read()


def main(argv: list[str]) -> int:
    if "--version" in argv:
        print(json.dumps({"engine": "python-sim-engine", "version": __version__}))
        return 0
    try:
        raw = json.loads(_read_input([a for a in argv if a != "--"]))
    except json.JSONDecodeError as error:
        print(f"job-spec is not valid JSON: {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"cannot read job-spec input: {error}", file=sys.stderr)
        return 2
    try:
        result = run_job(raw)
    except JobSpecError as error:
        print(f"invalid job-spec: {error}", file=sys.stderr)
        return 2
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
