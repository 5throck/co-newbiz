// @version 1.0.0
/** Admin console helpers: code-to-label key normalisation, ADR status parsing, list search matching. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error --jsx is not set in the root tsconfig program; the module itself is type-checked under app/web-next
import { adrStatusCode, labelKeyOf, matchesQuery } from "../../app/web-next/components/admin/console/admin-ui.tsx";

const ROOT = join(import.meta.dirname, "../../app/web-next");
const ko = JSON.parse(readFileSync(join(ROOT, "locales/ko.json"), "utf8"));

describe("labelKeyOf", () => {
  test("dots and dashes become underscores so audit codes and agent ids resolve", () => {
    expect(labelKeyOf("business_case.delete")).toBe("business_case_delete");
    expect(labelKeyOf(" process-governance-manager ")).toBe("process_governance_manager");
    expect(labelKeyOf("login")).toBe("login");
  });
  test("every audit action seen in the log has a catalog label", () => {
    const labels = ko.admin.labels.action as Record<string, string>;
    for (const code of ["login", "logout", "password_change", "business_case.delete", "review_claim_ack.recorded", "archive_list", "market_sizing_analysis.rerun"]) {
      expect(labels[labelKeyOf(code)]).toBeTruthy();
    }
  });
});

describe("adrStatusCode", () => {
  test("reads the leading word of free-form ADR status prose", () => {
    expect(adrStatusCode("Accepted")).toBe("accepted");
    expect(adrStatusCode("Accepted — 2026-08-26, retroactively, after Phases 0-6")).toBe("accepted");
    expect(adrStatusCode("Proposed — implementation landed in the same change")).toBe("proposed");
    expect(adrStatusCode("Unknown")).toBe("unknown");
  });
  test("anything else is 'other', never the raw text", () => {
    expect(adrStatusCode("Draft")).toBe("other");
    expect(adrStatusCode("")).toBe("other");
    expect(adrStatusCode(null)).toBe("other");
  });
});

describe("matchesQuery", () => {
  test("empty query matches everything", () => {
    expect(matchesQuery("  ", "anything")).toBe(true);
  });
  test("every term must appear in some field, case-insensitively", () => {
    expect(matchesQuery("alice 분석", "alice", "Alice K", "분석가")).toBe(true);
    expect(matchesQuery("alice 열람", "alice", "Alice K", "분석가")).toBe(false);
    expect(matchesQuery("x", null, undefined)).toBe(false);
  });
});
