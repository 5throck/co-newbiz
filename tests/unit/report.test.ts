// @version 1.0.0
/**
 * Unit tests for the report renderer (scripts/co-newbiz/report.ts ->
 * python/report/{mdast,theme,glossary_appendix,render_docx,render_pdf,
 * render_hwpx}.py), design v1.0 sections 3-3 and 4-8. Runs the real Python
 * renderers against the Korean fixture tests/fixtures/report-sample.ko.md.
 *
 * The count figures below were hand-verified against the fixture before
 * being encoded (verify-then-encode): 3 headings + glossary heading = 5,
 * 8 paragraphs incl. appendix intro, 2 tables (financial + glossary),
 * 6 bullets, and 4 matched glossary terms (Covenant via "재무약정", DSCR,
 * Proxy Chain via "프록시 체인", WACC).
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReport } from "../../scripts/co-newbiz/report.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "report-sample.ko.md");

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "co-newbiz-report-"));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

test("all three formats render with identical AST counts — the shared-AST promise", async () => {
  const results = await renderReport(FIXTURE, ["docx", "pdf", "hwpx"], { outDir });
  expect(results).toHaveLength(3);
  for (const r of results) {
    expect(r.headings).toBe(5);
    expect(r.paragraphs).toBe(8);
    expect(r.tables).toBe(2);
    expect(r.bullets).toBe(6);
  }
}, 20000);

test("glossary appendix matched the 4 fixture terms in every format", async () => {
  const results = await renderReport(FIXTURE, ["docx", "pdf", "hwpx"], { outDir });
  for (const r of results) {
    expect(r.glossary_terms).toBe(4);
  }
}, 20000);

test("docx output is a real ZIP container with the Malgun Gothic family", async () => {
  const [docx] = await renderReport(FIXTURE, ["docx"], { outDir });
  expect(docx.format).toBe("docx");
  expect(existsSync(docx.output)).toBe(true);
  expect(readFileSync(docx.output).subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // "PK"
  expect(docx.font).toBe("Malgun Gothic");
  expect(docx.font_source).toBe("windows-system");
}, 20000);

test("pdf output is a real PDF with the Korean TTF pair embedded", async () => {
  const [pdf] = await renderReport(FIXTURE, ["pdf"], { outDir });
  const raw = readFileSync(pdf.output);
  expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
  // Embedded font programs (regular + bold at minimum) — a Helvetica-only
  // fallback would have none, which is exactly the "tofu PDF" failure mode.
  const fontFileCount = raw.reduce(
    (acc, _b, i) => acc + (raw.subarray(i, i + 8).toString() === "FontFile" ? 1 : 0),
    0,
  );
  expect(fontFileCount).toBeGreaterThanOrEqual(2);
}, 20000);

test("hwpx output is a ZIP container and passes OWPML schema validation", async () => {
  const [hwpx] = await renderReport(FIXTURE, ["hwpx"], { outDir });
  expect(readFileSync(hwpx.output).subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  expect(hwpx.validation).toBe("PASS");
}, 20000);

test("--no-glossary renders without the appendix", async () => {
  const [docx] = await renderReport(FIXTURE, ["docx"], { outDir, noGlossary: true });
  expect(docx.glossary_terms).toBe(0);
  expect(docx.tables).toBe(1); // financial table only
}, 20000);

test("a missing Markdown file rejects with a clear error", async () => {
  await expect(renderReport("tests/fixtures/does-not-exist.md", ["docx"], { outDir })).rejects.toThrow(
    /not found/,
  );
});

test("an unsupported format rejects before spawning Python", async () => {
  await expect(renderReport(FIXTURE, ["pptx" as never], { outDir })).rejects.toThrow(
    /Unsupported report format/,
  );
});
