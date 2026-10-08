"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState } from "react";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { api } from "../../../lib/api.ts";
import { regionTotal, type SizingMatrix } from "../../../lib/market-sizing.ts";
import type { IndustryDetail, ChainProposal } from "./types.ts";

export function useSizingReport({ detail, matrix, stepSummaries, analysisId, onAddLinked }: {
  detail: IndustryDetail;
  matrix: SizingMatrix;
  stepSummaries: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }> | null;
  analysisId: string | null;
  onAddLinked?: () => void;
}) {

  const [tab, setTab] = useState<"overview" | "structure" | "competitive" | "size" | "allocation" | "growth" | "pipeline" | "qualitative" | "regulation" | "risk" | "validate">("overview");
  const [rerunStarted, setRerunStarted] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  // ADR-0126 — 가치사슬 연계 제안 승인 (analyst+). 승인 시 structural hop으로
  // 등록되고 산업 상세를 다시 불러와 링크 테이블·제안 목록을 갱신한다. 부모가
  // detail을 소유하므로 갱신 결과는 로컬 뷰(localDetail)로 겹쳐 쓴다.
  const { me } = useAuth();
  const canCurate = canWriteBusiness(me?.role);
  const [localDetail, setLocalDetail] = useState<IndustryDetail | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [chainLinkError, setChainLinkError] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState({ industry_id: "", relation: "전방", evidence_ref: "" });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkSaved, setLinkSaved] = useState(false);
  const [retiringLinkId, setRetiringLinkId] = useState<string | null>(null);
  const [legacyRelation, setLegacyRelation] = useState<Record<string, string>>({});
  const [legacyAssigning, setLegacyAssigning] = useState<string | null>(null);
  const view = localDetail ?? detail;

  async function reload() {
    const r = await api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}`);
    setLocalDetail(r.data);
  }

  async function approveProposal(p: ChainProposal) {
    if (approving || !detail) return;
    setApproving(p.industry_id);
    setChainLinkError(null);
    try {
      await api.post(`/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/chain-links`, {
        relation: p.relation,
        industry_id: p.industry_id,
        evidence_ref: `S1 시장 구조 정의 제안 승인 — ${p.relation} ${p.name_ko}${p.note ? ` (${p.note})` : ""}`,
        approved_proposal: true,
      });
      await reload();
    } catch (e) {
      setChainLinkError(e instanceof Error ? e.message : "링크 등록 실패");
    } finally {
      setApproving(null);
    }
  }

  async function submitManualLink() {
    if (!detail || linkSaving || !manualLink.industry_id || !manualLink.evidence_ref.trim()) return;
    setLinkSaving(true);
    setChainLinkError(null);
    setLinkSaved(false);
    try {
      await api.post(`/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/chain-links`, {
        relation: manualLink.relation,
        industry_id: manualLink.industry_id,
        evidence_ref: manualLink.evidence_ref.trim(),
      });
      setManualLink({ industry_id: "", relation: manualLink.relation, evidence_ref: "" });
      setLinkSaved(true);
      await reload();
    } catch (e) {
      setChainLinkError(e instanceof Error ? e.message : "링크 등록에 실패했습니다.");
    } finally {
      setLinkSaving(false);
    }
  }

  async function retireLink(linkId: string) {
    if (!detail) return;
    const rationale = window.prompt("회수 근거(rationale)를 입력하세요:");
    if (!rationale?.trim()) return;
    setRetiringLinkId(linkId);
    setChainLinkError(null);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/chain-links/${encodeURIComponent(linkId)}`, {
        status: "retired",
        rationale: rationale.trim(),
      });
      await reload();
    } catch (e) {
      setChainLinkError(e instanceof Error ? e.message : "회수에 실패했습니다.");
    } finally {
      setRetiringLinkId(null);
    }
  }

  async function assignLegacyRelation(linkId: string) {
    if (!detail) return;
    const relation = legacyRelation[linkId] ?? "전방";
    setLegacyAssigning(linkId);
    setChainLinkError(null);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/chain-links/${encodeURIComponent(linkId)}`, {
        relation,
      });
      await reload();
    } catch (e) {
      setChainLinkError(e instanceof Error ? e.message : "relation 지정에 실패했습니다.");
    } finally {
      setLegacyAssigning(null);
    }
  }
  const proj2030Total = matrix.regions.reduce((sum, r) => sum + regionTotal(matrix, r.code, 4), 0);
  const TABS = [
    ["overview", "개요"],
    ["structure", "시장 구조"],
    ["competitive", "경쟁 구조"],
    ["size", "시장 규모"],
    ["allocation", "권역·세그먼트"],
    ["growth", "성장성"],
    ["pipeline", "수요 파이프라인"],
    ["qualitative", "정성 분석"],
    ["regulation", "규제 환경"],
    ["risk", "신뢰도·리스크"],
    ["validate", "검증·한계"],
  ] as const;
  return { TABS, tab, setTab, matrix, proj2030Total, canCurate, onAddLinked, view, retiringLinkId, retireLink, approving, approveProposal, chainLinkError, manualLink, setManualLink, linkSaving, submitManualLink, linkSaved, legacyRelation, setLegacyRelation, legacyAssigning, assignLegacyRelation, detail, rerunStarted, analysisId, setRerunError, setRerunStarted, rerunError, stepSummaries };
}

export type SizingReportState = ReturnType<typeof useSizingReport>;
