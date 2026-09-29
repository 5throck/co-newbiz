// @version 1.0.0
/**
 * Guards for two audit-script fixes: agent discovery inside agents/ and the
 * SCRIPTS.md registry column-count check.
 */
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findAgentFiles } from "../../scripts/agent-lifecycle-audit";
import { findMalformedRegistryRows } from "../../scripts/verify-scripts";

test("findAgentFiles counts named agents in agents/ even without role/color", () => {
  const root = mkdtempSync(join(tmpdir(), "agents-"));
  try {
    mkdirSync(join(root, "agents"));
    writeFileSync(join(root, "agents", "a.md"), "---\nname: a\ndescription: does a\n---\nbody\n");
    writeFileSync(join(root, "agents", "nameless.md"), "---\ndescription: x\n---\n");
    writeFileSync(join(root, "agents", "README_ko.md"), "---\nname: readme\n---\n");
    const found = findAgentFiles(join(root, "agents"), 0, true).map((f) => f.split("/").pop());
    expect(found).toEqual(["a.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findMalformedRegistryRows reports rows that are not 8 columns", () => {
  const md = [
    "## Registry",
    "| script | source | version | status | removal-date | security-advisory | layer | pair |",
    "|---|---|---|---|---|---|---|---|",
    "| `ok.ts` | L0 | 1.0.0 | active | — | — | L0+L1 | — |",
    "| `bad.ts` | L0 | 1.0.0 | active | — | — | L0 | L0+L1 | — |",
    "",
    "## Next",
    "| `ignored.ts` | x |",
  ].join("\n");
  expect(findMalformedRegistryRows(md)).toEqual([{ script: "bad.ts", columns: 9 }]);
});
