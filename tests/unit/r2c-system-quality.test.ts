// @version 1.1.0
// R2-C system quality: synthetic/degenerate value helpers (item 7), the glossary-backed label map
// (item 8), the design-lint rule that rejects a class-less <button> (item 5), and the design-lint
// styles.css font-size floor rule v1.5.0 (Wave U-2): sub-floor and body-range non-token literals
// fail, token-equal 0.875rem passes, em-relative is report-only.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { closureRecordKeyOf } from "../../app/web-next/lib/label-keys.ts";

// i18n re-pin (T3-6): ko stub translator for catalog-key assertions.
const koCatalog = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], koCatalog) as string;
import { join } from "node:path";
import {
  formatPctOrNa, formatUsdBOrNa, isDegeneratePct, isDegenerateSize, isSyntheticSizing, NOT_COMPUTABLE_TEXT,
} from "../../app/web-next/lib/synthetic-value.ts";
import {
  localizeMessage, localizeRequirement,
} from "../../app/web-next/lib/labels.ts";

describe("synthetic and degenerate values", () => {
  test("a version with any non-LLM step is synthetic; all-LLM or frozen research is not", () => {
    expect(isSyntheticSizing([{ source: "llm" }, { source: "synthesis" }])).toBe(true);
    expect(isSyntheticSizing([{ source: "llm" }, { source: "llm" }])).toBe(false);
    expect(isSyntheticSizing(null)).toBe(false);
    expect(isSyntheticSizing([])).toBe(false);
  });

  test("CAGR -100% and $0 read as 산정 불가, real values keep their number", () => {
    expect(isDegeneratePct(-100)).toBe(true);
    expect(isDegeneratePct(Number.NaN)).toBe(true);
    expect(isDegeneratePct(null)).toBe(true);
    expect(isDegeneratePct(-12.5)).toBe(false);
    expect(formatPctOrNa(-100)).toBe(NOT_COMPUTABLE_TEXT);
    expect(formatPctOrNa(12.34)).toBe("12.3%");
    expect(isDegenerateSize(0)).toBe(true);
    expect(formatUsdBOrNa(0)).toBe(NOT_COMPUTABLE_TEXT);
    expect(formatUsdBOrNa(1234.4)).toBe("$1,234B");
  });
});

describe("label map", () => {
  test("gates and decisions have Korean labels and unknown keys fall back to themselves", () => {
    // i18n re-pin (T3-6): gate names resolve through common.gate.* ko catalog values.
    expect(JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")).common.gate.entity_ic).toContain("투자심의");
    expect(tr("common.decisionLabel.kill")).toContain("중단");
    // i18n re-pin (T3-6): closure record keys resolve common.closureRecord.* via closureRecordKeyOf
    expect(tr(closureRecordKeyOf("gate_decision(kill)")!.label)).not.toContain("gate_decision");
    expect(closureRecordKeyOf("something_new")).toBeNull();
  });

  test("system jargon is rewritten for readers", () => {
    expect(localizeMessage("LLM provider is not configured (CO_NEWBIZ_LLM_PROVIDER/API_KEY/MODEL).")).not.toMatch(/LLM provider|CO_NEWBIZ/);
    expect(localizeMessage("HOLD 결정에는 missing_artifacts(미완료 산출물 목록)가 필요합니다.")).not.toContain("missing_artifacts");
    expect(localizeRequirement("설립 실행 기록 (origin∈{internal,joint})")).not.toContain("∈");
    expect(localizeMessage("이미 한글인 문장")).toBe("이미 한글인 문장");
    expect(koCatalog.common.viewerReadOnly).toBe("보기 권한만 있습니다");
  });
});

describe("design-lint: class-less <button>", () => {
  const fixture = join(import.meta.dirname, "..", "..", "app", "web-next", "components", "zz-lint-fixture-tmp.tsx");
  const run = () => Bun.spawnSync([process.execPath, "scripts/co-newbiz/design-lint.ts"], { cwd: join(import.meta.dirname, "..", "..") });

  test("a button without className fails, with className or a spread passes, a handler arrow does not hide it", () => {
    try {
      writeFileSync(fixture, `export const A = () => <button type="button" onClick={() => go()}>x</button>;\n`);
      const bad = run();
      expect(bad.exitCode).toBe(1);
      expect(bad.stderr.toString()).toContain("zz-lint-fixture-tmp.tsx:1: <button> without a design class");

      writeFileSync(fixture, `export const A = () => <button type="button" onClick={() => go()} className="btn-ghost">x</button>;\nexport const B = (p: object) => <button {...p}>y</button>;\n`);
      expect(run().exitCode).toBe(0);
    } finally {
      if (existsSync(fixture)) rmSync(fixture);
    }
  });
});

describe("design-lint: styles.css font-size floor (Wave U-2 rule 6, v1.5.0)", () => {
  const cssPath = join(import.meta.dirname, "..", "..", "app", "web-next", "app", "styles.css");
  const run = () => Bun.spawnSync([process.execPath, "scripts/co-newbiz/design-lint.ts"], { cwd: join(import.meta.dirname, "..", "..") });

  test("sub-floor and body-range non-token literals fail, token-equal 0.875rem passes, em-relative is report-only", () => {
    const original = readFileSync(cssPath, "utf8");
    try {
      // negative proof (design-lint rule 6): the lint reads app/styles.css by path,
      // so the synthetic literals are appended to (and restored from) the real file.
      writeFileSync(cssPath, original + [
        ".zz-lint-floor-tmp { font-size: 0.72rem; }",
        ".zz-lint-band-tmp { font-size: 0.92rem; }",
        ".zz-lint-token-tmp { font-size: 0.875rem; }",
        ".zz-lint-em-tmp { font-size: 0.8em; }",
        "",
      ].join("\n"));
      const bad = run();
      expect(bad.exitCode).toBe(1);
      const err = bad.stderr.toString();
      expect(err).toContain('.zz-lint-floor-tmp" font-size 0.72rem is below the 14px floor');
      expect(err).toContain('.zz-lint-band-tmp" font-size 0.92rem is a body-range non-token literal');
      expect(err).not.toContain("zz-lint-token-tmp"); // 0.875rem is token-equal (--fs-body) — sanctioned
      expect(bad.stdout.toString()).toContain('.zz-lint-em-tmp" font-size 0.8em is em-relative'); // report-only

      // the token-equal literal alone must not fail the run (doctrine: sanctioned until tokenized)
      writeFileSync(cssPath, original + "\n.zz-lint-token-tmp { font-size: 0.875rem; }\n");
      expect(run().exitCode).toBe(0);
    } finally {
      writeFileSync(cssPath, original);
    }
  });
});
