// @version 1.0.0
/**
 * region-profiles validator - optional `credit_rating_references` section (ADR-0208, schema 1.4).
 * Runs the exported validateProfile() against the parsed real KR profile with one mutation per case.
 * Absent section stays valid (other profiles unaffected); agencies and synthetic are validated when present.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { validateProfile } from "../../region-profiles/_validate.ts";

const DIR = resolve(import.meta.dirname, "../../region-profiles");
const load = (file: string) =>
  yaml.load(readFileSync(join(DIR, file), "utf-8"), { schema: yaml.JSON_SCHEMA }) as Record<string, any>;
const kr = (): Record<string, any> => structuredClone(load("KR.yaml"));
const errors = (doc: unknown) =>
  validateProfile("KR.yaml", doc)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
const joined = (doc: unknown) => errors(doc).join("\n");

const syntheticTable = (over: Record<string, any> = {}) => ({
  id: "table-a",
  source: "Published coverage-to-rating table",
  url: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html",
  basis: "ebit_over_interest",
  as_of: "2026-01-05",
  verified_on: "2026-11-26",
  maintainer: "quant-methodologist",
  rows: [
    { lower_x: -100000, upper_x: 1, rating: "CCC" },
    { lower_x: 1, upper_x: 3, rating: "BB" },
    { lower_x: 3, upper_x: 8, rating: "A-" },
    { lower_x: 8, upper_x: null, rating: "AA" },
  ],
  ...over,
});
const withSynthetic = (table = syntheticTable(), defaultId = "table-a") => {
  const doc = kr();
  doc.credit_rating_references.data.synthetic = { default_table_id: defaultId, tables: [table] };
  return doc;
};

describe("credit_rating_references validator", () => {
  test("the shipped KR profile passes and carries the registry values", () => {
    const doc = kr();
    expect(errors(doc)).toEqual([]);
    const d = doc.credit_rating_references.data;
    expect(d.rating_scale).toHaveLength(20);
    expect(d.default.rating).toBe("BBB-");
    expect(d.disclosed.stale_months).toBe(18);
    expect(d.kd_crosscheck.warn_gap_pp).toBe(2);
  });

  test("schema file is version 1.4 and lists the section as optional", () => {
    const schema = readFileSync(join(DIR, "_schema.yaml"), "utf-8");
    expect(schema).toContain('schema_version: "1.4"');
    expect(schema).toContain("credit_rating_references");
  });

  test("absent section passes; every other shipped profile is unaffected", () => {
    const doc = kr();
    delete doc.credit_rating_references;
    expect(errors(doc)).toEqual([]);
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".yaml") && !n.startsWith("_"))) {
      expect(errors(load(f))).toEqual([]);
    }
  });

  for (const field of ["source", "verified_on", "maintainer"]) {
    test(`section missing provenance field '${field}' is rejected`, () => {
      const doc = kr();
      delete doc.credit_rating_references[field];
      expect(joined(doc)).toContain(
        `Section 'credit_rating_references' is missing required provenance field '${field}'`,
      );
    });
  }

  test("empty data and a future verified_on are rejected", () => {
    const empty = kr();
    empty.credit_rating_references.data = {};
    expect(joined(empty)).toContain("credit_rating_references'.data is missing or empty");
    const future = kr();
    future.credit_rating_references.verified_on = "2999-01-01";
    expect(joined(future)).toContain("verified_on is in the future");
  });

  test("rating_scale: missing, empty, duplicate and blank entries are rejected", () => {
    for (const [scale, msg] of [
      [undefined, "data.rating_scale must be a non-empty list"],
      [[], "data.rating_scale must be a non-empty list"],
      [["AAA", "AAA"], "duplicate rating 'AAA'"],
      [["AAA", ""], "data.rating_scale[1] must be a non-empty string"],
    ] as Array<[unknown, string]>) {
      const doc = kr();
      doc.credit_rating_references.data.rating_scale = scale;
      expect(joined(doc)).toContain(msg);
    }
  });

  test("default must resolve in the scale and carry a reason", () => {
    const a = kr();
    a.credit_rating_references.data.default.rating = "ZZZ";
    expect(joined(a)).toContain("data.default.rating 'ZZZ' is not in data.rating_scale");
    const b = kr();
    delete b.credit_rating_references.data.default.reason;
    expect(joined(b)).toContain("data.default.reason is required");
    const c = kr();
    delete c.credit_rating_references.data.default;
    expect(joined(c)).toContain("data.default must be a mapping");
  });

  test("disclosed: stale_months positive, aggregate lowest, instrument present", () => {
    for (const [patch, msg] of [
      [{ stale_months: 0 }, "stale_months must be a positive number"],
      [{ stale_months: "18" }, "stale_months must be a positive number"],
      [{ aggregate: "highest" }, "aggregate must be 'lowest'"],
      [{ instrument: "" }, "data.disclosed.instrument is required"],
    ] as Array<[Record<string, unknown>, string]>) {
      const doc = kr();
      Object.assign(doc.credit_rating_references.data.disclosed, patch);
      expect(joined(doc)).toContain(msg);
    }
  });

  test("spread_map: anchors resolve and are ordered; method fixed", () => {
    for (const [patch, msg] of [
      [{ upper_anchor: "ZZZ" }, "data.spread_map.upper_anchor 'ZZZ' is not in data.rating_scale"],
      [{ lower_anchor: "ZZZ" }, "data.spread_map.lower_anchor 'ZZZ' is not in data.rating_scale"],
      [{ upper_anchor: "BBB-", lower_anchor: "AA-" }, "upper_anchor must be a better rating than lower_anchor"],
      [{ upper_anchor: "AA-", lower_anchor: "AA-" }, "upper_anchor must be a better rating than lower_anchor"],
      [{ between: "linear" }, "between must be 'geometric'"],
      [{ above_upper: "extrapolate" }, "above_upper must be 'clamp'"],
      [{ below_lower: "clamp" }, "below_lower must be 'clamp_flagged'"],
    ] as Array<[Record<string, unknown>, string]>) {
      const doc = kr();
      Object.assign(doc.credit_rating_references.data.spread_map, patch);
      expect(joined(doc)).toContain(msg);
    }
  });

  test("kd_crosscheck.warn_gap_pp must be a positive number", () => {
    for (const v of [0, -2, "2", null]) {
      const doc = kr();
      doc.credit_rating_references.data.kd_crosscheck.warn_gap_pp = v;
      expect(joined(doc)).toContain("warn_gap_pp must be a positive number");
    }
  });

  describe("agencies (optional, validated when present)", () => {
    const withAgencies = (agencies: unknown) => {
      const doc = kr();
      doc.credit_rating_references.data.agencies = agencies;
      return doc;
    };
    test("a good list passes; duplicates, empty aliases and non-https home_url are rejected", () => {
      expect(
        errors(
          withAgencies([
            { id: "a", aliases: ["x"], home_url: "https://example.org" },
            { id: "b", aliases: ["y"] },
          ]),
        ),
      ).toEqual([]);
      expect(
        joined(
          withAgencies([
            { id: "a", aliases: ["x"] },
            { id: "a", aliases: ["y"] },
          ]),
        ),
      ).toContain("duplicate agency id 'a'");
      expect(joined(withAgencies([{ id: "a", aliases: [] }]))).toContain("aliases must be a non-empty list");
      expect(joined(withAgencies([{ id: "a", aliases: ["x"], home_url: "http://example.org" }]))).toContain(
        "home_url must be an https://",
      );
      expect(joined(withAgencies([{ aliases: ["x"] }]))).toContain("missing required field 'id'");
      expect(joined(withAgencies([]))).toContain("data.agencies must be a non-empty list");
    });
    test("kind must be bond or bureau, attested a boolean; an alias owned by two agencies is rejected", () => {
      expect(errors(withAgencies([{ id: "a", kind: "bureau", attested: false, aliases: ["x"] }]))).toEqual([]);
      expect(joined(withAgencies([{ id: "a", kind: "rater", aliases: ["x"] }]))).toContain(
        "kind must be 'bond' or 'bureau'",
      );
      expect(joined(withAgencies([{ id: "a", aliases: ["x"], attested: "no" }]))).toContain(
        "attested must be a boolean",
      );
      expect(
        joined(
          withAgencies([
            { id: "a", aliases: ["NICE 디앤비"] },
            { id: "b", kind: "bureau", aliases: ["nice디앤비"] },
          ]),
        ),
      ).toContain("is already an alias of agency 'a'");
    });
    test("the shipped bureau agencies are kind bureau, unattested, and share no alias with a bond agency", () => {
      const agencies = kr().credit_rating_references.data.agencies as Array<Record<string, any>>;
      const bureau = agencies.filter((a) => a.kind === "bureau");
      expect(bureau.map((a) => a.id)).toEqual(["nice-dnb", "ecredible", "ked", "nice-info", "sci"]);
      expect(bureau.every((a) => a.attested === false && a.home_url === undefined)).toBe(true);
      expect(agencies.filter((a) => a.kind === undefined).map((a) => a.id)).toEqual(["korea-ratings", "kis", "nice"]);
    });
  });

  describe("synthetic (optional, validated when present)", () => {
    test("a good table passes", () => {
      expect(errors(withSynthetic())).toEqual([]);
    });
    test("default_table_id must resolve; duplicate table ids rejected", () => {
      expect(joined(withSynthetic(syntheticTable(), "nope"))).toContain(
        "default_table_id 'nope' must match exactly one table id",
      );
      const doc = withSynthetic();
      doc.credit_rating_references.data.synthetic.tables.push(syntheticTable());
      expect(joined(doc)).toContain("duplicate synthetic table id 'table-a'");
    });
    test("url must be https; as_of / verified_on must be valid dates not in the future", () => {
      expect(joined(withSynthetic(syntheticTable({ url: "http://example.org" })))).toContain(
        "url must be an https:// URL",
      );
      expect(joined(withSynthetic(syntheticTable({ as_of: "2999-01-01" })))).toContain("as_of is in the future");
      expect(joined(withSynthetic(syntheticTable({ verified_on: "2026-13-40" })))).toContain(
        "verified_on is not a valid ISO-8601 date",
      );
      expect(joined(withSynthetic(syntheticTable({ verified_on: undefined })))).toContain(
        "missing required field 'verified_on'",
      );
    });
    test("rows: first row covers zero, contiguous, one open top row", () => {
      const rows = (r: unknown[]) => joined(withSynthetic(syntheticTable({ rows: r })));
      expect(rows([{ lower_x: 1, upper_x: null, rating: "A" }])).toContain("must be <= 0");
      expect(
        rows([
          { lower_x: 0, upper_x: 1, rating: "CCC" },
          { lower_x: 2, upper_x: null, rating: "A" },
        ]),
      ).toContain("must equal the previous row's upper_x");
      expect(rows([{ lower_x: 0, upper_x: 5, rating: "A" }])).toContain("the last row must be open");
      expect(
        rows([
          { lower_x: 0, upper_x: null, rating: "CCC" },
          { lower_x: 5, upper_x: null, rating: "A" },
        ]),
      ).toContain("is null (open row) but is not the last row");
      expect(rows([])).toContain("rows must be a non-empty list");
    });
    test("row ratings resolve in the scale and never worsen as coverage rises", () => {
      const rows = (r: unknown[]) => joined(withSynthetic(syntheticTable({ rows: r })));
      expect(rows([{ lower_x: 0, upper_x: null, rating: "ZZZ" }])).toContain(
        "rating 'ZZZ' is not in data.rating_scale",
      );
      expect(
        rows([
          { lower_x: 0, upper_x: 2, rating: "A" },
          { lower_x: 2, upper_x: null, rating: "BBB" },
        ]),
      ).toContain("ratings must not worsen as coverage rises");
    });
  });
});
