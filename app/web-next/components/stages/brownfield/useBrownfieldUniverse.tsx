"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { api } from "../../../lib/api.ts";
import { type CapabilityGapRow, summarizeGap } from "../../../lib/capability-gap.ts";
import { useEffect } from "react";
import type { useBrownfieldBase } from "./useBrownfieldBase.ts";
import type { WebProposalResponse, UniRecoResponse, UniCriteria, EvalItem, EvalCategoryScore, FinancialsResp } from "./types.ts";

export function useBrownfieldUniverse(prev: ReturnType<typeof useBrownfieldBase>) {
  const { savingUniverse, selected, universeDraft, setSavingUniverse, setError, loadDetail, setEditingUniverse, setUniReco, setUniRecoApplied, setUniverseDraft, setGapHint, gapHint, opportunityId, setSelected, webBusy, setWebBusy, setWebProposals, setWebNote, setWebSource, uniBusy, setUniBusy, setEvalItems, setEvalScores, setFinancials } = prev;

  const universeModalFocus = useModalFocus(() => { if (!savingUniverse) closeUniverseEditor(); });

  // Long List 테이블의 재무·기술 평가 배지·잠정 순위는 서버가 계산해 target
  // row에 붙여주는 eval_summary를 그대로 쓴다(targets GET, ADR-0139) — 항목별
  // 편집 UI(evalItems)만 행을 펼칠 때 lazy 로드한다(loadEvalItems).

  async function saveUniverse() {
    if (!selected || savingUniverse || !universeDraft.definition.trim()) return;
    setSavingUniverse(true); setError(null);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets`, {
        definition: universeDraft.definition.trim(),
        // criteria는 더 이상 이 화면에서 입력받지 않는다 — 서버가 기존 값을
        // 그대로 보존한다(생략 시 덮어쓰지 않음).
        min_long_list: Number(universeDraft.min_long_list) || 5,
      });
      loadDetail(selected.opportunity.id);
      setEditingUniverse(false);
      setUniReco(null);
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목표 시장 정의 저장 실패");
    } finally {
      setSavingUniverse(false);
    }
  }

  function universeDraftFromSaved() {
    const u = selected?.universe;
    return {
      definition: u?.definition ?? "",
      min_long_list: String(u?.min_long_list ?? 5),
    };
  }

  // 수정 모달 열기 — 매번 저장된 값으로 새로 채운다(이전에 취소한 미저장
  // 입력이 남아있지 않도록). 참고용 S3 역량 갭 힌트도 함께 불러온다.
  function openUniverseEditor() {
    setUniverseDraft(universeDraftFromSaved());
    setUniReco(null);
    setUniRecoApplied(false);
    setEditingUniverse(true);
    if (selected) {
      api.get<{ rows: CapabilityGapRow[] }>(`/api/opportunities/${encodeURIComponent(selected.opportunity.id)}/capability-gap`)
        .then((r) => {
          const s = summarizeGap(r.data.rows);
          setGapHint({ unmet: s.unmet, partial: s.partial });
        })
        .catch(() => setGapHint(null));
    }
  }

  // 취소 — 입력값을 버리고 저장된 값으로 되돌린 뒤 모달을 닫는다. 저장 전까지는
  // 어떤 값도 반영되지 않는다(보기/수정 분리).
  function closeUniverseEditor() {
    setUniverseDraft(universeDraftFromSaved());
    setUniReco(null);
    setUniRecoApplied(false);
    setEditingUniverse(false);
  }

  // 목표 시장 정의 수정 폼 — 수정 모달 안에서만 쓰인다.
  function UniverseForm() {
    return (
      <form
        className="sizing-new-form mb-0"
        onSubmit={(e) => { e.preventDefault(); void saveUniverse(); }}
        aria-label="목표 시장 정의 수정"
      >
        <label className="text-[length:var(--fs-caption)] block mb-3">
          <span className="block mb-1">정의 * (후보 풀의 범위)</span>
          <textarea
            value={universeDraft.definition}
            onChange={(e) => setUniverseDraft({ ...universeDraft, definition: e.target.value })}
            placeholder="예: 국내 상장 로봇 부품·시스템 업체 전체"
            required
            rows={3}
            className="sizing-new-input w-full"
          />
        </label>
        <label className="text-[length:var(--fs-caption)] w-32 shrink-0 block mb-3">
          <span className="block mb-1">최소 후보 수</span>
          <input type="number" min={1} value={universeDraft.min_long_list} onChange={(e) => setUniverseDraft({ ...universeDraft, min_long_list: e.target.value })} className="sizing-new-input sizing-new-input-sm w-full" />
        </label>
        {gapHint && (
          <p className="mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            참고(강제 공식 아님): S3 필요 역량 중 미보유 {gapHint.unmet}건 · 부분충족 {gapHint.partial}건
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={closeUniverseEditor} disabled={savingUniverse}>취소</button>
          <button type="submit" className="btn-ghost btn-sm" disabled={savingUniverse || !universeDraft.definition.trim()}>
            {savingUniverse ? "저장 중..." : "목표 시장 저장"}
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    if (!opportunityId) { setSelected(null); return; }
    loadDetail(opportunityId);
  }, [opportunityId, loadDetail]);

  // 기회를 바꾸면 진행 중이던 수정을 닫는다 — 다른 기회의 미저장 입력이 새
  // 기회 폼에 남지 않도록.
  useEffect(() => {
    setEditingUniverse(false);
    setUniReco(null);
    setUniRecoApplied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.opportunity.id]);

  // ── B: Long List 웹검색 후보 제안 생성 (on-demand, ADR-0118) ──
  async function generateWebProposals() {
    if (!selected || webBusy) return;
    setWebBusy(true); setError(null);
    try {
      const res = await api.post<WebProposalResponse>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/target-proposals/web-search`, {});
      setWebProposals(res.data.suggestions);
      setWebNote(res.data.note);
      setWebSource(res.data.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "웹검색 제안 생성 실패");
    } finally {
      setWebBusy(false);
    }
  }

  // ── D: 유니버스 선정 기준 초안 생성 ──
  async function generateUniReco() {
    if (!selected || uniBusy) return;
    setUniBusy(true); setError(null);
    try {
      const res = await api.post<UniRecoResponse>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/universe-criteria-draft`, {});
      setUniReco(res.data);
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "정의 초안 생성 실패");
    } finally {
      setUniBusy(false);
    }
  }

  // 적용 — 아래 목표 시장 정의 폼의 "정의" 필드만 채운다(저장은 사람이 "목표
  // 시장 저장" 클릭). 산업/지역/규모 요약은 참고용일 뿐 자동으로 선정 기준·
  // 최소 후보 수 입력에 밀어넣지 않는다 — 그 두 값은 사람이 이미 정한 값을
  // 그대로 유지한다.
  function applyUniReco(c: UniCriteria) {
    const content = c.rationale || [c.industry, c.region, c.size].filter(Boolean).join(" · ");
    if (!content) return;
    setUniverseDraft((prev) => ({ ...prev, definition: content }));
    setUniRecoApplied(true);
  }

  // S7 재무·기술 평가 (ADR-0139) — 후보 행을 펼칠 때 불러온다(최초 호출 시
  // 서버가 재무 빌트인·기술 시딩을 lazy하게 채운다).
  function loadEvalItems(targetId: string) {
    if (!selected) return;
    api.get<{ items: EvalItem[]; scores: Record<EvalItem["category"], EvalCategoryScore> }>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/eval-state`)
      .then((r) => {
        setEvalItems((prev) => ({ ...prev, [targetId]: r.data.items }));
        setEvalScores((prev) => ({ ...prev, [targetId]: r.data.scores }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "재무·기술 평가 불러오기 실패"));
  }

  function loadFinancials(companyId: string) {
    api.get<FinancialsResp>(`/api/companies/${encodeURIComponent(companyId)}/financials`)
      .then((r) => setFinancials((prev) => ({ ...prev, [companyId]: r.data })))
      .catch(() => setFinancials((prev) => ({ ...prev, [companyId]: null })));
  }
  return { openUniverseEditor, generateWebProposals, closeUniverseEditor, universeModalFocus, generateUniReco, applyUniReco, UniverseForm };
}
