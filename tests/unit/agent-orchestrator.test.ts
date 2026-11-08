/**
 * Unit tests for the ADR-0096 orchestration engine (runActivityChain,
 * runDeliberationRounds, buildSynthesis) plus the 0064/0065/0066 migrations.
 *
 * Real scratch SQLite (project-promotion test pattern): the entity-addressing
 * writes, the agent_position member-type invariant, and the dissent_json
 * verbatim rule are exercised against the actual 0045+0064–0066 schema, not
 * mocked. The migration round-trip uses the survival-DB pattern from
 * migration-0013.test.ts: build pre-0064 state with the REAL runner, seed a
 * legacy-shape process_run row, then apply the real 0064+ migrations and read
 * the row back.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { runActivityChain, type CallAgent, type AgentCallResult } from "../../app/web-next/lib/agent-orchestrator.ts";
import { runDeliberationRounds, deliberationPrompt, buildSynthesis } from "../../app/web-next/lib/deliberation.ts";

const TEST_DB_PATH = "db/data/test-agent-orchestrator.sqlite";
const SURVIVAL_DB_PATH = "db/data/test-agent-orchestrator-survival.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-09-03T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

beforeAll(() => {
  for (const p of [TEST_DB_PATH, SURVIVAL_DB_PATH]) {
    if (existsSync(p)) rmSync(p);
  }
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  projectId = insertProject();
}, 60000);

afterAll(() => {
  resetDb();
  for (const base of [TEST_DB_PATH, SURVIVAL_DB_PATH]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = base + suffix;
      if (existsSync(p)) rmSync(p);
    }
  }
});

function tableColumns(table: string): { name: string; notnull: number; dflt_value: string | null }[] {
  return db.query(`PRAGMA table_info(${table})`).all() as never[];
}

// ---------------------------------------------------------------------------
// runActivityChain
// ---------------------------------------------------------------------------

describe("runActivityChain", () => {
  test("project entity: process_run/activity_run/agent_run written with correct addressing, status done", async () => {
    const result = await runActivityChain(
      { entityType: "project", entityId: projectId },
      [
        { activityId: "act-1", agentKey: "market-analyst", prompt: "p1", execute: async () => "MARKET ARTIFACT" },
        { activityId: "act-2", agentKey: "regulatory-analyst", prompt: "p2", execute: async () => "REG ARTIFACT" },
      ],
      { actor: "user-001" },
    );

    expect(result.status).toBe("done");
    const run = db
      .query("SELECT entity_type, entity_id, project_id, status, source, started_by FROM process_run WHERE id = ?")
      .get(result.processRunId) as Record<string, unknown>;
    expect(run.entity_type).toBe("project");
    expect(run.entity_id).toBe(projectId);
    expect(run.project_id).toBe(projectId); // compatibility column populated for project runs
    expect(run.status).toBe("done");
    expect(run.source).toBe("agent");
    expect(run.started_by).toBe("user-001");

    const activities = db
      .query("SELECT activity_id, status, output_md FROM activity_run WHERE process_run_id = ? ORDER BY activity_id")
      .all(result.processRunId) as { activity_id: string; status: string; output_md: string }[];
    expect(activities.map((a) => a.activity_id)).toEqual(["act-1", "act-2"]);
    expect(activities.every((a) => a.status === "done" && a.output_md !== null)).toBe(true);

    const agentRuns = db
      .query("SELECT agent_key, status FROM agent_run WHERE process_run_id = ? ORDER BY activity_id")
      .all(result.processRunId) as { agent_key: string; status: string }[];
    expect(agentRuns.map((a) => a.agent_key)).toEqual(["market-analyst", "regulatory-analyst"]);
    expect(agentRuns.every((a) => a.status === "done")).toBe(true);
  });

  test("opportunity entity: entity addressing works, project_id left NULL", async () => {
    const oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
      oppId, "opp-orch", "산업", "assessed", "user-001", NOW,
    ]);
    const result = await runActivityChain(
      { entityType: "opportunity", entityId: oppId },
      [{ activityId: "act-opp", agentKey: "market-analyst", prompt: "p", execute: async () => "OPP ARTIFACT" }],
      { actor: "user-001" },
    );
    expect(result.status).toBe("done");
    const run = db
      .query("SELECT entity_type, entity_id, project_id FROM process_run WHERE id = ?")
      .get(result.processRunId) as Record<string, unknown>;
    expect(run.entity_type).toBe("opportunity");
    expect(run.entity_id).toBe(oppId);
    expect(run.project_id).toBeNull(); // opportunity runs leave it NULL by design (0064)
  });

  test("callAgent fallback is used when an activity has no execute()", async () => {
    const callAgent: CallAgent = async (agentKey, prompt) => ({ positionMd: `LLM:${agentKey}:${prompt}` });
    const result = await runActivityChain(
      { entityType: "project", entityId: projectId },
      [{ activityId: "act-llm", agentKey: "fin-analyst", prompt: "analyze this" }],
      { actor: "user-001", callAgent },
    );
    expect(result.activities[0].outputMd).toBe("LLM:fin-analyst:analyze this");
  });

  test("failure path: run + activity + agent_run all marked failed and the chain stops", async () => {
    let secondCalled = false;
    const result = await runActivityChain(
      { entityType: "project", entityId: projectId },
      [
        { activityId: "act-ok", agentKey: "market-analyst", prompt: "p", execute: async () => "fine" },
        {
          activityId: "act-boom",
          agentKey: "fin-analyst",
          prompt: "p",
          execute: async () => {
            throw new Error("LLM unavailable");
          },
        },
        {
          activityId: "act-never",
          agentKey: "risk-officer",
          prompt: "p",
          execute: async () => {
            secondCalled = true;
            return "never";
          },
        },
      ],
      { actor: "user-001" },
    );

    expect(result.status).toBe("failed");
    expect(secondCalled).toBe(false); // chain stopped at the failure
    const run = db.query("SELECT status, finished_at FROM process_run WHERE id = ?").get(result.processRunId) as { status: string; finished_at: string | null };
    expect(run.status).toBe("failed");
    expect(run.finished_at).not.toBeNull();
    const statuses = db
      .query("SELECT activity_id, status FROM activity_run WHERE process_run_id = ? ORDER BY rowid")
      .all(result.processRunId) as { activity_id: string; status: string }[];
    expect(statuses).toEqual([
      { activity_id: "act-ok", status: "done" },
      { activity_id: "act-boom", status: "failed" },
    ]);
    expect((db.query("SELECT status FROM agent_run WHERE activity_id = 'act-boom' AND process_run_id = ?").get(result.processRunId) as { status: string }).status).toBe("failed");
  });

  test("continueOnError: later activities still run, run still ends failed", async () => {
    const result = await runActivityChain(
      { entityType: "project", entityId: projectId },
      [
        { activityId: "a", agentKey: "x", prompt: "p", execute: async () => { throw new Error("boom"); } },
        { activityId: "b", agentKey: "y", prompt: "p", execute: async () => "ok" },
      ],
      { actor: "user-001", continueOnError: true },
    );
    expect(result.status).toBe("failed");
    expect(result.activities.map((a) => a.status)).toEqual(["failed", "done"]);
    expect((db.query("SELECT status FROM process_run WHERE id = ?").get(result.processRunId) as { status: string }).status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// runDeliberationRounds
// ---------------------------------------------------------------------------

interface CapturedCall { agentKey: string; prompt: string }

/** Fake committee: agent K in round N answers "POSITION K/N" with a unique nonce. */
function makeCommitteeFake(keys: string[]): { callAgent: CallAgent; calls: CapturedCall[]; positions: Map<string, string[]> } {
  const calls: CapturedCall[] = [];
  const counts = new Map<string, number>();
  const positions = new Map<string, string[]>();
  const callAgent: CallAgent = async (agentKey, prompt) => {
    calls.push({ agentKey, prompt });
    const n = (counts.get(agentKey) ?? 0) + 1;
    counts.set(agentKey, n);
    const md = `POSITION ${agentKey}/${n} nonce-${agentKey}-${n}`;
    if (!positions.has(agentKey)) positions.set(agentKey, []);
    positions.get(agentKey)!.push(md);
    return { positionMd: md, confidence: 70 + n, recommendation: "go" };
  };
  return { callAgent, calls, positions };
}

const MEMBERS = [{ agentKey: "market-analyst" }, { agentKey: "risk-officer" }, { agentKey: "fin-analyst" }];

describe("runDeliberationRounds", () => {
  test("round 2 prompts CONTAIN the full round-1 positions of all OTHER members, verbatim", async () => {
    const { callAgent, calls, positions } = makeCommitteeFake(MEMBERS.map((m) => m.agentKey));
    const result = await runDeliberationRounds(
      { entityType: "opportunity", entityId: (db.query("SELECT id FROM opportunity LIMIT 1").get() as { id: string } | null)?.id ?? ulid() },
      {
        committeeKey: "steering-committee",
        agents: MEMBERS,
        rounds: 2,
        topic: "S4 진출 여부 검토",
        callAgent,
        actor: "user-001",
      },
    );

    expect(result.status).toBe("done");
    expect(result.evaluation).not.toBeNull();

    // Every member was called twice (2 rounds × 3 members).
    for (const key of MEMBERS.map((m) => m.agentKey)) {
      const prompts = calls.filter((c) => c.agentKey === key).map((c) => c.prompt);
      expect(prompts.length).toBe(2);

      // Round 1: independent — no other member's position present.
      for (const other of MEMBERS.map((m) => m.agentKey)) {
        if (other === key) continue;
        expect(prompts[0]).not.toContain(positions.get(other)![0]);
      }
      // Own position is never fed back.
      expect(prompts[1]).not.toContain(positions.get(key)![0]);

      // Round 2: the FULL round-1 positions of ALL OTHER members, verbatim.
      for (const other of MEMBERS.map((m) => m.agentKey)) {
        if (other === key) continue;
        expect(prompts[1]).toContain(positions.get(other)![0]);
      }
    }
  });

  test("responsive rounds (ADR-0196): round 2 prompts add own prior position + contract + agenda; peers stay verbatim", async () => {
    const { callAgent, calls, positions } = makeCommitteeFake(MEMBERS.map((m) => m.agentKey));
    const prev = process.env.CO_NEWBIZ_COMMITTEE_RESPONSIVE;
    process.env.CO_NEWBIZ_COMMITTEE_RESPONSIVE = "1";
    try {
      await runDeliberationRounds(
        { entityType: "opportunity", entityId: (db.query("SELECT id FROM opportunity LIMIT 1").get() as { id: string } | null)?.id ?? ulid() },
        {
          committeeKey: "steering-committee",
          agents: MEMBERS,
          rounds: 2,
          topic: "S4 진출 여부 검토",
          callAgent,
          actor: "user-001",
          agenda: [{ id: "I1", title: "수요 전제" }],
        },
      );
    } finally {
      if (prev === undefined) delete process.env.CO_NEWBIZ_COMMITTEE_RESPONSIVE;
      else process.env.CO_NEWBIZ_COMMITTEE_RESPONSIVE = prev;
    }
    for (const key of MEMBERS.map((m) => m.agentKey)) {
      const prompts = calls.filter((c) => c.agentKey === key).map((c) => c.prompt);
      expect(prompts[0]).not.toContain("## 응답 규칙"); // round 1 untouched
      expect(prompts[0]).not.toContain("## 안건 쟁점");
      expect(prompts[1]).toContain(positions.get(key)![0]); // own prior position now present
      expect(prompts[1]).toContain("## 응답 규칙");
      expect(prompts[1]).toContain("- I1: 수요 전제");
      for (const other of MEMBERS.map((m) => m.agentKey)) {
        if (other !== key) expect(prompts[1]).toContain(positions.get(other)![0]);
      }
    }
  });

  test("agent_position rows written per round per member; member_type defaults to agent", async () => {
    const { callAgent } = makeCommitteeFake(MEMBERS.map((m) => m.agentKey));
    const result = await runDeliberationRounds(
      { entityType: "project", entityId: projectId },
      { committeeKey: "steering-committee", agents: MEMBERS, rounds: 2, topic: "t", callAgent, actor: "user-001" },
    );

    const rows = db
      .query("SELECT round, member_type, agent_key, human_user_id, position_md, confidence FROM agent_position WHERE process_run_id = ? ORDER BY round, agent_key")
      .all(result.processRunId) as { round: number; member_type: string; agent_key: string | null; human_user_id: string | null; position_md: string; confidence: number }[];
    expect(rows.length).toBe(6); // 3 members × 2 rounds
    expect(rows.every((r) => r.member_type === "agent" && r.agent_key !== null && r.human_user_id === null)).toBe(true);
    expect(new Set(rows.map((r) => r.round))).toEqual(new Set([1, 2]));
    expect(rows.every((r) => r.confidence >= 71 && r.confidence <= 72)).toBe(true);
  });

  test("human member seats write member_type='human' with human_user_id (exactly-one-of invariant)", async () => {
    db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [
      ulid(), "human-chair-01", "analyst", "active", "s", "h", 1, NOW,
    ]);
    const { callAgent } = makeCommitteeFake(["market-analyst"]);
    const result = await runDeliberationRounds(
      { entityType: "opportunity", entityId: (db.query("SELECT id FROM opportunity LIMIT 1").get() as { id: string }).id },
      {
        committeeKey: "steering-committee",
        agents: [
          { agentKey: "market-analyst" },
          { agentKey: "human-role:chair", memberType: "human", humanUserId: "human-chair-01" },
        ],
        rounds: 1,
        topic: "t",
        callAgent,
        actor: "user-001",
      },
    );
    const humanRow = db
      .query("SELECT member_type, agent_key, human_user_id FROM agent_position WHERE process_run_id = ? AND member_type = 'human'")
      .get(result.processRunId) as { member_type: string; agent_key: string | null; human_user_id: string };
    expect(humanRow.agent_key).toBeNull();
    expect(humanRow.human_user_id).toBe("human-chair-01");
  });

  test("default synthesis writes a gate_evaluation PROPOSAL (never a gate_decision / decision row)", async () => {
    const { callAgent } = makeCommitteeFake(MEMBERS.map((m) => m.agentKey));
    const result = await runDeliberationRounds(
      { entityType: "project", entityId: projectId },
      { committeeKey: "steering-committee", agents: MEMBERS, rounds: 1, topic: "t", callAgent, gate: "pre_fs", actor: "user-001" },
    );
    const ev = db
      .query("SELECT gate, recommendation, evaluated_by, dissent_json, process_run_id FROM gate_evaluation WHERE id = ?")
      .get(result.evaluation!.gateEvaluationId) as Record<string, unknown>;
    expect(ev.gate).toBe("pre_fs");
    expect(ev.recommendation).toBe("go"); // majority of the fake committee
    expect(ev.evaluated_by).toBe("process-governance-manager"); // standing chair
    expect(ev.dissent_json).toBeNull();
    expect(ev.process_run_id).toBe(result.processRunId);

    // ADR-0096 §5/§4: the orchestrator writes PROPOSALS only.
    expect((db.query("SELECT COUNT(*) c FROM gate_decision").get() as { c: number }).c).toBe(0);
    expect((db.query("SELECT COUNT(*) c FROM decision").get() as { c: number }).c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSynthesis — the dissent rule (ADR-0096 §6)
// ---------------------------------------------------------------------------

describe("buildSynthesis (dissent rule)", () => {
  const RISK_DISSent_MD = "이 구조는 환율 변동성에 노출되어 있어 GO 반대. 최소 60% 헤지 전제 없이는 승인 불가.";

  test("veto_dissent minority position is copied VERBATIM into dissent_json; majority stands", () => {
    const out = buildSynthesis([
      { memberKey: "market-analyst", positionMd: "시장성 충분", recommendation: "go" },
      { memberKey: "fin-analyst", positionMd: "재무 타당", recommendation: "go" },
      { memberKey: "risk-officer", positionMd: RISK_DISSent_MD, recommendation: "kill", vetoDissent: true },
    ]);
    expect(out.recommendation).toBe("go");
    expect(out.dissents).toEqual([{ member_key: "risk-officer", position_md: RISK_DISSent_MD }]);
    const parsed = JSON.parse(out.dissent_json!) as Array<{ member_key: string; position_md: string }>;
    expect(parsed).toHaveLength(1);
    // Verbatim: byte-identical position text, Korean included — never summarized.
    expect(parsed[0].position_md).toBe(RISK_DISSent_MD);
    expect(parsed[0].position_md).toBe(out.dissents[0].position_md);
  });

  test("a veto_dissent AGREEING with the majority is not a dissent", () => {
    const out = buildSynthesis([
      { memberKey: "a", positionMd: "x", recommendation: "go" },
      { memberKey: "b", positionMd: "y", recommendation: "go", vetoDissent: true },
    ]);
    expect(out.recommendation).toBe("go");
    expect(out.dissent_json).toBeNull();
  });

  test("no stated majority → hold; unflagged dissenting opinions are NOT captured", () => {
    const out = buildSynthesis([
      { memberKey: "a", positionMd: "go가 좋다", recommendation: "go" },
      { memberKey: "b", positionMd: "kill이 좋다", recommendation: "kill" }, // dissents but no veto flag
    ]);
    expect(out.recommendation).toBe("hold");
    expect(out.dissent_json).toBeNull();
  });

  test("empty committee → hold, no dissent", () => {
    const out = buildSynthesis([]);
    expect(out.recommendation).toBe("hold");
    expect(out.dissent_json).toBeNull();
  });

  test("deliberationPrompt: round 1 carries the topic only; rounds 2+ embed prior positions", () => {
    const member = { agentKey: "market-analyst" };
    const r1 = deliberationPrompt(member, "안건 A", [], 1);
    expect(r1).toContain("안건 A");
    const prior = [[
      { memberKey: "market-analyst", positionMd: "MY OWN" },
      { memberKey: "risk-officer", positionMd: "OTHER FULL TEXT" },
    ]];
    const r2 = deliberationPrompt(member, "안건 A", prior, 2);
    expect(r2).toContain("OTHER FULL TEXT");
    expect(r2).not.toContain("MY OWN");
  });
});

// ---------------------------------------------------------------------------
// Migration round-trip (0064/0065/0066) — survival-DB pattern
// ---------------------------------------------------------------------------

describe("migrations 0064–0066 round trip", () => {
  test("a legacy-shape process_run row survives 0064 as entity_type='project' with project_id preserved", () => {
    resetDb();
    const sdb = getDb(SURVIVAL_DB_PATH);
    sdb.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    // Build pre-0064 state with the REAL migration files, in filename order.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < "0064").sort();
    for (const file of files) {
      sdb.run(readFileSync(join(MIGRATIONS_DIR, file), "utf-8"));
      sdb.run("INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)", [file, file, NOW]);
    }

    const pid = ulid();
    sdb.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [pid, `NP-${pid.slice(-6)}`, NOW]);
    const legacyRunId = ulid();
    // Legacy (0045) shape: project_id NOT NULL, no entity columns.
    sdb.run(
      "INSERT INTO process_run (id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [legacyRunId, pid, "2.0.0", "screening", "done", "web", "user-001", "2026-09-01T09:00:00Z", "2026-09-01T09:05:00Z"],
    );
    const before = sdb.query("SELECT * FROM process_run WHERE id = ?").get(legacyRunId);

    try {
      const { applied } = runMigrations(SURVIVAL_DB_PATH);
      expect(applied).toContain("0064_process_execution_entity_generalize.sql");
      expect(applied).toContain("0065_agent_position_human_members.sql");
      expect(applied).toContain("0066_orchestration_linkage_and_dissent.sql");

      // Fresh connection for the post-migration read: bun caches prepared
      // statements per connection, and the "SELECT *" above was prepared
      // against the PRE-0064 table shape (stale columns after the rebuild).
      resetDb();
      const after = getDb(SURVIVAL_DB_PATH).query("SELECT * FROM process_run WHERE id = ?").get(legacyRunId) as Record<string, unknown>;
      // All original fields verbatim…
      for (const [k, v] of Object.entries(before as Record<string, unknown>)) {
        expect(after[k]).toBe(v);
      }
      // …plus the generalized addressing.
      expect(after.entity_type).toBe("project");
      expect(after.entity_id).toBe(pid);
      expect(after.project_id).toBe(pid); // compatibility column preserved
    } finally {
      // restore the main test singleton for the remaining describes — even on
      // failure, so later tests don't inherit the closed survival handle
      resetDb();
      db = getDb(TEST_DB_PATH);
    }
  });

  test("schema pins: process_run, agent_position, and the 0066 additive columns", () => {
    // 0064 — entity addressing NOT NULL + nullable compatibility project_id.
    const pr = tableColumns("process_run");
    const prByName = new Map(pr.map((c) => [c.name, c]));
    expect(pr.map((c) => c.name)).toEqual([
      "id", "entity_type", "entity_id", "project_id", "spec_version", "stage",
      "status", "source", "started_by", "started_at", "finished_at",
      // 0067 (ADR-0097): additive nullable committee-session metadata column.
      "meta_json",
    ]);
    expect(prByName.get("entity_type")).toMatchObject({ notnull: 1 });
    expect(prByName.get("entity_id")).toMatchObject({ notnull: 1 });
    expect(prByName.get("project_id")).toMatchObject({ notnull: 0 });
    // The entity CHECK survives the rebuild.
    expect(() =>
      db.run(
        "INSERT INTO process_run (id, entity_type, entity_id, spec_version, stage, started_by, started_at) VALUES (?,?,?,?,?,?,?)",
        [ulid(), "company", "x", "2.0.0", "s", "u", NOW],
      ),
    ).toThrow(/CHECK constraint failed/);

    // 0065 — member columns + relaxed agent_key.
    const ap = new Map(tableColumns("agent_position").map((c) => [c.name, c]));
    expect([...ap.keys()]).toEqual([
      "id", "process_run_id", "member_type", "agent_key", "human_user_id",
      "position_md", "confidence", "round", "created_at",
    ]);
    expect(ap.get("member_type")!.dflt_value).toBe("'agent'");
    expect(ap.get("agent_key")!.notnull).toBe(0);
    expect(ap.get("human_user_id")!.notnull).toBe(0);

    // 0066 — purely additive columns.
    const ge = new Map(tableColumns("gate_evaluation").map((c) => [c.name, c]));
    expect(ge.has("dissent_json")).toBe(true);
    for (const table of ["gate_decision", "route_decision", "brownfield_target"]) {
      const cols = new Map(tableColumns(table).map((c) => [c.name, c]));
      expect(cols.has("gate_evaluation_id")).toBe(true);
    }

    // The 0064 entity index exists alongside the preserved project index.
    const idx = db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='process_run'").all() as { name: string }[];
    expect(idx.map((i) => i.name)).toEqual(expect.arrayContaining(["idx_process_run_project", "idx_process_run_entity"]));
  });

  test("opportunity-scoped runs and human-member positions insert cleanly post-migration (FK integrity)", () => {
    // opportunity entity: no md_project FK needed.
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, spec_version, stage, started_by, started_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), "opportunity", "01OPP", "2.0.0", "steering-committee", "user-001", NOW],
    );
    // human_user_id FK enforced.
    expect(() =>
      db.run(
        "INSERT INTO agent_position (id, process_run_id, member_type, human_user_id, position_md, round, created_at) VALUES (?,?,?,?,?,?,?)",
        [ulid(), "01RUN", "human", "01NOUSER", "p", 1, NOW],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    // PRAGMA foreign_key_check across the rebuilt tables: clean.
    const violations = db.query("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);
  });
});
