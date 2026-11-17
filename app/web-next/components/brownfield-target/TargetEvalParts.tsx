"use client";

// Parts of the candidate detail evaluation tab (ADR-0200 §7.2), split out of TargetEvalTab.tsx (400-line cap):
// the AI 평가 bar (single-candidate run via the S6 start dialog / hook / progress panel, unreviewed total) and the
// rule-only bulk accept dialog (`자동 규칙` verdicts only — AI verdicts are reviewed one at a time).
import { useTranslations } from "next-intl";
import { AiEvalRunsPanel } from "../stages/brownfield/AiEvalChips.tsx";
import { AiEvalModal } from "../stages/brownfield/AiEvalDialogs.tsx";
import { AiEvalRowButton } from "../stages/brownfield/AiEvalRowButton.tsx";
import { rowBlock } from "../stages/brownfield/aiEvalActive.ts";
import { useAiEval } from "../stages/brownfield/useAiEval.ts";
import { EVAL_CATEGORY_KEY, VERDICT_KEY } from "./constants.ts";
import type { EvalItem } from "./types.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";

export function EvalAiBar({ ctx, unreviewedTotal }: { ctx: TargetDetailViewState; unreviewedTotal: number }) {
  const ta = useTranslations("stages.s67.aiEval");
  const { detail, loadDetail, oppId, targetId, canAct } = ctx;
  // ADR-0200 Q7: the separate non-persisted "AI 초안" is retired; AI 평가 starts a single-candidate run (target_ids:[id])
  // with the same dialog, hook and progress panel as the S6 longlist. Results are applied straight to the verdicts.
  const ai = useAiEval({ oppId: oppId || null, loadDetail: () => loadDetail() });
  return (
    <div className="card mb-3 flex flex-col gap-2" data-testid="eval-ai-bar">
      <div className="flex flex-wrap items-center gap-2">
        {canAct && (
          <AiEvalRowButton
            companyName={detail?.target.company_name ?? ""}
            targetId={targetId}
            excluded={detail?.target.status === "excluded"}
            hasDart={!!detail?.target.dart_corp_code}
            block={rowBlock(ai.activeRuns, targetId)}
            busy={ai.busy}
            onStart={ai.start}
          />
        )}
        {unreviewedTotal > 0 ? (
          <span className="status-chip status-amber" data-testid="eval-unreviewed-total">
            <span aria-hidden="true">◔ </span>
            {ta("unreviewed", { n: unreviewedTotal })}
          </span>
        ) : (
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{ta("noUnreviewed")}</span>
        )}
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
          {ta("appliesDirectly")}
        </span>
      </div>
      {ai.notice && (
        <p role="status" className="m-0 text-[length:var(--fs-caption)]">
          <span aria-hidden="true">ⓘ </span>
          {ai.notice}
        </p>
      )}
      {ai.message && (
        <p role="alert" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {ai.message}
        </p>
      )}
      <AiEvalRunsPanel
        activeRuns={ai.activeRuns}
        latest={ai.view}
        canAct={canAct}
        busy={ai.busy}
        onResume={ai.resume}
        onCancel={ai.cancel}
      />
    </div>
  );
}

export function AcceptRuleDialog({
  category,
  items,
  busy,
  onClose,
  onConfirm,
}: {
  category: "financial" | "technical";
  items: EvalItem[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ta = useTranslations("stages.s67.aiEval");
  const tk = useTranslations("components.brownfieldTarget.constants");
  const tc = useTranslations("common");
  return (
    <AiEvalModal title={ta("acceptAllRuleTitle", { category: tk(EVAL_CATEGORY_KEY[category]) })} onClose={onClose}>
      <div className="flex flex-col gap-3 mt-2">
        <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{ta("acceptAllRuleIntro")}</p>
        <ul className="m-0 pl-5 text-[length:var(--fs-caption)]">
          {items
            .filter(
              (it) =>
                it.category === category && it.state?.verdict_source === "auto_rule" && it.state.status !== "pending",
            )
            .map((it) => (
              <li key={it.id}>
                {it.label} — {tk(VERDICT_KEY[it.state?.status ?? "pending"] ?? "verdictPending")}
              </li>
            ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button type="button" className="btn-premium btn-sm" disabled={busy} onClick={onConfirm}>
            {ta("acceptAllRuleConfirm")}
          </button>
        </div>
      </div>
    </AiEvalModal>
  );
}
