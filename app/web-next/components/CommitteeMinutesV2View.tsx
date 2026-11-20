// CommitteeMinutesV2View — the turn-meeting minutes v2 body (ADR-0204 phase 3 UI).
// Rendered in the meeting window's "회의록" tab from the ?format=json payload of
// GET .../minutes. Every recommendation shown is a PROPOSAL — the gate decision is
// recorded only by a human (design boundary #2).
//
// JSX rendering of lib/committee-minutes-v2.ts's markdown pieces:
//   - Per issue: title, 참석 위원 with reasons, excerpt quotes as dialogue lines
//     (plain text, never HTML), consensus proposal as a quote block, outcome +
//     tally line including 불참 (never folded into 기권), seat recommendations,
//     and the dissent verbatim (payload dissent_json, never summarized).
//   - Provenance badge "일부 인용 자동 교정" when provenance.repaired_quotes > 0.
//   - A fallback excerpt carries an explicit note pointing at the full transcript.
import { useTranslations } from "next-intl";
import type { CommitteeMinutesV2Json, MinutesV2Issue } from "../lib/committee-minutes-schema.ts";
import { tallyOf } from "../lib/committee-minutes-view.ts";
import { moveLabel, OutcomeBadge, seatName } from "./CommitteeTurnTranscript.tsx";

const T = "common.committee.turns";
const M = "common.committee.minutesV2";

type Translator = ReturnType<typeof useTranslations>;

const REC_CHIP: Record<string, string> = { go: "status-green", hold: "status-amber", kill: "status-red" };
const REC_LABEL: Record<string, string> = { go: "GO", hold: "HOLD", kill: "KILL" };
const VOTE_KEY: Record<string, string> = {
  accept: `${M}.vote.accept`,
  reserve: `${M}.vote.reserve`,
  no_response: `${M}.vote.no_response`,
};

/** A seat recommendation line: seat + GO/HOLD/KILL chip + 거부권 이견 marker (text, never color alone). */
function SeatRecommendation({ tr, rec }: { tr: Translator; rec: MinutesV2Issue["seat_recommendations"][number] }) {
  return (
    <li className="text-[length:var(--fs-caption)] mb-1">
      <span className="font-semibold">{rec.name}</span>{" "}
      <span className={`status-chip ${REC_CHIP[rec.recommendation] ?? "status-not-started"}`}>
        {REC_LABEL[rec.recommendation] ?? rec.recommendation}
      </span>
      {rec.veto_dissent && <span className="status-chip status-red ml-1">{tr(`${T}.vetoDissent`)}</span>}
    </li>
  );
}

/** One excerpt quote as a dialogue line: speaker · move (→ addressee) · “quote” (plain text). */
function ExcerptLine({ tr, e }: { tr: Translator; e: CommitteeMinutesV2Json["issues"][number]["excerpt"][number] }) {
  return (
    <li className="mb-1 pl-2 border-l-2" style={{ borderColor: "var(--muted-fg)" }}>
      <p className="text-[length:var(--fs-caption)] m-0">
        <span className="font-semibold">{e.speaker_name}</span>
        <span className="text-[color:var(--muted-fg)]">
          {" · "}
          {moveLabel(tr, e.move)}
          {e.addressed_name ? ` ${tr(`${T}.addressedTo`, { seat: e.addressed_name })}` : ""}
        </span>
        {e.quote_repaired && <span className="status-chip status-amber ml-1">{tr(`${M}.quoteRepaired`)}</span>}
      </p>
      <p className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0">“{e.quote}”</p>
    </li>
  );
}

/** "{name}: 동의 (권고 GO) — reason": built in code so empty parts never leave dangling separators. */
function voteLineText(
  tr: Translator,
  v: MinutesV2Issue["votes"][number],
  rec: MinutesV2Issue["seat_recommendations"][number] | undefined,
): string {
  const vote = VOTE_KEY[v.vote] ? tr(VOTE_KEY[v.vote]) : v.vote;
  const recText = rec ? tr(`${M}.voteRec`, { rec: REC_LABEL[rec.recommendation] ?? rec.recommendation }) : "";
  const reasonText = v.reason ? ` — ${v.reason}` : "";
  return `${v.name}: ${vote}${recText}${reasonText}`;
}

/** One issue of the minutes: participants, excerpts, consensus, tally + votes, seat recommendations. */
function IssueBlock({ tr, issue }: { tr: Translator; issue: MinutesV2Issue }) {
  const tally = tallyOf(issue);
  return (
    <section className="mb-3" data-testid="committee-minutes-issue" data-issue={issue.issue_id}>
      <h4 className="text-[length:var(--fs-body)] font-semibold mb-1">{issue.title}</h4>
      {issue.participants.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          {tr(`${M}.participants`)}:{" "}
          {issue.participants.map((p) => (p.reason ? `${p.name} (${p.reason})` : p.name)).join("; ")}
        </p>
      )}
      {issue.sat_out.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          {tr(`${M}.satOut`)}: {issue.sat_out.map((s) => s.name).join(", ")}
        </p>
      )}
      <p className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${M}.keyQuotes`)}</p>
      {issue.excerpt_source === "fallback" && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{tr(`${M}.fallbackNote`)}</p>
      )}
      <ul className="list-none p-0 m-0 mb-2">
        {issue.excerpt.map((e) => (
          <ExcerptLine key={e.turn_id} tr={tr} e={e} />
        ))}
      </ul>
      {issue.consensus && (
        <blockquote className="minutes-quote mb-2">
          <p className="text-[length:var(--fs-caption)] font-semibold m-0 mb-1">{tr(`${M}.consensus`)}</p>
          <p className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0">{issue.consensus.proposal}</p>
        </blockquote>
      )}
      <p className="flex flex-wrap items-center gap-2 m-0 mb-1 text-[length:var(--fs-caption)]">
        {<OutcomeBadge tr={tr} outcome={issue.outcome} />}
        <span className="text-[color:var(--muted-fg)] tabular-nums">
          {tr(`${M}.tally`, {
            accept: tally.accept,
            reserve: tally.reserve,
            abstain: tally.abstain,
            absent: tally.notParticipating,
          })}
        </span>
      </p>
      {issue.votes.length > 0 && (
        <ul className="list-none p-0 m-0 mb-1 pl-2 text-[length:var(--fs-caption)]">
          {issue.votes.map((v) => {
            const rec = issue.seat_recommendations.find((r) => r.seat === v.seat);
            return (
              <li key={v.seat} className="mb-1">
                {voteLineText(tr, v, rec)}
              </li>
            );
          })}
        </ul>
      )}
      {issue.seat_recommendations.length > 0 && (
        <div>
          <p className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${M}.recommendations`)}</p>
          <ul className="list-none p-0 m-0 pl-2">
            {issue.seat_recommendations.map((r) => (
              <SeatRecommendation key={r.seat} tr={tr} rec={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function CommitteeMinutesV2View({
  minutes,
  dissents,
}: {
  minutes: CommitteeMinutesV2Json;
  /** Verbatim dissent from the payload's dissent_json ([] = none). */
  dissents: Array<{ member_key: string; position_md: string }>;
}) {
  const tr = useTranslations();
  const ov = minutes.overview;
  return (
    <div className="committee-minutes-v2" data-testid="committee-minutes-v2">
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{tr(`${M}.notice`)}</p>
      <p className="flex flex-wrap items-center gap-1 mb-2">
        <span className="status-chip status-not-started">
          {tr(`${M}.heldAt`, { at: ov.held_at.slice(0, 16).replace("T", " ") })}
        </span>
        {ov.sittings.length > 1 && (
          <span className="status-chip status-not-started">{tr(`${M}.sittings`, { count: ov.sittings.length })}</span>
        )}
        {minutes.provenance.repaired_quotes > 0 && (
          <span className="status-chip status-amber">
            {tr(`${M}.repairedBadge`, { count: minutes.provenance.repaired_quotes })}
          </span>
        )}
        {minutes.provenance.source === "fallback" && (
          <span className="status-chip status-amber">{tr(`${M}.fallbackBadge`)}</span>
        )}
      </p>
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${M}.attendees`)}</h3>
      <ul className="list-none p-0 m-0 mb-2 text-[length:var(--fs-caption)]">
        <li>
          {tr(`${T}.chair`)} · {tr(`${M}.recorder`)}
        </li>
        {ov.seats.map((s) => (
          <li key={s.seat}>{s.name}</li>
        ))}
        {ov.human_participants.length > 0 && (
          <li>
            {tr(`${T}.human`)}: {ov.human_participants.map((h) => `${h.user_id} (${seatName(tr, h.seat)})`).join(", ")}
          </li>
        )}
        {ov.not_participating.length > 0 && (
          <li>
            {tr(`${M}.notParticipating`)}: {ov.not_participating.map((s) => s.name).join(", ")}
          </li>
        )}
      </ul>
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${M}.issues`)}</h3>
      {minutes.issues.map((issue) => (
        <IssueBlock key={issue.issue_id} tr={tr} issue={issue} />
      ))}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{tr(`${M}.openItems`)}</h3>
      {minutes.open_items.length === 0 ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">{tr(`${M}.noOpenItems`)}</p>
      ) : (
        <ul className="list-none p-0 m-0 mb-2 text-[length:var(--fs-caption)]">
          {minutes.open_items.map((o) => (
            <li key={`${o.text}|${o.owner_name ?? ""}|${o.issue_id ?? ""}`}>
              {o.text}
              {o.owner_name ? ` — ${tr(`${M}.owner`, { name: o.owner_name })}` : ""}
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1 text-[color:var(--red-fg)]">
        {tr("common.committeeMinutes.dissent")}
      </h3>
      {dissents.length === 0 ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
          {tr("common.committeeMinutes.none")}
        </p>
      ) : (
        <section aria-label={tr("common.committeeMinutes.dissent")} className="mb-2">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {tr("common.committeeMinutes.dissentNote")}
          </p>
          {dissents.map((d) => (
            <p
              key={d.member_key}
              className="whitespace-pre-wrap text-[length:var(--fs-caption)] mb-2 pl-2 border-l-2 m-0"
              style={{ borderColor: "var(--red-fg)" }}
            >
              &quot;{d.position_md}&quot; — {d.member_key}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
