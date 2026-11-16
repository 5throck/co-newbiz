"use client";

// Toolbar action + start dialog for the S6 bulk AI evaluation (ADR-0199 A1). Web evidence and DART force-refresh both
// default to OFF; the run is a proposal and a person confirms verdicts per candidate.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AiEvalModal, AiEvalStartForm } from "./AiEvalDialogs.tsx";
import type { StartOptions } from "./useAiEval.ts";

const DEFAULTS: StartOptions = { categories: "both", web_evidence: false, force_refresh: false };
/** Upper bound of DART calls per DART-registered candidate (design §1: about 9-14 for a cold cache). */
const MAX_CALLS_PER_CANDIDATE = 14;

export function AiEvalStartButton({
  candidates,
  dartEligible,
  disabled,
  busy,
  onStart,
}: {
  candidates: number;
  dartEligible: number;
  disabled: boolean;
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
        disabled={disabled || busy || candidates === 0}
        title={candidates === 0 ? t("noCandidates") : disabled ? t("bulkBlocked") : t("actionHint")}
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
            busy={busy}
            onCancel={close}
            onSubmit={() => {
              // Close either way: a refusal (409 / 429) is shown by the section's alert line, not trapped here.
              void onStart(value).then(close);
            }}
          />
        </AiEvalModal>
      )}
    </>
  );
}
