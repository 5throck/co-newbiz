import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_DEV_ORIGINS } from "../../app/web-next/lib/dev-origins.ts";

const origins = [...BUILTIN_DEV_ORIGINS];
const source = readFileSync(join(import.meta.dir, "..", "..", "app", "web-next", "next.config.ts"), "utf8");

describe("next.config allowedDevOrigins", () => {
  test("includes the production hostname and keeps the old one", () => {
    expect(origins).toContain("newbiz.bizknights.org");
    expect(origins).toContain("co-newbiz.bizknights.org");
  });
  test("includes the dev tunnel hostname, current Tailscale IP and MagicDNS name, and keeps older entries", () => {
    for (const o of ["dev-newbiz.bizknights.org", "100.87.220.26", "macmini.tail03efbe.ts.net", "100.104.16.127", "192.168.0.44"]) {
      expect(origins).toContain(o);
    }
  });
});

describe("next.config wiring", () => {
  test("allowedDevOrigins is resolved from the env-aware helper", () => {
    expect(source).toContain("allowedDevOrigins: resolveAllowedDevOrigins(");
  });
});

describe("port layout", () => {
  const root = join(import.meta.dir, "..", "..");
  test("dev scripts use 7748, compose maps 7749:7749", () => {
    const pkg = readFileSync(join(root, "app", "web-next", "package.json"), "utf8");
    expect(pkg).toContain("next dev -p 7748");
    expect(pkg).toContain("next start -p 7748");
    expect(readFileSync(join(root, "docker-compose.yml"), "utf8")).toContain('"7749:7749"');
  });
});
