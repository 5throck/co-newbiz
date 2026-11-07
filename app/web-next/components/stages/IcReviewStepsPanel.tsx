"use client";

// S11 투자심사 절차 단계 패널 (2026-10-21) — entity-ic-review 1~5 ·
// group-investment-review 1~5의 상태를 원장에서 읽어 보여주고, 사람이 수행하는
// 중간 단계(Kill Criteria 명시적 판정, IC 메모 스냅샷, 자금확정성 사실 확인,
// 통합 인사이트 리뷰, 의사결정 덱, 그룹 검토 소견)를 기록한다. 파생 단계
// (AI 종합 등급 제안, 투자심의위원회 결정)는 각자의 원장이 권위이며 여기서
// 기록하지 않는다. 절차 격차는 진행 결정의 누락 산출물 예외 근거 대상이다
// (decider 2026-10-21 — 차단이 아니라 사람의 근거를 요구한다).
import { TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { PageState, useToast } from "../ui.tsx";
import { useKillCriteriaLabels } from "../../lib/use-kill-criteria-labels.ts";
import { useTranslations } from "next-intl";

type StepStatus = "pending" | "incomplete" | "pass" | "fail" | "recorded";
type Verdict = "pass" | "fail" | "na";
interface StepRecord { id: string; status: string; evidence_ref: string | null; recorded_by: string; recorded_at: string; payload_json: string | null }
interface StepView { id: string; output_type: string; title: string; agent: string; source: string; human?: boolean; status: StepStatus; latest: StepRecord | null; detail: Record<string, unknown> }
interface Criterion { key: string; procedure: string; criterion_id: string; title: string; action: string; enabled: boolean; automated: "triggered" | "false" | "unassessed" | null; verdict: Verdict | null }
interface View {
  entity: StepView[]; group: StepView[]; kill_criteria: Criterion[];
  financing: { source_lines: number; unevidenced_lines: number; unevidenced_amount_krw_m: number; all_sources_evidenced: boolean; balanced: boolean };
  gaps: string[];
}

const STATUS_META = (tr: TranslatorFn): Record<StepStatus, { label: string; cls: string }> => resolveLabels(tr, {
  pending: { label: "stages.s11.stepsPanel.notRecorded", cls: "status-amber" },
  incomplete: { label: "stages.s11.stepsPanel.hasUnjudgedItems", cls: "status-amber" },
  pass: { label: "stages.s11.stepsPanel.met", cls: "status-green" },
  fail: { label: "stages.s11.stepsPanel.notMet", cls: "status-red" },
  recorded: { label: "stages.s11.stepsPanel.recorded", cls: "status-green" },
});
const AUTO_LABEL = (tr: TranslatorFn): Record<string, { label: string; cls: string }> => resolveLabels(tr, {
  triggered: { label: "stages.s11.stepsPanel.engineTriggered", cls: "status-red" },
  false: { label: "stages.s11.stepsPanel.engineNotTriggered", cls: "status-green" },
  unassessed: { label: "stages.s11.stepsPanel.engineNotEvaluated", cls: "status-gray" },
});

export function IcReviewStepsPanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {const tr = useTranslations(); const t = useTranslations("stages.s11.stepsPanel"); const tc = useTranslations("common"); const kc = useKillCriteriaLabels();
  const { toast } = useToast();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [killNote, setKillNote] = useState("");
  const [memoNote, setMemoNote] = useState("");
  const [stepInput, setStepInput] = useState<Record<string, { evidence_ref: string; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [insight, setInsight] = useState<{ source: string; note: string; draft: { synthesis: string; tensions: string[]; open_questions: string[]; recommendation_note: string } } | null>(null);

  async function draftInsight() {
    setBusy("insight");
    try {
      const r = await api.post<{ source: string; note: string; draft: { synthesis: string; tensions: string[]; open_questions: string[]; recommendation_note: string } }>(
        `/api/projects/${encodeURIComponent(projectId)}/ic-review-steps`, { action: "draft_insight_review" },
      );
      setInsight(r.data);
      const d = r.data.draft;
      const text = [d.synthesis, ...d.tensions.map((x) => t("tensionP1", { p1: x })), ...d.open_questions.map((q) => t("questionP1", { p1: q })), d.recommendation_note].filter(Boolean).join("\n");
      setStepInput((cur) => ({ ...cur, "entity-ic-review:4.5": { evidence_ref: cur["entity-ic-review:4.5"]?.evidence_ref ?? "", note: text } }));
      toast(r.data.source === "llm" ? t("integratedInsightDraftReceivedRecord") : t("llmNotConfiguredThisIs"));
    } catch (e) {
      toast(e instanceof Error ? t("draftGenerationFailedP1", { p1: e.message }) : t("failedToGenerateTheDraft"));
    } finally {
      setBusy(null);
    }
  }

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/ic-review-steps`)
      .then((r) => {
        setView(r.data);
        setVerdicts(Object.fromEntries(r.data.kill_criteria.filter((c) => c.verdict).map((c) => [c.key, c.verdict as Verdict])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheProcedure")));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function post(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/ic-review-steps`, body);
      toast(done);
      load();
    } catch (e) {
      toast(e instanceof Error ? t("recordingFailedP1", { p1: e.message }) : t("failedToRecord"));
    } finally {
      setBusy(null);
    }
  }

  const strip = (steps: StepView[], procedure: string) => (
    <ul className="flex flex-wrap gap-1 mb-2" aria-label={t("p1Step", { p1: procedure })}>
      {steps.map((s) => (
        <li key={`${procedure}-${s.id}`}>
          <span className={`status-chip ${STATUS_META(tr)[s.status].cls}`} title={`${s.output_type} · ${s.agent}${s.latest ? ` · ${s.latest.recorded_by} ${s.latest.recorded_at.slice(0, 10)}` : ""}`}>
            {s.id} {s.title} — {STATUS_META(tr)[s.status].label}
          </span>
        </li>
      ))}
    </ul>
  );

  const genericRecord = (procedure: "entity-ic-review" | "group-investment-review", s: StepView) => {
    const k = `${procedure}:${s.id}`;
    const inp = stepInput[k] ?? { evidence_ref: "", note: "" };
    return (
      <li key={k} className="mb-1">
        <strong>{s.id} {s.title}</strong> <span className={`status-chip ${STATUS_META(tr)[s.status].cls}`}>{STATUS_META(tr)[s.status].label}</span>
        {s.latest?.evidence_ref && <span className="note ml-1">{tc("evidence")} {s.latest.evidence_ref}</span>}
        {canAct && (
          <span className="flex flex-wrap gap-1 items-center mt-1">
            <input aria-label={t("p1EvidenceReference", { p1: s.title })} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem" }} placeholder={t("evidenceReferenceDocumentLink")} value={inp.evidence_ref} onChange={(e) => setStepInput((cur) => ({ ...cur, [k]: { ...inp, evidence_ref: e.target.value } }))} />
            <textarea aria-label={t("p1Memo", { p1: s.title })} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "18rem", flex: 1 }} rows={2} placeholder={t("memo10CharsIfNo")} value={inp.note} onChange={(e) => setStepInput((cur) => ({ ...cur, [k]: { ...inp, note: e.target.value } }))} />
            <button type="button" className="btn-ghost btn-sm" disabled={busy === k}
              onClick={() => void post(k, { action: "record", procedure, step_id: s.id, evidence_ref: inp.evidence_ref || null, payload: { note: inp.note } }, t("recordedP1", { p1: s.title }))}>
              {tc("record")}
            </button>
          </span>
        )}
      </li>
    );
  };

  if (error) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>;
  if (!view) return <PageState state="loading" />;
  const step2 = view.entity.find((s) => s.id === "2")!;
  const step3 = view.entity.find((s) => s.id === "3")!;
  const step4 = view.entity.find((s) => s.id === "4")!;
  const allAnswered = view.kill_criteria.every((c) => verdicts[c.key]);

  return (
    <section className="market-section sizing-step mt-3" aria-label={t("investmentReviewProcedureSteps")} data-testid="ic-review-steps">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> {t("investmentReviewProcedureStepsEntity")}</h3>
      {view.gaps.length > 0 && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="ic-procedure-gaps">
          <span className="status-chip status-amber">{t("procedureGap")} {view.gaps.length}{tc("countUnit")}</span>
          <span className="text-[color:var(--muted-fg)] ml-1">{view.gaps.join(" · ")} {t("recordingAGoRequiresException")}</span>
        </p>
      )}
      <h4 className="text-[length:var(--fs-body)] mt-1 mb-1">{t("entityInvestmentCommitteeReview")}</h4>
      {strip(view.entity, "entity-ic-review")}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-2 mb-1">{t("step2ExplicitKillCriteria")} <span className={`status-chip ${STATUS_META(tr)[step2.status].cls}`}>{STATUS_META(tr)[step2.status].label}</span></h5>
      {view.kill_criteria.length === 0 ? (
        <p className="note">{t("noApplicableKillCriteriaUntil")}</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table" aria-label={t("killCriteriaJudgement")}>
            <caption className="sr-only">{t("applicableKillCriteriaAndJudgement")}</caption>
            <thead><tr><th>{t("procedure")}</th><th>{tc("criteria")}</th><th>{t("action")}</th><th>{t("engineEvaluationProposal")}</th><th>{t("humanJudgement")}</th></tr></thead>
            <tbody>{view.kill_criteria.map((c) => (
              <tr key={c.key}>
                <td className="text-[length:var(--fs-caption)]">{c.procedure}</td>
                <td className="text-[length:var(--fs-caption)]" title={c.criterion_id}>{kc.title(c.criterion_id, c.title)}{!c.enabled && <span className="note ml-1">{t("forecastUndefined")}</span>}</td>
                <td className="text-[length:var(--fs-caption)]">{kc.action(c.action)}</td>
                <td>{c.automated ? <span className={`status-chip ${AUTO_LABEL(tr)[c.automated].cls}`}>{AUTO_LABEL(tr)[c.automated].label}</span> : <span className="note">{t("noEvaluationRun")}</span>}</td>
                <td>
                  {canAct ? (
                    <select aria-label={t("p1Judgement", { p1: kc.title(c.criterion_id, c.title) })} className="sizing-new-input sizing-new-input-sm" value={verdicts[c.key] ?? ""} onChange={(e) => setVerdicts((cur) => ({ ...cur, [c.key]: e.target.value as Verdict }))}>
                      <option value="">{t("notJudged")}</option><option value="pass">pass</option><option value="fail">fail</option><option value="na">na</option>
                    </select>
                  ) : (c.verdict ?? "—")}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {canAct && view.kill_criteria.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center mt-1">
          <input aria-label={t("killCriteriaJudgementMemo")} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "16rem" }} placeholder={t("judgementMemoOptional")} value={killNote} onChange={(e) => setKillNote(e.target.value)} />
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "kill" || !allAnswered} title={allAnswered ? undefined : t("everyCriterionNeedsAnExplicit")}
            onClick={() => void post("kill", { action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts, note: killNote } }, t("killCriteriaJudgementRecorded"))}>
            {t("recordKillCriteriaJudgement")}
          </button>
        </div>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">{t("step3IcMemoSnapshot")} <span className={`status-chip ${STATUS_META(tr)[step3.status].cls}`}>{STATUS_META(tr)[step3.status].label}</span>
        {typeof step3.detail.snapshot_hash === "string" && <code className="dd-item-id ml-1">{step3.detail.snapshot_hash}</code>}
      </h5>
      <p className="note">{t("bundlesTheAdoptedCaseOverall")}</p>
      {canAct && (
        <div className="flex flex-wrap gap-1 items-center mt-1">
          <input aria-label={t("icMemoNotes")} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "16rem" }} placeholder={t("memoNotesOptional")} value={memoNote} onChange={(e) => setMemoNote(e.target.value)} />
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "memo"} onClick={() => void post("memo", { action: "snapshot_ic_memo", note: memoNote }, t("icMemoSnapshotRecorded"))}>{t("createAndRecordIcMemo")}</button>
        </div>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">{t("step4FundingCertaintyPrecondition")} <span className={`status-chip ${STATUS_META(tr)[step4.status].cls}`}>{STATUS_META(tr)[step4.status].label}</span></h5>
      <p className="text-[length:var(--fs-caption)]">
        {view.financing.balanced ? t("sourcesAndUsesBalance") : t("sourcesAndUsesImbalanced")} {t("funding")} {view.financing.source_lines}{t("itemSWithoutDocumentation")} {view.financing.unevidenced_lines}{tc("countUnit")}
        {view.financing.unevidenced_lines > 0 && <> ({view.financing.unevidenced_amount_krw_m} {t("millionsOfKrwRecordThe")}</>}
        {step4.detail.confirmed === true && <span className="status-chip status-green ml-1">{t("humanConfirmationRecorded")}</span>}
      </p>
      {canAct && (
        <button type="button" className="btn-ghost btn-sm" disabled={busy === "fin"} onClick={() => void post("fin", { action: "record", procedure: "entity-ic-review", step_id: "4" }, t("fundingCertaintyFactCheckRecorded"))}>{t("recordConfirmationWithTheCurrent")}</button>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">{t("step45And4")}</h5>
      {canAct && (
        <div className="flex flex-wrap gap-1 items-center mb-1">
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "insight"} title={t("theLlmDraftsAnIntegrated")}
            onClick={() => void draftInsight()}>{busy === "insight" ? t("generatingDraft") : t("generateIntegratedInsightDraftLlm")}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "deck"} title={t("generatesBriefingPackE1And")}
            onClick={() => void post("deck", { action: "attach_decision_deck" }, t("decisionDeckBriefingPackCreated"))}>{t("createAndRecordDecisionDeck")}</button>
        </div>
      )}
      {insight && (
        <div className="card mb-2" data-testid="ic-insight-draft">
          <p className="text-[length:var(--fs-caption)]"><span className={`status-chip ${insight.source === "llm" ? "status-amber" : "status-gray"}`}>{insight.source === "llm" ? t("llmDraft") : tc("deterministicFallback")}</span> <span className="note">{insight.note}</span></p>
          <p className="text-[length:var(--fs-caption)]">{insight.draft.synthesis}</p>
          {insight.draft.tensions.length > 0 && <ul className="sizing-note-list">{insight.draft.tensions.map((x, i) => <li key={`t-${i}`}>{t("tension")} {x}</li>)}</ul>}
          {insight.draft.open_questions.length > 0 && <ul className="sizing-note-list">{insight.draft.open_questions.map((q, i) => <li key={`q-${i}`}>{t("question")} {q}</li>)}</ul>}
          <p className="note">{insight.draft.recommendation_note} {t("filledIntoThe45")}</p>
        </div>
      )}
      <ul className="sizing-note-list">
        {view.entity.filter((s) => s.id === "4.5" || s.id === "4.6").map((s) => genericRecord("entity-ic-review", s))}
      </ul>

      <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("groupInvestmentCommitteeReview")}</h4>
      {strip(view.group, "group-investment-review")}
      <ul className="sizing-note-list">
        {view.group.filter((s) => s.source === "ledger").map((s) => genericRecord("group-investment-review", s))}
      </ul>
    </section>
  );
}
