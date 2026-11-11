// s6.universe_criteria_draft prompt — DEC-20261111-05 / design
// 2026-11-11-s6-universe-viability-criteria §3 (Rows 1+ test plan §9.1).
// The rewritten prompt asks the profitability question: the output schema
// gains the `viability` field, technical-capability framing is prohibited as
// a scope/viability criterion, and the honest-unset form (`검증 필요` + the
// named missing data) is mandated when the evidence shows no profit pool.
// The D3 machine bar (closed 5-section skeleton, Hangul confined to
// # Language, ONE-JSON stated) is re-asserted here structurally so a prompt
// edit that breaks it fails the unit suite, not just the codegen script; the
// full system string is snapshotted so any future edit is deliberate.
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

describe("s6.universe_criteria_draft — viability axis (DEC-20261111-05)", () => {
  test("output contract schema carries viability between size and rationale", () => {
    expect(s6.system).toContain('{"criteria":{"industry":"","region":"","size":"","viability":"","rationale":""}}');
    // No legacy four-field schema line survives anywhere in the prompt.
    expect(s6.system).not.toContain('{"criteria":{"industry":"","region":"","size":"","rationale":""}}');
  });

  test("the technical-capability prohibition decision rule is present (design §3.2)", () => {
    expect(s6.system).toContain(
      "Never state a technical-capability, certification, or track-record condition as a scope criterion or as the viability condition",
    );
    // The demotion rationale says where capability fit IS judged (design §3.4).
    expect(s6.system).toContain("capability fit is judged per candidate at the screening stage");
  });

  test("the unverifiable-form instruction is present (honest unset, design §3.1)", () => {
    expect(s6.system).toContain("write the viability condition as unverifiable");
    expect(s6.system).toContain("name the specific data that would verify it");
    expect(s6.system).toContain("the value-chain stage financials of the relevant node");
  });

  test("per-claim version/grade citation rule is present (design §2 constraint 4)", () => {
    expect(s6.system).toContain("cite the version and the confidence grade of every figure you rely on");
  });

  test("viability is defined by the three profitability lenses (design §3.1)", () => {
    expect(s6.system).toContain("the profit pool of the segment");
    expect(s6.system).toContain("the margin structure");
    expect(s6.system).toContain("the pricing power of the value-chain stage");
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

  test("snapshot — the full system prompt is deliberate (design §9.1)", () => {
    expect(s6.system).toMatchSnapshot();
  });

  test("purpose names the viability axis (registry purpose line)", () => {
    expect(s6.purpose).toContain("수익성");
    expect(s6.agent).toBe("brownfield-agent");
  });
});
