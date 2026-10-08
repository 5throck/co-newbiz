// @version 1.0.0
/**
 * loader.ts — golden dataset loader for the AI evaluation harness (Wave B-2).
 *
 * Validates every case file with the Zod schema in tests/eval/golden/schema.ts,
 * verifies each citation points at an existing heading of a pilot doc, and runs
 * the leakage lint (`findLeakage`) on every pre-decision fixture. Any problem is
 * collected and thrown together so one run lists every defect.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { z } from "zod";
import { GoldenCase, InputFixture, findLeakage } from "../../tests/eval/golden/schema.ts";

type InputFixtureT = z.infer<typeof InputFixture>;

export const ROOT = resolve(import.meta.dir, "..", "..");
export const GOLDEN_DIR = join(ROOT, "tests", "eval", "golden");

export interface LoadedCase {
  case: GoldenCase;
  /** Pre-decision facts (leakage-linted). */
  inputs: InputFixtureT;
  /** Post-decision facts, when the case has any. */
  postDecision?: InputFixtureT;
}

export interface GoldenSet {
  version: string;
  cases: LoadedCase[];
}

const headingCache = new Map<string, Set<string>>();

function headingsOf(doc: string): Set<string> | null {
  if (headingCache.has(doc)) return headingCache.get(doc) as Set<string>;
  const p = join(ROOT, doc);
  if (!existsSync(p)) return null;
  const set = new Set<string>();
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) set.add(m[1]);
  }
  headingCache.set(doc, set);
  return set;
}

function checkCitation(c: { doc: string; section: string }, where: string, errors: string[]): void {
  const headings = headingsOf(c.doc);
  if (!headings) errors.push(`${where}: cited doc not found: ${c.doc}`);
  else if (!headings.has(c.section)) errors.push(`${where}: heading not found in ${c.doc}: "${c.section}"`);
}

/** Load and validate the whole golden set. Throws one Error listing every defect. */
export function loadGoldenSet(dir: string = GOLDEN_DIR): GoldenSet {
  const errors: string[] = [];
  const version = readFileSync(join(dir, "VERSION"), "utf-8").trim();
  const cases: LoadedCase[] = [];
  const files = readdirSync(join(dir, "cases")).filter((f) => f.endsWith(".yaml")).sort();
  for (const f of files) {
    const where = `cases/${f}`;
    const parsed = GoldenCase.safeParse(yamlLoad(readFileSync(join(dir, "cases", f), "utf-8")));
    if (!parsed.success) {
      errors.push(`${where}: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const c = parsed.data;
    if (c.golden_version !== version) errors.push(`${where}: golden_version ${c.golden_version} != VERSION ${version}`);
    for (const [i, e] of c.expectations.entries()) e.citation.forEach((ct) => checkCitation(ct, `${where} expectations[${i}]`, errors));
    c.public_outcome?.citation.forEach((ct) => checkCitation(ct, `${where} public_outcome`, errors));

    const readFixture = (ref: string): InputFixtureT | null => {
      const p = join(dir, ref);
      if (!existsSync(p)) {
        errors.push(`${where}: fixture missing: ${ref}`);
        return null;
      }
      const fx = InputFixture.safeParse(JSON.parse(readFileSync(p, "utf-8")));
      if (!fx.success) {
        errors.push(`${where}: fixture ${ref} invalid: ${fx.error.issues[0]?.message}`);
        return null;
      }
      return fx.data;
    };
    const inputs = readFixture(c.inputs_ref);
    if (inputs) {
      const leaked = findLeakage(inputs);
      if (leaked.length > 0) errors.push(`${where}: LEAKAGE in ${c.inputs_ref}: outcome keyword(s) ${leaked.join(", ")}`);
    }
    const post = c.post_decision_inputs_ref ? readFixture(c.post_decision_inputs_ref) : null;
    if (inputs) cases.push({ case: c, inputs, postDecision: post ?? undefined });
  }
  if (errors.length > 0) throw new Error(`golden set invalid (${errors.length}):\n- ${errors.join("\n- ")}`);
  return { version, cases };
}
