// Committee-registry projection pin (review F-3): procedures/_committees.yaml
// is the SSOT and app/web-next/lib/committee-registry.generated.ts is its
// generated projection. Before 2026-11-22 the projection had no generator and
// no gate — the ADR-0202 description rewording (05424622) landed in the YAML
// while the projection silently kept the pre-amendment wording. These tests
// pin generated-vs-YAML equality (mirroring the i18n-lint / platform-parity
// real-tree pattern) and the generator's determinism; the audit-variant
// PROJECTION_GENERATORS gate (v1.12.0) enforces the same freshness outside
// the unit suite.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const YAML_PATH = join(PROJECT_ROOT, "procedures", "_committees.yaml");
const OUT_PATH = join(PROJECT_ROOT, "app", "web-next", "lib", "committee-registry.generated.ts");

const { buildCommitteeRegistrySource } = await import("../../scripts/co-newbiz/generate-committee-registry.ts");

const normalize = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

describe("committee-registry projection (F-3)", () => {
  test("the committed projection equals the generator output for the current YAML", () => {
    const generated = buildCommitteeRegistrySource(readFileSync(YAML_PATH, "utf8"));
    expect(normalize(readFileSync(OUT_PATH, "utf8"))).toBe(normalize(generated));
  });

  test("the generator is byte-stable across runs", () => {
    const yamlText = readFileSync(YAML_PATH, "utf8");
    expect(buildCommitteeRegistrySource(yamlText)).toBe(buildCommitteeRegistrySource(yamlText));
  });

  test("a YAML edit changes the projection (the pin is sensitive, not vacuous)", () => {
    const yamlText = readFileSync(YAML_PATH, "utf8");
    // replaceAll: "rounds: 2" also appears in the YAML's prose header comment,
    // which the generator (correctly) ignores — the edit must reach the data.
    const edited = yamlText.replaceAll("rounds: 2", "rounds: 3");
    expect(edited).not.toBe(yamlText); // the sensitivity premise holds today
    expect(buildCommitteeRegistrySource(edited)).not.toBe(buildCommitteeRegistrySource(yamlText));
  });

  test("the projection carries every committee key from the YAML", () => {
    // Structural sanity beyond string equality: the runtime registry must
    // expose exactly the committees the SSOT declares.
    const generated = readFileSync(OUT_PATH, "utf8");
    for (const key of [
      "route-steering-committee",
      "target-longlist-shortlist-committee",
      "entity-ic-committee",
      "group-ic-committee",
    ]) {
      expect(generated).toContain(`"${key}"`);
    }
  });
});
