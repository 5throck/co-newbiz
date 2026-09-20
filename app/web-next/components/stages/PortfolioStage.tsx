"use client";

// S12 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/portfolio 페이지와
// /deals/[id]/s12 탭이 동일 컴포넌트를 소비한다). ProjectSubNav·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { useCallback, useEffect, useState } from "react";
import { ProjectSubNav } from "../ProjectSubNav.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { useConfirm } from "../crud.tsx";

// S12 사후 관리 — 포트폴리오 스코어카드 열람 + 포트폴리오 전환 결정 기록 화면
// (ADR-0101 §3). 이 화면은 venture-portfolio-IC의 '인적 결정'을 기록하는
// 표면이다 (경계 #2 — 트랜치 집행과 kill/divest는 투자결정이므로 사람의
// 행위다): 스코어카드는 데이터만 보여주며 kill/fund 권고를 하지 않고, 결정
// 기록은 명시적 P4 확인(useConfirm)을 거친 analyst+ 행위다. 기록자(recorder)는
// 세션 사용자, 결정자(decided_by)는 사람 역할 키로 화면에 분리 표기한다.

interface RollupRow {
  id: string;
  project_no: string; venture_class: string; section: string; measure_key: string;
  target_value: string | null; actual_value: string | null; status: string;
  evidence_ref: string; observed_at: string;
}
interface ClassRollupEntry { venture_class: string; ventures: number; measures: number; on_target: number; deviation: number; insufficient_evidence: number }
interface TrendEntry { review_cycle: string; measures: number; on_target: number; deviation: number; insufficient_evidence: number }
interface DecisionRow {
  id: string; review_cycle: string; decision: string; decided_by: string;
  decided_at: string; rationale: string; learning_capture: string | null;
  created_at: string; recorded_by: string;
}
interface ScorecardView {
  project: { id: string; project_no: string };
  rollup: {
    review_cycle: string | null; resolved_from: "explicit" | "latest";
    financial: RollupRow[]; strategic: RollupRow[];
    class_rollup: ClassRollupEntry[];
    insufficient_evidence: Array<{ project_id: string; section: string; measure_key: string }>;
    provenance: { runs: string[]; review_cycles_available: string[] };
  };
  trend: TrendEntry[];
  decisions: { latest: DecisionRow | null; history: DecisionRow[] };
}

// flow.spec v2.0.0 S12 어휘 5종 (PORTFOLIO_TRANSITIONS의 UI 라벨). 0071 CHECK와
// 동일 어휘 — 서버가 재검증한다.
const TRANSITION_LABELS: Record<string, string> = {
  next_tranche_released: "다음 트랜치 집행",
  held_evidence_incomplete: "보류 — 근거 미완결",
  graduate_to_core: "코어 사업 전환",
  reduce_or_divest: "축소·매각",
  kill_with_learning_captured: "중단 — 학습 내용 회수",
};

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STATUS_META: Record<string, { icon: string; label: string; cls: string }> = {
  on_target: { icon: "●", label: "목표 달성", cls: "status-green" },
  deviation: { icon: "◐", label: "이탈", cls: "status-amber" },
  insufficient_evidence: { icon: "○", label: "근거 부족", cls: "status-not-started" },
};

function statusMeta(status: string | undefined) {
  return STATUS_META[status ?? ""] ?? { icon: "?", label: status ?? "unknown", cls: "status-not-started" };
}

const EMPTY_FORM = { decision: "next_tranche_released", rationale: "", learning_capture: "", review_cycle: "" };

export function PortfolioStage({ projectId }: { projectId: string }) {
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ScorecardView | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ADR-0118 — S12 모니터링 브리프(초안). 전환 결정은 사람(venture-portfolio-IC)이 기록한다.
  interface MonitoringBrief {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    brief: {
      assessment_draft: string;
      risk_flags: string[];
      transition_suggestion: string | null;
      rationale_draft: string;
      learning_capture_draft: string;
      key_evidence: string[];
      cautions: string[];
    };
  }
  const [reco, setReco] = useState<MonitoringBrief | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  async function generateBrief() {
    if (recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<MonitoringBrief>(`/api/projects/${encodeURIComponent(projectId)}/monitoring-brief`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "브리프 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }

  const load = useCallback(() => {
    api.get<ScorecardView>(`/api/projects/${encodeURIComponent(projectId)}/scorecard`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "스코어카드를 불러오지 못했습니다."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function recordDecision() {
    confirm("포트폴리오 전환 결정 기록", () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.post(`/api/projects/${encodeURIComponent(projectId)}/transition-decision`, {
            decision: form.decision,
            rationale: form.rationale,
            learning_capture: form.learning_capture || undefined,
            review_cycle: form.review_cycle || undefined,
          });
          setNotice("전환 결정이 기록되었습니다 — 결정자는 venture-portfolio-IC(사람), 기록자는 세션 사용자로 남습니다. 장부는 추가 전용(append-only)입니다.");
          setForm({ ...EMPTY_FORM });
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "전환 결정 기록 실패");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: "venture-portfolio-IC의 결정을 장부에 기록합니다. 이 결정은 투자결정(트랜치 집행·kill/divest)으로서 사람의 판단이며, 에이전트가 대신 결정할 수 없습니다. 기록 후에는 수정·삭제할 수 없습니다.",
      confirmLabel: "기록",
    });
  }

  const isKill = form.decision === "kill_with_learning_captured";
  const rollup = view?.rollup;

  return (
<>
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S12" heading="S12 사후 관리 — 포트폴리오 스코어카드 · 전환 결정">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-2">
          분기별 스코어카드가 갱신되어야 S12 완료 기준이 충족됩니다 (최신 분기 또는 직전 분기).
          {view && rollup?.review_cycle && (
            <span className={`status-chip ${rollup.financial.length + rollup.strategic.length > 0 ? "status-green" : "status-amber"} ml-2`}>
              {rollup.financial.length + rollup.strategic.length > 0
                ? `● 최신 주기 ${rollup.review_cycle} (${rollup.resolved_from === "latest" ? "최신값 자동 해석" : "명시적 지정"})`
                : `○ 기록된 스코어카드 없음 (${rollup.review_cycle})`}
            </span>
          )}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {notice}</p>}

        {/* ── 주기별 트렌드 ──────────────────────────────────────────── */}
        <section className="market-section sizing-step" aria-label="스코어카드 트렌드">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">📈</span> 스코어카드 트렌드 — 분기별 요약
          </h3>
          {(view?.trend.length ?? 0) > 0 ? (
            <table className="data-table" aria-label="분기별 스코어카드 요약">
              <caption className="sr-only">리뷰 주기별 측정 요약</caption>
              <thead>
                <tr><th scope="col">리뷰 주기</th><th scope="col">측정 수</th><th scope="col">목표 달성</th><th scope="col">이탈</th><th scope="col">근거 부족</th></tr>
              </thead>
              <tbody>
                {view!.trend.map((t) => (
                  <tr key={t.review_cycle}>
                    <td className="tabular-nums">{t.review_cycle}</td>
                    <td className="tabular-nums">{t.measures}</td>
                    <td className="tabular-nums"><span className="status-chip status-green">● {t.on_target}</span></td>
                    <td className="tabular-nums"><span className="status-chip status-amber">◐ {t.deviation}</span></td>
                    <td className="tabular-nums"><span className="status-chip status-not-started">○ {t.insufficient_evidence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[0.82rem] text-[color:var(--muted-fg)]">
              아직 기록된 스코어카드 주기가 없습니다 — portfolio-venture-monitoring 절차의 분기 기록이 여기 표시됩니다.
            </p>
          )}
        </section>

        {/* ── 최신 주기 롤업 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step mt-3" aria-label="최신 주기 스코어카드">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">🗂</span> 최신 주기 롤업
            {rollup?.review_cycle && <span className="status-chip status-not-started ml-2">{rollup.review_cycle}</span>}
          </h3>
          {(rollup?.class_rollup.length ?? 0) > 0 && (
            <table className="data-table" aria-label="벤처 클래스 롤업">
              <caption className="sr-only">클래스별 롤업 요약</caption>
              <thead>
                <tr><th scope="col">클래스</th><th scope="col">벤처 수</th><th scope="col">측정</th><th scope="col">달성</th><th scope="col">이탈</th><th scope="col">근거 부족</th></tr>
              </thead>
              <tbody>
                {rollup!.class_rollup.map((c) => (
                  <tr key={c.venture_class}>
                    <td>{c.venture_class}</td>
                    <td className="tabular-nums">{c.ventures}</td>
                    <td className="tabular-nums">{c.measures}</td>
                    <td className="tabular-nums">{c.on_target}</td>
                    <td className="tabular-nums">{c.deviation}</td>
                    <td className="tabular-nums">{c.insufficient_evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(["financial", "strategic"] as const).map((section) => (
            <div key={section} className="mt-2">
              <h4 className="text-[0.85rem] mb-1">{section === "financial" ? "재무" : "전략"} 섹션</h4>
              {(rollup?.[section].length ?? 0) > 0 ? (
                <table className="data-table" aria-label={`${section} 측정 상세`}>
                  <caption className="sr-only">{section} 섹션 측정 상세</caption>
                  <thead>
                    <tr><th scope="col">측정</th><th scope="col">클래스</th><th scope="col">목표</th><th scope="col">실적</th><th scope="col">상태</th></tr>
                  </thead>
                  <tbody>
                    {rollup![section].map((r) => {
                      const meta = statusMeta(r.status);
                      return (
                        <tr key={r.id}>
                          <td>{r.measure_key}</td>
                          <td>{r.venture_class}</td>
                          <td>{r.target_value ?? "—"}</td>
                          <td>{r.actual_value ?? "—"}</td>
                          <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-[0.78rem] text-[color:var(--muted-fg)]">해당 섹션의 측정 기록이 없습니다.</p>
              )}
            </div>
          ))}
          {(rollup?.insufficient_evidence.length ?? 0) > 0 && (
            <ul className="sizing-note-list mt-2">
              {rollup!.insufficient_evidence.map((e, i) => (
                <li key={`${e.section}-${e.measure_key}-${i}`}>
                  <strong>근거 부족 예외</strong>: {e.measure_key} ({e.section}) — 목표 없이는 판정할 수 없습니다.
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── LLM 모니터링 브리프 (결정 지원) — ADR-0118: 초안은 LLM, 전환 결정은 사람 ── */}
        {canAct && (
          <section className="market-section sizing-step mt-3" aria-label="LLM 모니터링 브리프">
            <h3 className="sizing-step-title text-[0.9rem]">🤖 LLM 모니터링 브리프 (초안)</h3>
            <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">
              원칙 (경계 #2): 전환 결정은 사람(venture-portfolio-IC)이 기록합니다 — 스코어카드·시너지 인증·핵심인재·전환 이력에서 만든 <b>초안</b>입니다.
            </p>
            {recoError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {!reco && !recoLoading && !recoError && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button type="button" className="btn-ghost" onClick={() => void generateBrief()}>▶ 모니터링 브리프 생성</button>
                <span className="text-[0.75rem] text-[color:var(--muted-fg)]">투자 상태 평가·리스크 플래그·전환 제안·근거/학습 정리 초안을 작성해 결정 기록을 돕습니다.</span>
              </div>
            )}
            {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">스코어카드·인증·인재 기록을 근거로 초안을 작성하는 중...</p>}
            {reco && (
              <>
                <p className="mb-1 flex flex-wrap items-center gap-1">
                  <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? `LLM 초안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                  </span>
                  {reco.brief.transition_suggestion && (
                    <span className="status-chip status-amber">전환 제안: {TRANSITION_LABELS[reco.brief.transition_suggestion] ?? reco.brief.transition_suggestion}</span>
                  )}
                </p>
                {reco.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
                {reco.brief.assessment_draft && <p className="text-[0.8rem] mb-1"><span className="font-semibold">상태 평가 초안:</span> {reco.brief.assessment_draft}</p>}
                {reco.brief.risk_flags.length > 0 && (
                  <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ 리스크: {reco.brief.risk_flags.join(" / ")}</p>
                )}
                {reco.brief.rationale_draft && <p className="text-[0.8rem] mb-1"><span className="font-semibold">전환 근거 초안:</span> {reco.brief.rationale_draft}</p>}
                {reco.brief.learning_capture_draft && <p className="text-[0.8rem] mb-1"><span className="font-semibold">학습 정리 초안:</span> {reco.brief.learning_capture_draft}</p>}
                <p className="text-[0.7rem] text-[color:var(--muted-fg)] mb-1">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => confirm("브리프 초안을 결정 폼에 반영할까요?", () => {
                    setForm((f) => ({
                      ...f,
                      decision: reco.brief.transition_suggestion ?? f.decision,
                      rationale: reco.brief.rationale_draft || f.rationale,
                      learning_capture: reco.brief.learning_capture_draft || f.learning_capture,
                    }));
                  }, { body: "전환 제안(있다면)과 근거·학습 정리 초안을 결정 폼에 채웁니다 — 기록은 사람이 확정합니다.", confirmLabel: "반영" })}
                >
                  ▶ 결정 폼에 반영
                </button>
              </>
            )}
          </section>
        )}

        {/* ── 전환 결정 장부 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step mt-3" aria-label="포트폴리오 전환 결정">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">⚖️</span> 포트폴리오 전환 결정 — venture-portfolio-IC 인적 결정 장부
          </h3>
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-1">
            아래 기록은 사람(venture-portfolio-IC)의 결정이며, 이 화면의 사용자는 그 결정을 <strong>기록</strong>하는
            역할만 수행합니다. 결정자(decided_by)는 사람 역할 키로 고정되고
            기록자(recorded_by)는 세션 사용자로 남습니다.
          </p>
          {(view?.decisions.history.length ?? 0) > 0 ? (
            <table className="data-table" aria-label="전환 결정 이력">
              <caption className="sr-only">전환 결정 이력 (추가 전용)</caption>
              <thead>
                <tr><th scope="col">주기</th><th scope="col">결정</th><th scope="col">근거</th><th scope="col">결정일</th><th scope="col">기록자</th></tr>
              </thead>
              <tbody>
                {view!.decisions.history.map((d) => (
                  <tr key={d.id}>
                    <td className="tabular-nums">{d.review_cycle}</td>
                    <td><span className={`status-chip ${d.decision === "kill_with_learning_captured" || d.decision === "reduce_or_divest" ? "status-red" : d.decision === "next_tranche_released" || d.decision === "graduate_to_core" ? "status-green" : "status-amber"}`}>
                      {TRANSITION_LABELS[d.decision] ?? d.decision}
                    </span>
                      {d.learning_capture && (
                        <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">학습 회수: {d.learning_capture}</span>
                      )}
                    </td>
                    <td className="text-[0.78rem]">{d.rationale}</td>
                    <td className="text-[0.75rem] tabular-nums">{d.decided_at.slice(0, 10)}</td>
                    <td className="text-[0.75rem]">{d.recorded_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[0.82rem] text-[color:var(--muted-fg)]">아직 기록된 전환 결정이 없습니다.</p>
          )}

          {canAct && (
            <form className="sizing-new-form mt-2" aria-label="전환 결정 기록" onSubmit={(e) => { e.preventDefault(); recordDecision(); }}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]">
                  <span className="block mb-1">결정 (어휘 5종)</span>
                  <select
                    value={form.decision}
                    onChange={(e) => setForm({ ...form, decision: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {Object.entries(TRANSITION_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">리뷰 주기</span>
                  <input
                    value={form.review_cycle}
                    onChange={(e) => setForm({ ...form, review_cycle: e.target.value })}
                    className="sizing-new-input"
                    placeholder="YYYY-Qn (비우면 현재 분기)"
                  />
                </label>
                <label className="text-[0.78rem] flex-1 min-w-[14rem]">
                  <span className="block mb-1">근거 (필수)</span>
                  <input
                    value={form.rationale}
                    onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder="IC 심의 근거 — 근거 없는 결정은 기록될 수 없습니다"
                  />
                </label>
              </div>
              {isKill && (
                <label className="text-[0.78rem] block mt-2">
                  <span className="block mb-1">학습 내용 회수 (learning_capture — kill 시 필수)</span>
                  <input
                    value={form.learning_capture}
                    onChange={(e) => setForm({ ...form, learning_capture: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder="플레이북으로 회수할 학습 내용 — 중단 결정에 필수입니다"
                  />
                </label>
              )}
              <button type="submit" className="btn-primary btn-sm mt-2" disabled={busy}>
                {busy ? "기록 중..." : "결정 기록 (확인 필요)"}
              </button>
            </form>
          )}
        </section>
        {confirmDialog}
      </StageFrame>
</>
  );
}
