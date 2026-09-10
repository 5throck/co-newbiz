import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { validateRunbookRegistry } from "../../scripts/co-newbiz/runbook-validate.ts";

// The runbook registry (docs/runbooks/registry.yaml) is the managed list of
// playbooks / guidelines / manuals. The suite enforces its hygiene so a doc
// cannot be added, moved, or dropped without the registry and the library
// projection moving with it.
const ROOT = join(import.meta.dirname, "..", "..");

describe("runbook registry hygiene", () => {
  test("registry, filesystem, and library projection are consistent", () => {
    const issues = validateRunbookRegistry(ROOT);
    expect(issues).toEqual([]);
  });

  test("covers the three documentation layers", () => {
    const registryPath = join(ROOT, "docs", "runbooks", "registry.yaml");
    expect(existsSync(registryPath)).toBe(true);
    const registry = yaml.load(readFileSync(registryPath, "utf8")) as {
      entries: Array<{ layer: string; id: string }>;
    };
    const layers = new Set(registry.entries.map((e) => e.layer));
    expect(layers.has("runbook")).toBe(true);
    expect(layers.has("guideline")).toBe(true);
    expect(layers.has("manual")).toBe(true);
  });
});
