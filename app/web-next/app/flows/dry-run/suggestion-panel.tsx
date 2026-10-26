"use client";

// AI improvement helpers for the single-page dry-run session (2026-10-26b delta D2).
// POST /api/flows/dry-run/suggest returns a proposal only. Everything here is local to the editor
// buffer: "Apply" fills the prompt editor, a candidate chip fills the agent picker — nothing is saved
// until Run (save-and-run), and no repository write path exists in this module.
// available:false (no LLM / validation failure) is shown as "unavailable" + reason — never a fake proposal.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button, FilterChip } from "../../../components/ui.tsx";
import { api } from "../../../lib/api.ts";
import { fmtDateTime, fmtInt, lineDiffSummary, type DryRunSuggestion } from "../flows-view-lib.ts";
import { lineDiffRows } from "./dry-run-ui-lib.ts";

type ProposalType = NonNullable<DryRunSuggestion["proposal"]>["type"];

const PROPOSAL_TYPE_KEY: Record<ProposalType, string> = {
  prompt_improvement: "proposalTypePromptImprovement",
  agent_reassignment: "proposalTypeAgentReassignment",
};

export interface SuggestionState {
  suggestion: DryRunSuggestion | null;
  busy: boolean;
  errorText: string | null;
  request: (note: string) => Promise<void>;
  discard: () => void;
}

export function useSuggestion(promptKey: string): SuggestionState {
  const t = useTranslations("pages.flows.dryRunSession");
  const [suggestion, setSuggestion] = useState<DryRunSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function request(note: string) {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const n = note.trim();
      const r = await api.post<DryRunSuggestion>("/api/flows/dry-run/suggest", {
        promptKey,
        ...(n ? { evidence: { note: n } } : {}),
      });
      setSuggestion(r.data);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("suggestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return { suggestion, busy, errorText, request, discard: () => { setSuggestion(null); setErrorText(null); } };
}

/** "Get AI improvement" trigger: optional evidence note + button. */
export function SuggestionTrigger({ state }: { state: SuggestionState }) {
  const t = useTranslations("pages.flows.dryRunSession");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
        <span className="sr-only">{t("evidenceNoteSrOnly")}</span>
        <input
          className="sizing-new-input sizing-new-input-sm w-full"
          value={note}
          maxLength={300}
          placeholder={t("evidenceNotePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <Button size="sm" disabled={state.busy} onClick={() => void state.request(note)}>
        {state.busy ? t("suggesting") : state.suggestion ? t("suggestAgain") : t("suggestCta")}
      </Button>
    </div>
  );
}

/** Suggestion result shown beside the editor: highlighted diff, rationale callout, Apply / Discard. */
export function SuggestionResult({
  state,
  current,
  onApplyPrompt,
}: {
  state: SuggestionState;
  /** Editor buffer the proposal is compared against. */
  current: string;
  onApplyPrompt: (improvedSystem: string) => void;
}) {
  const t = useTranslations("pages.flows.dryRunSession");
  const { suggestion } = state;
  const proposal = suggestion?.available ? suggestion.proposal : null;
  const improved = proposal?.type === "prompt_improvement" ? proposal.improvedSystem : null;
  const rows = useMemo(() => (improved ? lineDiffRows(current, improved) : []), [current, improved]);
  const summary = useMemo(() => (improved ? lineDiffSummary(current, improved) : { added: 0, removed: 0 }), [current, improved]);

  return (
    <div className="dry-run-suggestion" aria-live="polite">
      {state.errorText && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">✕ {state.errorText}</p>}
      {suggestion === null ? (
        <p className="m-0 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("noSuggestionYet")}</p>
      ) : !suggestion.available ? (
        <p role="alert" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          <span className="status-chip status-not-started">{t("suggestUnavailableChip")}</span>{" "}
          {suggestion.reason ?? t("reasonNotProvided")}{t("suggestUnavailableTail")}
        </p>
      ) : (
        proposal && (
          <div className="sizing-grade-card">
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span className="status-chip status-in-progress">{t(PROPOSAL_TYPE_KEY[proposal.type])}</span>
            </div>
            <div role="note" className="dry-run-rationale">
              <span className="font-semibold">{t("rationaleLabel")}</span>
              <p className="m-0 mt-0.5">{proposal.rationale}</p>
            </div>

            {improved && (
              <>
                <p className="mt-2 mb-1 flex flex-wrap items-center gap-1 text-[length:var(--fs-caption)] font-semibold">
                  {t("diffHeading")}
                  {summary.added > 0 && <span className="status-chip status-approved">{t("diffAdded", { p1: fmtInt(summary.added) })}</span>}
                  {summary.removed > 0 && <span className="status-chip status-rejected">{t("diffRemoved", { p1: fmtInt(summary.removed) })}</span>}
                  {summary.added + summary.removed === 0 && <span className="status-chip status-not-started">{t("diffSame")}</span>}
                </p>
                <div className="dry-run-diff" role="group" aria-label={t("diffHeading")}>
                  {rows.map((r, i) => (
                    <div key={i} className={`dry-run-diff-row dry-run-diff-${r.kind}`}>
                      <span className="dry-run-diff-mark" aria-hidden="true">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
                      {r.kind !== "same" && <span className="sr-only">{r.kind === "add" ? t("diffLineAdded") : t("diffLineRemoved")}</span>}
                      <span className="dry-run-diff-text">{r.text || " "}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onApplyPrompt(improved)}>{t("acceptOverrideCta")}</Button>
                  <Button size="sm" onClick={state.discard}>{t("discardCta")}</Button>
                </div>
              </>
            )}

            {proposal.type === "agent_reassignment" && (
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("candidatesInPicker")}</p>
                <Button size="sm" onClick={state.discard}>{t("discardCta")}</Button>
              </div>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">
                {t("evidenceSummary", { p1: suggestion.evidence.recentFailures, p2: "" })}
              </summary>
              {suggestion.evidence.recentFailures === 0 ? (
                <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noRecentFailures")}</p>
              ) : (
                <ul className="ml-4 mb-0 list-disc text-[length:var(--fs-caption)]">
                  {suggestion.evidence.failures.map((f, i) => (
                    <li key={i} className="mb-1">
                      <span className="tabular-nums">{fmtDateTime(f.createdAt)}</span> — <code style={{ wordBreak: "break-all" }}>{f.error || t("noErrorMessage")}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 mb-0 text-[length:var(--fs-caption)]">
                <Link href="/flows?tab=ledger" className="text-[color:var(--accent)] underline">{t("viewFailuresInLedger")}</Link>
              </p>
            </details>
          </div>
        )
      )}
    </div>
  );
}

/** AI-recommended agent chips under the picker: a chip fills the picker (editor buffer only). */
export function CandidateChips({
  state,
  selectedKey,
  onPick,
}: {
  state: SuggestionState;
  selectedKey: string;
  onPick: (agentKey: string) => void;
}) {
  const t = useTranslations("pages.flows.dryRunSession");
  const proposal = state.suggestion?.available ? state.suggestion.proposal : null;
  if (!proposal || proposal.type !== "agent_reassignment" || proposal.candidateAgents.length === 0) return null;
  return (
    <div className="mt-1 mb-2" role="group" aria-label={t("candidatesHeading", { p1: proposal.candidateAgents.length })}>
      <p className="mb-1 mt-0 text-[length:var(--fs-caption)] font-semibold">{t("candidatesHeading", { p1: proposal.candidateAgents.length })}</p>
      <ul className="m-0 p-0 list-none">
        {proposal.candidateAgents.map((c) => (
          <li key={c.key} className="mb-1 flex flex-wrap items-center gap-2">
            <FilterChip selected={selectedKey === c.key} onClick={() => onPick(c.key)}>{c.key}</FilterChip>
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.rationale}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("candidatesContext")}</p>
    </div>
  );
}
