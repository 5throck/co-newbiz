"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { api } from "../../../lib/api.ts";
import { type CapabilityGapRow, summarizeGap } from "../../../lib/capability-gap.ts";
import { useEffect } from "react";
import type { useBrownfieldBase } from "./useBrownfieldBase.ts";
import type { WebProposalResponse, UniRecoResponse } from "./types.ts";
import { draftFromSaved, draftFromView, savePayload } from "./universeDraft.ts";
import { UniverseDirectionFields } from "./UniverseDirectionFields.tsx";
import { useTranslations } from "next-intl";

export function useBrownfieldUniverse(prev: ReturnType<typeof useBrownfieldBase>) {
  const t = useTranslations("stages.s67.useBrownfieldUniverse");
  const {
    savingUniverse,
    selected,
    universeDraft,
    setSavingUniverse,
    setError,
    loadDetail,
    setEditingUniverse,
    setUniReco,
    setUniRecoApplied,
    setUniverseDraft,
    setGapHint,
    gapHint,
    opportunityId,
    setSelected,
    webBusy,
    setWebBusy,
    setWebProposals,
    setWebNote,
    setWebSource,
    uniBusy,
    setUniBusy,
  } = prev;

  const universeModalFocus = useModalFocus(() => {
    if (!savingUniverse) closeUniverseEditor();
  });

  // 후보 전체 목록 테이블의 재무·기술 평가 배지·잠정 순위는 서버가 계산해 target
  // row에 붙여주는 eval_summary를 그대로 쓴다(targets GET, ADR-0139) — 항목별
  // 평가 편집은 brownfield-target/useTargetDetail의 eval-state 경로가 담당한다.

  async function saveUniverse() {
    if (!selected || savingUniverse || !universeDraft.definition.trim()) return;
    setSavingUniverse(true);
    setError(null);
    try {
      // The payload (definition, min_long_list and — for direction
      // records — direction/evidence/origin/drafted) is built by savePayload; the server
      // preserves criteria and any key we omit.
      await api.put(
        `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets`,
        savePayload(universeDraft),
      );
      loadDetail(selected.opportunity.id);
      setEditingUniverse(false);
      setUniReco(null);
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTheTarget"));
    } finally {
      setSavingUniverse(false);
    }
  }

  const universeDraftFromSaved = () => draftFromSaved(selected?.universe);

  // 수정 모달 열기 — 매번 저장된 값으로 새로 채운다(이전에 취소한 미저장
  // 입력이 남아있지 않도록). 참고용 S3 역량 갭 힌트도 함께 불러온다.
  function openUniverseEditor() {
    setUniverseDraft(universeDraftFromSaved());
    setUniReco(null);
    setUniRecoApplied(false);
    setEditingUniverse(true);
    if (selected) {
      api
        .get<{ rows: CapabilityGapRow[] }>(
          `/api/opportunities/${encodeURIComponent(selected.opportunity.id)}/capability-gap`,
        )
        .then((r) => {
          const s = summarizeGap(r.data.rows);
          setGapHint({ unmet: s.none, partial: s.partial });
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

  // 목표 시장 정의 수정 폼 — 수정 모달 안에서만 쓰인다. 렌더 헬퍼로 두어
  // 훅 상태(universeDraft·saveUniverse·closeUniverseEditor·gapHint)에 그대로
  // 닫혀 있고, 모달은 ctx를 통해 {universeForm()}으로 인라인 렌더한다.
  // use*는 중첩 함수 안에서 부를 수 없으므로 번역 문자열은 훅 본문(렌더
  // 시점)에서 한 번 만들어 닫는다 — 로콘이 바뀌면 훅이 다시 렌더되어 갱신된다.
  const tc = useTranslations("common");
  const formLabels = {
    definition: t("definitionTheCandidatePoolS"),
    definitionPlaceholder: t("eGAllListedDomestic"),
    minimumCandidateCount: t("minimumCandidateCount"),
    referenceNotAForcedFormula: t("referenceNotAForcedFormula"),
    itemSPartiallyMet: t("itemSPartiallyMet"),
    saveTargetMarket: t("saveTargetMarket"),
    formAriaLabel: tc("editTargetMarketDefinition"),
    countUnit: tc("countUnit"),
    cancel: tc("cancel"),
    saving: tc("saving"),
  };
  function universeForm() {
    return (
      <form
        className="sizing-new-form mb-0"
        onSubmit={(e) => {
          e.preventDefault();
          void saveUniverse();
        }}
        aria-label={formLabels.formAriaLabel}
      >
        {/* Direction records edit the conclusion fields (definition is recomposed from them);
            legacy records keep the plain definition textarea (no auto-convert). */}
        {universeDraft.direction ? (
          <UniverseDirectionFields draft={universeDraft} setDraft={setUniverseDraft} />
        ) : (
          <label className="text-[length:var(--fs-caption)] block mb-3">
            <span className="block mb-1">{formLabels.definition}</span>
            <textarea
              value={universeDraft.definition}
              onChange={(e) => setUniverseDraft({ ...universeDraft, definition: e.target.value })}
              placeholder={formLabels.definitionPlaceholder}
              required
              rows={3}
              className="sizing-new-input w-full"
            />
          </label>
        )}
        <label className="text-[length:var(--fs-caption)] w-32 shrink-0 block mb-3">
          <span className="block mb-1">{formLabels.minimumCandidateCount}</span>
          <input
            type="number"
            min={1}
            value={universeDraft.min_long_list}
            onChange={(e) => setUniverseDraft({ ...universeDraft, min_long_list: e.target.value })}
            className="sizing-new-input sizing-new-input-sm w-full"
          />
        </label>
        {gapHint && (
          <p className="mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {formLabels.referenceNotAForcedFormula} {gapHint.unmet}
            {formLabels.itemSPartiallyMet} {gapHint.partial}
            {formLabels.countUnit}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={closeUniverseEditor} disabled={savingUniverse}>
            {formLabels.cancel}
          </button>
          <button
            type="submit"
            className="btn-ghost btn-sm"
            disabled={savingUniverse || !universeDraft.definition.trim()}
          >
            {savingUniverse ? formLabels.saving : formLabels.saveTargetMarket}
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    if (!opportunityId) {
      setSelected(null);
      return;
    }
    loadDetail(opportunityId);
  }, [opportunityId, loadDetail, setSelected]);

  // 기회를 바꾸면 진행 중이던 수정을 닫는다 — 다른 기회의 미저장 입력이 새
  // 기회 폼에 남지 않도록.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is deliberately keyed on the opportunity id without reading it (re-run on every opportunity switch) — the setters are stable useState identities
  useEffect(() => {
    setEditingUniverse(false);
    setUniReco(null);
    setUniRecoApplied(false);
  }, [selected?.opportunity.id]);

  // ── B: 후보 전체 목록 웹검색 후보 제안 생성 (on-demand, ADR-0118) ──
  async function generateWebProposals() {
    if (!selected || webBusy) return;
    setWebBusy(true);
    setError(null);
    try {
      const res = await api.post<WebProposalResponse>(
        `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/target-proposals/web-search`,
        {},
      );
      setWebProposals(res.data.suggestions);
      setWebNote(res.data.note);
      setWebSource(res.data.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToGenerateWebSearch"));
    } finally {
      setWebBusy(false);
    }
  }

  // ── D: 유니버스 선정 기준 초안 생성 ──
  async function generateUniReco() {
    if (!selected || uniBusy) return;
    setUniBusy(true);
    setError(null);
    try {
      const res = await api.post<UniRecoResponse>(
        `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/universe-criteria-draft`,
        {},
      );
      setUniReco(res.data);
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToGenerateTheDefinition"));
    } finally {
      setUniBusy(false);
    }
  }

  // 적용 — 초안의 편집 가능 필드(결론·범위·가치사슬·우선·제외)만 아래 폼에 채운다.
  // 저장은 사람이 "방향성 저장"을 눌러야 한다. 선정 기준(재무 기준)·최소 후보 수는
  // 사람이 정한 값을 그대로 둔다(DEC-20261111-05 honest unset). `definition`은 채워진
  // 방향성에서 라벨 문장으로 다시 만들어진다(universeDraft.composeDefinition).
  function applyUniReco(res: UniRecoResponse) {
    const view = res.draft;
    if (!view) return;
    setUniverseDraft((prev) => draftFromView(view, res.prompt_version, prev));
    setUniRecoApplied(true);
  }
  return {
    openUniverseEditor,
    generateWebProposals,
    closeUniverseEditor,
    universeModalFocus,
    generateUniReco,
    applyUniReco,
    universeForm,
  };
}
