// @version 1.0.0
/**
 * region-profiles validator - optional `erp_references` section (ADR-0207).
 * Runs the exported validateProfile() against the parsed real KR profile with
 * one mutation per case. Absent section stays valid (other profiles unaffected).
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
    .map((i) => i.message);
const second = (e0: Record<string, any>) => ({ ...e0, id: "second-entry", superseded_by: undefined });

describe("erp_references validator", () => {
  test("the shipped KR profile passes and carries a default Damodaran entry", () => {
    const doc = kr();
    expect(errors(doc)).toEqual([]);
    const data = doc.erp_references.data;
    expect(data.entries.some((e: any) => e.id === data.default_source_id)).toBe(true);
    expect(
      data.entries.find((e: any) => e.id === data.default_source_id).url.startsWith("https://pages.stern.nyu.edu/"),
    ).toBe(true);
  });

  test("absent section passes; every other shipped profile is unaffected", () => {
    const doc = kr();
    delete doc.erp_references;
    expect(errors(doc)).toEqual([]);
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".yaml") && !n.startsWith("_"))) {
      expect(errors(load(f))).toEqual([]);
    }
  });

  for (const field of ["source", "verified_on", "maintainer"]) {
    test(`section missing provenance field '${field}' is rejected`, () => {
      const doc = kr();
      delete doc.erp_references[field];
      expect(errors(doc).join("\n")).toContain(
        `Section 'erp_references' is missing required provenance field '${field}'`,
      );
    });
  }

  test("empty data is rejected", () => {
    const doc = kr();
    doc.erp_references.data = {};
    expect(errors(doc).join("\n")).toContain("erp_references'.data is missing or empty");
  });

  for (const field of ["id", "source", "url", "value_pct", "basis", "as_of", "verified_on", "maintainer"]) {
    test(`entry missing '${field}' is rejected`, () => {
      const doc = kr();
      delete doc.erp_references.data.entries[0][field];
      expect(errors(doc).length).toBeGreaterThan(0);
    });
  }

  test("non-https url is rejected", () => {
    const doc = kr();
    doc.erp_references.data.entries[0].url = "http://pages.stern.nyu.edu/x";
    expect(errors(doc).join("\n")).toContain("url must start with https://");
  });

  test("future as_of / verified_on / published_on are rejected", () => {
    for (const f of ["as_of", "verified_on", "published_on"]) {
      const doc = kr();
      doc.erp_references.data.entries[0][f] = "2999-01-01";
      expect(errors(doc).join("\n")).toContain(`${f} is in the future`);
    }
  });

  test("malformed dates are rejected", () => {
    const doc = kr();
    doc.erp_references.data.entries[0].as_of = "2026-13-45";
    expect(errors(doc).join("\n")).toContain("as_of is not a valid ISO-8601 date");
  });

  test("value outside the sanity band or non-numeric is rejected", () => {
    for (const v of [0, -1, 25, 48.7, "4.87"]) {
      const doc = kr();
      doc.erp_references.data.entries[0].value_pct = v;
      expect(errors(doc).length).toBeGreaterThan(0);
    }
  });

  test("basis must be in the enum", () => {
    const doc = kr();
    doc.erp_references.data.entries[0].basis = "guess";
    expect(errors(doc).join("\n")).toContain("basis must be one of");
  });

  test("duplicate id is rejected", () => {
    const doc = kr();
    const e0 = doc.erp_references.data.entries[0];
    doc.erp_references.data.entries.push({ ...e0 });
    expect(errors(doc).join("\n")).toContain("duplicate entry id");
  });

  test("dangling superseded_by is rejected; a resolving one passes", () => {
    const doc = kr();
    const e0 = doc.erp_references.data.entries[0];
    doc.erp_references.data.entries.push(second(e0));
    e0.superseded_by = "does-not-exist";
    expect(errors(doc).join("\n")).toContain("superseded_by does not resolve");
    e0.superseded_by = "second-entry";
    doc.erp_references.data.default_source_id = "second-entry";
    expect(errors(doc)).toEqual([]);
  });

  test("default_source_id missing, dangling, or pointing at a superseded entry is rejected", () => {
    const missing = kr();
    delete missing.erp_references.data.default_source_id;
    expect(errors(missing).join("\n")).toContain("default_source_id is required");

    const dangling = kr();
    dangling.erp_references.data.default_source_id = "nope";
    expect(errors(dangling).join("\n")).toContain("must match exactly one entry");

    const superseded = kr();
    const e0 = superseded.erp_references.data.entries[0];
    superseded.erp_references.data.entries.push(second(e0));
    e0.superseded_by = "second-entry"; // default still points at e0
    expect(errors(superseded).join("\n")).toContain("names a superseded entry");
  });

  test("empty or missing entries is rejected", () => {
    const empty = kr();
    empty.erp_references.data.entries = [];
    expect(errors(empty).join("\n")).toContain("data.entries must be a non-empty list");
    const gone = kr();
    delete gone.erp_references.data.entries;
    expect(errors(gone).join("\n")).toContain("data.entries must be a non-empty list");
  });
});
