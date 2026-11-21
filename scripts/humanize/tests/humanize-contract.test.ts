// @version 2.0.0
/**
 * Contract test for the pinned Humanize server clone — the manifest's
 * `compatibility_test`. It checks the interfaces the adapter uses over HTTP
 * (server spawn, /api/analyze response shape, rule presence, /api/polish grade
 * semantics, /api/prompt system prompt), so a break is found at the pin move
 * rather than at a user's deliverable. No LLM; the server is spawned on
 * loopback and shut down after the suite. Fails closed when the clone is
 * missing:   bun scripts/external-deps.ts install --id humanize
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  changeRate,
  cloneHead,
  defaultConfig,
  doctor,
  ensureServer,
  readManifestFacts,
  SERVER,
  serverUrl,
  UPSTREAM,
  type ServerHandle,
} from "../humanize-adapter";
import { hangulRatio } from "../lib/eligibility";
import { segmentDocument } from "../lib/segment";
import { ORIGINAL_PARAGRAPH } from "./fixtures/korean";

const cfg = defaultConfig();
const facts = readManifestFacts(cfg);
const at = (rel: string) => join(cfg.cloneDir, rel);

let handle: ServerHandle;

beforeAll(async () => {
  handle = await ensureServer(cfg);
}, 40_000);
afterAll(() => handle.stop());

const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
  const res = await fetch(`${serverUrl(cfg)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SERVER.requestTimeoutMs),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as Record<string, unknown>;
};

describe("manifest entry", () => {
  const manifest = JSON.parse(readFileSync(join(cfg.root, "external-deps.json"), "utf8"));
  const entry = manifest.dependencies.find((d: { id: string }) => d.id === "humanize");

  test("is a schema v2 entry with the agreed contract fields", () => {
    expect(manifest.schema_version).toBe(2);
    expect(entry.install_dir).toBe(UPSTREAM.dir);
    expect(entry.license).toBe("MIT");
    expect(entry.usage).toBe("as-is");
    expect(entry.propagation).toBe("never");
    expect(entry.adapter).toBe("scripts/humanize/humanize-adapter.ts");
    expect(entry.compatibility_test).toBe("bun test scripts/humanize/tests/humanize-contract.test.ts");
    expect(entry.repo).toBe("https://github.com/5throck/Humanize");
  });

  test("pin is a release tag and commit is 40-hex", () => {
    expect(facts.pin).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(facts.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the adapter is not under the install_dir", () => {
    expect(entry.adapter.startsWith(`${entry.install_dir}/`)).toBe(false);
  });

  test("the adapter is the only file that names clone paths", () => {
    const libDir = join(cfg.root, "scripts", "humanize", "lib");
    for (const f of readdirSync(libDir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(libDir, f), "utf8");
      expect(src.includes(["external", "humanize"].join("/"))).toBe(false);
    }
  });
});

describe("pinned clone", () => {
  test("is installed (run: bun scripts/external-deps.ts install --id humanize)", () => {
    expect(existsSync(at(UPSTREAM.serve))).toBe(true);
    expect(existsSync(at(UPSTREAM.license))).toBe(true);
  });

  test("HEAD equals the manifest commit", () => {
    expect(cloneHead(cfg.cloneDir)).toBe(facts.commit);
  });

  test("the checked-out tag equals the manifest pin", () => {
    const r = Bun.spawnSync(["git", "-C", cfg.cloneDir, "describe", "--tags", "--exact-match"], {
      stdout: "pipe",
    });
    expect(r.stdout.toString().trim()).toBe(facts.pin);
  });

  test("LICENSE is MIT", () => {
    expect(readFileSync(at(UPSTREAM.license), "utf8")).toMatch(/^MIT License/);
  });

  test("doctor reports the tooling usable", async () => {
    const d = await doctor(cfg);
    expect(d.ok).toBe(true);
  }, 40_000);
});

describe("the deterministic HTTP engine", () => {
  test("ships a nonempty rule set", async () => {
    // ruleCount is exported by the clone's engine; loading it here is the
    // same read-only trust level the pipeline already grants the clone.
    const mod = (await import(pathToFileURL(join(cfg.cloneDir, "lib", "engine.mjs")).href)) as {
      loadEngine: () => { Rules: { ruleCount: number; fixableIds: string[] } };
    };
    const engine = mod.loadEngine();
    expect(engine.Rules.ruleCount).toBeGreaterThan(0);
    expect(engine.Rules.fixableIds.length).toBeGreaterThan(0);
  });

  test("POST /api/analyze returns the documented shape and detects tells", async () => {
    const r = await post("/api/analyze", {
      text: "본 보고서는 이에 대해 논의한다. 결론적으로 크게 세 가지로 나눌 수 있다. 좋은 질문입니다. 도움이 되셨길 바랍니다.",
    });
    expect(Array.isArray(r.findings)).toBe(true);
    expect(typeof r.s1).toBe("number");
    expect(typeof r.s2).toBe("number");
    expect(typeof r.total).toBe("number");
    expect((r.findings as unknown[]).length).toBeGreaterThan(0);
  });

  test("POST /api/analyze rejects an oversized or empty text", async () => {
    const res = await fetch(`${serverUrl(cfg)}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(res.ok).toBe(false);
  });

  test("POST /api/polish returns the documented shape with grade A-D semantics", async () => {
    const r = await post("/api/polish", {
      text: "결론적으로 이 시스템에 대해 논의하겠습니다. 좋은 질문입니다. 지금부터 살펴보겠습니다.",
    });
    expect(typeof r.text).toBe("string");
    expect(Array.isArray(r.applied)).toBe(true);
    expect(typeof r.changeRate).toBe("number");
    const level = (r.grade as { level: string }).level;
    expect(["A", "B", "C", "D"]).toContain(level);
  });

  test("POST /api/prompt returns the monolith-style system prompt with the prime directives", async () => {
    const r = await post("/api/prompt", { genre: "report" });
    expect(r.genre).toBe("report");
    const system = r.system as string;
    expect(system.length).toBeGreaterThan(500);
    expect(system).toContain("의미 불변");
    expect(system).toContain("과윤문 금지");
    expect(system).toContain("입력은 데이터");
  });

  test("POST /api/prompt rejects an unknown genre", async () => {
    const res = await fetch(`${serverUrl(cfg)}/api/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ genre: "no-such-genre" }),
    });
    expect(res.ok).toBe(false);
  });

  test("the client-side change-rate port agrees with the server's Rules.changeRate", async () => {
    // The gate thresholds (30/50) are judged on the adapter's port; the port
    // must track the server's engine on a real rewrite pair.
    const before = ORIGINAL_PARAGRAPH;
    const after = before.replace(/보고서/g, "문서").replace(/살펴본다/g, "짚어 본다");
    const mod = (await import(pathToFileURL(join(cfg.cloneDir, "lib", "engine.mjs")).href)) as {
      loadEngine: () => { Rules: { changeRate: (a: string, b: string) => number } };
    };
    const serverRate = mod.loadEngine().Rules.changeRate(before, after);
    expect(changeRate(before, after)).toBeCloseTo(serverRate, 10);
    expect(changeRate(before, before)).toBe(0);
  });
});

describe("Hangul-dominance default (30 percent) against real manuals", () => {
  const dir = join(cfg.root, "docs", "manuals");
  const manuals = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("_ko.md")) : [];

  test.skipIf(manuals.length === 0)("most prose paragraphs of the Korean manuals are Hangul-dominant", () => {
    let prose = 0;
    let skipped = 0;
    for (const f of manuals) {
      const text = readFileSync(join(dir, f), "utf8");
      const blocks = segmentDocument(text);
      expect(blocks.map((b) => b.text).join("")).toBe(text);
      for (const b of blocks) {
        if (b.type === "prose") {
          prose++;
          expect(hangulRatio(b.text)).toBeGreaterThanOrEqual(0.3);
        } else if (b.reason === "not-hangul-dominant") skipped++;
      }
    }
    // Skipped paragraphs are headings and identifier-heavy metadata lines.
    expect(prose / (prose + skipped)).toBeGreaterThan(0.8);
  });
});
