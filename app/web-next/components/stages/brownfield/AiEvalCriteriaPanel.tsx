"use client";

// "Evaluation criteria" dialog for the S6 longlist (ADR-0199): the toolbar button opens a modal with every criterion
// and its weight, live financial thresholds vs code defaults, plain-language rules, and threshold editing through the
// EXISTING PATCH /eval-criteria/{id} path (analyst+ only). A change applies from the next evaluation; old versions
// keep the thresholds they were drafted with. Content is identical to the former inline collapsible panel.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../../../lib/api.ts";
import {
  isFinancialDataRef,
  parseRubric,
  rubricDefaults,
  rubricFields,
} from "../../../lib/brownfield-financial-rubric.ts";
import { AiEvalModal } from "./AiEvalDialogs.tsx";
import { ScoreExplanation, TechnicalRules } from "./AiEvalCriteriaRules.tsx";
import { type CriterionRow, isDefaultRubric, ruleSentence } from "./aiEvalRules.ts";

/** The one write this panel does: the existing PATCH path with the full threshold set. */
export function saveRubricRequest(oppId: string, criterionId: string, rubric: Record<string, number>) {
  return api.patch(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`, {
    rubric,
  });
}

function RubricEditor({
  row,
  canAct,
  saving,
  onSave,
}: {
  row: CriterionRow;
  canAct: boolean;
  saving: boolean;
  onSave: (id: string, rubric: Record<string, number>) => void;
}) {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  const reasonId = useId();
  const ref = row.data_ref as Parameters<typeof rubricFields>[0];
  const current = parseRubric(ref, row.rubric_json);
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(current).map(([k, v]) => [k, String(v)])),
  );
  return (
    <form
      className="flex flex-wrap items-end gap-2 mt-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(row.id, Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])));
      }}
    >
      {rubricFields(ref).map((f) => (
        <label key={f.key} className="flex flex-col text-[length:var(--fs-caption)]" title={f.hint}>
          {f.label} ({f.unit})
          <input
            type="number"
            className="w-24"
            min={f.min}
            max={f.max}
            step={f.step}
            value={draft[f.key] ?? ""}
            disabled={!canAct || saving}
            aria-describedby={canAct ? undefined : reasonId}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <button type="submit" className="btn-ghost btn-sm" disabled={!canAct || saving}>
        {t("save")}
      </button>
      {!canAct && (
        <span id={reasonId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("viewerReason")}
        </span>
      )}
    </form>
  );
}

function FinancialRow({
  row,
  canAct,
  saving,
  onSave,
}: {
  row: CriterionRow;
  canAct: boolean;
  saving: boolean;
  onSave: (id: string, rubric: Record<string, number>) => void;
}) {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  if (!isFinancialDataRef(row.data_ref) || row.source !== "builtin") return null;
  const ref = row.data_ref;
  const isDefault = isDefaultRubric(ref, row.rubric_json);
  const def = rubricDefaults(ref);
  const rule = ruleSentence(ref, parseRubric(ref, row.rubric_json));
  return (
    <div className="mt-1 text-[length:var(--fs-caption)]">
      <span
        className="status-chip status-not-started"
        title={isDefault ? undefined : `${t("defaultsLine")} ${JSON.stringify(def)}`}
      >
        <span aria-hidden="true">{isDefault ? "● " : "✎ "}</span>
        {isDefault ? t("badgeDefault") : t("badgeAdjusted")}
      </span>
      <p className="m-0 mt-1">{t(`rule.${rule.key}`, rule.params)}</p>
      <p className="m-0 text-[color:var(--muted-fg)]">{t("rule.common")}</p>
      <RubricEditor
        key={`${row.id}:${row.rubric_json ?? ""}`}
        row={row}
        canAct={canAct}
        saving={saving}
        onSave={onSave}
      />
    </div>
  );
}

/** Pure list (rendered under test): criteria grouped by category with weights, rules and editors. */
export function CriteriaList({
  criteria,
  canAct,
  savingId,
  onSave,
}: {
  criteria: CriterionRow[];
  canAct: boolean;
  savingId: string | null;
  onSave: (id: string, rubric: Record<string, number>) => void;
}) {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  const tc = useTranslations("stages.s67.aiEval.category");
  return (
    <div className="flex flex-col gap-3">
      {(["financial", "technical"] as const).map((cat) => {
        const rows = criteria.filter((c) => c.category === cat);
        if (rows.length === 0) return null;
        return (
          <section key={cat} aria-label={tc(cat)}>
            <h4 className="m-0 text-[length:var(--fs-body)]">{tc(cat)}</h4>
            <ul className="m-0 mt-1 pl-0 list-none flex flex-col gap-2">
              {rows.map((c) => (
                <li key={c.id}>
                  <span className="font-semibold">{c.label}</span>{" "}
                  <span className="text-[color:var(--muted-fg)]">{t("weight", { n: c.weight })}</span>
                  {cat === "financial" && (
                    <FinancialRow row={c} canAct={canAct} saving={savingId === c.id} onSave={onSave} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {criteria.some((c) => c.category === "technical") && <TechnicalRules />}
    </div>
  );
}

/** Modal body (rendered under test): score explanation, load/save errors, notice and the criteria list. */
export function CriteriaPanelBody({
  criteria,
  error,
  notice,
  canAct,
  savingId,
  onSave,
}: {
  criteria: CriterionRow[] | null;
  error: string | null;
  notice: string | null;
  canAct: boolean;
  savingId: string | null;
  onSave: (id: string, rubric: Record<string, number>) => void;
}) {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  return (
    <div className="flex flex-col gap-3 mt-2">
      <ScoreExplanation />
      {error && (
        <p role="alert" className="m-0 text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
          {error}
        </p>
      )}
      {criteria ? (
        <>
          <p className="m-0 text-[length:var(--fs-caption)]">{t("notice")}</p>
          {notice && (
            <p role="status" className="m-0 text-[length:var(--fs-caption)]">
              {notice}
            </p>
          )}
          <CriteriaList criteria={criteria} canAct={canAct} savingId={savingId} onSave={onSave} />
        </>
      ) : (
        !error && <p className="m-0 text-[color:var(--muted-fg)]">{t("loading")}</p>
      )}
    </div>
  );
}

/** Toolbar button + modal. Open state drives aria-expanded on the button; Escape / backdrop click close via the
 * shared focus hook; the dialog is labelled by its heading (aria-labelledby). */
export function AiEvalCriteriaDialog({ oppId, canAct }: { oppId: string; canAct: boolean }) {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [criteria, setCriteria] = useState<CriterionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const base = `/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria`;

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ criteria: CriterionRow[] }>(base);
      setCriteria(r.data.criteria);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [base, t]);
  useEffect(() => {
    if (open && !criteria) void load();
  }, [open, criteria, load]);

  async function save(id: string, rubric: Record<string, number>) {
    setSavingId(id);
    setNotice(null);
    try {
      await saveRubricRequest(oppId, id, rubric);
      setNotice(t("saved"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(true)}>
        {t("title")}
      </button>
      {open && (
        <AiEvalModal title={t("title")} titleId={titleId} showClose onClose={() => setOpen(false)}>
          <CriteriaPanelBody
            criteria={criteria}
            error={error}
            notice={notice}
            canAct={canAct}
            savingId={savingId}
            onSave={(id, r) => void save(id, r)}
          />
        </AiEvalModal>
      )}
    </>
  );
}
