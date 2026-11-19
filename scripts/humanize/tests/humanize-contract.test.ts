// @version 1.0.0
/**
 * Contract test for the pinned Humanize KR clone — the manifest's
 * `compatibility_test`. It checks the interfaces the adapter uses (script
 * names, CLI flags, exit codes, agent argument names, rules-file path), so a
 * break is found at the pin move rather than at a user's deliverable.
 * No LLM, no network. Fails closed when the clone is missing:
 *   bun scripts/external-deps.ts install --id humanize
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cloneHead, defaultConfig, doctor, readManifestFacts, runUpstream, UPSTREAM } from "../humanize-adapter";
import { hangulRatio } from "../lib/eligibility";
import { segmentDocument } from "../lib/segment";
import { ORIGINAL_PARAGRAPH, paragraph } from "./fixtures/korean";

const cfg = defaultConfig();
const facts = readManifestFacts(cfg);
const at = (rel: string) => join(cfg.cloneDir, rel);

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
      expect(src.includes(["skills", "humanize-korean"].join("/"))).toBe(false);
    }
  });
});

describe("pinned clone", () => {
  test("is installed (run: bun scripts/external-deps.ts install --id humanize)", () => {
    expect(existsSync(at(UPSTREAM.scripts.gates))).toBe(true);
  });

  test("HEAD equals the manifest commit", () => {
    expect(cloneHead(cfg.cloneDir)).toBe(facts.commit);
  });

  test("the checked-out tag equals the manifest pin", () => {
    const r = spawnSync("git", ["-C", cfg.cloneDir, "describe", "--tags", "--exact-match"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe(facts.pin);
  });

  test("LICENSE is MIT", () => {
    expect(readFileSync(at(UPSTREAM.license), "utf8")).toMatch(/^MIT License/);
  });

  test("has every file the adapter names", () => {
    for (const rel of [...Object.values(UPSTREAM.scripts), UPSTREAM.agent, UPSTREAM.quickRules]) {
      expect(existsSync(at(rel))).toBe(true);
    }
  });

  test("doctor reports the clone usable", () => {
    expect(doctor(cfg).ok).toBe(true);
  });

  test("the monolith agent still declares its three argument names", () => {
    const def = readFileSync(at(UPSTREAM.agent), "utf8");
    for (const a of UPSTREAM.agentArgs) expect(def).toContain(a);
  });

  test("the input shim accepts --run-dir and --genre", () => {
    const r = runUpstream(cfg, UPSTREAM.scripts.shim, ["--help"], tmpdir());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--run-dir");
    expect(r.stdout).toContain("--genre");
  });

  test("the post-processing scripts accept --before, --after and --out", () => {
    for (const s of [UPSTREAM.scripts.modality, UPSTREAM.scripts.commas]) {
      const r = runUpstream(cfg, s, ["--help"], tmpdir());
      expect(r.status).toBe(0);
      for (const f of ["--before", "--after", "--out"]) expect(r.stdout).toContain(f);
    }
    const lex = runUpstream(cfg, UPSTREAM.scripts.lexical, ["restore", "--help"], tmpdir());
    expect(lex.status).toBe(0);
  });

  test("verify_gates exits 0 on an identical pair and 2 on a rewrite beyond 50 percent", () => {
    const dir = mkdtempSync(join(tmpdir(), "humanize-contract-"));
    writeFileSync(join(dir, "a.txt"), ORIGINAL_PARAGRAPH + "\n");
    writeFileSync(join(dir, "same.txt"), ORIGINAL_PARAGRAPH + "\n");
    writeFileSync(join(dir, "heavy.txt"), paragraph({ rewritten: 9, heavy: true }) + "\n");
    const run = (after: string) =>
      runUpstream(
        cfg,
        UPSTREAM.scripts.gates,
        ["--before", join(dir, "a.txt"), "--after", join(dir, after), "--genre", "report"],
        dir,
      );
    expect(run("same.txt").status).toBe(0);
    expect(run("heavy.txt").status).toBe(2);
    expect(
      runUpstream(cfg, UPSTREAM.scripts.gates, ["--before", join(dir, "nope"), "--after", join(dir, "a.txt")], dir)
        .status,
    ).toBe(3);
  });

  test("the input shim writes metrics and keeps the unit text intact for clean input", () => {
    const dir = mkdtempSync(join(tmpdir(), "humanize-shim-"));
    writeFileSync(join(dir, "01_input.txt"), ORIGINAL_PARAGRAPH + "\n");
    const r = runUpstream(cfg, UPSTREAM.scripts.shim, ["--run-dir", dir, "--genre", "report"], dir);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "01_input_with_metrics.txt"))).toBe(true);
    expect(readFileSync(join(dir, "01_input.txt"), "utf8")).toBe(ORIGINAL_PARAGRAPH + "\n");
    expect(r.stdout).toMatch(/route_hint=/);
  });

  test("running the upstream scripts leaves the clone untouched (no bytecode written)", () => {
    const stray = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.name === ".git"
          ? []
          : e.isDirectory()
            ? e.name === "__pycache__"
              ? [join(d, e.name)]
              : stray(join(d, e.name))
            : [],
      );
    expect(stray(cfg.cloneDir)).toEqual([]);
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
