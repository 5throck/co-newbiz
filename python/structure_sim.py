#!/usr/bin/env python3
"""
Industry-structure scenario propagation engine — ADR-0066 Phase C,
value-chain scenario-simulation design (2026-08-24) section 3.3.

Driver deltas flow through two channels per iteration:
  demand   : node's own driver contributions (chain_node_sensitivity ×
             sampled driver delta), then propagated downstream along
             value_chain_link edges scaled by each edge's elasticity;
  margin   : upstream commodity-cost shock reduced by each incoming edge's
             pass_through_rate — what the node cannot pass through comes out
             of its margin.

Honesty rules carried over from the design:
  - an edge without elasticity transmits NO demand — nodes whose only inflow
    is such edges are reported in `unassessed_nodes` rather than defaulted;
  - identical seed + identical inputs reproduce identical output (design §12
    item 13): numpy's seeded Generator exclusively, never the global RNG.

Usage:
    python structure_sim.py <input_json>

Input JSON shape:
    {
      "seed": 42,
      "iterations": 5000,
      "drivers": {
        "rate_bp":       {"mode": 100, "low": 50, "high": 200},
        "fx_pct":        {"mode": 5, "low": 0, "high": 12},
        "commodity_pct": {"mode": 8, "low": 0, "high": 20},
        "regulation_severity": {"mode": 1, "low": 0, "high": 3}
      },
      "nodes": [{"industry_id": "A"}, {"industry_id": "B"}],
      "links": [
        {"from": "A", "to": "B", "elasticity": 0.6, "pass_through_rate": 0.8}
      ]
    }

Output JSON (to stdout):
    {"results": [
       {"industry_id": "B",
        "demand_delta_pct": {"p05": .., "p50": .., "p95": ..},
        "margin_delta_pp":  {"p05": .., "p50": .., "p95": ..},
        "unassessed": false}, ...
     ],
     "unassessed_nodes": ["C"],
     "seed": 42, "iterations": 5000}
"""

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


def _quantiles(samples: list[float]) -> dict[str, float]:
    arr = np.array(samples, dtype=float)
    return {
        "p05": float(np.percentile(arr, 5)),
        "p50": float(np.percentile(arr, 50)),
        "p95": float(np.percentile(arr, 95)),
    }


def _triangular(rng: np.random.Generator, spec: dict[str, Any]) -> float:
    return float(rng.triangular(spec["low"], spec["mode"], spec["high"]))


def _rate_contribution(sample_bp: float, sensitivity: float) -> float:
    # sensitivity unit: % demand change per 100 bp.
    return sensitivity * (sample_bp / 100.0)


def run_simulation(
    seed: int,
    iterations: int,
    drivers: dict[str, Any],
    nodes: list[dict[str, Any]],
    links: list[dict[str, Any]],
) -> dict[str, Any]:
    rng = np.random.default_rng(seed)

    node_ids = [n["industry_id"] for n in nodes]
    node_set = set(node_ids)

    # Driver sampling vectors per iteration.
    samples: dict[str, list[float]] = {}
    specs = {
        "rate_bp": lambda d: d,
        "fx_pct": lambda d: d,
        "commodity_pct": lambda d: d,
        "regulation_severity": lambda d: d,
    }
    for name, build in specs.items():
        if name in drivers:
            samples[name] = [_triangular(rng, build(drivers[name])) for _ in range(iterations)]

    # Node-level own demand contributions per iteration (%).
    own: dict[str, list[float]] = {nid: [0.0] * iterations for nid in node_ids}
    for n in nodes:
        nid = n["industry_id"]
        for drv_name, key in (("rate_bp", "rate"), ("fx_pct", "fx"),
                              ("commodity_pct", "commodity"), ("regulation_severity", "regulation")):
            sens = n.get("sensitivities", {}).get(key)
            if sens is None or drv_name not in samples:
                continue
            conv = (lambda s, d: s * (d / 100.0)) if drv_name == "rate_bp" else (lambda s, d: s * d)
            own[nid] = [o + conv(sens, smp) for o, smp in zip(own[nid], samples[drv_name])]

    # Topological order over from→to edges (links between unknown nodes ignored).
    preds: dict[str, list[tuple[str, float | None]]] = {nid: [] for nid in node_ids}
    out_edges: dict[str, list[tuple[str, float | None]]] = {nid: [] for nid in node_ids}
    indeg: dict[str, int] = {nid: 0 for nid in node_ids}
    for l in links:
        f, t = l.get("from"), l.get("to")
        if f not in node_set or t not in node_set or f == t:
            continue
        out_edges[f].append((t, l.get("elasticity")))
        preds[t].append((f, l.get("elasticity")))
        indeg[t] += 1

    queue = [nid for nid in node_ids if indeg[nid] == 0]
    topo: list[str] = []
    while queue:
        u = queue.pop(0)
        topo.append(u)
        for t, _e in out_edges[u]:
            indeg[t] -= 1
            if indeg[t] == 0:
                queue.append(t)

    # Demand propagation in topological order: each edge transmits the source
    # node's total demand delta scaled by its elasticity. An edge without a
    # coefficient transmits nothing — a node whose only inflow is such an edge
    # is reported UNASSESSED rather than defaulted to zero impact.
    total_demand: dict[str, list[float]] = {nid: list(own[nid]) for nid in node_ids}
    for u in topo:
        for t, elasticity in out_edges[u]:
            if elasticity is None:
                continue
            src = total_demand[u]
            total_demand[t] = [d + elasticity * s for d, s in zip(total_demand[t], src)]

    # Margin channel: commodity cost shock minus what each inflow passes through.
    commodity = samples.get("commodity_pct", [0.0] * iterations)
    margin: dict[str, list[float]] = {nid: [0.0] * iterations for nid in node_ids}
    for l in links:
        f, t = l.get("from"), l.get("to")
        if f not in node_set or t not in node_set or f == t:
            continue
        p = l.get("pass_through_rate")
        if p is None:
            continue
        leakage = [(1.0 - float(p)) * c for c in commodity]
        margin[t] = [m - lk for m, lk in zip(margin[t], leakage)]

    unassessed: list[str] = []
    results: list[dict[str, Any]] = []
    for nid in node_ids:
        coeff_inflow = any(e is not None for _f, e in preds[nid])
        if not coeff_inflow and len(preds[nid]) > 0:
            # every inflow lacked elasticity → demand transmission unproven
            unassessed.append(nid)
        results.append(
            {
                "industry_id": nid,
                "demand_delta_pct": _quantiles(total_demand[nid]),
                "margin_delta_pp": _quantiles(margin[nid]),
                "unassessed": nid in unassessed,
            }
        )

    return {
        "results": results,
        "unassessed_nodes": sorted(unassessed),
        "seed": seed,
        "iterations": iterations,
    }


def indeg_covered(nid: str, preds: dict[str, list[tuple[str, float | None]]]) -> bool:
    return len(preds.get(nid, [])) > 0


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python structure_sim.py <input_json>", file=sys.stderr)
        sys.exit(1)
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    output = run_simulation(
        seed=int(payload["seed"]),
        iterations=int(payload["iterations"]),
        drivers=payload.get("drivers", {}),
        nodes=payload.get("nodes", []),
        links=payload.get("links", []),
    )
    print(json.dumps(output))


if __name__ == "__main__":
    main()
