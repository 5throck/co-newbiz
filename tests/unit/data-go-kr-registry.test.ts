import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as yaml from "js-yaml";

// docs/runbooks/data-go-kr-datasets.yaml is the single list of data.go.kr datasets the
// project uses or plans to use. Each dataset needs its own 활용신청 before the shared
// DATA_GO_KR_API_KEY works against it, so an endpoint referenced anywhere in code or in
// a skill must be registered first (apply -> register -> build).
const ROOT = join(import.meta.dirname, "..", "..");
const REGISTRY = join(ROOT, "docs", "runbooks", "data-go-kr-datasets.yaml");
const ENDPOINT = /apis\.data\.go\.kr\/[0-9]+\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+/g;
const SCAN_DIRS = ["skills", "scripts", "db", "mcp", join("app", "web-next", "app"), join("app", "web-next", "lib")];
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage", ".git"]);
const SCAN_EXT = /\.(ts|tsx|md|json|yaml|yml)$/;

interface Dataset {
  id: string;
  name_ko: string;
  provider: string;
  dataset_id: string | null;
  url: string | null;
  endpoints: string[];
  endpoint_mapping: string;
  env_var: string;
  status: string;
  application_status: string;
  account_type: string | null;
  applied_on: string | null;
  approved_on: string | null;
  expires_on: string | null;
  evidence: string | null;
  used_by: string;
  owner: string;
  notes: string;
}

function load(): { datasets: Dataset[] } {
  return yaml.load(readFileSync(REGISTRY, "utf8")) as { datasets: Dataset[] };
}

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(name)) out.push(full);
  }
}

describe("data.go.kr dataset registry", () => {
  test("every entry carries the required fields with valid enums", () => {
    const { datasets } = load();
    expect(datasets.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const d of datasets) {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      for (const f of ["name_ko", "provider", "env_var", "used_by", "owner", "notes"] as const) {
        expect(typeof d[f] === "string" && d[f].trim() !== "").toBe(true);
      }
      expect(d.env_var).toBe("DATA_GO_KR_API_KEY");
      expect(["in_use", "planned"]).toContain(d.status);
      expect(["approved", "pending", "not_applied", "unknown"]).toContain(d.application_status);
      expect(Array.isArray(d.endpoints)).toBe(true);
      expect(["verified", "unverified", "none"]).toContain(d.endpoint_mapping);
      if (d.endpoints.length > 0) expect(d.endpoint_mapping).not.toBe("none");
      expect([null, "development", "operation"]).toContain(d.account_type);
      for (const f of ["applied_on", "approved_on", "expires_on"] as const) {
        if (d[f] !== null) expect(d[f]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (d.application_status === "approved") {
        expect(d.account_type).not.toBeNull();
        expect(d.applied_on).not.toBeNull();
      }
      if (d.dataset_id !== null) expect(d.url).toBe(`https://www.data.go.kr/data/${d.dataset_id}/openapi.do`);
      if (d.application_status === "approved") expect(d.evidence ?? d.approved_on).toBeTruthy();
    }
  });

  test("an in_use dataset with endpoints is never marked not_applied", () => {
    for (const d of load().datasets) {
      if (d.status === "in_use") expect(d.application_status).not.toBe("not_applied");
    }
  });

  test("every apis.data.go.kr endpoint referenced in code or skills is registered", () => {
    const registered = new Set(load().datasets.flatMap((d) => d.endpoints));
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.match(ENDPOINT) ?? []) {
        if (!registered.has(m)) missing.push(`${relative(ROOT, file)}: ${m}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("the FSC bond datasets (ADR-0208 slice 4) are in use with their verified endpoints, cross-check only, with the KOGL terms recorded", () => {
    const byId = new Map(load().datasets.map((d) => [d.id, d]));
    const basic = byId.get("fsc-bond-basic-info");
    const price = byId.get("fsc-bond-price-info");
    expect(basic?.endpoints).toEqual(["apis.data.go.kr/1160100/GetBondIssuInfoService_V2/getBondBasiInfo_V2"]);
    expect(price?.endpoints).toEqual(["apis.data.go.kr/1160100/GetBondSecuritiesInfoService_V2/getBondPriceInfo_V2"]);
    for (const d of [basic, price]) {
      expect(d?.status).toBe("in_use");
      expect(d?.endpoint_mapping).toBe("verified");
      expect(d?.application_status).toBe("approved");
      expect(d?.used_by).toContain("wacc/bond-evidence");
      expect(d?.used_by).toContain("never an applied value");
      expect(d?.notes).toContain("KOGL");
    }
    expect(basic?.notes).toContain("type 2");
    expect(price?.notes).toContain("type 4");
    expect(price?.notes).toContain("NO MODIFICATION");
    // the code constants carry exactly the registered endpoints (the scan test above would flag a stray one)
    const lib = readFileSync(join(ROOT, "db", "lib", "fsc-bond-evidence.ts"), "utf8");
    for (const e of [...(basic?.endpoints ?? []), ...(price?.endpoints ?? [])]) expect(lib).toContain(e);
  });

  test("every registered endpoint is a well-formed service URL", () => {
    for (const d of load().datasets) {
      for (const e of d.endpoints) expect(e).toMatch(new RegExp(`^${ENDPOINT.source}$`));
    }
  });
});
