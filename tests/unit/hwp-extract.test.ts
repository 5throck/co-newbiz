// @version 1.0.0
/** Wave C2 — deterministic HWP BodyText parser fixture. */

import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const PY = process.platform === "win32" ? "python" : "python3";

test("extract_hwp.py parses an unpacked HWPTAG_PARA_TEXT section fixture", () => {
  const fixture = "tests/fixtures/hwp-section-uncompressed.bin";
  expect(existsSync(fixture)).toBe(true);
  const res = spawnSync(PY, ["python/extract_hwp.py", "--section-fixture", fixture], { encoding: "utf8" });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("첫 번째 문단");
  expect(res.stdout).toContain("Second paragraph");
});
