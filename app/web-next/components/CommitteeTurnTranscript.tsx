"use client";

// CommitteeTurnTranscript — the turn-engine meeting transcript (ADR-0204 phase 2,
// design 2026-11-20-committee-turn-based-meeting-design §4.8): turns grouped under
// their agenda issue, in seq order. Rendered inside the meeting window (live, growing while
// the meeting runs, and for a finished session read from GET).
//
// Rendering rules:
//   - Chair rows (open / call / consensus proposal / close / resume) are styled
//     apart from member speech: a text chip AND a tinted left rule — never color alone.
//   - A close row shows the outcome (icon + label) and the vote tally; seats that did not
//     take part in the issue are counted apart ("not participating"), never as accept.
//   - Each issue lists its chair-selected participants (seat label + reason) in a collapsed
//     note when the agenda carries them (design §16.2); absent = nothing is shown.
//   - pass_on_behalf shows the structured fact and reason only — the chair never
//     puts words in a person's mouth, so no utterance text is shown for it.
//   - Abandoned turns (a stopped sitting whose issue was re-run) are left out of the
//     flow and offered in a collapsed note.
//   - Utterances are LLM / human text: rendered as plain text (React-escaped,
//     whitespace preserved), never injected as HTML.
//   - A plain ordered list; new rows never move focus.
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type AgendaParticipant,
  groupTurnsByIssue,
  type IssueTurnGroup,
  type TurnView,
  turnRowKind,
  visibleTurnCount,
  voteTally,
} from "../lib/committee-progress-view.ts";
import { COMMITTEE_SEAT_LABEL_KEY } from "../lib/label-keys.ts";

type Translator = ReturnType<typeof useTranslations>;

const T = "common.committee.turns";

const KNOWN_MOVES: ReadonlySet<string> = new Set([
  "propose",
  "ask",
  "answer",
  "rebut",
  "concede",
  "amend",
  "pass",
  "accept",
  "reserve",
  "open",
  "call",
  "propose_consensus",
  "close",
  "resume",
  "pass_on_behalf",
  "speak",
  "request_floor",
  "grant_floor",
  "decline_floor",
]);
const KNOWN_REASONS = new Set([
  "budget",
  "consensus_failed",
  "human_timeout",
  "human_wait_cap",
  "resume",
  "floor_granted",
  "floor_limit",
  "turn_cap",
  "mentioned",
]);
const KNOWN_OUTCOMES = new Set(["agreed", "narrowed", "unresolved"]);
const KNOWN_STANCES = new Set(["for", "against", "conditional", "unsure"]);

/** A committee seat's display name; "human" (a person without a registry seat) reads "human member"; unknown keys render raw. */
export function seatName(tr: Translator, key: string): string {
  if (key === "human") return tr(`${T}.human`);
  const labelKey = COMMITTEE_SEAT_LABEL_KEY[key];
  return labelKey ? tr(labelKey) : key;
}

/** Who speaks, as text: the chair and humans are named by role, members by their seat. */
function speakerLabel(tr: Translator, t: TurnView): string {
  if (t.role === "chair") return tr(`${T}.chair`);
  if (t.role === "human") {
    return t.speakerSeat && t.speakerSeat !== "human"
      ? `${tr(`${T}.human`)} · ${seatName(tr, t.speakerSeat)}`
      : tr(`${T}.human`);
  }
  return seatName(tr, t.speakerSeat);
}

/** "propose" → "제안"; a move outside the catalog renders raw. Shared with the minutes v2 view. */
export function moveLabel(tr: Translator, move: string): string {
  return KNOWN_MOVES.has(move) ? tr(`${T}.move.${move}`) : move;
}

/** Outcome chip (icon + label, never color alone). Shared with the minutes v2 view. */
export function OutcomeBadge({ tr, outcome }: { tr: Translator; outcome: string }) {
  const label = KNOWN_OUTCOMES.has(outcome) ? tr(`${T}.outcome.${outcome}`) : outcome;
  const Icon = outcome === "agreed" ? CheckCircle2 : outcome === "narrowed" ? MinusCircle : AlertTriangle;
  const tone = outcome === "agreed" ? "status-green" : outcome === "narrowed" ? "status-amber" : "status-red";
  return (
    <span className={`status-chip ${tone} inline-flex items-center gap-1`} data-outcome={outcome}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

function ruleStyle(kind: ReturnType<typeof turnRowKind>): { borderColor: string; background?: string } {
  switch (kind) {
    case "chair":
    case "close":
      return { borderColor: "var(--primary)", background: "var(--primary-bg)" };
    case "human":
      return { borderColor: "var(--green-border)" };
    case "pass":
      return { borderColor: "var(--border)" };
    default:
      return { borderColor: "var(--muted-fg)" };
  }
}

function TurnRow({ tr, t }: { tr: Translator; t: TurnView }) {
  const kind = turnRowKind(t);
  const tally = voteTally(t.votes);
  const showBody = kind !== "pass" && !t.error && t.utteranceMd.trim().length > 0;
  // Vote rows carry the stance in the move label already ("찬성"): rendering the stance
  // label too produced "찬성 찬성". One label per fact — the stance chip shows only
  // when the move is not itself the stance (a non-vote move with a stance reported).
  const stance = t.stance !== null && kind !== "vote" ? t.stance : null;
  return (
    <li
      data-testid="committee-turn-row"
      data-seq={t.seq}
      data-kind={kind}
      className="mb-2 pl-2 pr-2 py-1 border-l-2"
      style={ruleStyle(kind)}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1 text-[length:var(--fs-caption)]">
        {kind === "chair" || kind === "close" || kind === "pass" ? (
          <span className="status-chip status-info">{tr(`${T}.chair`)}</span>
        ) : kind === "human" ? (
          <span className="status-chip status-green">{tr(`${T}.human`)}</span>
        ) : null}
        {kind !== "chair" && kind !== "close" && kind !== "pass" && (
          <span className="font-semibold">{speakerLabel(tr, t)}</span>
        )}
        <span className="text-[color:var(--muted-fg)]">{moveLabel(tr, t.move)}</span>
        {t.addressedTo && (
          <span className="text-[color:var(--muted-fg)]">
            {tr(`${T}.addressedTo`, { seat: seatName(tr, t.addressedTo) })}
          </span>
        )}
        {stance && (
          <span className="text-[color:var(--muted-fg)]">
            {KNOWN_STANCES.has(stance) ? tr(`${T}.stance.${stance}`) : stance}
          </span>
        )}
        {t.recommendation && (
          <span className="text-[color:var(--muted-fg)]">
            {tr(`${T}.recommendation`, { value: t.recommendation.toUpperCase() })}
          </span>
        )}
        {t.vetoDissent && <span className="status-chip status-red">{tr(`${T}.vetoDissent`)}</span>}
      </p>

      {kind === "close" && (
        <p className="flex flex-wrap items-center gap-2 m-0 mb-1 text-[length:var(--fs-caption)]">
          {t.outcome && <OutcomeBadge tr={tr} outcome={t.outcome} />}
          {tally && (
            <span className="text-[color:var(--muted-fg)] tabular-nums">
              {tally.notParticipating !== null
                ? tr(`${T}.votesWithAbsent`, {
                    accept: tally.accept,
                    reserve: tally.reserve,
                    abstain: tally.abstain,
                    absent: tally.notParticipating,
                  })
                : tr(`${T}.votes`, { accept: tally.accept, reserve: tally.reserve, abstain: tally.abstain })}
            </span>
          )}
        </p>
      )}

      {kind === "pass" && (
        <p className="m-0 text-[length:var(--fs-caption)]">
          {tr(`${T}.passOnBehalf`, { seat: seatName(tr, t.forSeat ?? "") })}
          {t.reason && (
            <span className="text-[color:var(--muted-fg)]">
              {" "}
              {tr(`${T}.reasonLabel`, {
                reason: KNOWN_REASONS.has(t.reason) ? tr(`${T}.reason.${t.reason}`) : t.reason,
              })}
            </span>
          )}
        </p>
      )}

      {t.error && (
        <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {tr(`${T}.turnError`)} ({t.error})
        </p>
      )}

      {showBody && <p className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0">{t.utteranceMd}</p>}
    </li>
  );
}

function ParticipantsNote({ tr, issueIndex, list }: { tr: Translator; issueIndex: number; list: AgendaParticipant[] }) {
  if (list.length === 0) return null;
  return (
    <details className="mb-2" data-testid="committee-issue-participants" data-issue={issueIndex}>
      <summary className="text-[length:var(--fs-caption)] cursor-pointer text-[color:var(--muted-fg)]">
        {tr(`${T}.participants.summary`, { count: list.length })}
      </summary>
      <ul className="list-none p-0 m-0 mt-1 pl-2" aria-label={tr(`${T}.participants.listLabel`)}>
        {list.map((p) => (
          <li key={p.seat} className="text-[length:var(--fs-caption)] mb-1">
            <span className="font-semibold">{p.label ?? seatName(tr, p.seat)}</span>
            <span className="text-[color:var(--muted-fg)]"> — {p.reason ?? tr(`${T}.participants.noReason`)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function IssueSection({
  tr,
  g,
  participants,
}: {
  tr: Translator;
  g: IssueTurnGroup;
  participants?: AgendaParticipant[];
}) {
  const headingId = `committee-issue-${g.issueIndex}`;
  return (
    <section aria-labelledby={headingId} className="mb-3" data-testid="committee-turn-issue" data-issue={g.issueIndex}>
      <h3 id={headingId} className="text-[length:var(--fs-body)] font-semibold mb-1">
        {g.title
          ? tr(`${T}.issueHeading`, { index: g.issueIndex, title: g.title })
          : tr(`${T}.issueHeadingNoTitle`, { index: g.issueIndex })}
      </h3>
      <ParticipantsNote tr={tr} issueIndex={g.issueIndex} list={participants ?? []} />
      <ol className="list-none p-0 m-0">
        {g.turns.map((t) => (
          <TurnRow key={t.turnId} tr={tr} t={t} />
        ))}
      </ol>
      {g.interrupted.length > 0 && (
        <details className="mt-1" data-testid="committee-turn-interrupted">
          <summary className="text-[length:var(--fs-caption)] cursor-pointer text-[color:var(--muted-fg)]">
            {tr(`${T}.interrupted`, { count: g.interrupted.length })}
          </summary>
          <ol className="list-none p-0 m-0 mt-1">
            {g.interrupted.map((t) => (
              <TurnRow key={t.turnId} tr={tr} t={t} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export function CommitteeTurnTranscript({
  turns,
  titles,
  participants,
  currentIssue,
  currentTitle,
}: {
  turns: readonly TurnView[];
  /** Agenda titles by issue (index 0 = issue 1), when the payload carries the agenda. */
  titles?: ReadonlyArray<string | null | undefined>;
  /** Chair-selected participants by issue (index 0 = issue 1), when the agenda carries them. */
  participants?: ReadonlyArray<AgendaParticipant[]>;
  /** The issue the run is on and its progress title (fills the title before the agenda is known). */
  currentIssue?: number;
  currentTitle?: string;
}) {
  const tr = useTranslations();
  const groups = groupTurnsByIssue(turns, { titles, currentIssue, currentTitle });
  const count = visibleTurnCount(turns);
  return (
    <div className="mt-2" data-testid="committee-turn-transcript">
      <p className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${T}.transcriptTitle`, { count })}</p>
      {groups.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] m-0">{tr(`${T}.empty`)}</p>
      ) : (
        groups.map((g) => (
          <IssueSection key={g.issueIndex} tr={tr} g={g} participants={participants?.[g.issueIndex - 1]} />
        ))
      )}
    </div>
  );
}
