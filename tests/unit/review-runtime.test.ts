import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ADR-0153 (Wave F PR F-2) — 3-stage review runtime for the 7 gate proposals.
// The LLM is ALWAYS mocked here; no real provider is ever called.
const TEST_DB_PATH = "db/data/test-review-runtime.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { insertAiReview, insertHumanFinal, ReviewWriteError, findReview } = await import(
  "../../db/repositories/review.repository.ts"
);
const { buildGateArtifact, gateStageIds, REVIEW_GATES, gateEntityType } = await import(
  "../../app/web-next/lib/review/gate-artifacts.ts"
);
const { runAiFirstChecks } = await import("../../app/web-next/lib/review/ai-first.ts");
const { runAiSecond, parseAi2ndOutput, monthlyTokenCap, buildAi2ndMessages } = await import(
  "../../app/web-next/lib/review/ai-second.ts"
);
const { runAiFirst, runReview, getReviewView, resolveArtifact } = await import(
  "../../app/web-next/lib/review/engine.ts"
);
const { handleReview } = await import("../../app/web-next/lib/review/http.ts");
const { selectReviewer, agentDomain } = await import("../../app/web-next/lib/review/domains.ts");
const { loadStageActivities } = await import("../../app/web-next/lib/spec-activities.ts");
const { AGENT_REGISTRY, AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
import type { Ai2ndDeps } from "../../app/web-next/lib/review/ai-second.ts";
import type { ReviewBuckets } from "../../db/repositories/review.repository.ts";

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
const USER = "reviewer-human";
let leadCookie = "";

function newOpp(): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    `opp-${id.slice(-5)}`,
    "assessed",
    "test",
    NOW,
  ]);
  return id;
}
function newProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `PRJ-${id.slice(-6)}`, NOW]);
  return id;
}
const count = (table: string): number => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const VALID_REPLY = JSON.stringify({
  verified: [{ claim: "Stage S1 records exist", reason: "listed in artifact", evidence_ref: "stage:S1" }],
  could_not_verify: [{ claim: "Source accuracy", reason: "no source documents were provided" }],
  needs_judgement: [{ claim: "Attractiveness weighting", reason: "trade-off between growth and risk" }],
});

function fakeDeps(replies: Array<string | Error>, calls: { n: number }): Ai2ndDeps {
  return {
    complete: async () => {
      const r = replies[Math.min(calls.n, replies.length - 1)];
      calls.n++;
      if (r instanceof Error) throw r;
      return r;
    },
    isConfigured: () => true,
    modelId: () => "mock-model",
  };
}
/** AI 1st buckets with no structural gap — the precondition for AI 2nd. */
const CLEAN: ReviewBuckets = {
  verified: [],
  could_not_verify: [{ claim: "Accuracy not examined", reason: "structure only" }],
  needs_judgement: [],
};

beforeAll(async () => {
  await createUser(db, {
    userId: "lead-rv",
    role: "analyst",
    password: "pw-lead-rv-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "lead-rv", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: "lead-rv", password: "pw-lead-rv-12345" }),
  });
  leadCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("migration 0124 + repository guards (no PASS stamp)", () => {
  test("AI stages cannot carry a result at the table level; human_final can", () => {
    const base = `INSERT INTO review_stage (id, stage, reviewer_agent_or_user, unverified_items_json, result, created_at) VALUES (?,?,?,?,?,?)`;
    expect(() => db.run(base, [ulid(), "ai_1st", "x", "[]", "pass", NOW])).toThrow();
    expect(() => db.run(base, [ulid(), "ai_2nd", "x", "[]", "approved", NOW])).toThrow();
    expect(() => db.run(base, [ulid(), "human_final", "someone", "[]", "go", NOW])).not.toThrow();
  });
  test("insertAiReview rejects a human stage and an empty could_not_verify", () => {
    const common = {
      artifactKey: "gate:screening",
      entityType: "opportunity" as const,
      entityId: "e",
      stageId: "S3",
      contentHash: "h",
      authorDomain: null,
      reviewerAgent: "platform-lead",
      reviewerDomain: "technical",
      performed: true,
      requestedBy: USER,
      db,
    };
    expect(() => insertAiReview({ ...common, stage: "human_final" as unknown as "ai_1st", buckets: CLEAN })).toThrow(
      ReviewWriteError,
    );
    expect(() =>
      insertAiReview({
        ...common,
        stage: "ai_2nd",
        buckets: { verified: [], could_not_verify: [], needs_judgement: [] },
      }),
    ).toThrow(ReviewWriteError);
    expect(() => insertAiReview({ ...common, stage: "ai_2nd", performed: false, buckets: CLEAN })).toThrow(
      ReviewWriteError,
    );
  });
  test("a human_final write by an agent id throws; by a human succeeds", () => {
    const input = {
      artifactKey: "gate:dd",
      entityType: "project" as const,
      entityId: "p",
      stageId: "S9",
      contentHash: "h",
      result: "go",
      unverifiedItems: [],
      reviewedRefs: {},
      agentIds: AGENT_KEYS,
      db,
    };
    expect(() => insertHumanFinal({ ...input, reviewerUser: "platform-lead" })).toThrow(ReviewWriteError);
    expect(() => insertHumanFinal({ ...input, reviewerUser: USER, result: " " })).toThrow(ReviewWriteError);
    expect(() => insertHumanFinal({ ...input, reviewerUser: USER })).not.toThrow();
  });
});

describe("agent domains and cross-domain reviewer selection", () => {
  test("every agent in the roster has a domain frontmatter value", () => {
    for (const a of AGENT_REGISTRY) expect(a.domain, a.key).not.toBeNull();
    expect(agentDomain("backend-engineer")).toBe("technical");
    expect(agentDomain("risk-officer")).toBe("functional");
    expect(agentDomain("pm")).toBeNull();
  });
  test("a same-domain reviewer is never selected (table-driven over every agent)", () => {
    for (const a of AGENT_REGISTRY) {
      const d = agentDomain(a.key);
      const sel = selectReviewer([a.key]);
      if (d === null) expect(sel.ok, a.key).toBe(false);
      else if (sel.ok) expect(sel.reviewerDomain, a.key).not.toBe(d);
    }
  });
  test("a same-domain reviewer is never selected (table-driven over all gate artifacts)", () => {
    for (const gate of REVIEW_GATES) {
      const authors = [...new Set(gateStageIds(gate).flatMap((s) => loadStageActivities(s).map((x) => x.agent)))];
      const sel = selectReviewer(authors);
      if (sel.ok) {
        for (const a of authors) expect(agentDomain(a), `${gate}:${a}`).not.toBe(sel.reviewerDomain);
      } else {
        expect(sel.reason.length).toBeGreaterThan(0);
      }
    }
  });
  test("an unresolvable author domain means not performed, never a same-domain fallback", () => {
    const sel = selectReviewer(["pm", "docs-writer"]);
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("reviewer domain unresolved");
  });
  test("ADR-0185 W3-C: s3.synergy_fa / s3.capability_gap_draft rebinds keep a cross-domain AI-2nd reviewer (functional author -> technical reviewer)", () => {
    for (const author of ["financial-analyst", "process-governance-manager", "risk-officer"]) {
      const sel = selectReviewer([author]);
      expect(sel.ok).toBe(true);
      if (sel.ok) {
        expect(sel.reviewerDomain).toBe("technical");
        expect(sel.reviewerAgent).toBe("platform-lead");
      }
    }
  });
});

describe("AI 1st (deterministic)", () => {
  test("structural gaps land in could_not_verify; could_not_verify is never empty; no verdict fields", () => {
    const opp = newOpp();
    const artifact = buildGateArtifact("screening", opp);
    expect(artifact.entityType).toBe("opportunity");
    const buckets = runAiFirstChecks(artifact);
    expect(buckets.could_not_verify.length).toBeGreaterThan(0);
    expect(buckets.could_not_verify.some((i) => i.structural)).toBe(true);
    expect(Object.keys(buckets).sort()).toEqual(["could_not_verify", "needs_judgement", "verified"]);
    expect(buckets.needs_judgement.some((i) => i.claim.includes("screening gate verdict"))).toBe(true);
  });
  test("a screening-gate entity at S1: later gate stages are not_reached, non-structural; only S1 is structural", () => {
    const opp = newOpp();
    const artifact = buildGateArtifact("screening", opp);
    expect(artifact.stages.find((s) => s.id === "S1")!.not_reached).toBeUndefined();
    const later = artifact.stages.filter((s) => s.id !== "S1");
    expect(later.length).toBeGreaterThan(0);
    for (const s of later) expect(s.not_reached).toBe(true);
    const buckets = runAiFirstChecks(artifact);
    const nr = buckets.could_not_verify.filter((i) => i.scope === "not_reached");
    expect(nr).toHaveLength(later.length);
    expect(nr.every((i) => i.structural === false)).toBe(true);
    expect(buckets.could_not_verify.filter((i) => i.structural === true)).toHaveLength(1);
  });
  test("the content hash is stable for the same evidence and AI 1st is reused", () => {
    const opp = newOpp();
    const a = buildGateArtifact("pre_fs", opp);
    const b = buildGateArtifact("pre_fs", opp);
    expect(a.contentHash).toBe(b.contentHash);
    const r1 = runAiFirst({ gate: "pre_fs", entityId: opp, userId: USER, db });
    const r2 = runAiFirst({ gate: "pre_fs", entityId: opp, userId: USER, db });
    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(r2.id).toBe(r1.id);
  });
  test("every gate artifact builds for its carrier", () => {
    const opp = newOpp();
    const prj = newProject();
    for (const gate of REVIEW_GATES) {
      const art = buildGateArtifact(gate, gateEntityType(gate) === "opportunity" ? opp : prj);
      expect(art.artifactKey).toBe(`gate:${gate}`);
      expect(art.stages.length).toBeGreaterThan(0);
    }
  });
});

describe("AI 2nd (LLM mocked)", () => {
  function setup() {
    const opp = newOpp();
    const artifact = buildGateArtifact("screening", opp);
    return { opp, artifact };
  }

  test("a gate none of whose stages is reached is not performed and never calls the LLM", async () => {
    const pid = newProject();
    const artifact = buildGateArtifact("dd", pid);
    expect(artifact.stages.every((s) => s.not_reached === true)).toBe(true);
    const calls = { n: 0 };
    const buckets = runAiFirstChecks(artifact);
    const out = await runAiSecond(
      { artifact, ai1stBuckets: buckets, userId: USER, db },
      fakeDeps([VALID_REPLY], calls),
    );
    expect(out.performed).toBe(false);
    expect(out.notPerformedReason).toContain("No stage of this gate has been reached");
    expect(calls.n).toBe(0);
  });

  test("a screening gate with S1 complete and later stages not reached runs AI 2nd on the reached stages only", async () => {
    const opp = newOpp();
    const artifact = buildGateArtifact("screening", opp);
    const reached = {
      ...artifact,
      stages: artifact.stages.map((s) => (s.id === "S1" ? { ...s, status: "complete" as const } : s)),
    };
    const calls = { n: 0 };
    const ai1 = runAiFirstChecks(reached);
    expect(ai1.could_not_verify.some((i) => i.structural === true)).toBe(false);
    const out = await runAiSecond(
      { artifact: reached, ai1stBuckets: ai1, userId: USER, db },
      fakeDeps([VALID_REPLY], calls),
    );
    expect(out.notPerformedReason ?? "").not.toContain("structural gaps");
  });

  test("completeStructured dep: provider token count is the recorded cost; a null result is not performed", async () => {
    const out = JSON.parse(VALID_REPLY) as ReviewBuckets;
    const ok: Ai2ndDeps = {
      ...fakeDeps([VALID_REPLY], { n: 0 }),
      completeStructured: async () => ({ value: out, tokens: 1234 }),
    };
    const a = setup().artifact;
    const done = await runAiSecond({ artifact: a, ai1stBuckets: CLEAN, userId: USER, db }, ok);
    expect(done.performed).toBe(true);
    expect(findReview("ai_2nd", "opportunity", a.entityId, a.artifactKey, a.contentHash, db)!.cost_tokens).toBe(1234);
    const none: Ai2ndDeps = { ...ok, completeStructured: async () => null };
    const b = setup().artifact;
    const skipped = await runAiSecond({ artifact: b, ai1stBuckets: CLEAN, userId: USER, db }, none);
    expect(skipped.performed).toBe(false);
    expect(skipped.notPerformedReason).toContain("not valid");
  });

  test("valid output is stored in the 3 buckets by a different-domain reviewer; result stays NULL", async () => {
    const { artifact } = setup();
    const calls = { n: 0 };
    const out = await runAiSecond({ artifact, ai1stBuckets: CLEAN, userId: USER, db }, fakeDeps([VALID_REPLY], calls));
    expect(out.performed).toBe(true);
    expect(calls.n).toBe(1);
    const row = findReview("ai_2nd", "opportunity", artifact.entityId, artifact.artifactKey, artifact.contentHash, db)!;
    expect(row.result).toBeNull();
    expect(row.reviewer_domain).not.toBe(row.author_domain);
    expect(row.model_id).toBe("mock-model");
    expect(row.cost_tokens).toBeGreaterThan(0);
    expect(row.requested_by).toBe(USER);
    expect(JSON.parse(row.unverified_items_json).length).toBeGreaterThan(0);
  });

  test("a cache hit on identical content makes no LLM call", async () => {
    const { artifact } = setup();
    const calls = { n: 0 };
    const deps = fakeDeps([VALID_REPLY], calls);
    await runAiSecond({ artifact, ai1stBuckets: CLEAN, userId: USER, db }, deps);
    const again = await runAiSecond({ artifact, ai1stBuckets: CLEAN, userId: USER, db }, deps);
    expect(again.cached).toBe(true);
    expect(calls.n).toBe(1);
  });

  test("an empty could_not_verify is rejected; invalid JSON retries once then is recorded as not performed", async () => {
    const { artifact } = setup();
    expect(parseAi2ndOutput(JSON.stringify({ verified: [], could_not_verify: [], needs_judgement: [] }))).toBeNull();
    expect(
      parseAi2ndOutput(
        JSON.stringify({
          verified: [],
          could_not_verify: [{ claim: "c", reason: "r" }],
          needs_judgement: [],
          verdict: "pass",
        }),
      ),
    ).toBeNull();
    expect(parseAi2ndOutput("not json")).toBeNull();
    const calls = { n: 0 };
    const out = await runAiSecond(
      { artifact, ai1stBuckets: CLEAN, userId: USER, db },
      fakeDeps(["garbage", '{"verified":[]}'], calls),
    );
    expect(calls.n).toBe(2);
    expect(out.performed).toBe(false);
    expect(out.notPerformedReason).toContain("not valid after one retry");
    expect(out.buckets.could_not_verify.length).toBeGreaterThan(0);
  });

  test("an unconfigured LLM, a failing LLM and structural AI 1st gaps are each 'not performed' (no fallback)", async () => {
    const { artifact } = setup();
    const calls = { n: 0 };
    const unconfigured = { ...fakeDeps([VALID_REPLY], calls), isConfigured: () => false };
    const a = await runAiSecond({ artifact, ai1stBuckets: CLEAN, userId: USER, db }, unconfigured);
    expect(a.performed).toBe(false);
    expect(a.notPerformedReason).toContain("not configured");

    const b = await runAiSecond(
      { artifact, ai1stBuckets: CLEAN, userId: USER, db },
      fakeDeps([new Error("boom")], calls),
    );
    expect(b.performed).toBe(false);
    expect(b.notPerformedReason).toContain("LLM call failed: boom");

    const gaps: ReviewBuckets = {
      ...CLEAN,
      could_not_verify: [{ claim: "S1 incomplete", reason: "x", structural: true }],
    };
    const c = await runAiSecond({ artifact, ai1stBuckets: gaps, userId: USER, db }, fakeDeps([VALID_REPLY], calls));
    expect(c.performed).toBe(false);
    expect(c.notPerformedReason).toContain("structural gaps");
    expect(calls.n).toBe(1); // only the failing-LLM case called out
  });

  test("an unresolved author domain is recorded as not performed", async () => {
    const { artifact } = setup();
    const calls = { n: 0 };
    const out = await runAiSecond(
      { artifact: { ...artifact, authorAgents: ["pm"] }, ai1stBuckets: CLEAN, userId: USER, db },
      fakeDeps([VALID_REPLY], calls),
    );
    expect(out.performed).toBe(false);
    expect(out.notPerformedReason).toBe("reviewer domain unresolved");
    expect(calls.n).toBe(0);
  });

  test("the monthly token cap (env, default 200k) blocks the call and is recorded as not performed", async () => {
    delete process.env.REVIEW_MONTHLY_TOKEN_CAP;
    expect(monthlyTokenCap()).toBe(200_000);
    process.env.REVIEW_MONTHLY_TOKEN_CAP = "5";
    try {
      expect(monthlyTokenCap()).toBe(5);
      const { artifact } = setup();
      const calls = { n: 0 };
      const out = await runAiSecond(
        { artifact, ai1stBuckets: CLEAN, userId: USER, db },
        fakeDeps([VALID_REPLY], calls),
      );
      expect(out.performed).toBe(false);
      expect(out.notPerformedReason).toContain("monthly token cap reached");
      expect(calls.n).toBe(0);
    } finally {
      delete process.env.REVIEW_MONTHLY_TOKEN_CAP;
    }
  });

  test("runReview on an incomplete opportunity: AI 1st writes, AI 2nd is not performed, view has 3 buckets and no verdict", async () => {
    const opp = newOpp();
    const calls = { n: 0 };
    const { ai1st, ai2nd } = await runReview(
      { gate: "screening", entityId: opp, userId: USER, db },
      fakeDeps([VALID_REPLY], calls),
    );
    expect(ai1st.buckets.could_not_verify.length).toBeGreaterThan(0);
    expect(ai2nd.performed).toBe(false);
    expect(calls.n).toBe(0);
    const view = getReviewView("screening", opp, db);
    expect(view.ai_1st?.current).toBe(true);
    expect(view.ai_2nd?.performed).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/"(result|verdict|pass|score)"/i);
  });
});

describe("boundary #2 regression", () => {
  const ROOT = resolve(import.meta.dirname, "..", "..");
  const REVIEW_DIR = join(ROOT, "app/web-next/lib/review");
  // http.ts is request plumbing (auth + project visibility, which legitimately
  // reach shared infra); the ENGINE — everything that runs a review — is what
  // must have no path to a decision writer.
  const entry = [
    ...readdirSync(REVIEW_DIR)
      .filter((f) => f.endsWith(".ts") && f !== "http.ts")
      .map((f) => join(REVIEW_DIR, f)),
    join(ROOT, "db/repositories/review.repository.ts"),
  ];

  function resolveImport(from: string, spec: string): string | null {
    if (!spec.startsWith(".")) return null;
    const p = resolve(dirname(from), spec);
    for (const c of [p, `${p}.ts`, `${p}.tsx`, join(p, "index.ts")]) if (existsSync(c) && c.match(/\.tsx?$/)) return c;
    return null;
  }
  function closure(): Set<string> {
    const seen = new Set<string>();
    const stack = [...entry];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const r = resolveImport(f, m[1]);
        if (r) stack.push(r);
      }
    }
    return seen;
  }
  const FORBIDDEN_FILES = [
    /app\/web-next\/app\/api\//,
    /db\/lib\/approval-chain\.ts$/,
    /db\/repositories\/closure\.repository\.ts$/,
    /db\/repositories\/project\.repository\.ts$/,
    /lib\/closure-http\.ts$/,
  ];
  const PROTECTED_WRITE =
    /(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(gate_decision|approval\w*|venture_transition_decision|closure_record)\b/i;

  test("the review module has no import path to the gate / approval / transition / closure writers", () => {
    const files = [...closure()].map((f) => f.slice(ROOT.length + 1));
    expect(files.length).toBeGreaterThan(entry.length);
    for (const f of files) {
      for (const bad of FORBIDDEN_FILES) expect(f, `forbidden import path: ${f}`).not.toMatch(bad);
    }
  });

  test("no file reachable from the review module contains a write to a decision table", () => {
    for (const f of closure()) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(PROTECTED_WRITE);
    }
  });

  test("running the review engine writes no gate_decision / approval / transition / closure rows", async () => {
    const opp = newOpp();
    const prj = newProject();
    const tables = ["gate_decision", "approval_chain", "venture_transition_decision", "closure_record"];
    const before = tables.map(count);
    const deps = fakeDeps([VALID_REPLY], { n: 0 });
    for (const gate of REVIEW_GATES) {
      await runReview({ gate, entityId: gateEntityType(gate) === "opportunity" ? opp : prj, userId: USER, db }, deps);
    }
    expect(tables.map(count)).toEqual(before);
    expect(count("review_stage")).toBeGreaterThan(0);
    // and no AI row carries a result
    expect(
      (
        db
          .query("SELECT COUNT(*) AS n FROM review_stage WHERE stage != 'human_final' AND result IS NOT NULL")
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });
});

describe("HTTP: human_final only via the human gate POST; review routes", () => {
  let pid = "";
  beforeAll(() => {
    pid = newProject();
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, "lead-rv", "lead", "test", NOW, "test"],
    );
  });
  const humanFinals = (entityId: string) =>
    db.query("SELECT * FROM review_stage WHERE stage = 'human_final' AND entity_id = ?").all(entityId) as Array<{
      result: string;
      reviewer_agent_or_user: string;
      artifact_key: string;
      unverified_items_json: string;
      content_hash: string;
      reviewed_refs_json: string;
    }>;

  test("the review routes never create a human_final row", async () => {
    const r1 = await nextRequest(`/api/projects/${pid}/reviews`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "dd" }),
    });
    expect(r1.status).toBe(200);
    const body = (
      (await r1.json()) as {
        data: { ai_1st: { verified: unknown[]; could_not_verify: unknown[]; needs_judgement: unknown[] } | null };
      }
    ).data;
    expect(body.ai_1st?.could_not_verify.length).toBeGreaterThan(0);
    const r2 = await nextRequest(`/api/projects/${pid}/reviews/ai-2nd`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "dd" }),
    });
    expect(r2.status).toBe(200); // no stage of the dd gate is reached yet (or AI 1st has structural gaps) => recorded as not performed
    const view = ((await r2.json()) as { data: { ai_2nd: { performed: boolean; not_performed_reason: string } } }).data;
    expect(view.ai_2nd.performed).toBe(false);
    expect(humanFinals(pid)).toHaveLength(0);
    const get = await nextRequest(`/api/projects/${pid}/reviews?gate=dd`, { headers: { cookie: leadCookie } });
    expect(get.status).toBe(200);
    expect(
      (await nextRequest(`/api/projects/${pid}/reviews?gate=nope`, { headers: { cookie: leadCookie } })).status,
    ).toBe(400);
    expect(
      (await nextRequest(`/api/projects/${pid}/reviews?gate=screening`, { headers: { cookie: leadCookie } })).status,
    ).toBe(400);
    expect((await nextRequest(`/api/projects/${pid}/reviews?gate=dd`)).status).toBe(401);
  });

  test("a project gate-decision POST writes exactly one human_final row for the session user, with the AI gaps still unverified", async () => {
    await nextRequest(`/api/projects/${pid}/reviews`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "dd" }),
    });
    const res = await nextRequest(`/api/projects/${pid}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({
        gate: "dd",
        decision: "hold",
        missing_artifacts: ["DD checklist"],
        rationale: "reviewed",
      }),
    });
    expect(res.status).toBe(201);
    const rows = humanFinals(pid);
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("hold");
    expect(rows[0].reviewer_agent_or_user).toBe("lead-rv");
    expect(rows[0].artifact_key).toBe("gate:dd");
    expect(JSON.parse(rows[0].unverified_items_json).length).toBeGreaterThan(0);
    expect(JSON.parse(rows[0].reviewed_refs_json).ai_1st_id).toBeTruthy();
  });

  test("a gate outside the 7 proposals (target_screening) writes no human_final row", async () => {
    const o = newOpp();
    const before = count("review_stage");
    const res = await nextRequest(`/api/opportunities/${o}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({
        gate: "target_screening",
        decision: "hold",
        missing_artifacts: ["S7 shortlist"],
        rationale: "r",
      }),
    });
    expect(res.status).toBe(201);
    expect(count("review_stage")).toBe(before);
  });

  test("an opportunity screening decision writes a human_final row; the S12 transition does too", async () => {
    const o = newOpp();
    const res = await nextRequest(`/api/opportunities/${o}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "screening", decision: "hold", rationale: "r", missing_artifacts: ["x"] }),
    });
    expect(res.status).toBe(201);
    const rows = humanFinals(o);
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("hold");

    const t = await nextRequest(`/api/projects/${pid}/transition-decision`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ decision: "next_tranche_released", rationale: "ok", tranche_condition: "milestone" }),
    });
    expect(t.status).toBe(201);
    const tr = db
      .query(
        "SELECT * FROM review_stage WHERE stage = 'human_final' AND artifact_key = 'gate:transition' AND entity_id = ?",
      )
      .all(pid) as Array<{ result: string }>;
    expect(tr).toHaveLength(1);
    expect(tr[0].result).toBe("next_tranche_released");
  });
});

describe("AI 2nd request locale (spec 2026-11-06-ai-review-stage-scope-fit-i18n follow-up)", () => {
  const directive = (locale: string) =>
    `Write the claim and reason text of every item in ${locale} (BCP-47). Keep evidence_ref values and JSON keys exactly as specified.`;

  test("buildAi2ndMessages: locale set -> directive appended; absent -> prompt unchanged", () => {
    const artifact = buildGateArtifact("screening", newOpp());
    const withKo = buildAi2ndMessages(artifact, "platform-lead", "technical", "functional", "ko");
    expect(withKo[0].content).toContain(directive("ko"));
    const without = buildAi2ndMessages(artifact, "platform-lead", "technical", "functional");
    expect(without[0].content).not.toContain("(BCP-47)");
    expect(without[0].content).toContain("You are a reviewer for a new-business investment review team.");
  });

  test("runAiSecond threads the locale into the LLM messages", async () => {
    const { artifact } = (() => {
      const opp = newOpp();
      return { artifact: buildGateArtifact("screening", opp) };
    })();
    let system = "";
    const deps: Ai2ndDeps = {
      complete: async (messages) => {
        system = messages[0].content;
        return VALID_REPLY;
      },
      isConfigured: () => true,
      modelId: () => "mock-model",
    };
    const out = await runAiSecond({ artifact, ai1stBuckets: CLEAN, userId: USER, locale: "en", db }, deps);
    expect(out.performed).toBe(true);
    expect(system).toContain(directive("en"));
  });

  test("http: POST locale 'ko' reaches the AI 2nd prompt; invalid locales are ignored without error", async () => {
    // Opportunity carrier: seed a clean cached AI 1st row for the built
    // artifact's content hash so AI 2nd actually runs against the mocked deps.
    const opp = newOpp();
    const artifact = buildGateArtifact("screening", opp);
    insertAiReview({
      stage: "ai_1st",
      artifactKey: artifact.artifactKey,
      entityType: "opportunity",
      entityId: opp,
      stageId: artifact.stageId,
      contentHash: artifact.contentHash,
      buckets: CLEAN,
      authorDomain: null,
      reviewerAgent: "deterministic-checks",
      reviewerDomain: null,
      performed: true,
      requestedBy: USER,
      db,
    });
    const systems: string[] = [];
    const deps: Ai2ndDeps = {
      complete: async (messages) => {
        systems.push(messages[0].content);
        return VALID_REPLY;
      },
      isConfigured: () => true,
      modelId: () => "mock-model",
    };
    // handleReview is called directly (mocked deps); synthesize the CSRF
    // double-submit the nextRequest helper mirrors for cookie mutations.
    const post = (entityId: string, body: unknown) =>
      handleReview(
        new Request(`http://t/api/opportunities/${entityId}/reviews/ai-2nd`, {
          method: "POST",
          headers: { cookie: `${leadCookie}; co_newbiz_csrf=t`, "x-csrf-token": "t" },
          body: JSON.stringify(body),
        }),
        "opportunity",
        entityId,
        "ai-2nd",
        deps,
      );
    const ok = await post(opp, { gate: "screening", locale: "ko" });
    expect(ok.status).toBe(200);
    expect(systems.length).toBe(1);
    expect(systems[0]).toContain(directive("ko"));
    // A different artifact content (different opp) so no cache hit; the invalid
    // locales are advisory — ignored, English prompt, still 200.
    for (const bad of ["123", "<script>", "ko_KR"]) {
      const opp2 = newOpp();
      const a2 = buildGateArtifact("screening", opp2);
      insertAiReview({
        stage: "ai_1st",
        artifactKey: a2.artifactKey,
        entityType: "opportunity",
        entityId: opp2,
        stageId: a2.stageId,
        contentHash: a2.contentHash,
        buckets: CLEAN,
        authorDomain: null,
        reviewerAgent: "deterministic-checks",
        reviewerDomain: null,
        performed: true,
        requestedBy: USER,
        db,
      });
      const res = await post(opp2, { gate: "screening", locale: bad });
      expect(res.status).toBe(200);
      expect(systems.length).toBe(2);
      expect(systems[1]).not.toContain("(BCP-47)");
      systems.length = 1;
    }
  });
});
