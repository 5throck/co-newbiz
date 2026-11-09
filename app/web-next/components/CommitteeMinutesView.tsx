"use client";

// CommitteeMinutesView (ADR-0196 Phase C, design 2026-11-08-committee-minutes-as-meeting-design §2.4, §7 M1/M2/M6).
// Meeting-form minutes rendered from the ?format=json payload of
// GET /api/opportunities/{id}/committee-sessions/{sessionId}/minutes.
// Boundary rules (non-negotiable):
//  - NEVER renders a PASS / approval stamp — the recommendation is a
//    PROPOSAL (제안 권고), the gate decision is recorded only by a human.
//  - Dissent renders VERBATIM from dissent_json — never summarized.
//  - AI-drafted sections carry an explicit AI-drafted label, and the
//    deterministic fallback state is visible.
//  - The minutesConfirmed state is shown when present.
// MinutesDialog is the shared modal wrapper (CommitteePanel M1/M2 and
// DecisionHistory both use it); it fetches the JSON and keeps the raw
// markdown download link.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../lib/use-modal-focus.ts";
import { useTranslations } from "next-intl";

interface AgendaIssue {
  id: string;
  title: string;
  contested?: boolean;
  raisedBy?: string[];
}

interface MinutesExchange {
  position_ref?: string | number | null;
  seat: string;
  act: string;
  summary_md: string;
}

interface DiscussionIssue {
  issue: string;
  exchanges: MinutesExchange[];
  resolution: string;
}

interface MinutesDraftJson {
  agenda?: Array<{ id: string; title: string }>;
  discussion: DiscussionIssue[];
  agreements: Array<{ text: string; seats?: string[] }>;
  open_questions: Array<{ question: string; owner_seat?: string | null }>;
  action_items: Array<{ item: string; owner_seat?: string | null }>;
}

export interface CommitteeMinutesPayload {
  sessionId: string;
  status: string;
  committeeKey: string | null;
  gate: string | null;
  decisionMode: string | null;
  track: string | null;
  agenda: AgendaIssue[] | null;
  agendaMeta?: { source: string; model?: string | null } | null;
  minutesDraft: {
    json: MinutesDraftJson;
    fallback: boolean;
    prompt_version?: string | null;
    created_at?: string | null;
  } | null;
  minutesConfirmed: { by: string; at: string } | null;
  recommendation: string | null;
  dissentJson: string | Array<{ member_key: string; position_md: string }> | null;
}

// dissent_json is stored as a raw JSON string in gate_evaluation; accept both
// the parsed and string forms. Parse failure degrades to "no dissent" — it
// never fabricates or paraphrases content.
function parseDissent(
  dissentJson: CommitteeMinutesPayload["dissentJson"],
): Array<{ member_key: string; position_md: string }> {
  if (!dissentJson) return [];
  if (Array.isArray(dissentJson)) return dissentJson;
  try {
    const parsed = JSON.parse(dissentJson) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<{ member_key: string; position_md: string }>) : [];
  } catch {
    return [];
  }
}

const REC_LABEL: Record<string, string> = { go: "GO", hold: "HOLD", kill: "KILL" };

export function CommitteeMinutesView({ payload }: { payload: CommitteeMinutesPayload }) {
  const t = useTranslations("common.committeeMinutes");
  const draft = payload.minutesDraft;
  const dissents = parseDissent(payload.dissentJson);
  const agendaTitle = (issueId: string): string =>
    payload.agenda?.find((a) => a.id === issueId)?.title ??
    draft?.json.agenda?.find((a) => a.id === issueId)?.title ??
    issueId;

  return (
    <section aria-label={t("title")} className="committee-minutes-view">
      {/* State chips — always text + chip class, never color-only. */}
      <p className="flex flex-wrap items-center gap-1 mb-2">
        <span className="status-chip status-not-started">{payload.status}</span>
        {payload.track && <span className="status-chip status-not-started">{payload.track}</span>}
        {payload.minutesConfirmed ? (
          <span className="status-chip status-green">✓ {t("confirmed")}</span>
        ) : (
          <span className="status-chip status-not-started">{t("draft")}</span>
        )}
        {draft?.fallback && <span className="status-chip status-amber">◐ {t("fallbackDraft")}</span>}
      </p>
      {payload.minutesConfirmed && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("confirmedBy", { by: payload.minutesConfirmed.by, at: payload.minutesConfirmed.at.slice(0, 10) })}
        </p>
      )}

      {/* Agenda (chair proposal) — contested marked with text, not color alone. */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("agenda")}</h3>
      {payload.agenda && payload.agenda.length > 0 ? (
        <ul className="mb-2 pl-4">
          {payload.agenda.map((issue) => (
            <li key={issue.id} className="text-[length:var(--fs-caption)] mb-1">
              {issue.id}: {issue.title}
              {issue.contested && (
                <span className="status-chip status-amber ml-1">
                  <span aria-hidden="true">◐</span> {t("contested")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("noAgenda")}</p>
      )}

      {/* Discussion by issue (AI-drafted). */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("discussion")}</h3>
      {draft ? (
        <>
          {draft.json.discussion.length === 0 && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("noDiscussion")}</p>
          )}
          {draft.json.discussion.map((d) => (
            <div key={d.issue} className="mb-2 pl-2 border-l-2" style={{ borderColor: "var(--muted-fg)" }}>
              <p className="text-[length:var(--fs-caption)] font-semibold mb-1">
                {d.issue}: {agendaTitle(d.issue)}
              </p>
              {d.exchanges.length === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">{t("noExchanges")}</p>
              )}
              {d.exchanges.map((e) => (
                <p
                  key={`${e.seat}:${String(e.position_ref ?? e.summary_md)}`}
                  className="text-[length:var(--fs-caption)] mb-1 m-0"
                >
                  <span className="tabular-nums">{e.seat}</span> ({e.act}): {e.summary_md}
                  {e.position_ref != null && <span className="text-[color:var(--muted-fg)]"> → #{e.position_ref}</span>}
                </p>
              ))}
              <p className="text-[length:var(--fs-caption)] mb-1 m-0">
                {t("resolution")}: <strong>{d.resolution}</strong>
              </p>
            </div>
          ))}
        </>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("notAvailable")}</p>
      )}

      {/* Agreements. */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("agreements")}</h3>
      {draft && draft.json.agreements.length > 0 ? (
        <ul className="mb-2 pl-4">
          {draft.json.agreements.map((a) => (
            <li key={a.text} className="text-[length:var(--fs-caption)] mb-1">
              {a.text}
              {a.seats && a.seats.length > 0 && (
                <span className="text-[color:var(--muted-fg)]"> ({a.seats.join(", ")})</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("none")}</p>
      )}

      {/* Preserved dissent — VERBATIM (ADR-0096 §6). Own labelled region, never collapsible. */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--red-fg)] mb-1">{t("dissent")}</h3>
      {dissents.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: labelled region grouping the verbatim dissent block
        <div role="region" aria-label={t("dissent")} className="mb-2">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("dissentNote")}</p>
          {dissents.map((d) => (
            <p
              key={d.member_key}
              className="whitespace-pre-wrap text-[length:var(--fs-caption)] mb-2 pl-2 border-l-2 m-0"
              style={{ borderColor: "var(--red-fg)" }}
            >
              &quot;{d.position_md}&quot; — {d.member_key}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("none")}</p>
      )}

      {/* Open questions and action items. */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("openQuestions")}</h3>
      {draft && draft.json.open_questions.length > 0 ? (
        <ul className="mb-2 pl-4">
          {draft.json.open_questions.map((q) => (
            <li key={q.question} className="text-[length:var(--fs-caption)] mb-1">
              {q.question}
              {q.owner_seat && <span className="text-[color:var(--muted-fg)]"> — {q.owner_seat}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("none")}</p>
      )}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("actionItems")}</h3>
      {draft && draft.json.action_items.length > 0 ? (
        <ul className="mb-2 pl-4">
          {draft.json.action_items.map((a) => (
            <li key={a.item} className="text-[length:var(--fs-caption)] mb-1">
              {a.item}
              {a.owner_seat && <span className="text-[color:var(--muted-fg)]"> — {a.owner_seat}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("none")}</p>
      )}

      {/* Proposed recommendation — a PROPOSAL, never a decision stamp. */}
      <h3 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("proposedRecommendation")}</h3>
      {payload.recommendation ? (
        <p className="mb-2">
          <span
            className={`status-chip ${
              payload.recommendation === "go"
                ? "status-green"
                : payload.recommendation === "hold"
                  ? "status-amber"
                  : "status-red"
            }`}
          >
            {REC_LABEL[payload.recommendation] ?? payload.recommendation}
          </span>{" "}
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("proposalNote")}</span>
        </p>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("none")}</p>
      )}

      {/* AI-drafted footer label — mandatory on every AI-drafted section. */}
      {draft && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
          <span className="status-chip status-not-started">✦ {t("aiDraftedShort")}</span> {t("aiDraftedNote")}
        </p>
      )}
    </section>
  );
}

/** Shared modal wrapper — fetches ?format=json on open, keeps the raw
    markdown download link, renders CommitteeMinutesView. Used by
    CommitteePanel (M1/M2) and DecisionHistory (M1). */
export function MinutesDialog({
  opportunityId,
  sessionId,
  committeeLabel,
  onClose,
}: {
  opportunityId: string;
  sessionId: string;
  committeeLabel: string;
  onClose: () => void;
}) {
  const t = useTranslations("common.committeeMinutes");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [payload, setPayload] = useState<CommitteeMinutesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/minutes?format=json`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The minutes route answers in the standard { data, meta, error } envelope (ADR-0069);
        // read the inner payload, tolerating a bare payload only for robustness.
        const body = (await res.json()) as { data?: CommitteeMinutesPayload } | CommitteeMinutesPayload;
        return "data" in body && body.data !== undefined ? body.data : (body as CommitteeMinutesPayload);
      })
      .then((json) => {
        if (alive) setPayload(json);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      alive = false;
    };
  }, [opportunityId, sessionId]);
  const base = `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/minutes`;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: shared modal-backdrop pattern (CommitteePanel modal, useModalFocus handles Escape via onKeyDown)
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click here only stops backdrop-close propagation; the dialog itself is keyboard-operable via useModalFocus (Escape) */}
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${committeeLabel} ${t("title")}`}
        style={{ maxWidth: "40rem", width: "100%", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head flex items-center justify-between">
          <h2 style={{ fontSize: "0.95rem" }}>
            {committeeLabel} — {t("title")}
          </h2>
          <span className="actions-row">
            <a className="btn-ghost btn-sm" href={base} target="_blank" rel="noreferrer">
              {t("downloadMd")}
            </a>
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label={t("close")}>
              {t("close")}
            </button>
          </span>
        </div>
        <div className="mt-2 mb-3">
          {error && (
            <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
              ✕ {t("loadFailed")}
            </p>
          )}
          {!error && !payload && (
            <p role="status" className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
              {t("loading")}
            </p>
          )}
          {payload && <CommitteeMinutesView payload={payload} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
