// committee-minutes-v2 — minutes of a turn-engine meeting (ADR-0204 phase 3,
// design 2026-11-20 §4.6 / §13 Q7 / §15.2).
//
// DB-free and LLM-free on purpose: everything here is a pure function over the
// stored turn rows (TurnRecord[]), so it is unit-testable without a database and
// the no-fabrication rule is enforced in one place.
//
//   * collectIssueFacts      — per issue: participants, consensus, votes, outcome,
//                              tally, per-seat recommendation, all read from rows;
//   * buildMinutesV2Material — the numbered transcript the chair model selects from;
//   * resolveMinutesV2Selection — the model's picks, validated: an excerpt turn must
//                              be a live speech turn of THAT issue, a quote must be
//                              made of verbatim fragments (else the whole utterance is
//                              used and the repair is counted), anything else is
//                              rejected and counted — never silently dropped;
//   * assembleMinutesV2      — the stored v2 JSON; issues the model did not cover get
//                              the deterministic excerpt (consensus proposal + close
//                              row) and are recorded as fallback;
//   * verifyMinutesV2        — re-checks every reference and quote against the rows;
//   * buildMinutesAppendix   — appendix A (full transcript, non-abandoned, seq order)
//                              and B (abandoned attempts), deterministic;
//   * minutesV2*Lines        — the markdown pieces (header, body, open items, appendix).
//
// The chair has NO write path to the recommendation or to dissent: the schema has
// no field for either (ADR-0096 §6, ADR-0204).
import type { AgendaIssue } from "./deliberation.ts";
import {
  committeeMinutesV2Schema,
  MINUTES_V2_VERSION,
  type CommitteeMinutesV2Json,
  type MinutesV2Excerpt,
  type MinutesV2Issue,
  type MinutesV2LlmOutput,
} from "./committee-minutes-schema.ts";
import {
  CHAIR_DISPLAY_NAME,
  liveRecords,
  notParticipatingSeats,
  resolveSeatName,
  seatDisplayName,
  type SeatNamer,
  type TurnRecord,
} from "./committee-turns.ts";

/** Stored as minutes_draft.prompt_version of a turn-engine meeting (`committee.minutes_turns` prompt). */
export const MINUTES_V2_PROMPT_VERSION = "committee.minutes@3";

/** The header line, rendered by code — never by the model. */
export const MINUTES_V2_HEADER = "AI 위원회 회의 기록 — 사람이 모인 회의가 아니며, 결정은 사람이 합니다.";

const OUTCOME_LABELS: Record<string, string> = { agreed: "합의", narrowed: "일부 합의", unresolved: "미합의(보류)" };
const REASON_LABELS: Record<string, string> = {
  budget: "발언·시간 한도에 도달해 합의 없이 닫음",
  consensus_failed: "합의안을 정리하지 못해 닫음",
  not_closed: "닫히지 않음",
};
const VOTE_LABELS: Record<string, string> = { accept: "동의", reserve: "유보", no_response: "응답 없음" };

/** Max excerpt turns per issue (the model is asked for 2 to 5). */
export const MAX_EXCERPT_PER_ISSUE = 6;
const MIN_FRAGMENT_CHARS = 3;
const SPEECH_MOVES = new Set(["propose", "ask", "answer", "rebut", "concede", "amend", "speak"]);

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Who is speaking, by display name — never an agent key. */
export function speakerLabel(r: Pick<TurnRecord, "role" | "speaker">, name: SeatNamer = seatDisplayName): string {
  if (r.role === "chair") return CHAIR_DISPLAY_NAME;
  if (r.role === "human") return `${name(r.speaker)} (사람)`;
  return name(r.speaker);
}

/** A discussion utterance a person could quote: a seat's / human's speech move that did not fail. */
export function isSpeechTurn(r: TurnRecord): boolean {
  return r.role !== "chair" && !r.error && SPEECH_MOVES.has(r.move) && collapse(r.utterance).length > 0;
}

// ── Verbatim quotes ────────────────────────────────────────────────────────

const ELLIPSIS_RE = /\s*(?:…|\.{3})\s*/;

/** The fragments of a quote: split at an ellipsis, whitespace collapsed, empties dropped. */
export function quoteFragments(quote: string): string[] {
  return quote
    .split(ELLIPSIS_RE)
    .map(collapse)
    .filter((x) => x.length > 0);
}

/** True when every fragment of `quote` occurs in `utterance`, in order (whitespace-insensitive, otherwise exact). */
export function isVerbatim(utterance: string, quote: string): boolean {
  const hay = collapse(utterance);
  const whole = collapse(quote);
  if (whole === "") return false;
  if (hay.includes(whole)) return true; // one contiguous run, including a literal "..." inside the utterance
  const frags = quoteFragments(quote);
  if (frags.length === 0) return false;
  let from = 0;
  for (const f of frags) {
    if (f.length < MIN_FRAGMENT_CHARS && f !== hay) return false;
    const at = hay.indexOf(f, from);
    if (at < 0) return false;
    from = at + f.length;
  }
  return true;
}

/**
 * The quote to store for a turn. No quote from the model = the whole utterance. A quote whose
 * fragments are not all verbatim is REPAIRED to the whole utterance (and flagged), never stored.
 */
export function verbatimQuote(
  utterance: string,
  quote: string | undefined,
): { quote: string; full: boolean; repaired: boolean } {
  const whole = collapse(utterance);
  if (quote === undefined || collapse(quote) === "") return { quote: whole, full: true, repaired: false };
  if (!isVerbatim(utterance, quote)) return { quote: whole, full: true, repaired: true };
  const frags = quoteFragments(quote);
  if (frags.length === 1 && frags[0] === whole) return { quote: whole, full: true, repaired: false };
  const first = whole.indexOf(frags[0]);
  const lastFrag = frags[frags.length - 1];
  const lastAt = whole.lastIndexOf(lastFrag);
  const lead = first > 0 ? "… " : "";
  const tail = lastAt + lastFrag.length < whole.length ? " …" : "";
  return { quote: `${lead}${frags.join(" … ")}${tail}`, full: false, repaired: false };
}

// ── Facts read from the rows ───────────────────────────────────────────────

export interface MinutesV2Input {
  agenda: readonly AgendaIssue[];
  /** Every turn row of the run (live and abandoned), any order. */
  records: readonly TurnRecord[];
  currentAttempt: number;
  chairSeat: string;
  /** The committee's agent seats (registry order). */
  seats: readonly string[];
  attempts?: ReadonlyArray<{ attempt: number; started_at?: string; ended_at?: string }>;
  heldAt?: string;
  name?: SeatNamer;
}

export interface IssueFacts {
  index: number;
  issue: AgendaIssue;
  /** Live rows of the issue in seq order. */
  rows: TurnRecord[];
  speech: TurnRecord[];
  open?: TurnRecord;
  close?: TurnRecord;
  consensus?: TurnRecord;
  base: Omit<MinutesV2Issue, "excerpt" | "excerpt_source">;
}

const bySeq = (a: TurnRecord, b: TurnRecord): number => a.seq - b.seq;

/** Per-issue facts, read from the live rows only (partial turns of a stopped sitting are excluded). */
export function collectIssueFacts(input: MinutesV2Input): IssueFacts[] {
  const name = input.name ?? seatDisplayName;
  const live = liveRecords([...input.records].sort(bySeq), input.currentAttempt);
  return input.agenda.map((issue, idx): IssueFacts => {
    const index = idx + 1;
    const rows = live.filter((r) => r.issueIndex === index && r.move !== "resume").sort(bySeq);
    const chair = rows.filter((r) => r.role === "chair");
    const open = chair.find((r) => r.move === "open");
    const close = [...chair].reverse().find((r) => r.move === "close");
    const consensus = [...chair].reverse().find((r) => r.move === "propose_consensus" && !r.error);
    const speech = rows.filter(isSpeechTurn);

    const reasons = new Map((issue.participants ?? []).map((p) => [p.seat, p.reason] as const));
    const participantKeys = open?.participants ?? [
      ...new Set(speech.filter((r) => r.role === "seat").map((r) => r.speaker)),
    ];
    const guestKeys = [
      ...new Set(speech.filter((r) => r.role === "seat" && !participantKeys.includes(r.speaker)).map((r) => r.speaker)),
    ];

    // Votes: the seat rows after the consensus proposal. A vote the seat could not give is stored as an
    // error pass — reported as "no response", never as accept.
    const votes: MinutesV2Issue["votes"] = [];
    if (consensus) {
      const last = new Map<string, TurnRecord>();
      for (const r of rows) {
        if (r.role === "chair" || r.seq <= consensus.seq) continue;
        if (r.vote || (r.move === "pass" && r.error)) last.set(r.speaker, r);
      }
      for (const r of last.values()) {
        const vote = r.vote ?? "no_response";
        const reason = vote === "no_response" ? undefined : collapse(r.utterance);
        votes.push({ seat: r.speaker, name: name(r.speaker), vote, ...(reason ? { reason } : {}) });
      }
    }
    const tally = {
      accept: close?.votes?.accept ?? votes.filter((v) => v.vote === "accept").length,
      reserve: close?.votes?.reserve ?? votes.filter((v) => v.vote === "reserve").length,
      abstain: close?.votes?.abstain ?? votes.filter((v) => v.vote === "no_response").length,
      not_participating: close?.votes?.not_participating ?? close?.nonParticipants?.length ?? 0,
    };
    const satOut = (close?.nonParticipants ?? []).map((seat) => ({ seat, name: name(seat) }));
    const recommendations: MinutesV2Issue["seat_recommendations"] = [];
    for (const r of rows) {
      if (r.role === "chair" || !r.vote || r.recommendation === undefined) continue;
      const entry = {
        seat: r.speaker,
        name: name(r.speaker),
        recommendation: r.recommendation,
        ...(r.vetoDissent ? { veto_dissent: true } : {}),
      };
      const at = recommendations.findIndex((x) => x.seat === r.speaker);
      if (at >= 0) recommendations[at] = entry;
      else recommendations.push(entry);
    }
    const reason = close?.reason ?? (close ? undefined : "not_closed");
    return {
      index,
      issue,
      rows,
      speech,
      ...(open ? { open } : {}),
      ...(close ? { close } : {}),
      ...(consensus ? { consensus } : {}),
      base: {
        issue_id: issue.id as MinutesV2Issue["issue_id"],
        title: issue.title,
        participants: participantKeys.map((seat) => ({ seat, name: name(seat), reason: reasons.get(seat) ?? "" })),
        guests: guestKeys.map((seat) => ({ seat, name: name(seat) })),
        sat_out: satOut,
        consensus: consensus
          ? {
              turn_id: consensus.id,
              proposal: collapse(consensus.utterance) || consensus.utterance,
              rests_on_turns: (consensus.restsOn ?? []).filter((id) => rows.some((r) => r.id === id)),
            }
          : null,
        votes,
        outcome: close?.outcome ?? "unresolved",
        ...(reason ? { outcome_reason: reason } : {}),
        tally,
        seat_recommendations: recommendations,
      },
    };
  });
}

// ── Model material and selection ───────────────────────────────────────────

/** The numbered transcript the chair model selects from (display names only). */
export function buildMinutesV2Material(
  topic: string,
  facts: readonly IssueFacts[],
  name: SeatNamer = seatDisplayName,
): string {
  const out: string[] = [
    "## 심의 안건",
    topic,
    "",
    "## 안건별 발언 기록",
    "각 발언 앞의 #번호가 발언 번호입니다. excerpt에는 같은 안건의 번호만 쓸 수 있습니다.",
  ];
  for (const f of facts) {
    out.push("", `### ${f.issue.id}: ${f.issue.title}`);
    const names = f.base.participants.map((p) => p.name);
    if (names.length > 0) out.push(`참여 위원: ${names.join(", ")}`);
    if (f.speech.length === 0) out.push("(발언 없음)");
    for (const r of f.speech) {
      const to = r.addressedTo ? ` → ${name(r.addressedTo)}` : "";
      out.push(`#${r.seq} ${speakerLabel(r, name)} [${r.move}${to}]: ${collapse(r.utterance)}`);
    }
    if (f.base.consensus) out.push(`합의안(의장): ${f.base.consensus.proposal}`);
    const t = f.base.tally;
    out.push(
      `결과: ${OUTCOME_LABELS[f.base.outcome]} (동의 ${t.accept}, 유보 ${t.reserve}, 응답 없음 ${t.abstain}, 불참 ${t.not_participating})`,
    );
    for (const v of f.base.votes) if (v.vote === "reserve" && v.reason) out.push(`유보 사유 — ${v.name}: ${v.reason}`);
  }
  return out.join("\n");
}

export interface ResolvedSelection {
  excerpts: Map<string, MinutesV2Excerpt[]>;
  openItems: CommitteeMinutesV2Json["open_items"];
  rejectedRefs: number;
  repairedQuotes: number;
  notes: string[];
}

/** "7", "#7", 7 → 7; anything else is not a seq number. */
function seqOf(ref: number | string): number | undefined {
  if (typeof ref === "number") return Number.isInteger(ref) ? ref : undefined;
  const m = ref.trim().match(/^#?(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

function toExcerpt(
  r: TurnRecord,
  q: { quote: string; full: boolean; repaired: boolean },
  name: SeatNamer,
): MinutesV2Excerpt {
  return {
    turn_id: r.id,
    seq: r.seq,
    speaker_seat: r.speaker,
    speaker_name: speakerLabel(r, name),
    role: r.role,
    move: r.move,
    ...(r.addressedTo ? { addressed_name: name(r.addressedTo) } : {}),
    quote: q.quote,
    quote_full: q.full,
    ...(q.repaired ? { quote_repaired: true } : {}),
  };
}

/**
 * Validate the model's selection against the stored turns. A pick whose turn does not
 * resolve (unknown number/id, another issue, abandoned, not a speech turn) is REJECTED and
 * counted; a quote that is not verbatim is REPAIRED to the whole utterance and counted.
 */
export function resolveMinutesV2Selection(
  out: MinutesV2LlmOutput,
  facts: readonly IssueFacts[],
  input: Pick<MinutesV2Input, "seats" | "name">,
): ResolvedSelection {
  const name = input.name ?? seatDisplayName;
  const excerpts = new Map<string, MinutesV2Excerpt[]>();
  const notes: string[] = [];
  let rejected = 0;
  let repaired = 0;
  const byIssue = new Map(facts.map((f) => [f.issue.id, f] as const));
  for (const item of out.issues) {
    const f = byIssue.get(item.issue_id);
    if (!f) {
      rejected += item.excerpt.length;
      notes.push(`${item.issue_id}: issue is not on the agenda`);
      continue;
    }
    const picked: MinutesV2Excerpt[] = [];
    for (const pick of item.excerpt) {
      const seq = seqOf(pick.turn);
      const turn = f.speech.find((r) => (seq !== undefined ? r.seq === seq : r.id === String(pick.turn).trim()));
      if (!turn) {
        rejected += 1;
        notes.push(`${f.issue.id}: turn ${String(pick.turn)} does not resolve to a live speech turn of the issue`);
        continue;
      }
      if (picked.some((p) => p.turn_id === turn.id)) continue;
      const q = verbatimQuote(turn.utterance, pick.quote);
      if (q.repaired) {
        repaired += 1;
        notes.push(`${f.issue.id}: quote of turn ${turn.seq} was not verbatim — the whole utterance is shown`);
      }
      picked.push(toExcerpt(turn, q, name));
    }
    picked.sort((a, b) => a.seq - b.seq);
    if (picked.length > 0) excerpts.set(f.issue.id, picked.slice(0, MAX_EXCERPT_PER_ISSUE));
  }
  const openItems: CommitteeMinutesV2Json["open_items"] = [];
  for (const o of out.open_items ?? []) {
    const text = collapse(o.text);
    if (!text) continue;
    const owner = resolveSeatName(o.owner_seat, input.seats, name);
    const issue = o.issue_id && byIssue.has(o.issue_id) ? o.issue_id : undefined;
    openItems.push({
      text,
      ...(owner ? { owner_seat: owner, owner_name: name(owner) } : {}),
      ...(issue ? { issue_id: issue as MinutesV2Issue["issue_id"] } : {}),
    });
  }
  return { excerpts, openItems: openItems.slice(0, 20), rejectedRefs: rejected, repairedQuotes: repaired, notes };
}

// ── Assembly ───────────────────────────────────────────────────────────────

/** Deterministic excerpt: the consensus proposal and the close row (verbatim); with neither, the last two speech turns. */
export function fallbackExcerpt(f: IssueFacts, name: SeatNamer = seatDisplayName): MinutesV2Excerpt[] {
  const chairRows = [f.consensus, f.close].filter(
    (r): r is TurnRecord => r !== undefined && collapse(r.utterance) !== "",
  );
  const rows = chairRows.length > 0 ? chairRows : f.speech.slice(-2);
  return rows.map((r) => toExcerpt(r, verbatimQuote(r.utterance, undefined), name));
}

function deterministicOpenItems(
  facts: readonly IssueFacts[],
  covered: ReadonlySet<string>,
): CommitteeMinutesV2Json["open_items"] {
  const items: CommitteeMinutesV2Json["open_items"] = [];
  for (const f of facts) {
    if (f.base.outcome === "agreed" || covered.has(f.issue.id)) continue;
    const reserved = f.base.votes.filter((v) => v.vote === "reserve");
    items.push({
      text: `${f.issue.title} — ${OUTCOME_LABELS[f.base.outcome]}${f.base.outcome_reason ? ` (${REASON_LABELS[f.base.outcome_reason] ?? f.base.outcome_reason})` : ""}`,
      issue_id: f.base.issue_id,
    });
    for (const v of reserved) {
      items.push({
        text: `${f.issue.title} — 유보(${v.name})${v.reason ? `: ${v.reason}` : ""}`,
        issue_id: f.base.issue_id,
      });
    }
  }
  return items;
}

function sittingsOf(
  input: MinutesV2Input,
  live: readonly TurnRecord[],
): CommitteeMinutesV2Json["overview"]["sittings"] {
  const attemptNos = new Set<number>([
    ...(input.attempts ?? []).map((a) => a.attempt),
    ...input.records.map((r) => r.attempt),
  ]);
  if (attemptNos.size === 0) attemptNos.add(1);
  return [...attemptNos]
    .sort((a, b) => a - b)
    .map((attempt) => {
      const meta = (input.attempts ?? []).find((a) => a.attempt === attempt);
      const mine = input.records.filter((r) => r.attempt === attempt);
      const lastAt = mine.map((r) => r.createdAt).sort()[mine.length - 1];
      const closed = live
        .filter((r) => r.attempt === attempt && r.role === "chair" && r.move === "close" && r.issueId)
        .map((r) => r.issueId as string);
      const ended = meta?.ended_at ?? lastAt;
      return {
        attempt,
        ...(meta?.started_at ? { started_at: meta.started_at } : {}),
        ...(ended ? { ended_at: ended } : {}),
        closed_issue_ids: [
          ...new Set(closed),
        ] as CommitteeMinutesV2Json["overview"]["sittings"][number]["closed_issue_ids"],
      };
    });
}

/**
 * The stored v2 minutes JSON. `selection` is null for a fully deterministic draft (no model, or
 * the model failed); issues the selection did not cover get the deterministic excerpt and are
 * recorded in provenance.fallback_issue_ids — the dialogue is never silently dropped.
 * Throws when the assembled JSON fails the schema or its own reference check (a code bug).
 */
export function assembleMinutesV2(
  input: MinutesV2Input,
  facts: readonly IssueFacts[],
  selection: ResolvedSelection | null,
): CommitteeMinutesV2Json {
  const name = input.name ?? seatDisplayName;
  const records = [...input.records].sort(bySeq);
  const live = liveRecords(records, input.currentAttempt);
  const fallbackIds: string[] = [];
  const issues: MinutesV2Issue[] = facts.map((f) => {
    const picked = selection?.excerpts.get(f.issue.id);
    if (picked && picked.length > 0) return { ...f.base, excerpt: picked, excerpt_source: "llm" };
    fallbackIds.push(f.issue.id);
    return { ...f.base, excerpt: fallbackExcerpt(f, name), excerpt_source: "fallback" };
  });
  const covered = new Set((selection?.openItems ?? []).flatMap((o) => (o.issue_id ? [o.issue_id] : [])));
  const openItems = [...(selection?.openItems ?? []), ...deterministicOpenItems(facts, covered)].slice(0, 20);
  const humans = new Map<string, string>();
  for (const r of live) if (r.role === "human" && r.humanUserId) humans.set(r.humanUserId, r.speaker);
  const source = !selection
    ? "fallback"
    : fallbackIds.length === 0
      ? "llm"
      : fallbackIds.length === facts.length
        ? "fallback"
        : "mixed";
  const sittings = sittingsOf(input, live);
  const firstAt = records.map((r) => r.createdAt).sort()[0];
  const json: CommitteeMinutesV2Json = {
    version: MINUTES_V2_VERSION,
    overview: {
      kind: "ai_committee_meeting",
      engine: "turns",
      held_at: input.heldAt ?? sittings[0]?.started_at ?? firstAt ?? new Date().toISOString(),
      chair_seat: input.chairSeat,
      seats: input.seats.map((seat) => ({ seat, name: name(seat) })),
      not_participating: notParticipatingSeats(input.seats, live).map((seat) => ({ seat, name: name(seat) })),
      human_participants: [...humans].map(([user_id, seat]) => ({ user_id, seat })),
      sittings,
    },
    issues,
    open_items: openItems,
    provenance: {
      source,
      fallback_issue_ids: fallbackIds as CommitteeMinutesV2Json["provenance"]["fallback_issue_ids"],
      rejected_refs: selection?.rejectedRefs ?? 0,
      repaired_quotes: selection?.repairedQuotes ?? 0,
      notes: (selection?.notes ?? []).slice(0, 20),
    },
  };
  const parsed = committeeMinutesV2Schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `minutes v2 failed its schema: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const problems = verifyMinutesV2(parsed.data, records, input.currentAttempt);
  if (problems.length > 0) throw new Error(`minutes v2 failed its reference check: ${problems.slice(0, 5).join("; ")}`);
  return parsed.data;
}

/**
 * Re-check a v2 minutes JSON against the stored rows: every excerpt / consensus turn id must be a
 * live row of the right issue, every quote must be verbatim to that row's utterance, every
 * `rests_on_turns` id must be a live row. Returns the problems found ([] = clean).
 */
export function verifyMinutesV2(
  json: CommitteeMinutesV2Json,
  records: readonly TurnRecord[],
  currentAttempt: number,
): string[] {
  const live = new Map(liveRecords([...records].sort(bySeq), currentAttempt).map((r) => [r.id, r] as const));
  const problems: string[] = [];
  json.issues.forEach((issue, idx) => {
    const issueIndex = idx + 1;
    for (const e of issue.excerpt) {
      const r = live.get(e.turn_id);
      if (!r) problems.push(`${issue.issue_id}: excerpt turn ${e.turn_id} is not a live turn`);
      else if (r.issueIndex !== issueIndex)
        problems.push(`${issue.issue_id}: excerpt turn ${e.turn_id} belongs to another issue`);
      else if (r.seq !== e.seq)
        problems.push(`${issue.issue_id}: excerpt turn ${e.turn_id} has seq ${r.seq}, not ${e.seq}`);
      else if (!isVerbatim(r.utterance, e.quote))
        problems.push(`${issue.issue_id}: quote of turn ${e.turn_id} is not verbatim`);
    }
    if (issue.consensus) {
      const c = live.get(issue.consensus.turn_id);
      if (!c || c.issueIndex !== issueIndex)
        problems.push(`${issue.issue_id}: consensus turn ${issue.consensus.turn_id} is not a live turn of the issue`);
      for (const id of issue.consensus.rests_on_turns) {
        const r = live.get(id);
        if (!r || r.issueIndex !== issueIndex)
          problems.push(`${issue.issue_id}: consensus rests on unknown turn ${id}`);
      }
    }
  });
  return problems;
}

// ── Appendix (deterministic) ───────────────────────────────────────────────

export interface AppendixTurn {
  turnId: string;
  seq: number;
  attempt: number;
  issueIndex: number;
  issueId: string | null;
  role: TurnRecord["role"];
  speakerSeat: string;
  /** Display name; a human speaker carries "(사람)". */
  speakerName: string;
  move: string;
  addressedTo: string | null;
  addressedName: string | null;
  utterance: string;
  error: string | null;
  /** "[seq] 화자 · move → addressee: utterance" — the line the markdown prints. */
  line: string;
}

export interface MinutesAppendix {
  /** Appendix A: every non-abandoned turn, seq order. */
  transcript: AppendixTurn[];
  /** Appendix B: abandoned partial turns of stopped sittings, grouped by attempt (ascending). */
  abandoned: Array<{ attempt: number; turns: AppendixTurn[] }>;
}

function appendixTurn(r: TurnRecord, name: SeatNamer): AppendixTurn {
  const speakerName = speakerLabel(r, name);
  const addressedName = r.addressedTo ? name(r.addressedTo) : null;
  const utterance = collapse(r.utterance);
  return {
    turnId: r.id,
    seq: r.seq,
    attempt: r.attempt,
    issueIndex: r.issueIndex,
    issueId: r.issueId ?? null,
    role: r.role,
    speakerSeat: r.speaker,
    speakerName,
    move: r.move,
    addressedTo: r.addressedTo ?? null,
    addressedName,
    utterance,
    error: r.error ?? null,
    line: `[${r.seq}] ${speakerName} · ${r.move}${addressedName ? ` → ${addressedName}` : ""}: ${utterance}`,
  };
}

/** Appendix A / B from the stored rows. Deterministic: no model text anywhere. */
export function buildMinutesAppendix(
  records: readonly TurnRecord[],
  currentAttempt: number,
  name: SeatNamer = seatDisplayName,
): MinutesAppendix {
  const sorted = [...records].sort(bySeq);
  const live = new Set(liveRecords(sorted, currentAttempt).map((r) => r.id));
  const transcript = sorted.filter((r) => live.has(r.id)).map((r) => appendixTurn(r, name));
  const byAttempt = new Map<number, AppendixTurn[]>();
  for (const r of sorted) {
    if (live.has(r.id)) continue;
    byAttempt.set(r.attempt, [...(byAttempt.get(r.attempt) ?? []), appendixTurn(r, name)]);
  }
  return {
    transcript,
    abandoned: [...byAttempt].sort((a, b) => a[0] - b[0]).map(([attempt, turns]) => ({ attempt, turns })),
  };
}

// ── Markdown pieces ────────────────────────────────────────────────────────

/** Header block: the code-rendered notice and, when restarted, the sittings line. */
export function minutesV2HeaderLines(json: CommitteeMinutesV2Json): string[] {
  const lines = [`> ${MINUTES_V2_HEADER}`];
  const n = json.overview.sittings.length;
  if (n > 1) lines.push("", `> 이 회의는 ${n}번에 나눠 진행되었습니다.`);
  return lines;
}

export function minutesV2AttendeeLines(json: CommitteeMinutesV2Json): string[] {
  const ov = json.overview;
  const absent = new Set(ov.not_participating.map((s) => s.seat));
  const lines = ["## 참석 위원", ""];
  lines.push(`- 의장(기록자): ${CHAIR_DISPLAY_NAME}`);
  for (const s of ov.seats)
    lines.push(`- ${s.name}${absent.has(s.seat) ? " — 어느 안건에도 참여하지 않음 (불참, 동의로 세지 않음)" : ""}`);
  for (const h of ov.human_participants) lines.push(`- 사람 참석: ${h.user_id} (${h.seat})`);
  if (ov.sittings.length > 1) {
    lines.push("", "진행 회차:");
    for (const s of ov.sittings) {
      lines.push(
        `- ${s.attempt}차${s.started_at ? ` (${s.started_at}${s.ended_at ? ` ~ ${s.ended_at}` : ""})` : ""}${s.closed_issue_ids.length > 0 ? ` — 마친 안건: ${s.closed_issue_ids.join(", ")}` : ""}`,
      );
    }
  }
  lines.push("");
  return lines;
}

function tallyLine(issue: MinutesV2Issue): string {
  const t = issue.tally;
  const why = issue.outcome_reason ? ` · ${REASON_LABELS[issue.outcome_reason] ?? issue.outcome_reason}` : "";
  return `- 표결: 동의 ${t.accept} · 유보 ${t.reserve} · 응답 없음 ${t.abstain} · 불참 ${t.not_participating} → 결과 **${OUTCOME_LABELS[issue.outcome]}**${why}`;
}

export function minutesV2IssueLines(json: CommitteeMinutesV2Json): string[] {
  const lines: string[] = ["## 안건별 논의", ""];
  for (const issue of json.issues) {
    lines.push(`### ${issue.issue_id}: ${issue.title}`, "");
    if (issue.participants.length > 0) {
      lines.push(
        `- 참여 위원: ${issue.participants.map((p) => (p.reason ? `${p.name} (${p.reason})` : p.name)).join("; ")}`,
      );
    }
    if (issue.guests.length > 0) lines.push(`- 발언권을 받은 위원: ${issue.guests.map((g) => g.name).join(", ")}`);
    if (issue.sat_out.length > 0)
      lines.push(`- 불참: ${issue.sat_out.map((s) => s.name).join(", ")} (동의로 세지 않음)`);
    lines.push("", "**핵심 발언** (의장이 고른 교환, 원문 인용)", "");
    if (issue.excerpt_source === "fallback") {
      lines.push("> 의장 선택을 받지 못해 합의안과 마침 기록으로 대신했습니다. 전체 발언은 부록 A를 보세요.", "");
    }
    for (const e of issue.excerpt) {
      const to = e.addressed_name ? ` → ${e.addressed_name}` : "";
      lines.push(`- [#${e.seq}](#turn-${e.turn_id}) **${e.speaker_name}** · ${e.move}${to}: “${e.quote}”`);
    }
    lines.push("");
    if (issue.consensus) {
      lines.push("**합의안** (의장 제안)", "", `> ${issue.consensus.proposal}`, "");
    }
    lines.push(tallyLine(issue));
    for (const v of issue.votes) {
      const rec = issue.seat_recommendations.find((r) => r.seat === v.seat);
      lines.push(
        `  - ${v.name}: ${VOTE_LABELS[v.vote]}${rec ? ` (권고 ${rec.recommendation}${rec.veto_dissent ? ", 거부권 수준 이의" : ""})` : ""}${v.reason ? ` — ${v.reason}` : ""}`,
      );
    }
    lines.push("");
  }
  return lines;
}

export function minutesV2OpenItemLines(json: CommitteeMinutesV2Json): string[] {
  const lines = ["## 미해결 항목", ""];
  if (json.open_items.length === 0) lines.push("- 기록 없음");
  for (const o of json.open_items) {
    lines.push(`- ${o.text}${o.owner_name ? ` (담당: ${o.owner_name})` : ""}${o.issue_id ? ` [${o.issue_id}]` : ""}`);
  }
  lines.push("");
  return lines;
}

export function minutesAppendixLines(
  appendix: MinutesAppendix,
  letters: { transcript: string; abandoned: string },
): string[] {
  const lines = [`## 부록 ${letters.transcript} — 전체 발언 기록`, ""];
  if (appendix.transcript.length === 0) lines.push("- 기록 없음");
  for (const t of appendix.transcript) lines.push(`- <a id="turn-${t.turnId}"></a>${t.line}`);
  lines.push("");
  if (appendix.abandoned.length > 0) {
    lines.push(`## 부록 ${letters.abandoned} — 중단된 시도`, "");
    lines.push("회의가 중간에 멈춰 다시 열리면서 이어지지 않은 발언입니다. 기록은 지우지 않고 따로 둡니다.", "");
    for (const group of appendix.abandoned) {
      lines.push(`### ${group.attempt}차 시도`, "");
      for (const t of group.turns) lines.push(`- ${t.line}`);
      lines.push("");
    }
  }
  return lines;
}

/** The live rows as the regeneration input-hash sees them (ids, order, wording). */
export function liveFingerprint(records: readonly TurnRecord[], currentAttempt: number): unknown[] {
  return liveRecords([...records].sort(bySeq), currentAttempt).map((r) => [r.id, r.seq, r.move, r.utterance]);
}
