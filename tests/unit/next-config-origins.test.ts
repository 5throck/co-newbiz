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
  test("dev uses 7748 loopback-bound, start uses 7748, compose maps 7749 loopback-only", () => {
    const pkg = readFileSync(join(root, "app", "web-next", "package.json"), "utf8");
    // Dev binding contract: the dev server binds to 127.0.0.1 so the
    // Cloudflare tunnel ingress (host.docker.internal:7748) and localhost
    // MCP clients keep working while the LAN-direct path (CF-Connecting-IP
    // spoofing) is closed — same contract as the compose loopback binding.
    expect(pkg).toContain("next dev -H 127.0.0.1 -p 7748");
    // The un-hardened bare form must not coexist; the hardened form above
    // cannot satisfy it, so a revert to the wide binding trips this check.
    expect(pkg).not.toContain("next dev -p 7748");
    expect(pkg).toContain("next start -p 7748");
    // Deployment contract: host port 7749 → container 7749, bound to 127.0.0.1 only.
    // Loopback binding is a TRUST_PROXY_HEADERS precondition: an interface-wide
    // binding would let any LAN peer hit 7749 directly and spoof CF-Connecting-IP,
    // bypassing the Cloudflare tunnel (docs/runbooks/deployment.md §8).
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:7749:7749"');
    // The un-hardened bare mapping must not coexist. The quoted form requires a
    // double quote directly before 7749:7749, so the loopback line above can
    // never satisfy it — a revert to the wide binding trips this check too.
    expect(compose).not.toContain('"7749:7749"');
  });
});
