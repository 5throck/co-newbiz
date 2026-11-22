// Prompt-registry projection pin (review F-19): app/web-next/prompts/prompts.json
// is the SSOT and app/web-next/lib/prompts.generated.ts is its generated
// projection. Until 2026-11-23 the generator had no --check and no blocking
// caller — the deep-equality test in prompt-registry.test.ts was the only net
// and ran in the CI unit job only, so a prompts.json edit that skipped
// regeneration passed /sync locally and failed late. These tests pin
// generated-vs-SSOT equality and the generator's determinism (mirroring the
// committee-registry-projection pattern); the audit-variant
// PROJECTION_GENERATORS gate (v1.13.0) enforces the same freshness outside the
// unit suite via generate-prompt-registry.ts --check.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const SSOT_PATH = join(PROJECT_ROOT, "app", "web-next", "prompts", "prompts.json");
const OUT_PATH = join(PROJECT_ROOT, "app", "web-next", "lib", "prompts.generated.ts");

const { buildPromptRegistrySource, validatePromptEntries, collectSentenceWarnings } = await import(
  "../../scripts/co-newbiz/generate-prompt-registry.ts"
);
import type { PromptEntry } from "../../scripts/co-newbiz/generate-prompt-registry.ts";

const ssot = JSON.parse(readFileSync(SSOT_PATH, "utf8")) as { prompts: PromptEntry[] };
const normalize = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

describe("prompt-registry projection (F-19)", () => {
  test("the committed projection equals the generator output for the current SSOT", () => {
    expect(normalize(readFileSync(OUT_PATH, "utf8"))).toBe(normalize(buildPromptRegistrySource(ssot.prompts)));
  });

  test("the generator is byte-stable across runs", () => {
    expect(buildPromptRegistrySource(ssot.prompts)).toBe(buildPromptRegistrySource(ssot.prompts));
  });

  test("an SSOT edit changes the projection (the pin is sensitive, not vacuous)", () => {
    const edited = ssot.prompts.map((p) =>
      p.key === "pm.query_classify" ? { ...p, purpose: `${p.purpose} (edited)` } : p,
    );
    expect(edited).not.toEqual(ssot.prompts); // the sensitivity premise holds today
    expect(buildPromptRegistrySource(edited)).not.toBe(buildPromptRegistrySource(ssot.prompts));
  });

  test("the current SSOT passes the D3 machine bar and the advisory stays advisory", () => {
    // validatePromptEntries THROWS on a machine-bar violation (the CLI maps the
    // throw to stderr + exit 1) — the live SSOT must sail through.
    expect(() => validatePromptEntries(ssot.prompts)).not.toThrow();
    // The >25-word sentence heuristic is advisory: collected, never thrown.
    const warnings = ssot.prompts.flatMap((p) => collectSentenceWarnings(p.key, p.system));
    expect(Array.isArray(warnings)).toBeTrue();
  });

  test("a machine-bar violation throws (a key losing its markers cannot project)", () => {
    const broken = ssot.prompts.map((p) =>
      p.key === "pm.query_classify" ? { ...p, system: p.system.replace("# Task", "") } : p,
    );
    expect(() => validatePromptEntries(broken)).toThrow(/missing required section marker/);
  });
});
