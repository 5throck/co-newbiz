/**
 * tests/unit/env-drift.test.ts — the pure drift classifier (design
 * 2026-11-13-env-single-source §3.4A). collectEnvDrift parses two .env texts
 * and classifies SSOT-key overlap: divergent (FAIL), duplicate (WARN),
 * whitespace (WARN). Non-SSOT keys must never be flagged — the guard must not
 * false-positive on tooling keys an operator adds (DATABASE_URL in both files,
 * for instance). Values never appear in the report.
 */
import { describe, expect, test } from "bun:test";
import { collectEnvDrift } from "../../scripts/lib/env-drift.ts";

describe("collectEnvDrift (design 2026-11-13-env-single-source §3.4A)", () => {
  test("flags a divergent SSOT key as a failure entry", () => {
    const report = collectEnvDrift("CO_NEWBIZ_LLM_MODEL=model-a\n", "CO_NEWBIZ_LLM_MODEL=model-b\n");
    expect(report.divergent).toEqual(["CO_NEWBIZ_LLM_MODEL"]);
    expect(report.duplicate).toEqual([]);
    expect(report.whitespace).toEqual([]);
  });

  test("flags an identical SSOT duplicate as a warning entry, not a divergence", () => {
    const report = collectEnvDrift("CO_NEWBIZ_DD_TAILOR_AGENTS=llm\n", "CO_NEWBIZ_DD_TAILOR_AGENTS=llm\n");
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual(["CO_NEWBIZ_DD_TAILOR_AGENTS"]);
  });

  test("a whitespace-only difference normalizes to a duplicate, not a divergence", () => {
    // The exact migration shape: the trailing space no reader ever propagated.
    const report = collectEnvDrift(
      "CO_NEWBIZ_LLM_PROVIDER=openai-compatible\n",
      "CO_NEWBIZ_LLM_PROVIDER=openai-compatible \n",
    );
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual(["CO_NEWBIZ_LLM_PROVIDER"]);
    // ...while the on-disk whitespace itself is reported for hygiene.
    expect(report.whitespace).toEqual([{ file: "app", key: "CO_NEWBIZ_LLM_PROVIDER" }]);
  });

  test("disjoint files produce an empty report", () => {
    const report = collectEnvDrift("TAVILY_API_KEY=t\n", "DATABASE_URL=file:/tmp/x.db\n");
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual([]);
    expect(report.whitespace).toEqual([]);
  });

  test("an empty app file (fresh clone) produces an empty report", () => {
    const report = collectEnvDrift("TAVILY_API_KEY=t\nCO_NEWBIZ_DB_PATH=/x\n", "");
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual([]);
    expect(report.whitespace).toEqual([]);
  });

  test("a commented line is invisible: only active definitions count", () => {
    const report = collectEnvDrift(
      "CO_NEWBIZ_LLM_MODEL=model-a\n",
      "# CO_NEWBIZ_LLM_MODEL=model-b\nCO_NEWBIZ_LLM_BASE_URL=https://x\n",
    );
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual([]);
  });

  test("non-SSOT keys are ignored even when defined in both files", () => {
    // DATABASE_URL is the legitimate app-file remnant; a tooling key added on
    // both sides must not fail the gate (design §3.4C).
    const report = collectEnvDrift(
      "DATABASE_URL=file:/a.db\nCO_NEWBIZ_DIST_DIR=.next\n",
      "DATABASE_URL=file:/b.db\nCO_NEWBIZ_DIST_DIR=.next\n",
    );
    expect(report.divergent).toEqual([]);
    expect(report.duplicate).toEqual([]);
  });

  test("detects unquoted trailing whitespace in either file, exempting quotes and inline comments", () => {
    const report = collectEnvDrift(
      `${[
        "CO_NEWBIZ_LLM_MODEL=gpt-6.1-terra ", // trailing space — flagged (root)
        'KOSIS_API_KEY="lit ws "', // quoted, short value — whitespace is literal, exempt
        "TAVILY_API_KEY=value  # inline comment", // comment separation, exempt
      ].join("\n")}\n`,
      `${[
        "CO_NEWBIZ_LLM_BASE_URL=https://api.example.com/v1 ", // flagged (app)
        "DART_API_KEY=clean",
      ].join("\n")}\n`,
    );
    expect(report.whitespace).toEqual([
      { file: "root", key: "CO_NEWBIZ_LLM_MODEL" },
      { file: "app", key: "CO_NEWBIZ_LLM_BASE_URL" },
    ]);
    expect(report.divergent).toEqual([]);
  });

  test("non-SSOT keys with whitespace are ignored (false-positive guard)", () => {
    const report = collectEnvDrift("DATABASE_URL=file:/a.db \n", "");
    expect(report.whitespace).toEqual([]);
  });

  test("detects leading whitespace on an unquoted value", () => {
    const report = collectEnvDrift(" CO_NEWBIZ_DB_PATH=/x\n", "");
    // The line regex requires the key at line start, so a leading space hides
    // the whole line — the flag must come from the VALUE side, not the key.
    expect(report.whitespace).toEqual([]);
    const withValueSpace = collectEnvDrift("CO_NEWBIZ_LLM_MODEL=  gpt\n", "");
    expect(withValueSpace.whitespace).toEqual([{ file: "root", key: "CO_NEWBIZ_LLM_MODEL" }]);
  });

  test("the report never carries values", () => {
    const report = collectEnvDrift("CO_NEWBIZ_LLM_API_KEY=sk-secret-root\n", "CO_NEWBIZ_LLM_API_KEY=sk-secret-app\n");
    expect(JSON.stringify(report)).not.toContain("sk-secret");
  });
});
