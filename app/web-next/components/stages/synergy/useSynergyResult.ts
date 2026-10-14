"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useCallback, useEffect } from "react";
import { api } from "../../../lib/api.ts";
import { type CapabilityGapRow } from "../../../lib/capability-gap.ts";
import type { GapGetResponse, SynergyAnalysis } from "./types.ts";
import type { TabKey } from "./synergyFormat.ts";

export function useSynergyResult({ analysis, tab, onTab, onBack, onRerun, onRefresh }: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
  onRefresh: () => void;
}) {

  const latest = analysis.versions?.[0] ?? null;
  const p = latest?.payload ?? null;
  const inProgress = analysis.status === "in_progress";
  const ct = useChartTheme(); // 리포트 차트 테마 — 훅은 컴포넌트 최상위에서 1회
  const analysisDate = latest?.created_at?.slice(0, 10) ?? analysis.created_at.slice(0, 10);
  const router = useRouter();
  const { me } = useAuth();
  const canCurate = canWriteBusiness(me?.role);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // ADR-0125 — 연계 시너지 사람 추가 폼.
  const [showLinkageForm, setShowLinkageForm] = useState(false);
  const [linkageForm, setLinkageForm] = useState({ area: "", synergyType: "", rationale: "", opportunity: "", risk: "" });
  const [linkageSaving, setLinkageSaving] = useState(false);
  const [linkageError, setLinkageError] = useState<string | null>(null);

  async function addLinkageItem() {
    if (linkageSaving || !linkageForm.area.trim() || !linkageForm.synergyType.trim() || !linkageForm.rationale.trim()) return;
    setLinkageSaving(true); setLinkageError(null);
    try {
      await api.post(`/api/synergy/analyses/${encodeURIComponent(analysis.id)}/linkage-items`, {
        area: linkageForm.area.trim(), synergyType: linkageForm.synergyType.trim(), rationale: linkageForm.rationale.trim(),
        opportunity: linkageForm.opportunity.trim() || undefined, risk: linkageForm.risk.trim() || undefined,
      });
      setLinkageForm({ area: "", synergyType: "", rationale: "", opportunity: "", risk: "" });
      setShowLinkageForm(false);
      onRefresh();
    } catch (err) {
      setLinkageError(err instanceof Error ? err.message : "영역 추가 실패");
    } finally {
      setLinkageSaving(false);
    }
  }

  // ADR-0125 — 우선 시너지 영역 판정/사유 사람 편집 + 새 영역 추가.
  const [editingArea, setEditingArea] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ verdict: "Short List", reason: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showShortlistForm, setShowShortlistForm] = useState(false);
  const [shortlistForm, setShortlistForm] = useState({ area: "", verdict: "Short List", reason: "" });

  async function saveShortlistItem(area: string, verdict: string, reason: string) {
    if (editSaving || !reason.trim()) return;
    setEditSaving(true); setEditError(null);
    try {
      await api.put(`/api/synergy/analyses/${encodeURIComponent(analysis.id)}/shortlist-items`, { area, verdict, reason: reason.trim() });
      setEditingArea(null);
      setShowShortlistForm(false);
      setShortlistForm({ area: "", verdict: "Short List", reason: "" });
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "판정 저장 실패");
    } finally {
      setEditSaving(false);
    }
  }

  // S3 우선 시너지 영역 -> S4 route-decision handoff: mark the linked opportunity
  // "selected" and hand the synergy rationale to /route-decision as a
  // pre-fill starting point (editable, not locked).
  const opportunityId = p?.opportunity?.id ?? analysis.opportunity_id ?? null;

  // 시너지 점수 사람 확정 (경계 #2) — 파이프라인 권고를 사람이 직접 수정·확정/
  // 철회한다. 편집기는 접혀 있지 않고 항상 보인다 — 확정이 안 보이면 하지 않은
  // 것과 같다(2026-09-14 사용자 리포트). 확정 전 권고는 S4 트랙 어드바이저에서
  // 투표에 쓰이지 않는다(중립 정보).
  const [synState, setSynState] = useState<{ synergyScore: number | null; synergyRationale: string | null; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null } | null>(null);
  const [confirmForm, setConfirmForm] = useState({ score: "", rationale: "" });
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const refreshSynState = useCallback(async () => {
    if (!opportunityId) return;
    try {
      const r = await api.get<{ synergyScore: number | null; synergyRationale: string | null; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/synergy-confirm`);
      setSynState(r.data);
    } catch { /* 기회 조회 실패 — 권고 표시로 폴백 */ }
  }, [opportunityId]);

  useEffect(() => { void refreshSynState(); setConfirmError(null); }, [refreshSynState]);
  const [gap, setGap] = useState<GapGetResponse | null>(null);
  const [gapRows, setGapRows] = useState<CapabilityGapRow[]>([]);
  const [gapBusy, setGapBusy] = useState(false);
  const [gapNote, setGapNote] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [newGapCap, setNewGapCap] = useState("");

  const loadGap = useCallback(() => {
    if (!opportunityId) return;
    api.get<GapGetResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/capability-gap`)
      .then((r) => { setGap(r.data); setGapRows(r.data.rows); })
      .catch(() => setGap(null));
  }, [opportunityId]);
  useEffect(() => { loadGap(); setGapError(null); setGapNote(null); }, [loadGap]);

  function updateGapRow(idx: number, patch: Partial<CapabilityGapRow>) {
    setGapRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function updateGapHeld(idx: number, patch: Partial<CapabilityGapRow["held"]>) {
    setGapRows((prev) => prev.map((r, i) => (i === idx ? { ...r, held: { ...r.held, ...patch } } : r)));
  }
  async function persistGap(): Promise<boolean> {
    if (!opportunityId || gapRows.length === 0) return false;
    try {
      const res = await api.put<GapGetResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/capability-gap`, { rows: gapRows });
      setGap((prev) => ({
        opportunity: prev?.opportunity ?? { id: opportunityId, name: p?.opportunity?.name ?? "" },
        rows: res.data.rows,
        stored: true,
        sketchCapabilities: prev?.sketchCapabilities ?? [],
        internalAssessmentPending: true,
        internalAssessmentNote: res.data.internalAssessmentNote,
      }));
      setGapRows(res.data.rows);
      return true;
    } catch (err) {
      setGapError(err instanceof Error ? err.message : "필요 역량 수준 저장 실패");
      return false;
    }
  }
  async function saveGap() {
    if (!opportunityId || gapBusy || gapRows.length === 0) return;
    setGapBusy(true); setGapError(null);
    const okSaved = await persistGap();
    if (okSaved) setGapNote("필요 역량 수준 레지스터를 저장했습니다 — S4 화면·게이트 브리프에 반영됩니다.");
    setGapBusy(false);
  }
  async function draftGap() {
    if (!opportunityId || gapBusy) return;
    if (gapRows.length === 0) { setGapError("먼저 필요 역량 행을 추가하세요."); return; }
    setGapBusy(true); setGapError(null);
    try {
      // 초안 엔드포인트는 저장된 레지스터를 읽는다 — 화면에만 있는 행(미저장
      // 시드·수동 추가)으로 누르면 "행이 없다"는 400이 나므로, 미저장 상태면
      // 먼저 현재 행을 저장한 뒤 초안을 요청한다(행 추가 자체는 사람의 입력이며
      // 보유 판정 기록과는 무게가 다르다).
      if (!gap?.stored) await persistGap();
      const res = await api.post<{ rows: CapabilityGapRow[]; source: string; note: string }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/capability-gap/llm-draft`, {});
      setGapRows(res.data.rows);
      setGapNote(res.data.note);
    } catch (err) { setGapError(err instanceof Error ? err.message : "LLM 초안 생성 실패"); }
    finally { setGapBusy(false); }
  }
  function addGapRow() {
    const capability = newGapCap.trim();
    if (!capability) return;
    setGapRows((prev) => [
      ...prev,
      { id: `gap-manual-${Date.now().toString(36)}`, capability, source: "manual", requiredNote: "",
        necessity: "", necessityScopeNote: "",
        held: { status: "unevaluated", holders: [], evidence: "" }, resolution: null, note: "",
        requiredLevel: "", currentLevel: "" },
    ]);
    setNewGapCap("");
  }

  // 편집기 프리필 — 점수는 항상 기록값을 따라간다. 근거는 다르다: 미확정
  // 상태의 currentRationale은 파이프라인이 계산 과정을 그대로 서술한 AI
  // 초안("규칙 기반 산출(...) LLM 보정 +3p: ...")이다 — 이걸 입력란에 자동으로
  // 채워두면 사람이 아무것도 고치지 않고 "확정 저장"만 눌러도 그 계산 로그가
  // "사람이 확정한 근거"로 그대로 기록돼버린다(경계 #2 위반처럼 보임, 2026-09-15
  // 사용자 리포트). 이미 사람이 확정해 기록된 근거(synState.confirmed)만
  // 프리필하고, 미확정 권고는 입력란을 비워 사람이 직접 쓰게 한다 — AI 초안은
  // 아래 "AI 초안 근거" 버튼으로 필요할 때만 불러온다.
  const currentScore = synState ? synState.synergyScore : (typeof p?.synergyScore === "number" ? p.synergyScore : null);
  const currentRationale = synState ? synState.synergyRationale : (p?.synergyRationale ?? null);
  useEffect(() => {
    setConfirmForm({
      score: currentScore != null ? String(currentScore) : "",
      rationale: synState?.confirmed ? (currentRationale ?? "") : "",
    });
  }, [currentScore, currentRationale, synState?.confirmed]);

  async function confirmSynergyScore() {
    if (!opportunityId || confirmSaving || confirmForm.score === "") return;
    setConfirmSaving(true); setConfirmError(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/synergy-confirm`, {
        score: Number(confirmForm.score),
        rationale: confirmForm.rationale.trim() || undefined,
      });
      await refreshSynState();
      onRefresh();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "점수 확정 실패");
    } finally {
      setConfirmSaving(false);
    }
  }

  async function retractSynergyScore() {
    if (!opportunityId || confirmSaving) return;
    setConfirmSaving(true); setConfirmError(null);
    try {
      await api.delete(`/api/opportunities/${encodeURIComponent(opportunityId)}/synergy-confirm`);
      await refreshSynState();
      onRefresh();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "확정 철회 실패");
    } finally {
      setConfirmSaving(false);
    }
  }

  const advanceToRouteDecision = useCallback(async () => {
    if (!opportunityId || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}`, { status: "selected" });
      const rationale = p?.synergyRationale ?? "";
      router.push(`/route-decision?opportunity=${encodeURIComponent(opportunityId)}&rationale=${encodeURIComponent(rationale)}`);
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "S4 진행 실패");
    } finally {
      setAdvancing(false);
    }
  }, [opportunityId, advancing, p?.synergyRationale, router]);
  return { analysis, analysisDate, latest, synState, onBack, canCurate, inProgress, onRerun, p, tab, onTab, opportunityId, advanceToRouteDecision, advanceError, confirmError, currentScore, currentRationale, confirmForm, setConfirmForm, confirmSaving, confirmSynergyScore, retractSynergyScore, showLinkageForm, setShowLinkageForm, linkageForm, setLinkageForm, linkageError, setLinkageError, linkageSaving, addLinkageItem, gapRows, gapBusy, draftGap, saveGap, gap, gapNote, gapError, updateGapHeld, updateGapRow, setGapRows, newGapCap, setNewGapCap, addGapRow, editingArea, editForm, setEditForm, editSaving, setEditingArea, saveShortlistItem, editError, showShortlistForm, setShowShortlistForm, shortlistForm, setShortlistForm };
}

export type SynergyResultState = ReturnType<typeof useSynergyResult>;
