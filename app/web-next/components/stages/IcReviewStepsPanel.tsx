"use client";

// S11 투자심사 절차 단계 패널 (2026-10-21) — entity-ic-review 1~5 ·
// group-investment-review 1~5의 상태를 원장에서 읽어 보여주고, 사람이 수행하는
// 중간 단계(Kill Criteria 명시적 판정, IC 메모 스냅샷, 자금확정성 사실 확인,
// 통합 인사이트 리뷰, 의사결정 덱, 그룹 검토 소견)를 기록한다. 파생 단계
// (AI 종합 등급 제안, 투자심의위원회 결정)는 각자의 원장이 권위이며 여기서
// 기록하지 않는다. 절차 격차는 진행 결정의 누락 산출물 예외 근거 대상이다
// (decider 2026-10-21 — 차단이 아니라 사람의 근거를 요구한다).
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { PageState, useToast } from "../ui.tsx";
import { KILL_CRITERIA_KO } from "../../lib/review/kill-criteria-ko.ts";

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

const STATUS_META: Record<StepStatus, { label: string; cls: string }> = {
  pending: { label: "미기록", cls: "status-amber" },
  incomplete: { label: "미판정 있음", cls: "status-amber" },
  pass: { label: "충족", cls: "status-green" },
  fail: { label: "미충족", cls: "status-red" },
  recorded: { label: "기록됨", cls: "status-green" },
};
const AUTO_LABEL: Record<string, { label: string; cls: string }> = {
  triggered: { label: "엔진: 발동", cls: "status-red" },
  false: { label: "엔진: 미발동", cls: "status-green" },
  unassessed: { label: "엔진: 미평가", cls: "status-gray" },
};

export function IcReviewStepsPanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {
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
      const text = [d.synthesis, ...d.tensions.map((t) => `긴장: ${t}`), ...d.open_questions.map((q) => `질문: ${q}`), d.recommendation_note].filter(Boolean).join("\n");
      setStepInput((cur) => ({ ...cur, "entity-ic-review:4.5": { evidence_ref: cur["entity-ic-review:4.5"]?.evidence_ref ?? "", note: text } }));
      toast(r.data.source === "llm" ? "통합 인사이트 초안을 받았습니다 — 검토 후 4.5로 기록하세요." : "LLM 미구성 — 결정론 폴백 초안입니다.");
    } catch (e) {
      toast(e instanceof Error ? `초안 생성 실패: ${e.message}` : "초안 생성 실패");
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
      .catch((e) => setError(e instanceof Error ? e.message : "절차 단계를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function post(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/ic-review-steps`, body);
      toast(done);
      load();
    } catch (e) {
      toast(e instanceof Error ? `기록 실패: ${e.message}` : "기록 실패");
    } finally {
      setBusy(null);
    }
  }

  const strip = (steps: StepView[], procedure: string) => (
    <ul className="flex flex-wrap gap-1 mb-2" aria-label={`${procedure} 단계`}>
      {steps.map((s) => (
        <li key={`${procedure}-${s.id}`}>
          <span className={`status-chip ${STATUS_META[s.status].cls}`} title={`${s.output_type} · ${s.agent}${s.latest ? ` · ${s.latest.recorded_by} ${s.latest.recorded_at.slice(0, 10)}` : ""}`}>
            {s.id} {s.title} — {STATUS_META[s.status].label}
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
        <strong>{s.id} {s.title}</strong> <span className={`status-chip ${STATUS_META[s.status].cls}`}>{STATUS_META[s.status].label}</span>
        {s.latest?.evidence_ref && <span className="note ml-1">근거 {s.latest.evidence_ref}</span>}
        {canAct && (
          <span className="flex flex-wrap gap-1 items-center mt-1">
            <input aria-label={`${s.title} 근거 참조`} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem" }} placeholder="근거 참조 (문서/링크)" value={inp.evidence_ref} onChange={(e) => setStepInput((cur) => ({ ...cur, [k]: { ...inp, evidence_ref: e.target.value } }))} />
            <textarea aria-label={`${s.title} 메모`} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "18rem", flex: 1 }} rows={2} placeholder="메모 (근거 참조가 없으면 10자 이상)" value={inp.note} onChange={(e) => setStepInput((cur) => ({ ...cur, [k]: { ...inp, note: e.target.value } }))} />
            <button type="button" className="btn-ghost btn-sm" disabled={busy === k}
              onClick={() => void post(k, { action: "record", procedure, step_id: s.id, evidence_ref: inp.evidence_ref || null, payload: { note: inp.note } }, `${s.title}을(를) 기록했습니다.`)}>
              기록
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
    <section className="market-section sizing-step mt-3" aria-label="투자심사 절차 단계" data-testid="ic-review-steps">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]"><span className="sizing-step-badge" aria-hidden="true">📋</span> 투자심사 절차 단계 — 법인 검토 · 그룹 검토</h3>
      {view.gaps.length > 0 && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="ic-procedure-gaps">
          <span className="status-chip status-amber">절차 격차 {view.gaps.length}건</span>
          <span className="text-[color:var(--muted-fg)] ml-1">{view.gaps.join(" · ")} — 진행(GO) 기록 시 누락 산출물 예외 근거가 필요합니다 (차단은 아닙니다).</span>
        </p>
      )}
      <h4 className="text-[length:var(--fs-body)] mt-1 mb-1">법인 투자심의위원회 검토 (entity-ic-review)</h4>
      {strip(view.entity, "entity-ic-review")}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-2 mb-1">step 2 — Kill Criteria 명시적 pass/fail <span className={`status-chip ${STATUS_META[step2.status].cls}`}>{STATUS_META[step2.status].label}</span></h5>
      {view.kill_criteria.length === 0 ? (
        <p className="note">적용되는 Kill Criteria가 없습니다 (트랙·설립 방식 미확정 시 entity-ic-review 항목만 표시됩니다).</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table" aria-label="Kill Criteria 판정">
            <caption className="sr-only">적용 Kill Criteria와 판정</caption>
            <thead><tr><th>절차</th><th>기준</th><th>조치</th><th>엔진 평가 (제안)</th><th>사람 판정</th></tr></thead>
            <tbody>{view.kill_criteria.map((c) => (
              <tr key={c.key}>
                <td className="text-[length:var(--fs-caption)]">{c.procedure}</td>
                <td className="text-[length:var(--fs-caption)]" title={c.criterion_id}>{KILL_CRITERIA_KO[c.criterion_id] ?? c.title}{!c.enabled && <span className="note ml-1">(예측 미정의)</span>}</td>
                <td className="text-[length:var(--fs-caption)]">{c.action}</td>
                <td>{c.automated ? <span className={`status-chip ${AUTO_LABEL[c.automated].cls}`}>{AUTO_LABEL[c.automated].label}</span> : <span className="note">평가 실행 없음</span>}</td>
                <td>
                  {canAct ? (
                    <select aria-label={`${c.title} 판정`} className="sizing-new-input sizing-new-input-sm" value={verdicts[c.key] ?? ""} onChange={(e) => setVerdicts((cur) => ({ ...cur, [c.key]: e.target.value as Verdict }))}>
                      <option value="">— 미판정</option><option value="pass">pass</option><option value="fail">fail</option><option value="na">na</option>
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
          <input aria-label="Kill Criteria 판정 메모" className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "16rem" }} placeholder="판정 메모 (선택)" value={killNote} onChange={(e) => setKillNote(e.target.value)} />
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "kill" || !allAnswered} title={allAnswered ? undefined : "모든 기준에 명시적 판정이 필요합니다"}
            onClick={() => void post("kill", { action: "record", procedure: "entity-ic-review", step_id: "2", payload: { verdicts, note: killNote } }, "Kill Criteria 판정을 기록했습니다.")}>
            Kill Criteria 판정 기록
          </button>
        </div>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">step 3 — IC 메모 스냅샷 <span className={`status-chip ${STATUS_META[step3.status].cls}`}>{STATUS_META[step3.status].label}</span>
        {typeof step3.detail.snapshot_hash === "string" && <code className="dd-item-id ml-1">{step3.detail.snapshot_hash}</code>}
      </h5>
      <p className="note">채택 케이스·종합 등급 제안·DD 요약·투자구조·자금 확정성·Kill 판정·리스크 히트맵을 한 스냅샷으로 묶어 해시와 함께 기록합니다.</p>
      {canAct && (
        <div className="flex flex-wrap gap-1 items-center mt-1">
          <input aria-label="IC 메모 비고" className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "16rem" }} placeholder="메모 비고 (선택)" value={memoNote} onChange={(e) => setMemoNote(e.target.value)} />
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "memo"} onClick={() => void post("memo", { action: "snapshot_ic_memo", note: memoNote }, "IC 메모 스냅샷을 기록했습니다.")}>IC 메모 스냅샷 생성·기록</button>
        </div>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">step 4 — 자금확정성 선결조건 (사실 확인 · 판단 아님) <span className={`status-chip ${STATUS_META[step4.status].cls}`}>{STATUS_META[step4.status].label}</span></h5>
      <p className="text-[length:var(--fs-caption)]">
        {view.financing.balanced ? "조달·사용 균형" : "조달·사용 미균형"} · 조달 {view.financing.source_lines}건 중 증빙 없음 {view.financing.unevidenced_lines}건
        {view.financing.unevidenced_lines > 0 && <> ({view.financing.unevidenced_amount_krw_m} 백만 KRW) — 투자구조 탭에서 커밋먼트 레터·내부 승인 증빙을 기록하세요</>}
        {step4.detail.confirmed === true && <span className="status-chip status-green ml-1">사람 확인 기록됨</span>}
      </p>
      {canAct && (
        <button type="button" className="btn-ghost btn-sm" disabled={busy === "fin"} onClick={() => void post("fin", { action: "record", procedure: "entity-ic-review", step_id: "4" }, "자금확정성 사실 확인을 기록했습니다.")}>현재 사실 상태로 확인 기록</button>
      )}

      <h5 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">step 4.5 · 4.6 — 통합 인사이트 리뷰 · 의사결정 덱</h5>
      {canAct && (
        <div className="flex flex-wrap gap-1 items-center mb-1">
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "insight"} title="투자심의 자료 요약만을 근거로 LLM이 통합 해석 초안을 만듭니다 — 저장되지 않으며, 검토 후 4.5 메모로 기록합니다"
            onClick={() => void draftInsight()}>{busy === "insight" ? "초안 생성 중..." : "통합 인사이트 초안 생성 (LLM)"}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "deck"} title="브리핑 팩(E1)을 생성해 해시와 함께 4.6 의사결정 덱으로 기록합니다"
            onClick={() => void post("deck", { action: "attach_decision_deck" }, "의사결정 덱(브리핑 팩)을 생성·기록했습니다.")}>의사결정 덱 생성·기록</button>
        </div>
      )}
      {insight && (
        <div className="card mb-2" data-testid="ic-insight-draft">
          <p className="text-[length:var(--fs-caption)]"><span className={`status-chip ${insight.source === "llm" ? "status-amber" : "status-gray"}`}>{insight.source === "llm" ? "LLM 초안" : "결정론 폴백"}</span> <span className="note">{insight.note}</span></p>
          <p className="text-[length:var(--fs-caption)]">{insight.draft.synthesis}</p>
          {insight.draft.tensions.length > 0 && <ul className="sizing-note-list">{insight.draft.tensions.map((t, i) => <li key={`t-${i}`}>긴장: {t}</li>)}</ul>}
          {insight.draft.open_questions.length > 0 && <ul className="sizing-note-list">{insight.draft.open_questions.map((q, i) => <li key={`q-${i}`}>질문: {q}</li>)}</ul>}
          <p className="note">{insight.draft.recommendation_note} — 아래 4.5 메모에 채워졌습니다. 수정 후 기록하세요.</p>
        </div>
      )}
      <ul className="sizing-note-list">
        {view.entity.filter((s) => s.id === "4.5" || s.id === "4.6").map((s) => genericRecord("entity-ic-review", s))}
      </ul>

      <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">그룹 투자심의위원회 검토 (group-investment-review)</h4>
      {strip(view.group, "group-investment-review")}
      <ul className="sizing-note-list">
        {view.group.filter((s) => s.source === "ledger").map((s) => genericRecord("group-investment-review", s))}
      </ul>
    </section>
  );
}
