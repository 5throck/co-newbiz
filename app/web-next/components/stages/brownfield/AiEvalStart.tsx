"use client";

// Toolbar action + start dialog for the S6 bulk AI evaluation (ADR-0199 A1). Web evidence and DART force-refresh both
// default to OFF; the run is a proposal and a person confirms verdicts per candidate.
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { BulkEstimate } from "./aiEvalQueueState.ts";
import { AiEvalModal, AiEvalStartForm } from "./AiEvalDialogs.tsx";
import type { StartOptions } from "./useAiEval.ts";

const DEFAULTS: StartOptions = { categories: "both", web_evidence: false, force_refresh: false };
/** Upper bound of DART calls per DART-registered candidate (design §1: about 9-14 for a cold cache). */
const MAX_CALLS_PER_CANDIDATE = 14;

export function AiEvalStartButton({
  candidates,
  dartEligible,
  estimate,
  busy,
  onStart,
}: {
  candidates: number;
  dartEligible: number;
  /** How many candidates this start would queue or skip, derived from the active runs (the server has the last word). */
  estimate: BulkEstimate;
  busy: boolean;
  onStart: (o: StartOptions) => Promise<boolean>;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<StartOptions>(DEFAULTS);
  const close = () => {
    setOpen(false);
    setValue(DEFAULTS);
  };
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={busy || candidates === 0}
        title={candidates === 0 ? t("noCandidates") : t("actionHint")}
        onClick={() => setOpen(true)}
      >
        {t("action")}
      </button>
      {open && (
        <AiEvalModal title={t("startTitle")} onClose={close}>
          <AiEvalStartForm
            value={value}
            onChange={setValue}
            stats={{ candidates, dartEligible, estimatedCalls: dartEligible * MAX_CALLS_PER_CANDIDATE }}
            note={t("queueEstimate", {
              queued: estimate.queued,
              skipped: estimate.skippedActive + estimate.skippedNotDart,
            })}
            busy={busy}
            onCancel={close}
            onSubmit={() => {
              // Close either way: a refusal (429 / 409) is shown by the section's alert line, not trapped here.
              void onStart(value).then(close);
            }}
          />
        </AiEvalModal>
      )}
    </>
  );
}
