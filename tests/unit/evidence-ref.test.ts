/**
 * Unit tests for db/lib/evidence-ref.ts — the v1.1 citation vocabulary
 * (ADR-0058 §2). Pure function matrix: the repository-layer gate in
 * dimension-input.repository.ts is covered in dimension-input-write.test.ts;
 * this file pins the validator itself so the vocabulary cannot drift
 * independently of its enforcement point.
 */
import { test, describe, expect } from "bun:test";
import { isValidEvidenceRef, EVIDENCE_REF_SHAPES } from "../../db/lib/evidence-ref.ts";

describe("isValidEvidenceRef", () => {
  test("accepts each documented shape", () => {
    expect(isValidEvidenceRef("doc:01ABCDEF")).toBe(true);
    expect(isValidEvidenceRef("doc:cim-2026-08-01")).toBe(true);
    expect(isValidEvidenceRef("src:KIS-2025")).toBe(true);
    expect(isValidEvidenceRef("https://example.com/cim#p12")).toBe(true);
  });

  test("rejects free-text citations (the unauditable shapes v1.1 retires)", () => {
    expect(isValidEvidenceRef("cim.pdf#p12")).toBe(false);
    expect(isValidEvidenceRef("expert-interview-3")).toBe(false);
    expect(isValidEvidenceRef("KIS-2025")).toBe(false);
    expect(isValidEvidenceRef("x")).toBe(false);
  });

  test("rejects empty and whitespace-only refs", () => {
    expect(isValidEvidenceRef("")).toBe(false);
    expect(isValidEvidenceRef("   ")).toBe(false);
  });

  test("rejects bare prefixes (pointer with nothing pointed at)", () => {
    expect(isValidEvidenceRef("doc:")).toBe(false);
    expect(isValidEvidenceRef("src:")).toBe(false);
    expect(isValidEvidenceRef("https://")).toBe(false);
  });

  test("rejects internal whitespace — a citation is one token, not a sentence", () => {
    expect(isValidEvidenceRef("doc:a b")).toBe(false);
    expect(isValidEvidenceRef("src:KIS 2025")).toBe(false);
    expect(isValidEvidenceRef("https://example.com/a b")).toBe(false);
  });

  test("rejects plain http — v1.1 keeps exactly one external shape", () => {
    expect(isValidEvidenceRef("http://example.com/cim")).toBe(false);
    expect(isValidEvidenceRef("ftp://example.com/cim")).toBe(false);
  });

  test("the exported shapes list stays the three documented members", () => {
    expect(EVIDENCE_REF_SHAPES).toEqual(["doc:<document-id>", "src:<md_source.code>", "https://<url>"]);
  });
});
