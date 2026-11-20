// @version 1.0.0
/**
 * committee-deliberation CLI (ADR-0204 phase 3, CLI parity): a turns-mode run writes minutes v2 —
 * the same markdown the app's .md download renders (per-issue participants, appendix A) — and
 * persists the v2 draft in process_run meta; a rounds-mode run keeps the v1 minutes layout.
 *
 * No network: --deterministic with the LLM provider disabled. The CLI writes memory/ and db/data/
 * relative to its cwd, so the artifacts of these runs are removed afterwards.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const CLI = join(PROJECT_ROOT, "scripts/co-newbiz/committee-deliberation.ts");

const TURNS_TOPIC = "cli parity unit probe turns";
const ROUNDS_TOPIC = "cli parity unit probe rounds";
const ENGINE_ENV_TOPIC = "cli parity unit probe env engine";

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "meeting"
  );
}

const artifacts = new Set<string>();

function run(topic: string, extra: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    CO_NEWBIZ_LLM_PROVIDER: "none",
    CO_NEWBIZ_COMMITTEE_ENGINE: undefined,
    CO_NEWBIZ_DB_PATH: undefined,
    ...env,
  };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const proc = Bun.spawnSync(["bun", CLI, topic, ...extra], {
    cwd: PROJECT_ROOT,
    env: childEnv as Record<string, string>,
  });
  const stdout = proc.stdout.toString();
  const m = stdout.match(/written: (.+\.md)/);
  const file = m?.[1];
  if (file) {
    artifacts.add(file);
    const date = file.match(/committee-(\d{4}-\d{2}-\d{2})-/)?.[1];
    if (date) artifacts.add(join(PROJECT_ROOT, `db/data/committee-${date}-${slug(topic)}.sqlite`));
  }
  return { exitCode: proc.exitCode, stdout, stderr: proc.stderr.toString(), file };
}

afterAll(() => {
  for (const f of artifacts) for (const s of ["", "-wal", "-shm"]) if (existsSync(f + s)) rmSync(f + s);
});

describe("committee-deliberation CLI — turns engine writes minutes v2", () => {
  const out = run(TURNS_TOPIC, ["--engine", "turns", "--deterministic"]);

  test("the run succeeds and writes the minutes file", () => {
    expect(out.exitCode).toBe(0);
    expect(out.file).toBeDefined();
    expect(existsSync(out.file as string)).toBe(true);
  });

  test("markdown has the v2 body: per-issue participants and appendix A", () => {
    const md = readFileSync(out.file as string, "utf8");
    expect(md).toContain(`# Meeting — ${TURNS_TOPIC}`);
    expect(md).toContain("## 안건별 논의");
    expect(md).toMatch(/^- 참석 위원 \d+명: .+/m); // per-issue (and overview) participants line
    expect(md).toContain("## 부록 A — 전체 발언 기록");
    expect(md).toContain("## 제안 권고 (proposal, not a decision)");
    expect(md).toContain("회의록 확정: 미확정");
    // No abandoned attempt in a clean run: appendix B is absent.
    expect(md).not.toContain("## 부록 B");
    // The old transcript-only rendering is gone.
    expect(md).not.toContain("## Transcript");
  });

  test("the v2 draft is persisted in process_run meta (engine turns, version 2, deterministic fallback)", () => {
    const date = (out.file as string).match(/committee-(\d{4}-\d{2}-\d{2})-/)?.[1];
    const db = new Database(join(PROJECT_ROOT, `db/data/committee-${date}-${slug(TURNS_TOPIC)}.sqlite`), {
      readonly: true,
    });
    const row = db.query("SELECT meta_json FROM process_run WHERE stage = 'meeting'").get() as { meta_json: string };
    db.close();
    const meta = JSON.parse(row.meta_json) as {
      engine: string;
      committee_key: string;
      minutes_draft: { fallback: boolean; json: { version: number; issues: Array<{ participants: unknown[] }> } };
    };
    expect(meta.engine).toBe("turns");
    expect(meta.committee_key).toBe("meeting-adhoc");
    expect(meta.minutes_draft.json.version).toBe(2);
    expect(meta.minutes_draft.fallback).toBe(true);
    expect(meta.minutes_draft.json.issues.length).toBeGreaterThan(0);
    expect(meta.minutes_draft.json.issues[0].participants.length).toBeGreaterThan(0);
  });
});

describe("committee-deliberation CLI — engine selection", () => {
  test("with no --engine and no env the CLI defaults to the turn engine; env rounds opts out", () => {
    const def = run(ENGINE_ENV_TOPIC + " default", ["--deterministic"]);
    expect(def.exitCode).toBe(0);
    expect(readFileSync(def.file as string, "utf8")).toContain("## 부록 A — 전체 발언 기록");
    const opt = run(ENGINE_ENV_TOPIC + " rounds optout", ["--deterministic"], { CO_NEWBIZ_COMMITTEE_ENGINE: "rounds" });
    expect(opt.exitCode).toBe(0);
    expect(readFileSync(opt.file as string, "utf8")).not.toContain("## 부록 A — 전체 발언 기록");
  });

  test("CO_NEWBIZ_COMMITTEE_ENGINE=turns is honoured when --engine is absent", () => {
    const out = run(ENGINE_ENV_TOPIC, ["--deterministic"], { CO_NEWBIZ_COMMITTEE_ENGINE: "turns" });
    expect(out.exitCode).toBe(0);
    expect(readFileSync(out.file as string, "utf8")).toContain("## 부록 A — 전체 발언 기록");
  });

  test("an invalid --engine is refused, not coerced", () => {
    const out = run("cli parity unit probe bad engine", ["--engine", "bogus", "--deterministic"]);
    expect(out.exitCode).not.toBe(0);
    expect(out.file).toBeUndefined();
  });

  test("the usage text documents --engine", () => {
    const proc = Bun.spawnSync(["bun", CLI], { cwd: PROJECT_ROOT });
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain("[--engine turns|rounds]");
  });
});

describe("committee-deliberation CLI — rounds engine unchanged", () => {
  const out = run(ROUNDS_TOPIC, ["--engine", "rounds", "--deterministic"]);

  test("keeps the round-engine layout (no minutes v2)", () => {
    expect(out.exitCode).toBe(0);
    const md = readFileSync(out.file as string, "utf8");
    expect(md).toContain("- Engine: runDeliberationRounds (ADR-0096) via /meeting (ADR-0097 §7)");
    expect(md).toContain("## Agenda and objectives");
    expect(md).toContain("## Synthesized outcome (PROPOSAL — not a decision)");
    expect(md).not.toContain("## 부록 A — 전체 발언 기록");
    expect(md).not.toMatch(/^- 참석 위원 \d+명: /m);
  });
});
