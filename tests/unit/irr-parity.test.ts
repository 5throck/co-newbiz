// @version 1.0.0
// D6 (Monte Carlo verification 2026-10-28): the Python engine (sim_engine.metrics.irr) and the
// TS fallback (business-case-generator.ts irr) must apply ONE bracket/null policy:
// bisection on [-0.9, 10], upper end widened x10 up to 1e6 when NPV does not change sign,
// null only when no sign change is found by then. Same flows -> same IRR on either path.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { irr } from "../../app/web-next/lib/business-case-generator.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PYTHON_DIR = resolve(REPO_ROOT, "python");
const PYTHON_BIN = existsSync(resolve(REPO_ROOT, ".venv", "bin", "python3")) ? resolve(REPO_ROOT, ".venv", "bin", "python3") : "python3";

function pythonIrr(vectors: number[][]): Array<number | null> | null {
  const code = "import json,sys\nfrom sim_engine.metrics import irr\nprint(json.dumps([irr(v) for v in json.load(sys.stdin)]))";
  const r = spawnSync(PYTHON_BIN, ["-c", code], { cwd: PYTHON_DIR, input: JSON.stringify(vectors), encoding: "utf-8", timeout: 30_000, env: { ...process.env, PYTHONPATH: PYTHON_DIR } });
  if ((r.status ?? r.exitCode) !== 0) return null;
  return JSON.parse(r.stdout);
}

const VECTORS: number[][] = [
  [-1000, 300, 400, 500],            // ordinary
  [-1000, 100, 100, 100],            // negative IRR
  [-1, 20],                          // IRR = 1900 % - above the standard bracket (the D6 repro)
  [-0.001, 500, 500],                // far above 1000 %
  [-100, -50, -20],                  // no root
  [100, 50, 20],                     // no root (all inflows)
  [0, 0, 0],
  [-500, 0, 0, 0, 1200],
];

describe("D6: IRR parity between sim_engine.metrics.irr and the TS fallback", () => {
  const py = pythonIrr(VECTORS);
  test.skipIf(py === null)("same flows give the same IRR (or both null)", () => {
    VECTORS.forEach((flows, i) => {
      const ts = irr(flows);
      const pyv = py![i];
      if (ts === null) expect(pyv).toBeNull();
      else {
        expect(pyv).not.toBeNull();
        expect(Math.abs(ts - (pyv as number))).toBeLessThan(1e-6 * Math.max(1, Math.abs(ts)));
      }
    });
  });
  test("the above-1000% case is no longer null on either path", () => {
    expect(irr([-1, 20])).toBeCloseTo(19, 6);
    if (py !== null) expect(py[2]).toBeCloseTo(19, 6);
  });
});
