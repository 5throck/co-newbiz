// @version 1.1.0
// Demo committee meetings for the user-manual screenshots (ADR-0204, turn-based meetings).
//
// The S1-S12 demo seed carries no committee sessions, so the S4 / S7 committee history and the meeting window
// (minutes v2, full transcript) had nothing to show. This module convenes FINISHED turn-engine sessions on the
// Brown Field demo opportunity through the real engine — `createCommitteeSession` + `runCommitteeSession` with the
// deterministic turn caller — so the rows (turn rows, minutes v2, sittings) are exactly what the product writes.
// No LLM, no network: the seed process never registers the LLM call-agent factory, so the chair agenda and the
// minutes pass take their deterministic fallbacks. One session is resumed (a seeded provider failure at issue 2,
// then `advanceCommitteeSession`) so the minutes carry two sittings.
//
// The engine finishes in well under a second, which would read as "0초" in the history rows. After each meeting the
// timestamps are therefore rewritten to fixed, realistic offsets from the seed time (a few hours apart; ~6 / ~5 / ~8
// minutes of sitting time, the resumed meeting with a 20-minute gap between its two sittings that the duration logic
// excludes) and the minutes are regenerated so held_at / sittings carry the same times.
//
// Capture-only: wired from scripts/co-newbiz/manual-capture.ts, not from the generic demo seeds, so the
// predicate/e2e tests that read the plain S1-S12 chain are unaffected.
//
// Usage (library): await seedCommitteeTurnDemo(dbPath, { opportunityId });
import { getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Sitting windows as [startOffsetMs, endOffsetMs] from the session start; one entry per sitting. */
interface Timing {
  startedAgoMs: number;
  sittings: Array<[number, number]>;
}
const S4A_TIMING: Timing = { startedAgoMs: 6 * HOUR, sittings: [[0, 6 * MIN]] };
const S4B_TIMING: Timing = {
  startedAgoMs: 4 * HOUR,
  sittings: [
    [0, 2.5 * MIN],
    [22.5 * MIN, 25 * MIN],
  ],
};
const S7_TIMING: Timing = { startedAgoMs: 2 * HOUR, sittings: [[0, 8 * MIN]] };

export interface CommitteeTurnDemoResult {
  /** S4 route-steering sessions, oldest first (the last one is the resumed, two-sitting meeting). */
  s4SessionIds: string[];
  /** S6/S7 target-longlist-shortlist session. */
  s7SessionId: string;
}

const ACTOR = "demo-seed";
const S4_COMMITTEE = "route-steering-committee";
const S7_COMMITTEE = "target-longlist-shortlist-committee";

/** Fixed, short agendas: keeps the deterministic meetings fast and the screenshots readable. */
const S4_AGENDA = ["진출 방식(인수·합작·자체 설립) 적합성", "필수 인허가와 인증 선행 조건", "자금 조달과 통합 위험"];
const S7_AGENDA = ["후보 대상 스크리닝 결과 확인", "최종 후보 목록 확정 여부"];

/** Convene finished turn-engine meetings on `opportunityId`. Idempotent: skips when the demo meetings already exist. */
export async function seedCommitteeTurnDemo(
  dbPath: string | undefined,
  opts: { opportunityId: string },
): Promise<CommitteeTurnDemoResult> {
  runMigrations(dbPath);
  const db = getDb(dbPath);

  const existing = db
    .query(
      "SELECT id, stage FROM process_run WHERE entity_type = 'opportunity' AND entity_id = ? AND started_by = ? ORDER BY started_at, id",
    )
    .all(opts.opportunityId, ACTOR) as Array<{ id: string; stage: string }>;
  const s7Existing = existing.find((r) => r.stage === "brownfield_target");
  if (s7Existing) {
    return {
      s4SessionIds: existing.filter((r) => r.stage === "route_decision").map((r) => r.id),
      s7SessionId: s7Existing.id,
    };
  }

  const agents = await import("../../app/web-next/lib/committee-agents.ts");
  const session = await import("../../app/web-next/lib/committee-session.ts");
  const turns = await import("../../app/web-next/lib/committee-turns.ts");
  // The chair passes must stay deterministic whatever the host process registered earlier.
  agents.setCallAgentFactory(null);
  const det = turns.deterministicTurnCaller();

  const convene = (
    committeeKey: string,
    gate: "pre_fs" | "target_screening",
    agenda: string[],
    extra: { briefMd?: string; track?: string },
  ) => {
    const created = session.createCommitteeSession(
      { entityType: "opportunity", entityId: opts.opportunityId },
      {
        committeeKey,
        decisionMode: "agent_team",
        gate,
        engine: "turns",
        actor: ACTOR,
        callAgent: agents.deterministicCallAgent(), // only skips the llm_required guard; the turns come from callTurn
        source: "web",
        ...extra,
      },
    );
    session.patchMeta(created.sessionId, { agenda: agenda.map((title, i) => ({ id: `I${i + 1}`, title })) });
    return created.sessionId;
  };

  // S4 #1 — a single sitting.
  const s4a = convene(S4_COMMITTEE, "pre_fs", S4_AGENDA, { track: "brownfield" });
  await session.runCommitteeSession(s4a, { callTurn: det });

  // S4 #2 — stops at issue 2 (provider failure), then resumed: two sittings.
  const s4b = convene(S4_COMMITTEE, "pre_fs", S4_AGENDA, { track: "brownfield" });
  const flaky: import("../../app/web-next/lib/committee-turns.ts").CallTurn = async (req) => {
    if (req.issueIndex === 2 && req.kind === "turn") throw new Error("provider overloaded");
    return det(req);
  };
  await session.runCommitteeSession(s4b, { callTurn: flaky }).then(
    () => {
      throw new Error("seed: the seeded failure did not stop the meeting");
    },
    (err: unknown) => {
      if (!(err instanceof Error) || err.message !== "provider overloaded") throw err;
    },
  );
  const resumed = await session.advanceCommitteeSession(s4b, { actor: ACTOR, callTurn: det });
  if (resumed.status !== "synthesized") throw new Error(`seed: the resumed meeting did not finish (${resumed.status})`);

  // S6/S7 shortlist committee — a single sitting.
  const s7 = convene(S7_COMMITTEE, "target_screening", S7_AGENDA, {
    briefMd:
      "S1-S12 데모 대상회사 — 스크리닝 점검표 판정을 근거로 최종 후보 목록 편입 여부를 심의합니다. (데모 데이터)",
  });
  await session.runCommitteeSession(s7, { callTurn: det });

  const nowMs = Date.now();
  await backdate(s4a, nowMs, S4A_TIMING);
  await backdate(s4b, nowMs, S4B_TIMING);
  await backdate(s7, nowMs, S7_TIMING);

  return { s4SessionIds: [s4a, s4b], s7SessionId: s7 };
}

/** Rewrite one finished session's clock to `timing` (see the header), then regenerate its (fallback) minutes. */
async function backdate(sessionId: string, nowMs: number, timing: Timing): Promise<void> {
  const session = await import("../../app/web-next/lib/committee-session.ts");
  const turns = await import("../../app/web-next/lib/committee-turns.ts");
  const db = getDb();
  const iso = (ms: number): string => new Date(ms).toISOString();
  const t0 = nowMs - timing.startedAgoMs;
  const sittings = timing.sittings.map(([a, b]) => ({ start: t0 + a, end: t0 + b }));
  const first = sittings[0];
  const last = sittings[sittings.length - 1];
  if (!first || !last) throw new Error("seed: a timing needs at least one sitting");

  const run = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
  const meta = JSON.parse(run.meta_json) as {
    attempts?: Array<Record<string, unknown>>;
    progress?: Record<string, unknown>;
    agenda_meta?: Record<string, unknown>;
  };
  if ((meta.attempts?.length ?? 0) !== sittings.length) {
    throw new Error(`seed: session has ${meta.attempts?.length ?? 0} sittings, timing has ${sittings.length}`);
  }
  const attempts = (meta.attempts ?? []).map((a, i) => ({
    ...a,
    started_at: iso(sittings[i]!.start),
    ended_at: iso(sittings[i]!.end),
  }));

  // Turn rows: spread evenly across their own sitting (attempt), in seq order.
  const records = turns.loadTurnRecords(sessionId);
  for (let i = 0; i < sittings.length; i++) {
    const rows = records.filter((r) => r.attempt === i + 1).sort((a, b) => a.seq - b.seq);
    const w = sittings[i]!;
    rows.forEach((r, k) => {
      db.run("UPDATE agent_position SET created_at = ? WHERE id = ?", [
        iso(w.start + Math.floor(((w.end - w.start) * (k + 1)) / (rows.length + 1))),
        r.id,
      ]);
    });
  }
  db.run("UPDATE gate_evaluation SET created_at = ? WHERE process_run_id = ?", [iso(last.end), sessionId]);
  db.run("UPDATE process_run SET started_at = ?, finished_at = ? WHERE id = ?", [
    iso(first.start),
    iso(last.end),
    sessionId,
  ]);
  session.patchMeta(sessionId, {
    attempts: attempts as never,
    progress: { ...meta.progress, started_at: iso(last.start), updated_at: iso(last.end) } as never,
    ...(meta.agenda_meta
      ? { agenda_meta: { ...meta.agenda_meta, created_at: iso(first.start + 5_000) } as never }
      : {}),
  });

  // Minutes carry held_at / sittings: rebuild from the rewritten attempts, then stamp the draft with the end time.
  const draft = await session.regenerateCommitteeMinutes(sessionId);
  session.patchMeta(sessionId, { minutes_draft: { ...draft, created_at: iso(last.end + 10_000) } });
}

if (import.meta.main) {
  const i = process.argv.indexOf("--db-path");
  const dbPath = i >= 0 ? process.argv[i + 1] : undefined;
  const opp = process.argv.indexOf("--opportunity");
  if (opp < 0 || !process.argv[opp + 1])
    throw new Error("usage: seed-committee-turn-demo.ts --opportunity <id> [--db-path <path>]");
  const r = await seedCommitteeTurnDemo(dbPath, { opportunityId: process.argv[opp + 1]! });
  console.log(`committee turn demo ready: s4=${r.s4SessionIds.join(",")} s7=${r.s7SessionId}`);
}
