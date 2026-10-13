"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { api } from "../../lib/api.ts";
import type { useTargetDetail } from "./useTargetDetail.ts";
import type { EvalDraftResp, EvalDraftItem, EvalItem } from "./types.ts";

export function useTargetActions(prev: ReturnType<typeof useTargetDetail>) {
  const { oppId, setEvalBusy, targetId, loadDetail, setError, draftBusy, setDraftBusy, setDraftNote, setDraftCategory, setEvalDraft, evalDraft, busy, setBusy, setRubricBusy, newCriterionLabel, setNewCriterionLabel, excludeReason, editDraft, setEditing } = prev;


  async function setEvalVerdict(criterionId: string, status: "pending" | "pass" | "partial" | "fail" | "na" | "waived", note?: string) {
    if (!oppId) return;
    setEvalBusy(criterionId);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-state/${encodeURIComponent(criterionId)}`, {
        status,
        ...(note !== undefined ? { note } : {}),
      });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가 판정 저장 실패");
    } finally {
      setEvalBusy(null);
    }
  }

  // ── 재무·기술 평가 자동 초안(ADR-0140/0141) ── 초안 생성은 저장이 아니다:
  // 서버가 전자공시 재무 정보(재무) 또는 공시·프로파일·웹 근거(기술)로 계산한 제안을
  // 클라이언트 상태에만 싣는다. 사람이 select를 바꾸거나 "초안 저장"을 누를
  // 때 기존 판정 저장 경로로 확정된다(경계 #2). 기술 근거로 확인 안 된 항목은
  // 제안 없이 "확인 안됨" 사유가 내려온다 — 날조된 판정이 아니라 명시적 미확인.
  async function generateEvalDraft(category: "financial" | "technical") {
    if (!oppId || draftBusy) return;
    setDraftBusy(true); setError(null);
    try {
      const r = await api.post<EvalDraftResp>(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-draft`, { category });
      setDraftNote(r.data.note);
      setDraftCategory(category);
      const byId: Record<string, EvalDraftItem> = {};
      for (const d of r.data.drafts) byId[d.criterion_id] = d;
      setEvalDraft(byId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 초안 생성 실패");
    } finally {
      setDraftBusy(false);
    }
  }

  /** 초안 전체 저장 — 사람이 버튼을 눌러 확정. 제안(status·note)을 그대로
   * PUT eval-state로 기록한다(assessed_by=사용자). 데이터 부족 항목은 건너뛴다. */
  async function saveDraftVerdicts() {
    if (!oppId || !evalDraft || busy) return;
    const entries = Object.values(evalDraft).filter((d) => d.status != null);
    if (entries.length === 0) return;
    setBusy(true); setError(null);
    try {
      for (const d of entries) {
        await api.put(
          `/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-state/${encodeURIComponent(d.criterion_id)}`,
          { status: d.status, note: d.note },
        );
      }
      setEvalDraft(null);
      setDraftCategory(null);
      setDraftNote(null);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "초안 판정 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  /** 임계값(루브릭) 저장 — 재무 빌트인 항목의 자동 초안 기준치를 조정한다. */
  async function saveRubric(criterionId: string, rubric: Record<string, number>) {
    if (!oppId) return;
    setRubricBusy(criterionId);
    try {
      await api.patch(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`, { rubric });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "임계값 저장 실패");
    } finally {
      setRubricBusy(null);
    }
  }

  async function setEvalWeight(criterionId: string, weight: number) {
    if (!oppId || !Number.isFinite(weight) || weight <= 0) return;
    setEvalBusy(criterionId);
    try {
      await api.patch(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/${encodeURIComponent(criterionId)}`, { weight });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "가중치 저장 실패");
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
      setError(err instanceof Error ? err.message : "평가 항목 추가 실패");
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
      setError(err instanceof Error ? err.message : "평가 항목 삭제 실패");
    } finally {
      setEvalBusy(null);
    }
  }

  async function shortlist() {
    if (!oppId || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/shortlist`, {});
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "최종 후보 목록 승격 실패");
    } finally {
      setBusy(false);
    }
  }

  async function exclude() {
    if (!oppId || busy || !excludeReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/exclude`, { reason: excludeReason.trim() });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "제외 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  // 후보 정보 수정/삭제(사용자 요청, 2026-09-15) — 등록 후에도 회사명·DART
  // 고유번호·목표 시장 근거를 고칠 수 있어야 하고, 잘못 등록한 후보는 완전
  // 삭제할 수 있어야 한다(제외는 사유를 남기는 별도 상태 — 삭제는 레코드 자체 제거).
  async function saveEdit() {
    if (busy || !editDraft.company_name.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/brownfield/targets/${encodeURIComponent(targetId)}`, {
        company_name: editDraft.company_name.trim(),
        dart_corp_code: editDraft.dart_corp_code.trim() || null,
        universe_note: editDraft.universe_note.trim() || null,
      });
      setEditing(false);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보 정보 수정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTarget() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.delete(`/api/brownfield/targets/${encodeURIComponent(targetId)}`);
      window.location.href = `/brownfield?opportunity=${encodeURIComponent(oppId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보 삭제 실패");
      setBusy(false);
    }
  }
  return { shortlist, exclude, deleteTarget, saveEdit, generateEvalDraft, saveDraftVerdicts, setEvalWeight, setEvalVerdict, removeEvalCriterion, saveRubric, addEvalCriterion };
}

export type TargetDetailViewState = ReturnType<typeof useTargetDetail> & ReturnType<typeof useTargetActions>;
