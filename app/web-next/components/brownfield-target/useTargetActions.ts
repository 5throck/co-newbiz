"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import type { useTargetDetail } from "./useTargetDetail.ts";
import type { EvalItem } from "./types.ts";

export function useTargetActions(prev: ReturnType<typeof useTargetDetail>) {
  const t = useTranslations("components.brownfieldTarget.useTargetActions");
  const {
    oppId,
    setEvalBusy,
    targetId,
    loadDetail,
    setError,
    busy,
    setBusy,
    setRubricBusy,
    newCriterionLabel,
    setNewCriterionLabel,
    excludeReason,
    editDraft,
    setEditing,
  } = prev;

  async function setEvalVerdict(
    criterionId: string,
    status: "pending" | "pass" | "partial" | "fail" | "na" | "waived",
    note?: string,
  ) {
    if (!oppId) return;
    setEvalBusy(criterionId);
    try {
      await api.put(
        `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-state/${encodeURIComponent(criterionId)}`,
        {
          status,
          ...(note !== undefined ? { note } : {}),
        },
      );
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("verdictSaveFailed"));
    } finally {
      setEvalBusy(null);
    }
  }

  // ADR-0200 Q1: accept every NON-PENDING rule verdict (`자동 규칙`) of one category as a human verdict. AI (`AI`)
  // verdicts are never included — they are reviewed one at a time. Human-only route; the count comes back from the server.
  async function acceptRuleVerdicts(category: "financial" | "technical") {
    if (!oppId) return;
    setEvalBusy(`accept-rule:${category}`);
    try {
      await api.post(
        `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-state/accept-rule`,
        { category },
      );
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("acceptRuleFailed"));
    } finally {
      setEvalBusy(null);
    }
  }

  /** 임계값(루브릭) 저장 — 재무 빌트인 항목의 자동 초안 기준치를 조정한다. */
  async function saveRubric(criterionId: string, rubric: Record<string, number>) {
    if (!oppId) return;
    setRubricBusy(criterionId);
    try {
      await api.patch(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`, {
        rubric,
      });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rubricSaveFailed"));
    } finally {
      setRubricBusy(null);
    }
  }

  async function setEvalWeight(criterionId: string, weight: number) {
    if (!oppId || !Number.isFinite(weight) || weight <= 0) return;
    setEvalBusy(criterionId);
    try {
      await api.patch(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`, {
        weight,
      });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("weightSaveFailed"));
    } finally {
      setEvalBusy(null);
    }
  }

  async function addEvalCriterion(category: EvalItem["category"]) {
    if (!oppId) return;
    const key = category;
    const label = newCriterionLabel[key]?.trim();
    if (!label) return;
    setEvalBusy(key);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria`, { category, label });
      setNewCriterionLabel((prev) => ({ ...prev, [key]: "" }));
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("criterionAddFailed"));
    } finally {
      setEvalBusy(null);
    }
  }

  async function removeEvalCriterion(criterionId: string) {
    if (!oppId) return;
    setEvalBusy(criterionId);
    try {
      await api.delete(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("criterionDeleteFailed"));
    } finally {
      setEvalBusy(null);
    }
  }

  async function shortlist() {
    if (!oppId || busy) return;
    setBusy(true);
    try {
      await api.post(
        `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/shortlist`,
        {},
      );
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("shortlistFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function exclude() {
    if (!oppId || busy || !excludeReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/exclude`, {
        reason: excludeReason.trim(),
      });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("excludeFailed"));
    } finally {
      setBusy(false);
    }
  }

  // 후보 정보 수정/삭제(사용자 요청, 2026-09-15) — 등록 후에도 회사명·DART
  // 고유번호·목표 시장 근거를 고칠 수 있어야 하고, 잘못 등록한 후보는 완전
  // 삭제할 수 있어야 한다(제외는 사유를 남기는 별도 상태 — 삭제는 레코드 자체 제거).
  async function saveEdit() {
    if (busy || !editDraft.company_name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/brownfield/targets/${encodeURIComponent(targetId)}`, {
        company_name: editDraft.company_name.trim(),
        dart_corp_code: editDraft.dart_corp_code.trim() || null,
        universe_note: editDraft.universe_note.trim() || null,
      });
      setEditing(false);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("editSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTarget() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/brownfield/targets/${encodeURIComponent(targetId)}`);
      window.location.href = `/brownfield?opportunity=${encodeURIComponent(oppId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
      setBusy(false);
    }
  }
  return {
    shortlist,
    exclude,
    deleteTarget,
    saveEdit,
    acceptRuleVerdicts,
    setEvalWeight,
    setEvalVerdict,
    removeEvalCriterion,
    saveRubric,
    addEvalCriterion,
  };
}

export type TargetDetailViewState = ReturnType<typeof useTargetDetail> & ReturnType<typeof useTargetActions>;
