import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "..", "app", "web-next", "next.config.ts"), "utf8");
const match = source.match(/allowedDevOrigins:\s*\[([^\]]*)\]/);
const origins = (match?.[1] ?? "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);

describe("next.config allowedDevOrigins", () => {
  test("includes the production hostname and keeps the old one", () => {
    expect(origins).toContain("newbiz.bizknights.org");
    expect(origins).toContain("co-newbiz.bizknights.org");
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
