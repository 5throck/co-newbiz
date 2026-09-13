"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// S10 투자구조 설계 (flow.spec v2.2.0) — 비히클(direct/SPC/holdco/내부 스핀오프/JV)
// 결정과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조) 검토,
// 그리고 자금조달 sources & uses 균형을 다룬다. 4축 검토 완료는 근거 아티팩트
// 참조가 필수인 별도 행위이고, 완료 술어는 "최신 가설 완료 + 조달=사용>0"이다.

interface HypothesisRow {
  id: string;
  asset_or_stock: string | null;
  stake_type: string | null;
  instrument_mix: string | null;
  vehicle: string | null;
  commercialization_path: string | null;
  tax_structure_note: string | null;
  liability_isolation_note: string | null;
  financing_leverage_note: string | null;
  exit_structure_note: string | null;
  four_axis_review_completed: number;
  hypothesized_by: string;
  hypothesized_at: string;
  rationale: string;
}
interface FinancingEntry {
  id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note: string | null;
  created_by: string;
}
interface View {
  hypotheses: HypothesisRow[];
  financing: { entries: FinancingEntry[]; totals: { sources: number; uses: number; balanced: boolean } };
}

const VEHICLE_LABEL: Record<string, string> = {
  direct: "직접 투자(direct)",
  spc: "SPC/SPV(목적법인)",
  holdco: "홀딩스 경유(holdco)",
  internal_venture_spinoff: "내부 벤처 스핀오프",
  jv: "합작(JV)",
};
const AXIS_LABEL: Record<string, string> = {
  tax_structure_note: "절세 구조",
  liability_isolation_note: "책임 격리",
  financing_leverage_note: "재무 레버리지",
  exit_structure_note: "엑싯 구조",
};

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export default function DealStructurePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [artifactRef, setArtifactRef] = useState<Record<string, string>>({});
  const [newHyp, setNewHyp] = useState({ vehicle: "", asset_or_stock: "", stake_type: "", instrument_mix: "", tax_structure_note: "", liability_isolation_note: "", financing_leverage_note: "", exit_structure_note: "", rationale: "" });
  const [newEntry, setNewEntry] = useState<{ kind: "source" | "use"; name: string; amount_krw_m: string; note: string }>({ kind: "source", name: "", amount_krw_m: "", note: "" });
  // ADR-0118 — S10 검토/안건구조 LLM 추천(제안). 가설 등록은 사람의 행위다.
  interface DealStructureReco {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    recommendation: {
      vehicle: string | null;
      stake_type: string | null;
      instrument_mix: string | null;
      four_axis: { tax_structure_note: string; liability_isolation_note: string; financing_leverage_note: string; exit_structure_note: string };
      rationale_draft: string;
      key_evidence: string[];
      cautions: string[];
    };
  }
  const [reco, setReco] = useState<DealStructureReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/deal-structure`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "투자구조 데이터를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function generateReco() {
    if (recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<DealStructureReco>(`/api/projects/${encodeURIComponent(projectId)}/deal-structure-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "추천 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }

  function applyReco() {
    if (!reco) return;
    const r = reco.recommendation;
    setNewHyp((h) => ({
      ...h,
      vehicle: r.vehicle ?? h.vehicle,
      stake_type: r.stake_type ?? h.stake_type,
      instrument_mix: r.instrument_mix ?? h.instrument_mix,
      tax_structure_note: r.four_axis.tax_structure_note !== "검증 필요" ? r.four_axis.tax_structure_note : h.tax_structure_note,
      liability_isolation_note: r.four_axis.liability_isolation_note !== "검증 필요" ? r.four_axis.liability_isolation_note : h.liability_isolation_note,
      financing_leverage_note: r.four_axis.financing_leverage_note !== "검증 필요" ? r.four_axis.financing_leverage_note : h.financing_leverage_note,
      exit_structure_note: r.four_axis.exit_structure_note !== "검증 필요" ? r.four_axis.exit_structure_note : h.exit_structure_note,
      rationale: r.rationale_draft || h.rationale,
    }));
  }

  async function post(body: Record<string, unknown>, successMsg?: string) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/deal-structure`, body);
      if (successMsg) setError(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  function completeFourAxis(h: HypothesisRow) {
    const ref = (artifactRef[h.id] ?? "").trim();
    if (!ref) {
      setError("4축 검토 완료에는 deal_structure_review 아티팩트 참조가 필수입니다.");
      return;
    }
    confirm("4축 검토 완료 처리", () => { void post({ action: "complete_four_axis", hypothesis_id: h.id, artifact_ref: ref }); },
      { body: "완료 처리는 감사 로그에 아티팩트 참조와 함께 기록되며 되돌릴 수 없습니다." });
  }

  function addEntry() {
    const amount = Number(newEntry.amount_krw_m);
    if (!newEntry.name.trim() || !Number.isFinite(amount) || amount < 0) {
      setError("항목명과 0 이상 금액(백만 KRW)이 필요합니다.");
      return;
    }
    void post({ action: "add_financing_entry", kind: newEntry.kind, name: newEntry.name.trim(), amount_krw_m: amount, note: newEntry.note || null });
    setNewEntry({ kind: newEntry.kind, name: "", amount_krw_m: "", note: "" });
  }

  const totals = data?.financing.totals;
  const diff = totals ? Math.round((totals.sources - totals.uses) * 10) / 10 : 0;

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S10" heading="S10 투자구조 설계 — 비히클·4축 검토·자금조달">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-3">
          비히클(SPC 포함)과 절세 구조·책임 격리·재무 레버리지·엑싯 구조 4대 축을 검토하고,
          자금조달 sources &amp; uses를 균형시킵니다. 이 산출물이 S11 IC 패키지의 입력입니다.
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">{error}</p>}

        {/* ── LLM 검토/안건구조 추천 (결정 지원) — ADR-0118: 제안은 LLM, 가설 등록은 사람 ── */}
        {canAct && (
          <section className="market-section sizing-step mb-3" aria-label="LLM 검토/안건구조 추천">
            <h3 className="sizing-step-title text-[0.9rem]">🤖 LLM 검토/안건구조 추천 (제안)</h3>
            <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">
              원칙 (경계 #2): 가설 등록·4축 확정은 사람이 합니다 — S8 채택 BC·S9 발견사항·WACC·현재 상태에서 만든 제안입니다.
            </p>
            {recoError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {!reco && !recoLoading && !recoError && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button type="button" className="btn-ghost" onClick={() => void generateReco()}>▶ LLM 추천 생성</button>
                <span className="text-[0.75rem] text-[color:var(--muted-fg)]">비히클·지분·수단과 4축 노트·구조 근거 초안을 작성해 가설 등록을 돕습니다.</span>
              </div>
            )}
            {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">채택 BC·DD 발견사항·WACC를 근거로 초안을 작성하는 중...</p>}
            {reco && (
              <>
                <p className="mb-1 flex flex-wrap items-center gap-1">
                  <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                  </span>
                  {reco.recommendation.vehicle && <span className="status-chip status-amber">{VEHICLE_LABEL[reco.recommendation.vehicle] ?? reco.recommendation.vehicle}</span>}
                  {reco.recommendation.stake_type && <span className="status-chip status-not-started">지분: {reco.recommendation.stake_type}</span>}
                  {reco.recommendation.instrument_mix && <span className="status-chip status-not-started">수단: {reco.recommendation.instrument_mix}</span>}
                </p>
                {reco.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
                {reco.recommendation.rationale_draft && <p className="text-[0.78rem] mb-1"><span className="font-semibold">구조 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
                <table className="data-table mb-2" aria-label="4축 노트 초안">
                  <caption className="sr-only">4축 노트 초안</caption>
                  <tbody>
                    {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                      <tr key={k}>
                        <th scope="row" style={{ width: "8rem" }}>{AXIS_LABEL[k]}</th>
                        <td className="text-[0.78rem]">{reco.recommendation.four_axis[k]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reco.recommendation.cautions.length > 0 && (
                  <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {reco.recommendation.cautions.join(" / ")}</p>
                )}
                <p className="text-[0.7rem] text-[color:var(--muted-fg)] mb-1">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => confirm("LLM 추천을 가설 폼에 반영할까요?", applyReco, {
                    body: "'새 투자구조 가설 기록' 폼에 초안을 채웁니다 — 검토·수정 후 사람이 등록합니다.",
                    confirmLabel: "반영",
                  })}
                >
                  ▶ 가설 폼에 반영
                </button>
              </>
            )}
          </section>
        )}

        <section className="market-section sizing-step mb-3" aria-label="투자구조 가설">
          <h3 className="sizing-step-title text-[0.9rem]">투자구조 가설 ({data?.hypotheses.length ?? 0}건)</h3>
          {(data?.hypotheses ?? []).map((h) => (
            <div key={h.id} className="sizing-grade-card mb-2">
              <div className="flex flex-wrap items-center gap-1 mb-1">
                {h.vehicle && <span className="status-chip status-amber">{VEHICLE_LABEL[h.vehicle] ?? h.vehicle}</span>}
                {h.asset_or_stock && <span className="status-chip status-not-started">{h.asset_or_stock === "asset" ? "자산 인수" : h.asset_or_stock === "stock" ? "주식 인수" : "혼합"}</span>}
                {h.stake_type && <span className="status-chip status-not-started">지분: {h.stake_type}</span>}
                {h.instrument_mix && <span className="status-chip status-not-started">수표: {h.instrument_mix}</span>}
                {h.four_axis_review_completed === 1
                  ? <span className="status-chip status-green">4축 검토 완료</span>
                  : <span className="status-chip status-red">4축 검토 미완료</span>}
                <span className="text-[0.7rem] text-[color:var(--muted-fg)]">{h.hypothesized_at.slice(0, 10)} · {h.hypothesized_by}</span>
              </div>
              <table className="data-table" aria-label="4축 검토 노트">
                <caption className="sr-only">4대 축 검토 내용</caption>
                <tbody>
                  {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                    <tr key={k}>
                      <th scope="row" style={{ width: "8rem" }}>{AXIS_LABEL[k]}</th>
                      <td>{h[k] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[0.75rem] text-[color:var(--muted-fg)] mt-1">근거: {h.rationale}</p>
              {canAct && h.four_axis_review_completed !== 1 && (
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <input
                    className="sizing-new-input text-[0.78rem]"
                    style={{ minWidth: "18rem" }}
                    placeholder="deal_structure_review 아티팩트 참조 (필수)"
                    value={artifactRef[h.id] ?? ""}
                    onChange={(e) => setArtifactRef({ ...artifactRef, [h.id]: e.target.value })}
                    aria-label="아티팩트 참조"
                  />
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => completeFourAxis(h)}>4축 검토 완료</button>
                </div>
              )}
            </div>
          ))}
          {data && data.hypotheses.length === 0 && (
            <p className="text-[0.85rem] text-[color:var(--muted-fg)]">등록된 가설이 없습니다 — 아래에서 새 가설을 기록하세요.</p>
          )}

          {canAct && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[0.82rem] text-[color:var(--accent)]">새 투자구조 가설 기록</summary>
              <div className="flex flex-wrap gap-2 mt-2 text-[0.8rem]">
                <label>비히클
                  <select className="sizing-new-input ml-1" value={newHyp.vehicle} onChange={(e) => setNewHyp({ ...newHyp, vehicle: e.target.value })}>
                    <option value="">—</option>
                    {Object.entries(VEHICLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>자산/주식
                  <select className="sizing-new-input ml-1" value={newHyp.asset_or_stock} onChange={(e) => setNewHyp({ ...newHyp, asset_or_stock: e.target.value })}>
                    <option value="">—</option>
                    <option value="asset">자산 인수</option>
                    <option value="stock">주식 인수</option>
                    <option value="mixed">혼합</option>
                  </select>
                </label>
                <label>지분
                  <select className="sizing-new-input ml-1" value={newHyp.stake_type} onChange={(e) => setNewHyp({ ...newHyp, stake_type: e.target.value })}>
                    <option value="">—</option>
                    <option value="full">전량(full)</option>
                    <option value="majority">과반(majority)</option>
                    <option value="minority">소수(minority)</option>
                    <option value="joint_control">공동 통제</option>
                  </select>
                </label>
                <label>수표 믹스
                  <select className="sizing-new-input ml-1" value={newHyp.instrument_mix} onChange={(e) => setNewHyp({ ...newHyp, instrument_mix: e.target.value })}>
                    <option value="">—</option>
                    <option value="primary">신주(primary)</option>
                    <option value="secondary">구주(secondary)</option>
                    <option value="mixed">혼합</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-1 gap-1 mt-2 text-[0.8rem]">
                {(["tax_structure_note", "liability_isolation_note", "financing_leverage_note", "exit_structure_note"] as const).map((k) => (
                  <label key={k}>{AXIS_LABEL[k]}
                    <input className="sizing-new-input w-full" value={newHyp[k]} onChange={(e) => setNewHyp({ ...newHyp, [k]: e.target.value })} />
                  </label>
                ))}
                <label>근거 (필수)
                  <textarea className="sizing-new-input w-full" rows={2} value={newHyp.rationale} onChange={(e) => setNewHyp({ ...newHyp, rationale: e.target.value })} />
                </label>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm mt-1"
                disabled={busy}
                onClick={() => {
                  if (!newHyp.rationale.trim()) { setError("근거(rationale)는 필수입니다."); return; }
                  void post({ action: "hypothesize", ...newHyp, vehicle: newHyp.vehicle || null, asset_or_stock: newHyp.asset_or_stock || null, stake_type: newHyp.stake_type || null, instrument_mix: newHyp.instrument_mix || null });
                  setNewHyp({ vehicle: "", asset_or_stock: "", stake_type: "", instrument_mix: "", tax_structure_note: "", liability_isolation_note: "", financing_leverage_note: "", exit_structure_note: "", rationale: "" });
                }}
              >
                가설 기록
              </button>
            </details>
          )}
        </section>

        <section className="market-section sizing-step" aria-label="자금조달 계획">
          <h3 className="sizing-step-title text-[0.9rem]">자금조달 계획 (sources &amp; uses)</h3>
          {totals && (
            <p className="text-[0.82rem] mb-1">
              조달 <span className="mono-num">{fmt(totals.sources)}</span> · 사용 <span className="mono-num">{fmt(totals.uses)}</span> · 차액{" "}
              <span className="mono-num">{fmt(diff)}</span> 백만 KRW{" "}
              {totals.balanced
                ? <span className="status-chip status-green">균형</span>
                : <span className="status-chip status-red">불균형 — S10 완료 요건 미충족</span>}
            </p>
          )}
          <table className="data-table" aria-label="자금조달 항목">
            <caption className="sr-only">sources &amp; uses 항목</caption>
            <thead>
              <tr><th scope="col">구분</th><th scope="col">항목</th><th scope="col" className="mono-num">금액 (백만 KRW)</th><th scope="col">비고</th><th scope="col"></th></tr>
            </thead>
            <tbody>
              {(data?.financing.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{e.kind === "source" ? "조달" : "사용"}</td>
                  <td>{e.name}</td>
                  <td className="mono-num">{fmt(e.amount_krw_m)}</td>
                  <td>{e.note ?? "—"}</td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-danger btn-sm" disabled={busy}
                        onClick={() => confirm("항목 삭제", () => { void post({ action: "remove_financing_entry", entry_id: e.id }); }, { body: "삭제는 감사 로그에 기록됩니다.", confirmLabel: "삭제" })}>
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.financing.entries.length ?? 0) === 0 && (
                <tr><td colSpan={5}>등록된 항목이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
          {canAct && (
            <div className="flex flex-wrap items-end gap-2 mt-2 text-[0.8rem]">
              <label>구분
                <select className="sizing-new-input ml-1" value={newEntry.kind} onChange={(e) => setNewEntry({ ...newEntry, kind: e.target.value as "source" | "use" })}>
                  <option value="source">조달</option>
                  <option value="use">사용</option>
                </select>
              </label>
              <label>항목명
                <input className="sizing-new-input ml-1" value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })} />
              </label>
              <label>금액 (백만 KRW)
                <input className="sizing-new-input mono-num ml-1" style={{ width: "8rem" }} value={newEntry.amount_krw_m} onChange={(e) => setNewEntry({ ...newEntry, amount_krw_m: e.target.value })} />
              </label>
              <label>비고
                <input className="sizing-new-input ml-1" value={newEntry.note} onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })} />
              </label>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addEntry}>추가</button>
            </div>
          )}
        </section>
      </StageFrame>
      {confirmDialog}
    </main>
  );
}
