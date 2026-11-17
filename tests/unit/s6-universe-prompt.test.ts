// s6.universe_criteria_draft@3 prompt — design 2026-11-17-s6-universe-direction-review
// §4.2 (supersedes the DEC-20261111-05 viability schema). The output contract is
// the structured direction (`rationale` removed), the capability rule is an
// output rule, and growth figures are basis-only. The D3 machine bar (closed
// 5-section skeleton, Hangul confined to # Language, ONE-JSON stated) is
// re-asserted structurally so a prompt edit that breaks it fails the unit
// suite, not just the codegen script; the full system string is snapshotted so
// any future edit is deliberate.
import { describe, expect, test } from "bun:test";
import { PROMPTS } from "../../app/web-next/lib/prompts.generated.ts";

const s6 = PROMPTS["s6.universe_criteria_draft"];

/** The closed 5-section skeleton, in the mandated order (generate-prompt-registry
 * SECTION_MARKERS — the same set the D3 machine bar enforces). */
const SECTION_MARKERS = [
  "# Evidence boundary",
  "# Task",
  "# Output contract",
  "# Language",
  "# Proposal-only disclaimer",
] as const;

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;

describe("s6.universe_criteria_draft@3 — evaluation target direction (design 2026-11-17)", () => {
  test("output contract is the structured direction schema; rationale is gone", () => {
    expect(s6.system).toContain(
      '{"direction":{"headline":{"text":"","refs":[]},"scope":{"industry":{"text":"","refs":[]},"region":{"text":"","refs":[]},"size":{"text":"","refs":[]}},"value_chain":{"text":"","refs":[]},"prioritise":[{"type":"","why":"","refs":[]}],"exclude":[{"type":"","why":"","refs":[]}],"basis":{"text":"","refs":[]}}}',
    );
    expect(s6.system).not.toContain("rationale");
    expect(s6.system).not.toContain('"criteria"');
    expect(s6.system).not.toContain("viability");
  });

  test("the catalog-citation and exact-number rules are present", () => {
    expect(s6.system).toContain("Cite catalog ids only");
    expect(s6.system).toContain("Copy every number exactly as it appears in the cited item");
    expect(s6.system).toContain("Never name source stages in visible text");
  });

  test("the capability rule is an output rule (scope/exclude never, prioritise as a preference)", () => {
    expect(s6.system).toContain(
      "No scope sentence and no exclude item names a capability, certification, or track-record condition",
    );
    expect(s6.system).toContain("A prioritise item may name a required capability as a preference");
    expect(s6.system).not.toMatch(/report (compliance|that you)/i);
  });

  test("growth figures are basis-only", () => {
    expect(s6.system).toContain("Growth-rate and projection items may be cited only in the basis");
  });

  test("length limits are stated in the output contract", () => {
    expect(s6.system).toContain("headline 90, each scope sentence 120, value_chain 100, type 60, why 80, basis 140");
  });

  test("machine bar: closed 5-section skeleton, exactly once each, in order", () => {
    for (const marker of SECTION_MARKERS) {
      expect(s6.system.indexOf(marker)).toBe(s6.system.lastIndexOf(marker));
      expect(s6.system.includes(marker)).toBeTrue();
    }
    let at = -1;
    for (const marker of SECTION_MARKERS) {
      const next = s6.system.indexOf(marker);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    // Closed heading vocabulary — no undeclared "# ..." heading anywhere.
    for (const line of s6.system.split("\n")) {
      if (/^#\s+\S/.test(line)) expect(SECTION_MARKERS as readonly string[]).toContain(line.trim());
    }
  });

  test("machine bar: Hangul only inside the # Language section", () => {
    const languageAt = s6.system.indexOf("# Language");
    const disclaimerAt = s6.system.indexOf("# Proposal-only disclaimer");
    expect(languageAt).toBeGreaterThan(-1);
    expect(disclaimerAt).toBeGreaterThan(languageAt);
    expect(s6.system.slice(0, languageAt)).not.toMatch(HANGUL_RE);
    expect(s6.system.slice(disclaimerAt)).not.toMatch(HANGUL_RE);
    // The unverified marker itself is pinned ONLY in # Language and referenced
    // by indirection elsewhere (design §3.2 compliance note b).
    expect(s6.system.slice(0, languageAt)).not.toContain("검증 필요");
    expect(s6.system.slice(languageAt, disclaimerAt)).toContain("검증 필요");
  });

  test("machine bar: ONE-JSON and no-code-fence stated in # Output contract", () => {
    const contract = s6.system.slice(s6.system.indexOf("# Output contract"), s6.system.indexOf("# Language"));
    expect(contract).toMatch(/one json/i);
    expect(contract).toContain("code fence");
  });

  test("snapshot — the full system prompt is deliberate", () => {
    expect(s6.system).toMatchSnapshot();
  });

  test("purpose names the evaluation target direction (registry purpose line)", () => {
    expect(s6.purpose).toContain("평가 대상 방향성");
    expect(s6.agent).toBe("brownfield-agent");
  });
});
