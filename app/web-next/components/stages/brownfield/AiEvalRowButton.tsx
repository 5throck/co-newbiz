"use client";

// Per-candidate AI evaluation action for the S6 longlist (ADR-0199): opens the same start dialog scoped to one
// candidate and starts the run with `target_ids: [id]`. Web evidence and force refresh stay OFF by default.
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { RowBlock } from "./aiEvalActive.ts";
import { AiEvalModal, AiEvalStartForm } from "./AiEvalDialogs.tsx";
import type { StartOptions } from "./useAiEval.ts";

const DEFAULTS: StartOptions = { categories: "both", web_evidence: false, force_refresh: false };
const MAX_CALLS_PER_CANDIDATE = 14;

export function AiEvalRowButton({
  companyName,
  targetId,
  excluded,
  hasDart,
  block,
  busy,
  onStart,
}: {
  companyName: string;
  targetId: string;
  excluded: boolean;
  hasDart: boolean;
  /** Run-state block: this candidate is waiting in the queue or running. Other runs never block it (ADR-0200 part B). */
  block: RowBlock | null;
  busy: boolean;
  onStart: (o: StartOptions, targetIds?: string[]) => Promise<boolean>;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<StartOptions>(DEFAULTS);
  const blockText = block === "running" ? t("rowTargetRunning") : block === "queued" ? t("rowQueuedBlock") : null;
  const reason = excluded ? t("rowExcluded") : !hasDart ? t("rowNoDart") : blockText;
  const close = () => {
    setOpen(false);
    setValue(DEFAULTS);
  };
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={reason !== null || busy}
        aria-label={t("rowLabel", { company: companyName })}
        title={reason ?? t("rowTitle", { company: companyName })}
        onClick={() => setOpen(true)}
      >
        {t("rowAction")}
      </button>
      {open && (
        <AiEvalModal title={t("rowStartTitle", { company: companyName })} onClose={close}>
          <AiEvalStartForm
            value={value}
            onChange={setValue}
            stats={{ candidates: 1, dartEligible: 1, estimatedCalls: MAX_CALLS_PER_CANDIDATE }}
            summary={t("rowSummary", { company: companyName, calls: MAX_CALLS_PER_CANDIDATE })}
            busy={busy}
            onCancel={close}
            onSubmit={() => {
              void onStart(value, [targetId]).then(close);
            }}
          />
        </AiEvalModal>
      )}
    </>
  );
}
