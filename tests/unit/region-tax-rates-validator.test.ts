// @version 1.0.0
/**
 * region-profiles validator - optional `corporate_tax_rates` section (ADR-0207 addendum).
 * Runs the exported validateProfile() against the parsed real KR profile with one mutation
 * per case. Absent section stays valid (other profiles unaffected).
 */
import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { validateProfile } from "../../region-profiles/_validate.ts";

const DIR = resolve(import.meta.dirname, "../../region-profiles");
const load = (file: string) =>
  yaml.load(readFileSync(join(DIR, file), "utf-8"), { schema: yaml.JSON_SCHEMA }) as Record<string, any>;

function kr(): Record<string, any> {
  return structuredClone(load("KR.yaml"));
}
const errors = (doc: unknown) =>
  validateProfile("KR.yaml", doc)
    .filter((i) => i.severity === "error")
    .map((i) => i.message)
    .join("\n");
const general = (doc: Record<string, any>) => doc.corporate_tax_rates.data.schedules[0];

describe("corporate_tax_rates validator", () => {
  test("the shipped KR profile passes and carries the statutory 2026 combined rates", () => {
    const doc = kr();
    expect(errors(doc)).toBe("");
    const data = doc.corporate_tax_rates.data;
    expect(data.effective_from).toBe("2026-01-01");
    expect(data.default_schedule_id).toBe("general-domestic");
    expect(general(doc).brackets.map((b: any) => b.combined_rate_pct)).toEqual([11, 22, 24.2, 27.5]);
    expect(general(doc).brackets.map((b: any) => b.national_rate_pct)).toEqual([10, 20, 22, 25]);
    expect(general(doc).brackets.map((b: any) => b.upper_krw)).toEqual([200000000, 20000000000, 300000000000, null]);
    expect(doc.corporate_tax_rates.maintainer).toBe("financial-analyst");
    expect(doc.corporate_tax_rates.verified_on).toBe("2026-11-26");
  });

  test("absent section passes; every other shipped profile is unaffected", () => {
    const doc = kr();
    delete doc.corporate_tax_rates;
    expect(errors(doc)).toBe("");
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".yaml") && !n.startsWith("_"))) {
      expect(errors(load(f))).toBe("");
    }
  });

  for (const field of ["source", "verified_on", "maintainer"]) {
    test(`section missing provenance field '${field}' is rejected`, () => {
      const doc = kr();
      delete doc.corporate_tax_rates[field];
      expect(errors(doc)).toContain(`Section 'corporate_tax_rates' is missing required provenance field '${field}'`);
    });
  }

  test("empty data is rejected", () => {
    const doc = kr();
    doc.corporate_tax_rates.data = {};
    expect(errors(doc)).toContain("corporate_tax_rates'.data is missing or empty");
  });

  test("effective_from: required, valid ISO date, not in the future", () => {
    let doc = kr();
    delete doc.corporate_tax_rates.data.effective_from;
    expect(errors(doc)).toContain("data.effective_from is required");
    doc = kr();
    doc.corporate_tax_rates.data.effective_from = "2026-13-01";
    expect(errors(doc)).toContain("data.effective_from is not a valid ISO-8601 date");
    doc = kr();
    doc.corporate_tax_rates.data.effective_from = "2999-01-01";
    expect(errors(doc)).toContain("data.effective_from is in the future");
  });

  test("local_rate_ratio must be a number in (0, 1]", () => {
    for (const bad of [0, -0.1, 1.5, "0.1", null]) {
      const doc = kr();
      doc.corporate_tax_rates.data.local_rate_ratio = bad;
      expect(errors(doc)).toContain("data.local_rate_ratio must be a number in (0, 1]");
    }
  });

  test("schedules must be a non-empty list with unique ids and required refs", () => {
    let doc = kr();
    doc.corporate_tax_rates.data.schedules = [];
    expect(errors(doc)).toContain("data.schedules must be a non-empty list");
    doc = kr();
    doc.corporate_tax_rates.data.schedules[1].id = "general-domestic";
    expect(errors(doc)).toContain("duplicate schedule id 'general-domestic'");
    for (const f of ["statute_ref", "local_statute_ref", "url"]) {
      doc = kr();
      delete general(doc)[f];
      expect(errors(doc)).toContain(`schedule 'general-domestic' is missing required field '${f}'`);
    }
    doc = kr();
    general(doc).url = "http://www.law.go.kr/x";
    expect(errors(doc)).toContain("url must be an https:// URL with a host");
  });

  test("default_schedule_id must name a schedule", () => {
    let doc = kr();
    delete doc.corporate_tax_rates.data.default_schedule_id;
    expect(errors(doc)).toContain("data.default_schedule_id is required");
    doc = kr();
    doc.corporate_tax_rates.data.default_schedule_id = "nope";
    expect(errors(doc)).toContain("data.default_schedule_id 'nope' must match exactly one schedule id");
  });

  test("brackets: must start at 0 and be contiguous", () => {
    let doc = kr();
    general(doc).brackets[0].lower_krw = 1;
    expect(errors(doc)).toContain("brackets[0].lower_krw 1 must equal 0");
    doc = kr();
    general(doc).brackets[2].lower_krw = 19999999999;
    expect(errors(doc)).toContain("must equal the previous bracket's upper_krw");
  });

  test("brackets: last must be open, only the last may be open, bounds must be increasing integers", () => {
    let doc = kr();
    general(doc).brackets[3].upper_krw = 999999999999;
    expect(errors(doc)).toContain("the last bracket must be open");
    doc = kr();
    general(doc).brackets[1].upper_krw = null;
    expect(errors(doc)).toContain("is null (open bracket) but is not the last bracket");
    doc = kr();
    general(doc).brackets[0].upper_krw = 0;
    expect(errors(doc)).toContain("upper_krw must be an integer greater than lower_krw");
    doc = kr();
    general(doc).brackets[0].upper_krw = 2e8 + 0.5;
    expect(errors(doc)).toContain("upper_krw must be an integer greater than lower_krw");
  });

  test("brackets: rates must be numbers, within the sanity band, and arithmetically consistent", () => {
    let doc = kr();
    general(doc).brackets[0].combined_rate_pct = "11";
    expect(errors(doc)).toContain("must all be numbers (percent points)");
    doc = kr();
    Object.assign(general(doc).brackets[3], { national_rate_pct: 50, local_rate_pct: 5, combined_rate_pct: 55 });
    expect(errors(doc)).toContain("outside the sanity band (0, 50) percent points");
    doc = kr();
    general(doc).brackets[1].local_rate_pct = 2.5; // not national x ratio
    expect(errors(doc)).toContain("does not equal national_rate_pct 20 x local_rate_ratio 0.1");
    doc = kr();
    general(doc).brackets[1].combined_rate_pct = 23;
    expect(errors(doc)).toContain("does not equal national_rate_pct + local_rate_pct");
  });

  test("brackets: combined rates must be non-decreasing", () => {
    const doc = kr();
    Object.assign(general(doc).brackets[2], { national_rate_pct: 15, local_rate_pct: 1.5, combined_rate_pct: 16.5 });
    expect(errors(doc)).toContain("is lower than the previous bracket's");
  });
});
