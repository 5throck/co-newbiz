// @version 1.0.0
/**
 * Adapter gate behavior on fixtures. Scripted candidate rewrites stand in for
 * the LLM step; the deterministic gates (upstream scripts + anchor gate) are real.
 * Needs the pinned clone (external/humanize); skipped when it is absent — the
 * contract test is what fails closed on a missing clone.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, doctor, finalizeRun, prepareRun, type AdapterConfig } from "../humanize-adapter";
import {
  ANCHOR_ACRONYM_CHANGED,
  ANCHOR_DATE_CHANGED,
  ANCHOR_NUMBER_CHANGED,
  ANCHOR_STATUTE_DROPPED,
  ORIGINAL_PARAGRAPH,
  paragraph,
  twoUnitDocument,
} from "./fixtures/korean";

const base = defaultConfig();
const usable = doctor(base).ok;
let tmp = "";
let cfg: AdapterConfig;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "humanize-test-"));
  cfg = { ...base, tmpBase: join(tmp, "runs") };
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Prepare a one-paragraph document, write the candidate as the model output, finalize. */
function runOne(candidate: string | null) {
  const doc = ORIGINAL_PARAGRAPH + "\n";
  const prep = prepareRun({ text: doc, kind: "report", originPath: "docs/x_ko.md", config: cfg });
  if (prep.status !== "prepared") throw new Error(`prepare failed: ${prep.status === "not_polished" ? prep.reason : ""}`);
  if (candidate !== null) writeFileSync(join(prep.runDir, "units", "001", "final.md"), candidate + "\n");
  const fin = finalizeRun({ runDir: prep.runDir, keep: true, config: cfg });
  const proposal = readFileSync(fin.proposalPath, "utf8");
  const report = JSON.parse(readFileSync(join(fin.outDir, "report.json"), "utf8"));
  return { fin, proposal, report, doc };
}

describe.skipIf(!usable)("finalize gates", () => {
  test("a mild rewrite is adopted", () => {
    const cand = paragraph({ rewritten: 2 });
    const { fin, proposal, report } = runOne(cand);
    expect(fin.exitCode).toBe(0);
    expect(report.units[0].status).toBe("adopted");
    expect(proposal.trim()).toBe(cand);
  });

  test("a 30 to 50 percent rewrite is adopted with the warning recorded", () => {
    const { fin, report } = runOne(paragraph({ rewritten: 9 }));
    expect(report.units[0].status).toBe("adopted_with_warning");
    expect(report.units[0].changeRate).toBeGreaterThanOrEqual(0.3);
    expect(report.units[0].changeRate).toBeLessThan(0.5);
    expect(fin.exitCode).toBe(1);
  });

  test("a rewrite of 50 percent or more is rolled back", () => {
    const { fin, proposal, report, doc } = runOne(paragraph({ rewritten: 9, heavy: true }));
    expect(report.units[0].status).toBe("rolled_back");
    expect(report.units[0].reasons).toContain("change-rate-over-limit");
    expect(proposal).toBe(doc);
    expect(fin.exitCode).toBe(2);
  });

  test.each([
    ["number", ANCHOR_NUMBER_CHANGED],
    ["date", ANCHOR_DATE_CHANGED],
    ["statute reference", ANCHOR_STATUTE_DROPPED],
    ["acronym", ANCHOR_ACRONYM_CHANGED],
  ])("a changed %s rolls the unit back", (_name, anchor) => {
    const { proposal, report, doc } = runOne(paragraph({ rewritten: 2, anchor }));
    expect(report.units[0].status).toBe("rolled_back");
    expect(report.units[0].reasons).toContain("anchor-mismatch");
    expect(report.units[0].anchorDiffs.length).toBeGreaterThan(0);
    expect(proposal).toBe(doc);
  });

  test("empty model output keeps the original", () => {
    for (const out of [null, "   \n"]) {
      const { report, proposal, doc } = runOne(out);
      expect(report.units[0].status).toBe("kept_original");
      expect(proposal).toBe(doc);
    }
  });

  test("a model summary block is stripped from the deliverable text", () => {
    const cand = paragraph({ rewritten: 2 });
    const { proposal, report } = runOne(`${cand}\n\n<!-- HUMANIZE-SUMMARY\ngrade: A\n-->`);
    expect(proposal).not.toContain("HUMANIZE-SUMMARY");
    expect(report.units[0].selfReport).toContain("grade: A");
  });

  test("one bad unit and one good unit finalize as partial, protected blocks intact", () => {
    const doc = twoUnitDocument();
    const prep = prepareRun({ text: doc, kind: "report", originPath: "docs/x_ko.md", config: cfg });
    if (prep.status !== "prepared") throw new Error("prepare failed");
    expect(prep.units).toBe(2);
    writeFileSync(join(prep.runDir, "units", "001", "final.md"), paragraph({ rewritten: 2, anchor: ANCHOR_NUMBER_CHANGED }) + "\n");
    const second = readFileSync(join(prep.runDir, "units", "002", "00_original.txt"), "utf8");
    writeFileSync(join(prep.runDir, "units", "002", "final.md"), second.replace("별도의 단위로 다뤄진다", "따로 다뤄진다") + "\n");
    const fin = finalizeRun({ runDir: prep.runDir, keep: true, config: cfg });
    const report = JSON.parse(readFileSync(join(fin.outDir, "report.json"), "utf8"));
    expect(fin.exitCode).toBe(1);
    expect(report.status).toBe("partial");
    expect(report.units.map((u: { status: string }) => u.status)).toEqual(["rolled_back", "adopted"]);
    expect(report.protectedIdentical).toBe(true);
    const out = readFileSync(fin.proposalPath, "utf8");
    expect(out).toContain("| 규모 | 3.5조원 |");
    expect(out).toContain(ORIGINAL_PARAGRAPH); // bad unit left in the original wording
    expect(out).toContain("따로 다뤄진다");
  });

  test("the review note has the three sections and no bare approval wording", () => {
    const { fin } = runOne(paragraph({ rewritten: 2 }));
    const md = readFileSync(fin.reportPath, "utf8");
    expect(md).toContain("## Verified (deterministic)");
    expect(md).toContain("## Could not verify");
    expect(md).toContain("## Needs judgement");
    const couldNot = md.split("## Could not verify")[1].split("## Needs judgement")[0];
    expect(couldNot.trim().length).toBeGreaterThan(0);
    expect(/\bpolished\b/i.test(md)).toBe(false);
    expect(/\bpass(ed|es)?\b/i.test(md)).toBe(false);
    expect(/\bapprov/i.test(md)).toBe(false);
  });

  test("finalize on a clean run removes the work files and keeps the output", () => {
    const prep = prepareRun({ text: ORIGINAL_PARAGRAPH + "\n", kind: "report", config: cfg });
    if (prep.status !== "prepared") throw new Error("prepare failed");
    writeFileSync(join(prep.runDir, "units", "001", "final.md"), paragraph({ rewritten: 2 }) + "\n");
    const fin = finalizeRun({ runDir: prep.runDir, config: cfg });
    expect(fin.exitCode).toBe(0);
    expect(existsSync(join(prep.runDir, "units"))).toBe(false);
    expect(existsSync(fin.proposalPath)).toBe(true);
    expect(readFileSync(join(fin.outDir, "original.md"), "utf8")).toBe(ORIGINAL_PARAGRAPH + "\n");
  });

  test("prepare writes dispatch.json with absolute paths and the conservative instruction", () => {
    const prep = prepareRun({ text: ORIGINAL_PARAGRAPH + "\n", kind: "report", config: cfg });
    if (prep.status !== "prepared") throw new Error("prepare failed");
    const d = JSON.parse(readFileSync(join(prep.runDir, "dispatch.json"), "utf8"));
    expect(d.units[0].quick_rules_path.startsWith("/")).toBe(true);
    expect(d.units[0].input_path.startsWith("/")).toBe(true);
    expect(d.units[0].intensity_instruction.length).toBeGreaterThan(10);
    expect(d.agent_definition_path.endsWith(".md")).toBe(true);
  });
});

describe("failure posture (no clone needed)", () => {
  test("doctor fails closed when python3 is missing", () => {
    const d = doctor({ ...base, python: "python3-does-not-exist" });
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name === "python3")?.ok).toBe(false);
  });

  test("doctor fails closed when the clone is missing", () => {
    const d = doctor({ ...base, cloneDir: join(tmpdir(), "humanize-no-such-clone") });
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name === "clone")?.ok).toBe(false);
  });

  test("prepare reports not_polished instead of throwing when tooling is unusable", () => {
    const r = prepareRun({ text: ORIGINAL_PARAGRAPH, kind: "report", config: { ...base, cloneDir: join(tmpdir(), "humanize-no-such-clone") } });
    expect(r.status).toBe("not_polished");
  });

  test("prepare reports not_polished for an excluded input", () => {
    const r = prepareRun({ text: ORIGINAL_PARAGRAPH, kind: "report", originPath: "policies/p_ko.md", config: base });
    expect(r).toEqual({ status: "not_polished", reason: expect.stringContaining("denylist") });
  });

  test("prepare reports not_polished when nothing is Hangul-dominant prose", () => {
    const r = prepareRun({ text: "한\n\n| a | b |\n", kind: "report", config: { ...base, cloneDir: base.cloneDir } });
    expect(["not_polished", "prepared"]).toContain(r.status);
  });
});
