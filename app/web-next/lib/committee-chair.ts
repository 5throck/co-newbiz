// committee-chair — the chair's facilitation passes (ADR-0196 §2.2 / §2.3,
// phase B): the agenda pass after round 1 and the minutes pass at session
// end. Recorder-pattern throughout (ADR-0053/0097): both passes PROPOSE,
// neither votes, and neither has a write path to the ADR-0096 §6 dissent or
// to the recommendation — the minutes schema has no field for either, and
// dissent is rendered verbatim from dissent_json.
//
// LLM first (committee.agenda / committee.minutes prompts, temperature 0.2),
// deterministic fallback always available: the agenda fallback reads the
// round-1 criteria scorecards (spread >= 2) plus a split-recommendation
// issue; the minutes fallback builds a thinner discussion from the
// `responds_to` tails alone. A budget/rate-limit/outage error NEVER fails
// the run — it degrades to the fallback and is marked `fallback: true`.
//
// This module is DB-free on purpose: callers (committee-session.ts, the CLI)
// load ChairPositionRow[] from agent_position and persist the result into
// process_run.meta_json (design §2.5, storage option S2 — no migration).
import { createHash } from "node:crypto";
import { parsePositionMeta, makeLlmChairAgenda, makeLlmChairMinutes } from "./committee-llm.ts";
import { committeeSeatsUseLlm } from "./committee-agents.ts";
import { getProviderConfig } from "./llm.ts";
import { committeeMinutesSchema, resolveMinutesDraft, type CommitteeMinutesJson } from "./committee-minutes-schema.ts";
// Design §9.2 (F2): the chair-pass result types' SSOT is deliberation.ts (the
// lower-level engine, already upstream). This module re-exports them so the
// existing import sites keep working; the local duplicates are gone.
import type { AgendaIssue, AgendaPassResult, MinutesPassResult } from "./deliberation.ts";
import type { AgentCallResult } from "./agent-orchestrator.ts";

export type { AgendaPassResult, MinutesPassResult };

export const AGENDA_PROMPT_VERSION = "committee.agenda@1";
// @2 (2026-11-10, design §8.5): the committee.minutes prompt gained the
// resolution decision rule (agreed/narrowed/unresolved + dissent-orthogonality)
// inside the existing 5-section skeleton; stored drafts are distinguishable
// by this version string.
export const MINUTES_PROMPT_VERSION = "committee.minutes@2";

/** One position as the chair passes see it: an agent_position row whose
 * position-meta tail is parsed by the chair passes when needed. */
export interface ChairPositionRow {
  id: string;
  seat: string;
  memberType: string;
  round: number;
  positionMd: string;
}

/** Stored form of the agenda provenance in process_run.meta_json.agenda_meta. */
export interface AgendaMeta {
  source: "llm" | "fallback" | "human_edited";
  model?: string;
  prompt_version: string;
  input_hash: string;
  created_at: string;
}

/** Stored form of the minutes draft in process_run.meta_json.minutes_draft (S2). */
export interface MinutesDraft {
  json: CommitteeMinutesJson;
  fallback: boolean;
  model?: string;
  prompt_version: string;
  input_hash: string;
  created_at: string;
  /** Design §8.6: a SIBLING of `json` — never inside the zod-validated JSON,
   * so the stored shape stays stable. Present (integer >= 0, 0 included) on
   * every LLM-pass draft; ABSENT on fallback drafts and pre-amendment
   * sessions. */
  degraded_resolutions?: number;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** sha256 over the ordered position ids+texts, the agenda, prompt version,
 * and model (ADR-0196 §2.6) — the regeneration eligibility key. */
export function chairInputHash(parts: unknown[]): string {
  const h = createHash("sha256");
  h.update(stableJson(parts));
  return h.digest("hex");
}

function llmModel(): string | undefined {
  // Same seam as the committee seats: the chair passes reach the LLM only
  // when the bootstrap registered the call-agent factory AND the provider is
  // configured — a configured provider alone must never change behavior.
  if (!committeeSeatsUseLlm()) return undefined;
  const cfg = getProviderConfig();
  return cfg ? (cfg.model ?? "unknown") : undefined;
}

/** The position-meta tail fields the chair passes read. */
type PositionMetaTail = Partial<
  Pick<
    AgentCallResult,
    "recommendation" | "vetoDissent" | "confidence" | "criteriaScores" | "respondsTo" | "stanceChanged" | "issues"
  >
>;

function parseMeta(row: ChairPositionRow): PositionMetaTail {
  return parsePositionMeta(row.positionMd) ?? {};
}

// ── Agenda pass (§2.2) ─────────────────────────────────────────────────────

const CRITERIA_KEYS = [
  "control_need",
  "capability_criticality",
  "market_uncertainty",
  "integration_capacity",
  "speed_to_capability",
] as const;

// Design §8.9: Korean display labels for the five criteria. Titles are
// display content — the Korean label ONLY; the machine key stays in code and
// tests via CRITERIA_KEYS, never in the rendered title.
const CRITERIA_LABELS: Record<(typeof CRITERIA_KEYS)[number], string> = {
  control_need: "통제 필요도",
  capability_criticality: "역량 결정성",
  market_uncertainty: "시장 불확실성",
  integration_capacity: "통합 역량",
  speed_to_capability: "역량확보 속도",
};

/**
 * Deterministic agenda fallback: one issue per criterion whose score spread
 * across round-1 seats is 2 or more, plus "Overall recommendation" when the
 * stated recommendations are split. At most 5 issues, ids I1..I5.
 */
export function computeAgendaFallback(rows: ChairPositionRow[]): AgendaIssue[] {
  const latest = new Map<string, ChairPositionRow>();
  for (const r of [...rows].sort((a, b) => a.round - b.round)) latest.set(r.seat, r);
  const issues: AgendaIssue[] = [];
  for (const criterion of CRITERIA_KEYS) {
    const votes: Array<{ seat: string; v: number }> = [];
    for (const r of latest.values()) {
      const v = parseMeta(r).criteriaScores?.[criterion];
      if (typeof v === "number") votes.push({ seat: r.seat, v });
    }
    if (votes.length < 2) continue;
    const min = Math.min(...votes.map((x) => x.v));
    const spread = Math.max(...votes.map((x) => x.v)) - min;
    if (spread < 2) continue;
    issues.push({
      id: `I${issues.length + 1}`,
      title: `기준 쟁점: ${CRITERIA_LABELS[criterion]} (의견 산포 ${spread})`,
      raisedBy: votes
        .filter((x) => x.v <= min + 1)
        .map((x) => x.seat)
        .slice(0, 3),
      contested: true,
    });
    if (issues.length >= 5) return issues;
  }
  const recs = new Set([...latest.values()].map((r) => parseMeta(r).recommendation).filter(Boolean));
  if (recs.size > 1 && issues.length < 5) {
    issues.push({
      id: `I${issues.length + 1}`,
      title: `전체 권고 분분 (${[...recs].sort().join("/")})`,
      contested: true,
    });
  }
  return issues;
}

function parseAgendaIssues(raw: unknown): AgendaIssue[] | null {
  const arr = (raw as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const clean: AgendaIssue[] = [];
  for (const item of arr.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const { id, title, raised_by, contested } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^I\d{1,2}$/.test(id) || typeof title !== "string" || title.trim() === "") continue;
    clean.push({
      id,
      title: title.trim(),
      ...(Array.isArray(raised_by)
        ? { raisedBy: raised_by.filter((s): s is string => typeof s === "string").slice(0, 8) }
        : {}),
      ...(contested === true ? { contested: true } : {}),
    });
  }
  return clean.length >= 2 ? clean : null;
}

/** Pull the outermost JSON object out of a reply that may carry prose/fences. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The chair agenda pass. LLM (committee.agenda, temperature 0.2, 2–5 issues)
 * with the deterministic fallback on any failure — including no LLM
 * configured, budget/rate-limit errors, or a malformed reply.
 */
export async function runChairAgenda(opts: { topic: string; rows: ChairPositionRow[] }): Promise<AgendaPassResult> {
  const createdAt = new Date().toISOString();
  const model = llmModel();
  let source: "llm" | "fallback" = "fallback";
  let agenda: AgendaIssue[] | null = null;
  if (model) {
    try {
      const call = makeLlmChairAgenda();
      const material = opts.rows
        .map((r) => `### ${r.seat} (round ${r.round}, position ${r.id})\n${r.positionMd}`)
        .join("\n\n");
      const text = await call(`검토/안건:\n${opts.topic}\n\n## 라운드 1 입장 원문\n\n${material}`);
      agenda = parseAgendaIssues(extractJson(text));
      if (agenda) source = "llm";
    } catch {
      agenda = null; // budget/rate-limit/outage → deterministic fallback
    }
  }
  agenda ??= computeAgendaFallback(opts.rows);
  return {
    agenda,
    source,
    ...(source === "llm" && model ? { model } : {}),
    promptVersion: AGENDA_PROMPT_VERSION,
    inputHash: chairInputHash([
      opts.rows.map((r) => [r.id, r.positionMd]),
      opts.topic,
      AGENDA_PROMPT_VERSION,
      model ?? null,
    ]),
    createdAt,
  };
}

// ── Minutes pass (§2.3) ────────────────────────────────────────────────────

/** All agenda ids a position touches (its `issues` tail fields). */
function issuesOf(row: ChairPositionRow): string[] {
  return parseMeta(row).issues ?? [];
}

/**
 * Deterministic minutes fallback — thinner but true (design §2.3): the
 * discussion is built ONLY from the `responds_to` tails, grouped by issue.
 * Agreements and action items stay empty; `ask` acts surface as open
 * questions owned by the addressed seat.
 */
export function computeMinutesFallback(agenda: AgendaIssue[], rows: ChairPositionRow[]): CommitteeMinutesJson {
  const effective =
    agenda.length > 0 ? agenda : [...new Set(rows.flatMap(issuesOf))].sort().map((id) => ({ id, title: `쟁점 ${id}` }));
  const byIssue = new Map<string, CommitteeMinutesJson["discussion"][number]>();
  for (const issue of effective) {
    byIssue.set(issue.id, { issue_id: issue.id, exchanges: [], resolution: "unresolved" });
  }
  const openQuestions: CommitteeMinutesJson["open_questions"] = [];
  for (const row of rows) {
    for (const resp of parseMeta(row).respondsTo ?? []) {
      const firstIssue = byIssue.keys().next().value;
      const issueId = resp.issue && byIssue.has(resp.issue) ? resp.issue : firstIssue;
      if (issueId === undefined) continue;
      const d = byIssue.get(issueId) as { exchanges: unknown[] };
      d.exchanges.push({
        seat: row.seat,
        act: resp.act,
        summary: `${row.seat} → ${resp.seat}: ${resp.act}`,
        position_ref: row.id,
      });
      if (resp.act === "ask") openQuestions.push({ text: `${row.seat} → ${resp.seat} 질문`, owner_seat: resp.seat });
    }
  }
  for (const d of byIssue.values()) {
    const acts = d.exchanges.map((e) => e.act);
    d.resolution =
      acts.length > 0 && acts.every((a) => a === "agree")
        ? "agreed"
        : acts.includes("rebut")
          ? "unresolved"
          : acts.length > 0
            ? "narrowed"
            : "unresolved";
  }
  return {
    agenda: effective.map(({ id, title }) => ({ id, title })),
    discussion: [...byIssue.values()],
    agreements: [],
    open_questions: openQuestions.slice(0, 20),
    action_items: [],
  };
}

/**
 * The chair minutes pass. Input: the session topic (design §8.4 — the pass
 * knows what meeting it is minuting), all rounds, the agenda, the
 * responds_to tails — never the recommendation as an authority and never the
 * dissent. Output: the zod-validated minutes JSON with fabricated refs and
 * non-session seats dropped. Any LLM failure degrades to the deterministic
 * fallback with `fallback: true`.
 */
export async function runChairMinutes(opts: {
  topic: string;
  agenda: AgendaIssue[];
  rows: ChairPositionRow[];
  seats: readonly string[];
}): Promise<MinutesPassResult> {
  const createdAt = new Date().toISOString();
  const model = llmModel();
  let json: CommitteeMinutesJson | null = null;
  let fallback = true;
  let degraded = 0;
  if (model) {
    try {
      const call = makeLlmChairMinutes();
      const material = [
        // Design §8.4: the topic leads the material — the chair minutes pass
        // must know what meeting it is minuting (the topic includes the brief
        // via sessionTopic).
        "## 심의 안건",
        opts.topic,
        "",
        "## 안건 쟁점 (의장 제안)",
        ...opts.agenda.map((i) => `- ${i.id}: ${i.title}`),
        "",
        "## 발언 기록 (position_ref는 반드시 아래의 position id여야 한다)",
        ...opts.rows.map((r) => {
          const m = parseMeta(r);
          const tail = {
            ...(m.recommendation ? { recommendation: m.recommendation } : {}),
            ...(m.respondsTo && m.respondsTo.length > 0 ? { responds_to: m.respondsTo } : {}),
            ...(m.stanceChanged !== undefined ? { stance_changed: m.stanceChanged } : {}),
            ...(m.issues && m.issues.length > 0 ? { issues: m.issues } : {}),
          };
          const body = r.positionMd.replace(/<!--position-meta:[\s\S]*?-->/g, "").trim();
          return `### ${r.seat} (round ${r.round}, position_ref=${r.id}, meta=${JSON.stringify(tail)})\n${body}`;
        }),
      ].join("\n");
      const text = await call(material);
      const parsedDraft = extractJson(text);
      const resolved = resolveMinutesDraft(parsedDraft, {
        knownSeats: [...new Set(opts.seats)],
        positionIds: opts.rows.map((r) => r.id),
        agendaIds: opts.agenda.map((a) => a.id),
      });
      if (resolved.draft) {
        json = resolved.draft;
        degraded = resolved.degraded;
        fallback = false;
      } else {
        // Schema violations are silent by design in resolveMinutesDraft —
        // surface them here so a systematically failing minutes pass is
        // diagnosable from the server log.
        const check = committeeMinutesSchema.safeParse(parsedDraft);
        console.warn(
          "[committee-chair] minutes draft rejected:",
          check.success
            ? "refs did not resolve"
            : check.error.issues
                .slice(0, 5)
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
        );
      }
    } catch (err) {
      // budget/rate-limit/outage or unparseable output → deterministic fallback.
      // Logged, never silent: a systematically failing minutes pass would
      // otherwise look like a working (but empty) minutes surface.
      console.warn(
        "[committee-chair] minutes LLM pass failed, using deterministic fallback:",
        err instanceof Error ? err.message : String(err),
      );
      json = null;
    }
  }
  json ??= computeMinutesFallback(opts.agenda, opts.rows);
  return {
    json,
    fallback,
    ...(fallback || !model ? {} : { model }),
    promptVersion: MINUTES_PROMPT_VERSION,
    // Design §8.4: the topic joins the hash — a topic change makes the stored
    // draft regeneration-eligible (the documented blast radius: every
    // UNCONFIRMED stored session becomes regeneration-eligible; CONFIRMED
    // sessions stay frozen because the confirm refusal precedes the hash
    // comparison).
    inputHash: chairInputHash([
      opts.rows.map((r) => [r.id, r.positionMd]),
      opts.agenda,
      opts.topic,
      MINUTES_PROMPT_VERSION,
      model ?? null,
    ]),
    createdAt,
    degradedResolutions: fallback ? 0 : degraded,
  };
}

/**
 * The minutes input hash recomputed WITHOUT running the pass — the
 * regeneration eligibility key: regeneration is allowed only while
 * unconfirmed and when this differs from the stored draft's hash or the
 * stored draft is a fallback (ADR-0196 decision 4). Parts are [rows, agenda,
 * topic, MINUTES_PROMPT_VERSION, model] — the same formula runChairMinutes
 * hashes with (design §8.4).
 */
export function minutesInputHashFor(topic: string, agenda: AgendaIssue[], rows: ChairPositionRow[]): string {
  return chairInputHash([
    rows.map((r) => [r.id, r.positionMd]),
    agenda,
    topic,
    MINUTES_PROMPT_VERSION,
    llmModel() ?? null,
  ]);
}
