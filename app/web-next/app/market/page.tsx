"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { EChart } from "../../components/EChart.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import {
  AXES, REGISTRY, SEGMENTS, segmentsOf, STEPS,
  VALIDATION_STATUS_META, bandFor, global2026, projection2030, regionTotal,
  type SizingMatrix, type SegmentCode,
} from "../../lib/market-sizing.ts";

// S1 시장분석 (/market) — systematic-market-sizing 스킬의 8단계 절차 리포트.
// 랜딩 = 산업 테이블(신규 분석 생성 포함) → 선택 시 8단계 리치 리포트.
// 파이프라인 산출과 수동 연구 시드 모두 버전 페이로드의 매트릭스로 동일하게
// 렌더링된다 — 산업별 특수 케이스는 없다 (ADR-0112).

interface AnalysisInfo {
  id: string; status: "in_progress" | "completed" | "failed" | "pending"; current_step: number; latest_version: number | null;
  created_at: string; completed_at: string | null; error_message?: string | null;
  after_analysis_id?: string | null; linked_relation?: string | null;
  // ADR-0131 — 완료된 분석의 재분석이 진행 중이면 status는 여전히 'completed'로
  // 이전 버전을 가리킨 채 이 플래그만 1이 된다(재분석 성공 시에만 status/
  // completed_at이 새 버전으로 "교체"된다 — 조용한 데이터 훼손 방지).
  rerun_in_progress?: number;
  // ADR-0131 후속 — 최신 완료 버전의 stepSummaries 소스를 서버가 미리 집계한
  // 값. all_synthesis: 전 단계 결정론 합성(수치 신뢰 불가) — partial_synthesis:
  // 일부 단계만 합성(대개 정성/규제 등 텍스트 섹션, 수치는 대부분 정상일 수
  // 있으나 확인 필요) — null: 완전히 LLM 산출이거나 완료 버전 없음.
  data_quality?: "all_synthesis" | "partial_synthesis" | null;
}
interface IndustryRow {
  id: string; name_ko: string; name_en: string | null;
  ksic_code: string | null; driver_count: number; analysis: AnalysisInfo | null;
}
interface DriverRow { id: string; code: string; label_ko: string; description: string; }
interface MarketOverview {
  industries: IndustryRow[]; drivers: DriverRow[];
  stats: { value_chain_links: number; proxy_links: number; series_count: number; observation_count: number };
}
interface DriverSensitivity { driver_label: string; sensitivity: number; lag_months: number | null; region_code: string | null; segment_code: string | null }
interface AssumptionRow {
  assumption_key: string; kind: string; value: number; rationale: string | null;
  anchor_ref: string | null; as_of: string; ttl_days: number | null;
}
interface VersionInfo { version_no: number; changelog: string | null; created_by: string; created_at: string }
interface ChainLink {
  id: string;
  hop_type: "engineering" | "statistical" | "structural";
  coefficient: number | null;
  beta: number | null;
  r2: number | null;
  lag_months: number | null;
  evidence_ref: string;
  industry_id: string;
  name_ko: string;
  direction: "upstream" | "downstream";
  relation: string | null;
  hop_distance: number | null;
  source: string;
  status: string;
}
interface ChainProposal { industry_id: string; name_ko: string; relation: string; note: string | null }
interface LinkableIndustry { id: string; name_ko: string }
interface IndustryDetail {
  industry: { id: string; name_ko: string; name_en: string | null; ksic_code: string | null };
  chain: { links: ChainLink[]; legacyUntagged: ChainLink[]; grade: { reliability_grade: string; grade_rationale: string } | null };
  proposals?: ChainProposal[];
  unmatchedProposals?: Array<{ name: string; relation: string; note: string | null }>;
  linkableIndustries?: LinkableIndustry[];
  driver_sensitivities: DriverSensitivity[];
  sizing: { run_id: string; run_label: string; assumptions: AssumptionRow[] } | null;
  versions: VersionInfo[];
}
interface AnalysisDetail {
  id: string; status: "in_progress" | "completed"; current_step: number; name_ko: string;
  versions: Array<{ version_no: number; payload: { matrix?: SizingMatrix; stepSummaries?: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }> } | null; changelog: string | null; created_by: string; created_at: string }>;
}
interface LlmStatus { configured: boolean; provider: string | null; model: string | null }
interface KsicEntryView { code: string; name_ko: string; detail: string | null; profile: boolean }

const SEGMENT_COLORS = [0, 1, 2, 3, 4];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const POSITION_LABELS: Record<string, string> = {
  upstream: "상류(원자재·부품)",
  midstream: "중류(조립·가공)",
  downstream: "하류(완제품·수요처)",
};

// 산업 간 가치사슬 관계도 — 큐레이션된 수요 산업 연계(전방/전전방/후방/후후방,
// ADR-0129)를 SVG로 시각화한다. 레이어(서버가 Kahn 레이어링으로 계산)를
// 가로축, 같은 레이어 안에서는 세로로 노드를 배치하고 화살표로 방향을 그린다.
interface ChainGraphNode { id: string; name_ko: string; analyzed: boolean; layer: number }
interface ChainGraphEdge { from: string; to: string; relation: string; hopDistance: number | null }

function IndustryChainGraph({ nodes, edges }: { nodes: ChainGraphNode[]; edges: ChainGraphEdge[] }) {
  const ct = useChartTheme();
  if (nodes.length === 0) return null;

  const COL_W = 200;
  const ROW_H = 56;
  const NODE_W = 168;
  const NODE_H = 36;
  const PAD = 20;

  const byLayer = new Map<number, ChainGraphNode[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  for (const list of byLayer.values()) list.sort((a, b) => a.name_ko.localeCompare(b.name_ko));

  const pos = new Map<string, { x: number; y: number }>();
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);
  let maxRows = 1;
  for (const layer of layerKeys) {
    const list = byLayer.get(layer)!;
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, i) => {
      pos.set(n.id, { x: PAD + layer * COL_W, y: PAD + i * ROW_H });
    });
  }
  const width = PAD * 2 + (layerKeys.length - 1) * COL_W + NODE_W;
  const height = PAD * 2 + maxRows * ROW_H;

  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="산업 간 가치사슬 관계도" style={{ minWidth: "100%" }}>
        <defs>
          <marker id="chain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={ct.muted} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={ct.muted}
              strokeWidth={1.2}
              markerEnd="url(#chain-arrow)"
              opacity={0.6}
            >
              <title>{`${e.relation}${e.hopDistance ? ` (hop ${e.hopDistance})` : ""}`}</title>
            </path>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={n.analyzed ? ct.color[0] : ct.split}
                fillOpacity={n.analyzed ? 0.16 : 1}
                stroke={n.analyzed ? ct.color[0] : ct.muted}
                strokeWidth={1}
              >
                <title>{n.name_ko}{n.analyzed ? " — 분석 완료" : " — 미분석"}</title>
              </rect>
              <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={11} fill={ct.text ?? ct.muted}>
                {n.name_ko.length > 14 ? `${n.name_ko.slice(0, 13)}…` : n.name_ko}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MarketView() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [detail, setDetail] = useState<IndustryDetail | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIndustry = searchParams.get("industry");
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [ksicResults, setKsicResults] = useState<KsicEntryView[] | null>(null);
  const [ksicSearching, setKsicSearching] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed" | "stale" | "pending" | "failed">("all");
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [savingEdit, setSavingEdit] = useState(false);
  const [chainGraph, setChainGraph] = useState<{ nodes: ChainGraphNode[]; edges: ChainGraphEdge[] } | null>(null);
  const [chainGraphOpen, setChainGraphOpen] = useState(false);

  useEffect(() => {
    api.get<{ nodes: ChainGraphNode[]; edges: ChainGraphEdge[] }>("/api/market-overview/value-chain-graph")
      .then((r) => setChainGraph(r.data))
      .catch(() => setChainGraph({ nodes: [], edges: [] }));
  }, []);

  const refreshOverview = useCallback(() => {
    return api.get<MarketOverview>("/api/market-overview")
      .then((r) => { setOverview(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    void refreshOverview();
    api.get<LlmStatus>("/api/llm-status").then((r) => setLlmStatus(r.data)).catch(() => setLlmStatus({ configured: false, provider: null, model: null }));
  }, [refreshOverview]);

  // 분석 중인 산업이 있으면 3초 간격으로 상태 폴링 → 완료 시 목록이 자동 갱신
  const hasInProgress = overview?.industries.some((i) => i.analysis?.status === "in_progress" || i.analysis?.status === "pending" || !!i.analysis?.rerun_in_progress) ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refreshOverview(); }, 3000);
    return () => clearInterval(t);
  }, [hasInProgress, refreshOverview]);

  // 상세 진입은 URL(?industry=)기반 — 상단 바의 뒤로 가기가 동작하도록 한다.
  const loadDetail = useCallback((industryId: string) => {
    router.replace(`/market?industry=${encodeURIComponent(industryId)}`);
  }, [router]);

  useEffect(() => {
    if (!selectedIndustry) { setDetail(null); return; }
    if (detail?.industry.id === selectedIndustry) return;
    setDetail(null);
    api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(selectedIndustry)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "상세 불러오기 실패"));
  }, [selectedIndustry]);  // eslint-disable-line react-hooks/exhaustive-deps

  // KSIC 코드 검색 — DART 검색과 동일한 표준 패턴(이름으로 검색 → 결과 선택 시 코드 채움):
  // 명시적 검색 버튼(lucide Search 아이콘 — 아이콘 어휘표 검색/조회), 검색어는 KSIC
  // 입력값을 우선하고 비어 있으면 산업명으로 조회.
  // 결과는 sizing-note-list 목록으로 제시하고 선택은 클릭(aria-pressed + ✔ 표시).
  async function searchKsicCodes() {
    const q = newCode.trim() || newName.trim();
    if (!q || ksicSearching) return;
    setKsicSearching(true);
    setError(null);
    try {
      const res = await api.get<{ entries: KsicEntryView[] }>(`/api/market-overview/ksic?q=${encodeURIComponent(q)}`);
      setKsicResults(res.data.entries);
      if (res.data.entries.length === 0) setError("KSIC 검색 결과가 없습니다 — 코드를 직접 입력하세요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "KSIC 검색 실패");
    } finally {
      setKsicSearching(false);
    }
  }

  // ── 가치사슬 연계 후보 모달 (S1 분석·재분석 범위 선택) ──
  // 분석(또는 재분석) 대상 산업과 연관된 산업 후보를 보여주고, 사용자가
  // 선택한 산업을 함께 분석한다. 마스터에 없는 산업은 분석 생성 시
  // 자동 등록된다(서버 name 기반 dedup) — 선택 자체가 승인 행위다(경계 #2).
  interface RelatedCandidate {
    name_ko: string; industry_id: string | null; relation: string; note: string | null; source: "link" | "analysis" | "proxy";
    linkSource?: string;
    linkStatus?: string;
    // ADR-0129 — 이미 등록된 활성 proxy_link 행에서 온 후보인지. locked 후보는
    // 재분석 시 자동 반영되므로 해제할 수 없고(선택 해제 불가), 기본 선택됨.
    locked: boolean;
  }
  const [linkModal, setLinkModal] = useState<{
    open: boolean;
    primaryName: string;          // 이번에 분석(또는 재분석)할 대상
    rerunAnalysisId: string | null; // 재분석 모드일 때 대상 분석 id
    candidates: RelatedCandidate[];
    industryKnown: boolean;       // 대상이 산업 마스터에 등록되어 있는지
    selected: Set<string>;
    loading: boolean;
    running: boolean;
    // 방법론 패널 P0 — 대체/보완 관계는 사슬 후보에서 분리해 "대체 위협"으로 표출한다.
    substitutes: Array<{ name_ko: string; relation: string; note: string | null }>;
  }>({ open: false, primaryName: "", rerunAnalysisId: null, candidates: [], industryKnown: false, selected: new Set(), loading: false, running: false, substitutes: [] });

  // ADR-0129 — 서버가 붙여준 linkSource/linkStatus로 "이미 등록된 활성 연계"
  // 여부를 판정하고, locked 후보는 기본 선택 상태로 미리 채운다.
  function markLocked(candidates: RelatedCandidate[]): RelatedCandidate[] {
    return candidates.map((c) => ({ ...c, locked: c.linkSource !== undefined && c.linkStatus === "active" }));
  }
  function preselectLocked(candidates: RelatedCandidate[]): Set<string> {
    return new Set(candidates.filter((c) => c.locked).map((c) => c.name_ko));
  }

  async function openLinkModal(primaryName: string, rerunAnalysisId: string | null = null) {
    setLinkModal({ open: true, primaryName, rerunAnalysisId, candidates: [], industryKnown: false, selected: new Set(), loading: true, running: false, substitutes: [] });
    try {
      const r = await api.get<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        `/api/market-overview/related-candidates?name=${encodeURIComponent(primaryName)}`,
      );
      if (r.data.candidates.length > 0 || (r.data.substitutes?.length ?? 0) > 0) {
        const candidates = markLocked(r.data.candidates);
        setLinkModal((prev) => ({ ...prev, loading: false, industryKnown: r.data.industry !== null, candidates, selected: preselectLocked(candidates), substitutes: r.data.substitutes ?? [] }));
        return;
      }
      // 저장된 후보(연계 링크·과거 분석)가 없으면 1차 가치사슬 연계 산업 분석을
      // 자동 실행해 관련 산업과 연관성을 먼저 보여준다 (사용자 결정 사항).
      setLinkModal((prev) => ({ ...prev, loading: true, industryKnown: r.data.industry !== null }));
      const p = await api.post<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        "/api/market-overview/related-candidates",
        { name: primaryName },
      );
      const candidates = markLocked(p.data.candidates);
      setLinkModal((prev) => ({ ...prev, loading: false, industryKnown: p.data.industry !== null, candidates, selected: preselectLocked(candidates), substitutes: p.data.substitutes ?? [] }));
    } catch {
      setLinkModal((prev) => ({ ...prev, loading: false }));
    }
  }

  // 1차 가치사슬 연계 산업 분석 재실행 — 모달 안에서 수동으로 다시 돌릴 수 있다.
  async function rerunProxyAnalysis() {
    if (linkModal.loading || linkModal.running) return;
    setLinkModal((prev) => ({ ...prev, loading: true }));
    try {
      const p = await api.post<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        "/api/market-overview/related-candidates",
        { name: linkModal.primaryName },
      );
      const candidates = markLocked(p.data.candidates);
      setLinkModal((prev) => ({
        ...prev,
        loading: false,
        industryKnown: p.data.industry !== null,
        candidates,
        substitutes: p.data.substitutes ?? [],
        // 재실행으로 새로 온 locked 후보도 선택 목록에 포함시키되, 사용자가
        // 이미 직접 고른(비-locked) 선택은 유지한다.
        selected: new Set([...prev.selected, ...preselectLocked(candidates)]),
      }));
    } catch {
      setLinkModal((prev) => ({ ...prev, loading: false }));
    }
  }

  // 레드팀 가드레일 — 대기 큐 상한: 무제한 큐는 비용·시간 폭탄이 된다.
  const MAX_QUEUE_SELECTIONS = 5;
  function toggleCandidate(name: string, locked: boolean) {
    if (locked) return; // 등록된 연계 후보는 재분석에 자동 반영되어 해제할 수 없다.
    setLinkModal((prev) => {
      const selected = new Set(prev.selected);
      if (selected.has(name)) selected.delete(name);
      else {
        if (selected.size >= MAX_QUEUE_SELECTIONS) return prev;
        selected.add(name);
      }
      return { ...prev, selected };
    });
  }

  async function runWithSelections() {
    if (linkModal.running) return;
    setLinkModal((prev) => ({ ...prev, running: true }));
    setError(null);
    try {
      // 대상 분석: 재분석 모드면 rerun, 신규 모드면 생성(마스터 자동 등록 포함)
      if (linkModal.rerunAnalysisId) {
        await api.post(`/api/market-overview/analyses/${encodeURIComponent(linkModal.rerunAnalysisId)}/rerun`);
      } else {
        await api.post("/api/market-overview/analyses", { name_ko: linkModal.primaryName, ksic_code: newCode.trim() || undefined });
        setNewName(""); setNewCode(""); setKsicResults(null); setShowNewForm(false);
      }
      // 연계 산업(재분석 모드만) — after_analysis_id 앵커로 '연계 대기' 등록.
      // 서버가 대상 분석 완료 후 한 건씩 자동 시작한다(직렬 큐 — 설계 2026-09-13).
      // 신규 모드는 첫 분석 = 대상 산업만: 모달이 애초에 선택 UI를 노출하지 않는다.
      // locked(이미 등록된 proxy_link) 후보는 대상 파이프라인이 DB에서 직접
      // 재도출하므로 별도 분석을 스폰하지 않는다 — 선택 표시는 정보성일 뿐이다.
      const lockedNames = new Set(linkModal.candidates.filter((c) => c.locked).map((c) => c.name_ko));
      const relationByName = new Map(linkModal.candidates.map((c) => [c.name_ko, c.relation]));
      let extraCount = 0;
      if (linkModal.rerunAnalysisId) {
        for (const name of linkModal.selected) {
          if (name === linkModal.primaryName || lockedNames.has(name)) continue;
          await api.post("/api/market-overview/analyses", { name_ko: name, after_analysis_id: linkModal.rerunAnalysisId, linked_relation: relationByName.get(name) });
          extraCount++;
        }
      }
      await refreshOverview();
      setLinkModal({ open: false, primaryName: "", rerunAnalysisId: null, candidates: [], industryKnown: false, selected: new Set(), loading: false, running: false, substitutes: [] });
      if (extraCount > 0) setLinkNotice(`연계 산업 ${extraCount}건이 대기열에 등록되었습니다 (마스터 미등록 산업은 시작 시 자동 등록). '${linkModal.primaryName}' 분석 완료 후 한 건씩 자동 시작됩니다 — 진행 상황은 '대기' 필터에서 확인하세요.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 시작 실패");
      setLinkModal((prev) => ({ ...prev, running: false }));
    }
  }

  const backToList = useCallback(() => {
    router.replace("/market");
    setDetail(null);
  }, [router]);

  // 재분석: 실패 재시작 또는 분석일 경과에 따른 데이터 갱신. 새 버전으로 쌓임.
  const STALE_DAYS = 90;
  const relDate = (d: string | null) => {
    if (!d) return null;
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days <= 0) return "오늘";
    if (days < 30) return `${days}일 전`;
    if (days < 365) return `${Math.floor(days / 30)}개월 전`;
    return `${Math.floor(days / 365)}년 전`;
  };
  async function rerunAnalysis(analysisId: string, industryName: string) {
    // 재분석도 연관 산업 선택 모달을 거친다 — 같은 분석 행을 재실행하며
    // 선택된 연관 산업은 새로(또는 이어서) 분석을 시작한다.
    await openLinkModal(industryName, analysisId);
  }

  // 산업 삭제 — market-sizing 분석(버전 행 포함)과 함께 삭제한다.
  function deleteIndustry(ind: IndustryRow) {
    confirm(
      `산업 "${ind.name_ko}" 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/market-overview/industry/${encodeURIComponent(ind.id)}`);
          if (selectedIndustry === ind.id) backToList();
          await refreshOverview();
        } catch (err) {
          setError(err instanceof Error ? err.message : "산업 삭제 실패");
        }
      },
      { body: "이 산업의 시장분석 기록(버전 전체)도 함께 삭제되며 되돌릴 수 없습니다." },
    );
  }

  // 산업 정보 수정(이름·KSIC 코드) — 목록에서 인라인으로 편집한다.
  async function saveEdit() {
    if (!editing || savingEdit) return;
    if (!editing.name.trim()) { setError("산업명은 필수입니다."); return; }
    setSavingEdit(true);
    setError(null);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(editing.id)}`, {
        name_ko: editing.name.trim(),
        ksic_code: editing.code.trim() || null,
      });
      setEditing(null);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "산업 정보 수정 실패");
    } finally {
      setSavingEdit(false);
    }
  }

  // 목록 파생: 검색 + 상태 필터 + 우선순위 정렬(분석 중 → 업데이트 권장 → 최근 분석 → 대기)
  const buckets = useMemo(() => {
    const of = (ind: IndustryRow): IndustryRow["analysis"] & { bucket: "in_progress" | "stale" | "completed" | "pending" | "failed" } | null => {
      const a = ind.analysis;
      if (!a) return null;
      const d = (a.completed_at ?? a.created_at).slice(0, 10);
      const stale = a.status === "completed" && d && (Date.now() - new Date(d).getTime()) / 86400000 > STALE_DAYS;
      return { ...a, bucket: a.status === "in_progress" ? "in_progress" : a.status === "pending" ? "pending" : a.status === "failed" ? "failed" : stale ? "stale" : "completed" };
    };
    return { of };
  }, []);
  const visibleIndustries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (overview?.industries ?? [])
      .filter((ind) => {
        if (q && !(ind.name_ko.toLowerCase().includes(q) || (ind.name_en ?? "").toLowerCase().includes(q) || (ind.ksic_code ?? "").toLowerCase().includes(q))) return false;
        if (statusFilter === "all") return true;
        const b = buckets.of(ind)?.bucket ?? "pending";
        return b === statusFilter;
      });
    const rank = { failed: 0, in_progress: 1, stale: 2, completed: 3, pending: 4 } as const;
    return [...rows].sort((x, y) => {
      const bx = buckets.of(x)?.bucket ?? "pending";
      const by = buckets.of(y)?.bucket ?? "pending";
      if (rank[bx] !== rank[by]) return rank[bx] - rank[by];
      const dx = x.analysis ? (x.analysis.completed_at ?? x.analysis.created_at) : "";
      const dy = y.analysis ? (y.analysis.completed_at ?? y.analysis.created_at) : "";
      return dy.localeCompare(dx);
    });
  }, [overview, query, statusFilter, buckets]);

  // 관계별 그룹핑 — 본 산업(anchor) 아래에 전전방/전방/후방/후후방으로 딸린
  // 산업을 들여쓰기해 묶어 보여준다. 데이터는 이미 있던 것(연계 큐 등록 시
  // 기록되는 analysis.after_analysis_id/linked_relation, ADR-0130)을 그대로
  // 쓴다 — 새 스키마 없이 렌더링만 바꾼다. 상태 우선순위 정렬(실패→진행중→
  // 갱신필요→완료→대기)은 "본 산업"(그룹의 대표 행) 기준으로는 그대로 유지되고,
  // 딸린 산업은 자신의 개별 상태와 무관하게 본 산업 바로 아래 묶여서 표시된다.
  const RELATION_ORDER: Record<string, number> = { "전전방": 0, "전방": 1, "후방": 2, "후후방": 3 };
  const flatRows = useMemo(() => {
    const byAnalysisId = new Map<string, IndustryRow>();
    for (const ind of visibleIndustries) if (ind.analysis) byAnalysisId.set(ind.analysis.id, ind);
    const childIds = new Set<string>();
    const childrenByRootId = new Map<string, Array<{ ind: IndustryRow; relation: string }>>();
    for (const ind of visibleIndustries) {
      const rel = ind.analysis?.linked_relation;
      const afterId = ind.analysis?.after_analysis_id;
      if (!rel || !afterId) continue;
      const root = byAnalysisId.get(afterId);
      if (!root || root.id === ind.id) continue;
      childIds.add(ind.id);
      const list = childrenByRootId.get(root.id) ?? [];
      list.push({ ind, relation: rel });
      childrenByRootId.set(root.id, list);
    }
    for (const list of childrenByRootId.values()) {
      list.sort((a, b) => (RELATION_ORDER[a.relation] ?? 9) - (RELATION_ORDER[b.relation] ?? 9));
    }
    const rows: Array<{ ind: IndustryRow; relation: string | null }> = [];
    for (const ind of visibleIndustries) {
      if (childIds.has(ind.id)) continue;
      rows.push({ ind, relation: null });
      for (const child of childrenByRootId.get(ind.id) ?? []) rows.push({ ind: child.ind, relation: child.relation });
    }
    return rows;
  }, [visibleIndustries]);

  const statusCounts = useMemo(() => {
    const counts = { all: 0, in_progress: 0, completed: 0, stale: 0, pending: 0, failed: 0 };
    for (const ind of overview?.industries ?? []) {
      counts.all++;
      counts[buckets.of(ind)?.bucket ?? "pending"]++;
    }
    return counts;
  }, [overview, buckets]);

  if (detail && selectedIndustry) {
    const row = overview?.industries.find((i) => i.id === selectedIndustry);
    const analysisId = row?.analysis?.id ?? null;
    const analysisDate = row?.analysis ? (row.analysis.completed_at ?? row.analysis.created_at).slice(0, 10) : null;
    return (
      <main>
        <MarketReport
          detail={detail}
          analysisId={analysisId}
          analysisDate={analysisDate}
          onAddLinked={analysisId ? () => openLinkModal(detail.industry.name_ko, analysisId) : undefined}
        />
      </main>
    );
  }

  return (
    <main>
      {confirmDialog}
      {linkNotice && <p role="status" className="text-[color:var(--green-fg)] text-[0.85rem] mb-2">{linkNotice}</p>}
      <StageFrame stageId="S1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>산업을 선택하면 체계적 시장 규모 추정 8단계 절차로 분석된 리포트가 차트로 표시됩니다.</span>
          {/* 산업 간 가치사슬 관계도 — 인라인 배치는 목록 화면 공간을 너무 많이
              차지해 버튼 + 모달로 뺐다. 큐레이션된 수요 산업 연계가 하나도
              없으면(신규 워크스페이스) 버튼 자체를 숨긴다. */}
          {chainGraph && chainGraph.nodes.length > 0 && (
            <button type="button" className="btn-ghost btn-sm whitespace-nowrap" onClick={() => setChainGraphOpen(true)}>
              🔗 산업 간 가치사슬 관계도 보기 ({chainGraph.nodes.length}개 산업)
            </button>
          )}
        </span>
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 분석 대상 산업 (테이블) ── */}
      <section aria-label="분석 대상 산업" className="market-section">
        <SectionToolbar
          title="분석 대상 산업"
          icon=""
          count={statusCounts.all}
          filters={
            <input
              type="search"
              aria-label="산업 검색"
              placeholder="산업명·코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: "12rem", minWidth: "8rem" }}
            />
          }
          summary={
            <span role="group" aria-label="상태 필터" className="flex items-center gap-1">
              {([
                ["all", "전체"], ["in_progress", "분석 중"], ["completed", "완료"], ["stale", "업데이트 권장"], ["pending", "대기"], ["failed", "실패"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  className={`control-chip ${statusFilter === key ? "status-green" : "status-not-started"}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label} {statusCounts[key]}
                </button>
              ))}
            </span>
          }
          actions={
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowNewForm((v) => !v)} aria-expanded={showNewForm}>
              ＋ 신규 산업 분석
            </button>
          }
        />

        {showNewForm && (
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void openLinkModal(newName.trim()); }} aria-label="신규 산업 분석 생성" className="sizing-new-form mb-3">
            {/* 제출 시 바로 생성하지 않고 가치사슬 연계 후보 모달로 범위를 확정한다 */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">산업명 *</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 산업용 로봇" required className="sizing-new-input" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">KSIC 코드 (선택)</span>
                <span className="flex items-center gap-1">
                  <input
                    value={newCode}
                    onChange={(e) => { setNewCode(e.target.value); setKsicResults(null); }}
                    placeholder="예: 28121"
                    className="sizing-new-input sizing-new-input-sm"
                  />
                  <button type="button" className="btn-ghost btn-sm flex items-center gap-1" disabled={ksicSearching || (!newCode.trim() && !newName.trim())} onClick={() => void searchKsicCodes()}>
                    <Search size={16} aria-hidden="true" />
                    {ksicSearching ? "검색 중..." : "KSIC 검색"}
                  </button>
                </span>
              </label>
              <button type="submit" className="btn-primary" disabled={!newName.trim()}>
                분석 범위 선택 →
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowNewForm(false); setNewName(""); setNewCode(""); setKsicResults(null); }}
              >
                취소
              </button>
            </div>
            {ksicResults !== null && ksicResults.length > 0 && (
              <ul className="sizing-note-list mt-2" role="listbox" aria-label="KSIC 코드 검색 결과">
                {ksicResults.map((it) => (
                  <li key={it.code}>
                    <button
                      type="button"
                      aria-pressed={newCode === it.code}
                      className={`btn-ghost btn-sm w-full text-left ${newCode === it.code ? "font-semibold" : ""}`}
                      title={it.detail ?? it.name_ko}
                      onClick={() => {
                        setNewCode(it.code);
                        setKsicResults(null); // 선택 후 목록을 닫는다 — 다른 산업 선택 시 다시 검색
                        if (!newName.trim()) setNewName(it.name_ko);
                      }}
                    >
                      {newCode === it.code ? "✔ " : ""}{it.name_ko} <code className="dd-item-id">{it.code}</code>
                      {it.profile && <span className="text-[0.72rem] text-[color:var(--muted-fg)]"> · 업종 프로필</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
              KSIC 코드는 선택 — 산업명 또는 코드로 검색한 뒤 목록에서 선택하거나 직접 입력하세요(미지정 시 "—" 표시). 업종 프로필이 있는 코드는 표기됩니다.
              systematic-market-sizing 8단계 파이프라인이 순서대로 실행되며, 완료 전까지는 목록에 "분석 중"으로 표시됩니다.
              {llmStatus && (llmStatus.configured
                ? <> LLM 요약 사용: <strong>{llmStatus.provider} / {llmStatus.model}</strong></>
                : <> LLM 미구성(CO_NEWBIZ_LLM_* 환경변수) — <strong>결정론 합성</strong>으로 분석됩니다.</>)}
            </p>
          </form>
        )}

        {overview === null ? (
          <p>불러오는 중...</p>
        ) : overview.industries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 산업이 없습니다. "신규 산업 분석"으로 시작하세요.</p>
        ) : visibleIndustries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">검색·필터 조건에 맞는 산업이 없습니다.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 산업 목록">
            <caption className="sr-only">분석 대상 산업 목록</caption>
            <thead>
              <tr>
                <th scope="col">산업명</th>
                <th scope="col">KSIC 코드</th>
                <th scope="col">연결 드라이버</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map(({ ind, relation }) => {
                const a = ind.analysis;
                const inProgress = a?.status === "in_progress";
                // 큐 위치 표기(UX-4) — 같은 앵커의 대기열에서 몇 번째인지 칩 본문에 노출.
                const queueLabel = (() => {
                  if (a?.status !== "pending") return "연계 대기";
                  const sibs = (overview?.industries ?? [])
                    .map((i2) => i2.analysis)
                    .filter((x): x is AnalysisInfo => Boolean(x) && x!.status === "pending" && x!.after_analysis_id === a.after_analysis_id)
                    .sort((x, y) => x.created_at.localeCompare(y.created_at));
                  const idx = sibs.findIndex((x) => x.id === a.id);
                  return idx >= 0 ? `연계 대기 · ${idx + 1}번째` : "연계 대기";
                })();
                const analysisDate = a ? (a.completed_at ?? a.created_at).slice(0, 10) : null;
                const stale = a?.status === "completed" && analysisDate
                  ? (Date.now() - new Date(analysisDate).getTime()) / 86400000 > STALE_DAYS
                  : false;
                const isEditing = editing?.id === ind.id;
                return (
                  <tr key={ind.id} className={selectedIndustry === ind.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      {isEditing ? (
                        <input
                          aria-label="산업명 수정"
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          className="sizing-new-input"
                          autoFocus
                        />
                      ) : (
                        <span className="flex items-center gap-1.5" style={relation ? { paddingLeft: "1rem" } : undefined}>
                          {relation && (
                            <>
                              <span aria-hidden="true" className="text-[color:var(--muted-fg)]">↳</span>
                              <span className={`status-chip ${relation === "전방" || relation === "전전방" ? "status-in-progress" : "status-amber"}`}>{relation}</span>
                            </>
                          )}
                          <button
                            type="button"
                            className={relation ? "text-left underline-offset-2 hover:underline" : "font-semibold text-left underline-offset-2 hover:underline"}
                            title="분석 리포트 열기"
                            onClick={() => loadDetail(ind.id)}
                          >
                            {ind.name_ko}
                          </button>
                        </span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label="KSIC 코드 수정"
                          value={editing.code}
                          onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                          placeholder="예: 28121"
                          className="sizing-new-input sizing-new-input-sm"
                        />
                      ) : (
                        <code className="dd-item-id">{ind.ksic_code ?? "—"}</code>
                      )}
                    </td>
                    <td className="tabular-nums">{ind.driver_count}건</td>
                    <td>
                      {a?.status === "pending" ? (
                        <span className="status-chip status-not-started" title="선행 산업 분석이 완료되면 자동으로 시작됩니다. 시작 전에는 언제든 재분석 모달에서 제외할 수 있습니다.">{queueLabel}</span>
                      ) : inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a?.current_step ?? 0}/8단계)</span>
                      ) : a?.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0131 — 재분석 진행 중에도 status는 여전히 이전(완료) 버전을 가리킨다.
                        // 새 버전은 성공해야만 "교체"되므로, 지금 화면에 보이는 건 이전 버전 그대로다.
                        <span className="status-chip status-amber" title="이전 완료 버전은 그대로 표시되며, 재분석이 성공해야만 새 버전으로 교체됩니다.">재분석 중 (이전 v{a.latest_version ?? 1} 유지)</span>
                      ) : a?.status === "completed" && a.error_message ? (
                        // 보호 모드 재분석이 LLM 장애로 실패한 직후 — status/completed_at은 그대로,
                        // error_message만 이번 시도 실패 사유로 남는다(날짜·버전 변경 없음).
                        <span className="status-chip status-red" title={`${a.error_message} — 표시 중인 버전은 이전 완료 버전입니다.`}>재분석 실패 (v{a.latest_version ?? 1} 유지)</span>
                      ) : stale ? (
                        <span className="status-chip status-amber" title="분석일이 90일을 지났습니다 — 재분석로 최신화하세요.">업데이트 권장 (v{a?.latest_version ?? 1})</span>
                      ) : a?.status === "completed" && a.data_quality === "all_synthesis" ? (
                        // ADR-0131 후속 — 최신 완료 버전의 모든 단계가 LLM 미구성/실패로
                        // 결정론 합성값으로 채워졌다. 수치를 전혀 신뢰할 수 없으므로
                        // "분석 완료"와 시각적으로 구별되는 경고 상태로 표시한다.
                        <span className="status-chip status-red" title="이 버전은 전체 단계가 LLM 미구성/실패로 합성(더미) 값입니다 — 수치를 신뢰하지 말고 재분석하세요.">분석 완료 (v{a.latest_version ?? 1}) — 합성 데이터</span>
                      ) : a?.status === "completed" && a.data_quality === "partial_synthesis" ? (
                        <span className="status-chip status-amber" title="이 버전은 일부 단계가 LLM 미구성/실패로 합성(더미) 값입니다 — 리포트에서 어느 단계인지 확인 후 필요시 재분석하세요.">분석 완료 (v{a.latest_version ?? 1}) — 일부 합성</span>
                      ) : a?.status === "completed" ? (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      ) : a?.status === "failed" && a.error_message && (a.error_message.startsWith("선행 분석 실패") || a.error_message.startsWith("루트 재분석") || a.error_message.startsWith("선행 분석 장기")) ? (
                        <span className="status-chip status-not-started" title={`${a.error_message} — 재분석 완료 후 모달에서 다시 선택하거나, 해당 산업을 직접 분석할 수 있습니다.`}>시작 취소</span>
                      ) : a?.status === "failed" ? (
                        <span className="status-chip status-red" title={a.error_message ?? "파이프라인 실행 중 오류가 발생했습니다."}>분석 실패</span>
                      ) : (
                        <span className="status-chip status-not-started">분석 대기</span>
                      )}
                    </td>
                    <td>
                      {a ? (
                        <span className="tabular-nums" title={analysisDate ?? ""}>{relDate(analysisDate)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-ghost btn-sm" disabled={savingEdit || !editing.name.trim()} onClick={saveEdit}>
                            {savingEdit ? "저장 중..." : "저장"}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={inProgress}
                            onClick={() => loadDetail(ind.id)}
                          >
                            {inProgress ? "분석 중" : "열기"}
                          </button>
                          {a && !inProgress && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm sizing-rerun-btn"
                              title={stale ? "분석일이 90일 지났습니다" : "분석 실패 또는 갱신 필요 시 새 버전으로 재실행"}
                              onClick={() => rerunAnalysis(a.id, ind.name_ko)}
                            >
                              재분석
                            </button>
                          )}
                          {!inProgress && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              title="산업명·KSIC 코드 수정"
                              onClick={() => setEditing({ id: ind.id, name: ind.name_ko, code: ind.ksic_code ?? "" })}
                            >
                              수정
                            </button>
                          )}
                          {!inProgress && (
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              title="이 산업과 시장분석 기록을 삭제합니다"
                              onClick={() => deleteIndustry(ind)}
                            >
                              삭제
                            </button>
                          )}
                        </>
                      )}
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasInProgress && (
          <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">
            분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.
          </p>
        )}
      </section>

      {/* ── 가치사슬 연계 후보 모달 (분석·재분석 범위 선택, ADR-0126 확장) ── */}
      {linkModal.open && (
        <div className="modal-backdrop" onClick={() => { if (!linkModal.running) setLinkModal((prev) => ({ ...prev, open: false })); }}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="가치사슬 연계 산업 선택"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[0.95rem] mb-1">
              {linkModal.rerunAnalysisId ? "가치사슬 연계 산업 선택" : "가치사슬 연계 산업 미리보기"} — <span className="font-semibold">{linkModal.primaryName}</span>
            </h2>
            <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
              {linkModal.rerunAnalysisId
                ? "재분석 대상 산업과 연관성이 있는 산업 후보입니다. 선택한 산업은 '연계 대기'로 등록되며, 재분석이 완료된 뒤 한 건씩 자동으로 시작됩니다. 마스터에 없는 산업은 시작 시 자동 등록됩니다."
                : `첫 분석은 '${linkModal.primaryName}'만 진행됩니다. 아래는 함께 볼 만한 연계 산업 제안이며, 분석이 완료되면 리포트에서 '연계 산업 이어서 분석'으로 선택·추가할 수 있습니다.`}
            </p>
            {linkModal.loading ? (
              <p className="text-[0.85rem]" role="status">연계 산업 후보를 도출하는 중입니다 (수 초 소요) — 아직 분석은 시작되지 않았습니다.</p>
            ) : linkModal.candidates.length === 0 && linkModal.substitutes.length === 0 ? (
              <p className="text-[0.8rem] text-[color:var(--muted-fg)]">
                연관 산업 후보를 도출하지 못했습니다 — 이 산업만 분석을 진행할 수 있습니다.
              </p>
            ) : (
              <>
                <ul className="sizing-note-list mb-2" aria-label="연관 산업 후보">
                  {linkModal.candidates.map((c) => (
                    <li key={c.name_ko}>
                      <label className={`flex items-start gap-2 text-[0.82rem] ${linkModal.rerunAnalysisId && !c.locked ? "cursor-pointer" : ""}`}>
                        {linkModal.rerunAnalysisId ? (
                          <input
                            type="checkbox"
                            checked={linkModal.selected.has(c.name_ko)}
                            disabled={c.locked}
                            onChange={() => toggleCandidate(c.name_ko, c.locked)}
                            className="mt-1"
                          />
                        ) : (
                          <span className="mt-1 inline-block w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          <span className="font-semibold">{c.relation}</span> · {c.name_ko}{" "}
                          <span className={`status-chip ${c.industry_id ? "status-green" : "status-amber"}`}>
                            {c.industry_id ? "분석 가능" : "미등록 — 자동 등록"}
                          </span>
                          {c.locked && <span className="control-chip status-green" title="이미 등록된 연계 산업 — 재분석 시 자동 반영, 해제 불가">등록됨 · 고정</span>}
                          {c.source === "proxy" && <span className="status-chip status-not-started" title="LLM 1차 제안 — 검증 전 가설입니다.">제안 (검증 전)</span>}
                          {c.source === "link" && <span className="status-chip status-green">연계 근거</span>}
                          {c.source === "analysis" && <span className="status-chip status-not-started">과거 분석</span>}
                          {c.note && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{c.note}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {linkModal.substitutes.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[0.78rem] font-semibold">대체 위협 (검토 필요) — 6축 연관성 분석 영역</p>
                    <ul className="sizing-note-list" aria-label="대체 위협 후보">
                      {linkModal.substitutes.map((sub) => (
                        <li key={sub.name_ko} className="text-[0.82rem]">
                          {sub.name_ko}
                          {sub.note && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{sub.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {linkModal.rerunAnalysisId && (
                  <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-2">
                    이미 등록된 수요 산업은 재분석에 자동으로 반영됩니다 — 위 목록에서 제외할 수 없습니다.
                    {linkModal.selected.size >= 5 && " 대기 큐는 최대 5건까지 선택할 수 있습니다."}
                  </p>
                )}
                <button type="button" className="btn-ghost btn-sm" disabled={linkModal.loading || linkModal.running} onClick={() => void rerunProxyAnalysis()}>
                  후보 다시 도출
                </button>
              </>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" className="btn-ghost" disabled={linkModal.running} onClick={() => setLinkModal((prev) => ({ ...prev, open: false }))}>
                취소
              </button>
              <button type="button" className="btn-primary" disabled={linkModal.running} onClick={() => void runWithSelections()}>
                {linkModal.running
                  ? "분석 시작 중..."
                  : linkModal.rerunAnalysisId
                    ? linkModal.selected.size > 0 ? `재분석 시작 (연계 ${linkModal.selected.size}건은 완료 후 자동 시작)` : "재분석 시작"
                    : "이 산업만 분석"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 산업 간 가치사슬 관계도 모달 ── */}
      {chainGraphOpen && chainGraph && (
        <div className="modal-backdrop" onClick={() => setChainGraphOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="산업 간 가치사슬 관계도"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "min(90vw, 960px)" }}
          >
            <h2 className="text-[0.95rem] mb-1">산업 간 가치사슬 관계도</h2>
            <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
              사람이 확정한 전방/전전방/후방/후후방 연계만 표시합니다 — 색이 채워진 노드는 분석 완료된 산업입니다.
            </p>
            <IndustryChainGraph nodes={chainGraph.nodes} edges={chainGraph.edges} />
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChainGraphOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── 산업 리포트: 버전 페이로드의 매트릭스를 렌더링한다 (ADR-0112 — 모든 분석 동일 경로) ── */

function MarketReport({ detail, analysisId, analysisDate, onAddLinked }: { detail: IndustryDetail; analysisId: string | null; analysisDate: string | null; onAddLinked?: () => void }) {
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!analysisId) return;
    api.get<AnalysisDetail>(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}`)
      .then((r) => setAnalysis(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "분석 결과 불러오기 실패"));
  }, [analysisId]);

  const matrix: SizingMatrix | null = analysis?.versions[0]?.payload?.matrix ?? null;
  const stepSummaries = analysis?.versions[0]?.payload?.stepSummaries ?? null;
  // provenance는 데이터가 스스로 말한다: 수동 연구 시드(frozen-research)인지 파이프라인 산출인지.
  const manualResearch = matrix?.provenance === "frozen-research";
  const llmUsed = stepSummaries?.every((s) => s.source === "llm") ?? false;

  return (
    <>
      <div className="sizing-report-header">
        <h2>
          {detail.industry.name_ko} 시장 분석 리포트
          {detail.industry.ksic_code && <code className="dd-item-id ml-2">{detail.industry.ksic_code}</code>}
        </h2>
        <p className="text-[color:var(--muted-fg)] text-[0.78rem]">
          방법론: systematic-market-sizing v1.1
          {manualResearch ? " · 연구문서 기반 수동 분석(분석가 확정)" : " · 8단계 파이프라인 산출"}
          {analysisDate && <> · 분석일: <strong>{analysisDate}</strong></>}
        </p>
      </div>
      <VersionBar versions={detail.versions} />
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!analysis && (
        <p className="market-section">분석 결과를 불러오는 중...</p>
      )}
      {analysis && !matrix && (
        <section aria-label="분석 없음" className="market-section sizing-step">
          <p className="text-[color:var(--muted-fg)] italic">
            이 산업의 정식 분석 기록(버전)이 없습니다. 목록에서 "신규 산업 분석"으로 8단계 파이프라인을 실행하세요.
          </p>
          <StepSensitivityChart stepNumber={1} sensitivities={detail.driver_sensitivities} />
        </section>
      )}
      {matrix && (
        <>
          {/* ADR-0131 — LLM이 미구성이거나 실패해 일부/전체 단계가 결정론 합성
              폴백으로 채워진 버전은 시장 규모·CAGR 등 핵심 수치가 자리표시자
              (0, 1 등)일 수 있다. 기존의 일반 "추정치" 안내와 별개로, 이 버전이
              실제로 그런 상태인지 명시적으로 경고한다(2026-09-13 휴머노이드
              로봇 리포트 사고 — 경고 없이 $1B/-10000%가 실제 값처럼 보였음). */}
          {stepSummaries && !llmUsed && (
            <p className="market-section text-[0.82rem] text-[color:var(--red-fg)] font-semibold" role="alert" style={{ border: "1px solid var(--red-border, currentColor)", borderRadius: "0.5rem", padding: "0.6rem 0.8rem" }}>
              ⚠️ 이 버전은 {stepSummaries.every((s) => s.source !== "llm") ? "전체" : "일부"} 단계가 LLM 미구성/실패로 결정론 합성(더미) 값으로 채워졌습니다 —
              시장 규모·성장률 등 수치를 신뢰하지 마세요. LLM 구성을 확인한 뒤 재분석하세요.
            </p>
          )}
          {matrix.provenance === "llm-estimate" && (
            <p className="market-section sizing-note-list text-[0.78rem] text-[color:var(--amber-fg)]" role="note">
              이 매트릭스는 파이프라인 LLM이 생성한 추정치입니다 — 수치는 앵커 삼각검증(2단계)과
              기업 공시 교차검증(6단계)을 거친 동결 매트릭스가 아니며, 정식 인용 전 분석가 확정이 필요합니다.
              {llmUsed && <> (8단계 전체 LLM 요약 사용)</>}
            </p>
          )}
          <SizingReport detail={detail} matrix={matrix} stepSummaries={stepSummaries} analysisId={analysisId} onAddLinked={onAddLinked} />
        </>
      )}
    </>
  );
}

/* ── 버전 관리 바 ── */
function VersionBar({ versions }: { versions: VersionInfo[] }) {
  if (!versions || versions.length === 0) return null;
  return (
    <details className="market-section sizing-version-bar">
      <summary className="cursor-pointer text-[0.82rem]">
        버전 이력 ({versions.length}개 버전) — 최신 v{versions[0].version_no}
      </summary>
      <table className="data-table mt-2" aria-label="분석 버전 이력">
        <caption className="sr-only">분석 버전 이력</caption>
        <thead>
          <tr><th scope="col">버전</th><th scope="col">변경 내용</th><th scope="col">작성</th><th scope="col">일시</th></tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version_no}>
              <td className="font-semibold tabular-nums">v{v.version_no}</td>
              <td className="text-[0.78rem]">{v.changelog ?? "—"}</td>
              <td className="text-[0.75rem]">{v.created_by}</td>
              <td className="text-[0.75rem] tabular-nums">{v.created_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/* ═══════════════ 8단계 리포트 ═══════════════ */

function StepSection({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={`단계 ${n}: ${title}`} className="market-section sizing-step">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">{n}</span> {title}
      </h3>
      {children}
    </section>
  );
}

function SizingReport({ detail, matrix, stepSummaries, analysisId, onAddLinked }: {
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
  const canCurate = me?.role === "admin" || me?.role === "analyst";
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
  return (
    <div className="sizing-report text-[0.88rem]">
      <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section aria-label="개요" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge"></span> 핵심 요약
          </h3>
          <div className="summary-cards">
            <div className="summary-card glass">
              <span className="summary-value mono-num">${Math.round(matrix.anchor.total).toLocaleString()}B</span>
              <span className="text-label">기준 시장규모 (2026)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{matrix.consistency.bottomUpCagr.toFixed(1)}%</span>
              <span className="text-label">성장률 (연평균, 2026→2030)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">${Math.round(proj2030Total).toLocaleString()}B</span>
              <span className="text-label">2030 전망 (기본 시나리오)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{matrix.chainGrade.grade}</span>
              <span className="text-label">체인 등급 (통계 hop {matrix.chainGrade.statisticalHops}개)</span>
            </div>
          </div>
          <ul className="sizing-note-list mt-3">
            <li>분석 방법: systematic-market-sizing v1.1 — {matrix.provenance === "frozen-research" ? "연구문서 기반 수동 분석(분석가 확정)" : "8단계 파이프라인 산출(LLM 추정 포함, 분석가 확정 전)"}</li>
            <li>세그먼트: {segmentsOf(matrix).map((x) => x.label).join(" / ")} — 권역 {matrix.regions.length}개</li>
            <li>시나리오: 비관/기본/낙관 CAGR 밴드 — 세부는 <strong>성장성</strong> 탭</li>
            <li>경쟁 구조 — 세부는 <strong>경쟁 구조</strong> 탭 · 기회/위험 요인 — <strong>정성 분석</strong> 탭</li>
          </ul>
        </section>
      )}

      {tab !== "overview" && (
      <>
      {tab === "structure" && (
      <>
      <StepSection n={1} id="step-1" title="시장 구조 정의 (분석 축·산업 사슬 방향)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          시장을 <strong>권역 × 최종수요 세그먼트 × 시나리오</strong> 3축으로 나누고, 산업이 가치사슬에서
          어디에 위치하는지(상류·중류·하류)에 따라 분석 방향을 정합니다 — 하류 산업은 전방/전전방(수요처)을,
          상류 산업은 후방/후후방(공급처)을 분석해야 수요·공급 구조가 온전히 파악됩니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <table className="data-table sizing-axes-table" aria-label="분석 축 정의">
              <caption className="sr-only">분석 축 정의</caption>
              <thead><tr><th scope="col">구분</th><th scope="col">값</th></tr></thead>
              <tbody>
                <tr><td className="font-semibold">권역 (Region)</td><td>{matrix.regions.map((r) => r.label).join(" / ")} ({matrix.regions.length}개)</td></tr>
                <tr><td className="font-semibold">최종수요 세그먼트</td><td>{segmentsOf(matrix).map((seg) => seg.label).join(" / ")} ({segmentsOf(matrix).length}개)</td></tr>
                <tr><td className="font-semibold">시나리오</td><td>비관 / 기본 / 낙관 (3개, CAGR 밴드)</td></tr>
              </tbody>
            </table>
          </div>
          <div className="chart-half sizing-grade-card">
            <span className="status-chip status-amber">체인 등급 {matrix.chainGrade.grade}</span>
            <p className="mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.chainGrade.note}</p>
            <p className="mt-1 text-[0.78rem]">통계 hop {matrix.chainGrade.statisticalHops}개 · 분석 hop은 등급에 불가산</p>
          </div>
        </div>
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">
          산업 사슬 방향 — 위치: {POSITION_LABELS[matrix.chainDirection.position] ?? matrix.chainDirection.position}
        </h4>
        <table className="data-table" aria-label="산업 사슬 방향 분석">
          <caption className="sr-only">산업 사슬 방향 분석</caption>
          <thead>
            <tr><th scope="col" className="w-[8rem]">방향</th><th scope="col">인접 산업</th><th scope="col">분석 포인트</th></tr>
          </thead>
          <tbody>
            {matrix.chainDirection.relatedIndustries.map((r, i) => (
              <tr key={i}>
                <td className="font-semibold">{r.relation}</td>
                <td>{r.name}</td>
                <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">{matrix.chainDirection.note}</p>

        {/* 가치사슬 연계 — 링크 + 승인 대기 제안 + 등급 (S1 산출물, ADR-0126) */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1">
          <h4 className="text-[0.82rem] text-[color:var(--muted-fg)]">가치사슬 연계</h4>
          {onAddLinked && (
            <button type="button" className="btn-ghost btn-sm" onClick={onAddLinked} title="이 리포트의 가치사슬 인접 산업 중 추가로 분석할 산업을 고릅니다.">
              연계 산업 이어서 분석
            </button>
          )}
        </div>
        {view.chain.links.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            이 산업에 등록된 가치사슬 연계 링크가 없습니다 — 아래 승인 대기 제안에서 등록하거나, 신규 분석 산업은 드라이버 민감도가 구조 증거를 대신합니다.
          </p>
        ) : (
          <div className="table-scroll">
          <table className="data-table report-table" aria-label="가치사슬 연계 링크">
            <caption className="sr-only">가치사슬 연계 링크</caption>
            <thead>
              <tr><th scope="col" className="w-[8rem]">관계</th><th scope="col">산업</th><th scope="col">hop</th><th scope="col">계수/β</th><th scope="col">시차(월)</th><th scope="col">근거</th>{canCurate && <th scope="col">관리</th>}</tr>
            </thead>
            <tbody>
              {view.chain.links.map((l, i) => (
                <tr key={`${l.industry_id}-${l.direction}-${i}`}>
                  <td className="font-semibold">{l.relation ?? (l.direction === "upstream" ? "후방 (공급처)" : "전방 (수요처)")}</td>
                  <td>{l.name_ko}</td>
                  <td>{l.hop_type === "engineering" ? "engineering" : l.hop_type === "statistical" ? "statistical" : "구조 (승인)"}</td>
                  <td className="tabular-nums">{l.hop_type === "engineering" ? l.coefficient : l.beta !== null ? `β ${l.beta} (R² ${l.r2})` : "—"}</td>
                  <td className="tabular-nums">{l.lag_months ?? "—"}</td>
                  <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{l.evidence_ref}</td>
                  {canCurate && (
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={retiringLinkId === l.id}
                        onClick={() => void retireLink(l.id)}
                      >
                        {retiringLinkId === l.id ? "회수 중..." : "회수"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {/* ADR-0126 — S1 시장 구조 정의가 도출한 인접 산업 중 산업 마스터와
            매칭된 것을 승인 대기 제안으로 제시한다. 등록은 사람의 행위다. */}
        {canCurate && (view.proposals?.length ?? 0) > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[0.8rem] mb-1"><span className="font-semibold">승인 대기 제안</span> — 시장 구조 정의(Step 1)에서 도출된 인접 산업입니다. 승인하면 구조(structural) 링크로 등록됩니다 (변환 계수는 통계 보정 후 부여).</p>
            <div className="flex flex-wrap gap-2">
              {view.proposals!.map((p) => (
                <span key={p.industry_id} className="control-chip">
                  <span className="font-semibold">{p.relation}</span> · {p.name_ko}
                  <button type="button" className="btn-ghost btn-sm ml-1" disabled={approving === p.industry_id} onClick={() => void approveProposal(p)}>
                    {approving === p.industry_id ? "등록 중..." : "승인"}
                  </button>
                </span>
              ))}
            </div>
            {chainLinkError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mt-1 mb-0">{chainLinkError}</p>}
          </div>
        )}
        {(view.unmatchedProposals?.length ?? 0) > 0 && (
          <p className="mt-1 text-[0.75rem] text-[color:var(--muted-fg)]">
            미매칭 후보 (산업 마스터에 없어 등록 불가 — 시장분석 산업 편집에서 먼저 등록하세요): {view.unmatchedProposals!.map((u) => `${u.relation} ${u.name}`).join(", ")}
          </p>
        )}
        {/* ADR-0126 — 제안이 없어도 사람이 직접 연계를 등록할 수 있다 (같은 승인 행위). */}
        {canCurate && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.8rem] text-[color:var(--accent)]">＋ 직접 등록 (산업 마스터에서 선택)</summary>
            <div className="sizing-new-form mt-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]">
                  <span className="block mb-1">대상 산업 *</span>
                  <select
                    value={manualLink.industry_id}
                    onChange={(e) => setManualLink({ ...manualLink, industry_id: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                    style={{ minWidth: "12rem" }}
                  >
                    <option value="">선택...</option>
                    {(view.linkableIndustries ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name_ko}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">관계 *</span>
                  <select value={manualLink.relation} onChange={(e) => setManualLink({ ...manualLink, relation: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                    <option value="전방">전방 (수요처)</option>
                    <option value="전전방">전전방 (수요처, 2hop)</option>
                    <option value="후방">후방 (공급처)</option>
                    <option value="후후방">후후방 (공급처, 2hop)</option>
                  </select>
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">근거 *</span>
                  <input value={manualLink.evidence_ref} onChange={(e) => setManualLink({ ...manualLink, evidence_ref: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 12rem" }} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={linkSaving || !manualLink.industry_id || !manualLink.evidence_ref.trim()} onClick={() => void submitManualLink()}>
                  {linkSaving ? "등록 중..." : "등록"}
                </button>
              </div>
              {linkSaved && <p role="status" className="text-[0.78rem] text-[color:var(--green-fg)] mt-1 mb-0">링크가 등록되었습니다.</p>}
            </div>
          </details>
        )}
        {view.chain.grade && (
          <p className="mt-1 text-[0.8rem] text-[color:var(--muted-fg)]">
            <span className="status-chip status-green mr-1">체인 등급 {view.chain.grade.reliability_grade}</span>
            {view.chain.grade.grade_rationale}
          </p>
        )}

        {/* ADR-0129 — relation 미태깅 레거시 구조 링크(ADR-0126 시절 등록) 검토 큐.
            은퇴하지 않고 relation만 지정하면 되므로 별도 섹션으로 분리한다. */}
        {canCurate && view.chain.legacyUntagged.length > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[0.8rem] mb-1">
              <span className="font-semibold">레거시 검토</span> — relation이 태깅되지 않은 구(ADR-0126) 구조 링크입니다. 관계를 지정하세요.
            </p>
            <div className="flex flex-wrap gap-2">
              {view.chain.legacyUntagged.map((l) => (
                <span key={l.id} className="control-chip">
                  <span className="font-semibold">{l.direction === "upstream" ? "후방 (공급처)" : "전방 (수요처)"}</span> · {l.name_ko}
                  <select
                    value={legacyRelation[l.id] ?? "전방"}
                    onChange={(e) => setLegacyRelation({ ...legacyRelation, [l.id]: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm ml-1"
                  >
                    <option value="전방">전방</option>
                    <option value="전전방">전전방</option>
                    <option value="후방">후방</option>
                    <option value="후후방">후후방</option>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-1"
                    disabled={legacyAssigning === l.id}
                    onClick={() => void assignLegacyRelation(l.id)}
                  >
                    {legacyAssigning === l.id ? "지정 중..." : "지정"}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <StepSensitivityChart sensitivities={detail.driver_sensitivities} />
      </StepSection>
      </>
      )}

      {tab === "competitive" && (
        <section aria-label="경쟁 구조" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">2-A</span> 경쟁 구조 — 시장 집중도와 주요 기업
          </h3>
        {/* S1 competitive-intelligence 산출 — 산업 적응형 컬럼: (1) 레거시/시드 매트릭스의
            techType·용량·진행상태는 데이터가 있을 때만, (2) 파이프라인 신규 산출은
            산업별 attributes(라벨 자유)를 동적 컬럼으로 렌더링한다 (ADR-0092 optional). */}
        {matrix.competitive && (
          <>
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">경쟁 구조</h4>
            <p className="mb-1 text-[0.85rem]">{matrix.competitive.structure}</p>
            {matrix.competitive.players.length > 0 && (() => {
              const players = matrix.competitive.players;
              const hasTechType = players.some((pl) => pl.techType);
              const hasCapacity = players.some((pl) => pl.capacityMWe !== undefined);
              const hasProjectStatus = players.some((pl) => pl.projectStatus);
              // 동적 속성 컬럼 — player들이 공유하는 라벨의 합집합(최대 4개)
              const attrLabels: string[] = [];
              for (const pl of players) {
                for (const a of pl.attributes ?? []) {
                  if (!attrLabels.includes(a.label)) attrLabels.push(a.label);
                }
              }
              const attrOf = (pl: (typeof players)[number], label: string) =>
                pl.attributes?.find((a) => a.label === label)?.value ?? "—";
              return (
              <div className="table-scroll">
              <table className="data-table report-table" aria-label="경쟁 구조 — 주요 기업">
                <caption className="sr-only">경쟁 구조 주요 기업</caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-label">기업</th>
                    <th scope="col" className="col-type">포지션</th>
                    {hasTechType && <th scope="col" className="col-type">기술 유형</th>}
                    {hasCapacity && <th scope="col" className="col-num">용량 (MWe)</th>}
                    {hasProjectStatus && <th scope="col" className="col-type">진행 상태</th>}
                    {attrLabels.slice(0, 4).map((label) => <th key={label} scope="col" className="col-type">{label}</th>)}
                    <th scope="col" className="col-text">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((pl) => (
                    <tr key={pl.name}>
                      <td className="col-label font-semibold">{pl.name}</td>
                      <td className="col-type">
                        <span className={`status-chip ${pl.tier === "leader" ? "status-green" : pl.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                          {pl.tier === "leader" ? "리더" : pl.tier === "challenger" ? "도전자" : "니치"}
                        </span>
                      </td>
                      {hasTechType && <td className="col-type">{pl.techType ?? "—"}</td>}
                      {hasCapacity && <td className="col-num tabular-nums">{pl.capacityMWe !== undefined ? pl.capacityMWe.toLocaleString() : "—"}</td>}
                      {hasProjectStatus && <td className="col-type">{pl.projectStatus ? <span className="status-chip status-in-progress">{pl.projectStatus}</span> : "—"}</td>}
                      {attrLabels.slice(0, 4).map((label) => <td key={label} className="col-type">{attrOf(pl, label)}</td>)}
                      <td className="col-text text-[0.8rem] text-[color:var(--muted-fg)]">{pl.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              );
            })()}
          </>
        )}
          {!matrix.competitive && (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              경쟁 구조 데이터가 없습니다 — 재분석 시 1단계에서 도출됩니다.
            </p>
          )}
          <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">
            점유율·순위는 정성 추정(공시 대조 전) — 정밀 수치는 S2~S3 이후 공시 교차검증으로 보강됩니다.
          </p>
        </section>
      )}



      {tab === "size" && (
      <>
      <StepSection n={2} id="step-2" title="기준 시장규모 산정 (다중 소스 교차)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          독립 추정치 2–3개로 기준년 총시장(2026, $B)을 삼각검증하고 이상치를 명시적으로 제외합니다.
          이후 모든 배분이 이 앵커로 수렴해야 합니다.
        </p>
        <AnchorChart matrix={matrix} />
        <ul className="sizing-note-list mt-2">
          {matrix.anchor.sources.map((s) => (
            <li key={s.label} className={s.status === "excluded" ? "text-[color:var(--muted-fg)] line-through" : ""}>
              <strong>{s.label}</strong> — ${s.estimate.toFixed(2)}B
              {s.sourceUrl && <> · <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">출처</a></>}
              {s.asOf && <> <span className="text-[0.75rem] text-[color:var(--muted-fg)]">({s.asOf})</span></>}
              {s.methodology && <span className="block pl-4 text-[0.75rem] text-[color:var(--muted-fg)]">측정 방법론: {s.methodology}</span>}
              <span className="block pl-4 text-[0.78rem]">{s.note}</span>
            </li>
          ))}
        </ul>
      </StepSection>
      </>
      )}


      {tab === "allocation" && (
      <>
      <StepSection n={3} id="step-3" title="권역·세그먼트 배분">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          권역 가중치는 인접 공시시장 프록시에서, 세그먼트 믹스는 글로벌 교차검증치에 맞춘 보정 배분입니다.
          판단 조정은 셀별로 출처와 함께 기록됩니다(바텀업 합산이 아님).
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역 가중치 (도넛)</h4>
            <RegionWeightDonut matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 세그먼트 믹스 (100% 적층)</h4>
            <SegmentMixStack matrix={matrix} />
          </div>
        </div>
        <RegionTable matrix={matrix} />
      </StepSection>
      </>
      )}


      {tab === "growth" && (
      <>
      <StepSection n={4} id="step-4" title="셀별 CAGR·시나리오 밴드">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          권역×세그먼트 셀마다 개별 CAGR을 부여합니다(글로벌 단일 수준 아님). 시나리오 밴드는 기본값
          base×0.5 ~ base×1.55이며, <strong>소스 간 불일치가 문서화된 셀만</strong> 넓은 밴드로 대체합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">기본 시나리오 CAGR (셀별 그룹 바)</h4>
            <CagrGroupedBar matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">2026 → 2030 전망 (권역 합계)</h4>
            <ProjectionChart matrix={matrix} />
          </div>
        </div>
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">시나리오 밴드 (비관~낙관, 셀별 — 문서화된 오버라이드 강조)</h4>
        <ScenarioBandChart matrix={matrix} />
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 — 권역별 CAGR 적용 (그룹 바)</h4>
            <RegionScenarioChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 (권역 테이블, $B)</h4>
            <RegionScenarioTable matrix={matrix} />
          </div>
        </div>
        <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">
          시나리오는 글로벌 단일 CAGR이 아니라 각 권역×세그먼트 셀의 비관/기본/낙관 CAGR(4년 복리)을 그대로
          적용해 계산합니다 — 권역별 성격이 시나리오 결과에 그대로 반영됩니다.
        </p>
      </StepSection>

      {/* 4-A: 방법론 8단계 번호는 유지하고 별도 영역으로 표시 */}
      <section id="yearly-share" aria-label="연도별 시장점유율 추이" className="market-section sizing-step sizing-step-deep">
        <h3 className="sizing-step-title text-[0.95rem]">
          <span className="sizing-step-badge sizing-step-badge-deep">4-A</span> 연도별 시장점유율 추이 (2026 → 2030, 기본 시나리오)
        </h3>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          각 권역×세그먼트 셀의 기본 CAGR을 연도별로 복리 적용해 권역별 시장 규모와 점유율이
          어떻게 이동하는지 연 단위로 추적합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 점유율 추이 (적층 영역, %)</h4>
            <YearlyShareAreaChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 시장 규모 추이 (적층 바, $B)</h4>
            <YearlySizeStackedBar matrix={matrix} />
          </div>
        </div>
        <YearlyShareTable matrix={matrix} />
      </section>

      <StepSection n={5} id="step-5" title="성장률 정합성 확인 (바텀업 vs 탑다운)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          매트릭스를 롤업한 암시 글로벌 CAGR을 탑다운 컨센서스와 비교합니다. 허용 오차 내여도 이는
          <strong> 내부 정합성 확인</strong>일 뿐 — 양쪽 모두 같은 부류의 소스로 소급되므로 독립적 확인으로
          표현하지 않습니다.
        </p>
        <ConsistencyChart matrix={matrix} />
        <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.consistency.tolerance}</p>
        {matrix.externalForecast ? (
          <div className="chart-half sizing-grade-card mt-4">
            <h4 className="text-[0.85rem] mb-2">
              외부 미래 전망 대비 격차 분석 ({matrix.externalForecast.targetYear}년) — 과거 성장률 연장 추정 vs 외부 전망

              {(() => {
                const gap = matrix.externalForecast.gapPct;
                if (gap === undefined || Math.abs(gap) < 20) return null;
                return (
                  <div className="sizing-grade-card mt-2" role="note">
                    <p className="m-0 text-[0.8rem]">
                      <span className="status-chip status-red mr-1">검토 필요</span>
                      우리 추정과 외부 전망의 격차가 <strong>{Math.abs(gap).toFixed(1)}%</strong>로 20%를 초과합니다 — 분석 전제(드라이버·세그먼트 정의·앵커 소스)가 현실과 어긋났을 수 있습니다. 재분석으로 최신 외부 전망·연계 산업 근거를 반영하세요.
                    </p>
                    {rerunStarted ? (
                      <p role="status" className="text-[0.78rem] text-[color:var(--green-fg)] mt-1 mb-0">재분석이 시작되었습니다 — 완료되면 목록의 분석일이 갱신됩니다.</p>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost btn-sm mt-1"
                        onClick={async () => {
                          if (!analysisId) { setRerunError("분석 id를 찾을 수 없습니다 — 목록에서 재분석하세요."); return; }
                          try {
                            await api.post(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}/rerun`);
                            setRerunStarted(true);
                          } catch (e) {
                            setRerunError(e instanceof Error ? e.message : "재분석 시작 실패");
                          }
                        }}
                      >
                        지금 재분석 (최신 외부 전망·연계 근거 반영)
                      </button>
                    )}
                    {rerunError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mt-1 mb-0">{rerunError}</p>}
                  </div>
                );
              })()}
            </h4>
            <table className="data-table" aria-label="외부 전망 대비 격차">
              <caption className="sr-only">외부 전망 대비 격차</caption>
              <thead>
                <tr><th scope="col">구분</th><th scope="col">{matrix.externalForecast.targetYear}년 시장규모</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">우리 추정 (성장률 연장)</td>
                  <td className="tabular-nums">${(matrix.externalForecast.ourMarketSize ?? 0).toFixed(2)}B</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">바텀업 CAGR {(matrix.consistency.bottomUpCagr).toFixed(1)}% 적용</td>
                </tr>
                <tr>
                  <td className="font-semibold">외부 전망</td>
                  <td className="tabular-nums">${matrix.externalForecast.marketSize.toFixed(2)}B</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{matrix.externalForecast.sourceLabel}{matrix.externalForecast.cagr ? ` · CAGR ${(matrix.externalForecast.cagr * 100).toFixed(1)}%` : ""}</td>
                </tr>
                <tr className="row-selected">
                  <td className="font-semibold">격차</td>
                  <td className="tabular-nums font-semibold">{matrix.externalForecast.gapPct !== undefined ? `${matrix.externalForecast.gapPct > 0 ? "+" : ""}${matrix.externalForecast.gapPct}%` : "—"}</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">외부 전망이 우리 추정 대비 {matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct > 0 ? "높음 — 추가/강화 드라이버 개연성" : matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct < 0 ? "낮음 — 기존 드라이버 약화 개연성" : "동일"} </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 mb-0 text-[0.85rem] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
            {matrix.externalForecast.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
              <p className="mt-2 mb-0 text-[0.78rem]">
                <strong>과거 대비 신규·강화 드라이버:</strong>{" "}
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress mr-1">{d}</span>
                ))}
              </p>
            )}
            <p className="mt-2 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.externalForecast.note}</p>
          </div>
        ) : (
          <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">
            입수된 외부 미래 전망이 없습니다 — 기존 방식(과거 성장률 연장 추정)을 유지합니다. 재분석 시 최신 공개 전망을 반영해 격차 분석이 시도됩니다.
          </p>
        )}
      </StepSection>
      </>
      )}

      {tab === "qualitative" && (
        <section aria-label="정성 분석 — 기회·위험 요인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-A</span> 정성 분석 — 기회 요인과 위험 요인
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            정량 매트릭스만으로는 시장의 질적 방향이 보이지 않습니다. 이 요인들은 기회발굴(S2)의
            기회 발굴·요인 자동 도출의 입력으로 직결됩니다.
          </p>
          <div className="chart-pair">
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">✅ 기회 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.opportunityFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">위험 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.riskFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
          {matrix.externalForecast?.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">외부 전망 대비 신규·강화 드라이버</h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress">{d}</span>
                ))}
              </div>
              {matrix.externalForecast.gapAnalysis && (
                <p className="mb-0 text-[0.85rem] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
              )}
            </div>
          )}
          {matrix.qualitative.sources && matrix.qualitative.sources.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[0.85rem] text-[color:var(--accent)]">입수 출처 ({matrix.qualitative.sources.length}건 — 출처 명기 필수)</summary>
              <ul className="sizing-note-list mt-2">
                {matrix.qualitative.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                    {s.snippet && <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {tab === "pipeline" && (
        <section aria-label="수요 파이프라인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">4-B</span> 수요 파이프라인 — 프로젝트별 신뢰도 티어
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            향후 착공·발주가 예정된 개별 프로젝트를 신뢰도 티어로 구분합니다 — <strong>Tier 1</strong>(실착공·계약 확정)부터
            <strong> Tier 4</strong>(비구속 MOU·초기 검토)까지. 티어가 낮은(숫자가 큰) 항목일수록 수요 불확실성이 크며,
            시장 추정의 상방 근거로만 취급해야 합니다.
          </p>
          {matrix.demandPipeline && matrix.demandPipeline.length > 0 ? (
            <div className="table-scroll">
            <table className="data-table report-table" aria-label="수요 파이프라인 프로젝트">
              <caption className="sr-only">수요 파이프라인 프로젝트 목록</caption>
              <thead>
                <tr><th scope="col" className="w-[6rem]">티어</th><th scope="col">프로젝트</th><th scope="col">상태</th><th scope="col">COD 목표</th><th scope="col">출처</th></tr>
              </thead>
              <tbody>
                {[...matrix.demandPipeline].sort((a, b) => a.tier - b.tier).map((p, i) => (
                  <tr key={`${p.project}-${i}`} className={p.tier === 1 ? "row-selected" : undefined}>
                    <td>
                      <span className={`status-chip ${p.tier === 1 ? "status-green" : p.tier === 2 ? "status-amber" : "status-not-started"}`}>
                        Tier {p.tier}
                      </span>
                    </td>
                    <td className="font-semibold">
                      {p.project}
                      {p.relatedDemandIndustry ? (
                        <span className="block font-normal text-[0.72rem] text-[color:var(--muted-fg)]">{p.relatedDemandIndustry}</span>
                      ) : null}
                    </td>
                    <td className="text-[0.8rem]">{p.status}</td>
                    <td className="tabular-nums">{p.codTarget ?? "—"}</td>
                    <td className="text-[0.75rem]">
                      {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              수요 파이프라인 데이터가 없습니다 — 재분석 또는 시드 등록 시 프로젝트별 근거가 반영됩니다.
            </p>
          )}
        </section>
      )}

      {tab === "regulation" && (
        <section aria-label="규제 환경" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-B</span> 규제 환경 비교 — 관할권×항목
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            국가·관할권별 규제·인허가 상태를 비교합니다. <strong>1차 소스 직접 확인</strong> 여부가 표시되며,
            미확인(간접 추정) 항목은 법률 검토 전 인용할 수 없습니다.
          </p>
          {matrix.regulatoryComparison && matrix.regulatoryComparison.length > 0 ? (
            <div className="table-scroll">
            <table className="data-table report-table min-w-[52rem]" aria-label="규제 환경 비교">
              <caption className="sr-only">관할권별 규제 비교</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-label">관할권</th>
                  <th scope="col" className="col-type">항목</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="col-type">1차 소스 확인</th>
                  <th scope="col" className="col-text">출처·시점</th>
                </tr>
              </thead>
              <tbody>
                {matrix.regulatoryComparison.map((r, i) => (
                  <tr key={`${r.jurisdiction}-${r.item}-${i}`}>
                    <td className="col-label font-semibold">{r.jurisdiction}</td>
                    <td className="col-type whitespace-normal">{r.item}</td>
                    <td className="whitespace-normal text-[0.8rem]">{r.status}</td>
                    <td className="col-type">
                      <span className={`status-chip ${r.confirmedDirectly ? "status-green" : "status-not-started"}`}>
                        {r.confirmedDirectly ? "직접 확인" : "간접·추정"}
                      </span>
                    </td>
                    <td className="col-text whitespace-normal text-[0.75rem]">
                      {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                      {r.asOf ? ` · ${r.asOf}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              규제 비교 데이터가 없습니다 — 재분석 또는 시드 등록 시 관할권별 규제 조사가 반영됩니다.
            </p>
          )}
        </section>
      )}

      {tab === "risk" && (
        <section aria-label="신뢰도·리스크" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">7-A</span> 신뢰도·리스크 — RAG 상한 권고·Kill Criteria·검증 원장
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            데이터 신뢰도가 전체 판단 등급을 캡핑합니다(caps the grade). 아래 Kill Criteria 제안과
            "확인 불가" 선언은 분석가 검토 대상이며, 자동 판정이 아닙니다.
          </p>
          {matrix.ragCapRecommendation && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">RAG 상한 권고</h4>
              <span className={`status-chip ${matrix.ragCapRecommendation.grade === "green" ? "status-green" : matrix.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                상한 {matrix.ragCapRecommendation.grade.toUpperCase()}
              </span>
              <p className="mt-2 mb-0 text-[0.85rem]">{matrix.ragCapRecommendation.rationale}</p>
            </div>
          )}
          {matrix.killCriteriaProposals && matrix.killCriteriaProposals.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[0.85rem] text-[color:var(--muted-fg)] mb-2">Kill Criteria 제안 ({matrix.killCriteriaProposals.length}건 — 분석가 검토 필요)</h4>
              <div className="grid gap-2">
                {matrix.killCriteriaProposals.map((k, i) => (
                  <div key={i} className="sizing-grade-card">
                    <div className="flex items-center gap-2">
                      <span className={`status-chip ${k.severity === "high" ? "status-red" : k.severity === "medium" ? "status-amber" : "status-not-started"}`}>
                        {k.severity === "high" ? "심각" : k.severity === "medium" ? "보통" : "낮음"}
                      </span>
                      <strong className="text-[0.85rem]">{k.name}</strong>
                    </div>
                    <p className="mt-1 mb-0 text-[0.8rem]"><strong>기준:</strong> {k.thresholdText}</p>
                    <p className="mt-1 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{k.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matrix.verificationLedger && matrix.verificationLedger.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[0.85rem] text-[color:var(--accent)]">
                검증 원장 ({matrix.verificationLedger.length}건 — 확인/확인불가/판단필요)
              </summary>
              <table className="data-table mt-2" aria-label="검증 원장">
                <caption className="sr-only">주장별 검증 상태</caption>
                <thead>
                  <tr><th scope="col" className="w-[34%]">주장</th><th scope="col">상태</th><th scope="col">비고</th></tr>
                </thead>
                <tbody>
                  {matrix.verificationLedger.map((v, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{v.claim}</td>
                      <td className="sizing-verdict-cell">
                        <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                          {v.status === "confirmed" ? "확인" : v.status === "could_not_verify" ? "확인 불가" : "판단 필요"}
                        </span>
                      </td>
                      <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{v.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {!matrix.ragCapRecommendation && !matrix.killCriteriaProposals && !matrix.verificationLedger && (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              신뢰도·리스크 데이터가 없습니다 — 재분석 또는 시드 등록 시 반영됩니다.
            </p>
          )}
        </section>
      )}


      {tab === "validate" && (
      <>
      <StepSection n={6} id="step-6" title="기업 공시 교차검증">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          카테고리 내 상장사의 연차보고서·중간보고서 원문으로 매트릭스의 각 주장을 검증합니다.
          구조적으로 검증 불가능한 항목은 <strong>검증 불가</strong>로 명시합니다(탐색 실패가 아닌 공시 구조의 한계).
        </p>
        <div className="table-scroll">
        <table className="data-table report-table" aria-label="기업 공시 교차검증 결과">
          <caption className="sr-only">기업 공시 교차검증 결과</caption>
          <thead>
            <tr><th scope="col" className="w-[34%]">매트릭스 주장</th><th scope="col">판정</th><th scope="col">1차 소스 근거</th></tr>
          </thead>
          <tbody>
            {matrix.crossValidation.map((v) => {
              const meta = VALIDATION_STATUS_META[v.status] ?? VALIDATION_STATUS_META.directional;
              return (
                <tr key={v.claim}>
                  <td className="font-semibold">{v.claim}</td>
                  <td className="sizing-verdict-cell"><span className={`status-chip ${meta.chip}`}>{meta.label}</span></td>
                  <td className="text-[0.78rem]">{v.evidence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </StepSection>

      <StepSection n={7} id="step-7" title="분석 한계 목록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          판단적 보정·소스 불일치·추정 불가 신호를 번호 붙여 고정합니다. 소비자는 이 목록 없이 매트릭스를
          인용할 수 없습니다.
        </p>
        <ol className="sizing-limitations">
          {matrix.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        {matrix.sectionConfidence && matrix.sectionConfidence.length > 0 && (
          <>
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">섹션별 데이터 신뢰도 등급 (A 확정 ~ D 추정 불가)</h4>
            <table className="data-table" aria-label="섹션별 신뢰도 등급">
              <caption className="sr-only">섹션별 데이터 신뢰도 등급</caption>
              <thead>
                <tr><th scope="col">섹션</th><th scope="col">등급</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                {matrix.sectionConfidence.map((s, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{s.section}</td>
                    <td>
                      <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
                        {s.grade}
                      </span>
                    </td>
                    <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{s.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </StepSection>

      <StepSection n={8} id="step-8" title="가정 레지스트리 등록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          동결된 매트릭스는 assumption 레지스트리에 조합당 1 row(kind='assumed', rationale + anchor_ref + TTL)로
          등록됩니다. 레지스트리는 append-only — 수정은 새 row로 기록됩니다. 아래는 실제 등록 상태(라이브 조회)입니다.
        </p>
        <RegistryStatus
          sizing={detail.sizing}
          referenceImplementation={REGISTRY.referenceImplementation}
        />
      </StepSection>

      {stepSummaries && stepSummaries.length > 0 && (
        <details className="market-section sizing-step">
          <summary className="cursor-pointer text-[0.85rem]">파이프라인 단계별 분석 노트 ({stepSummaries.length}단계)</summary>
          <ol className="mt-3 space-y-2 text-[0.85rem]">
            {stepSummaries.map((s) => (
              <li key={s.step}>
                <strong>{s.step}. {STEPS[s.step - 1]?.title ?? s.step}</strong>{" "}
                <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {s.source === "llm" ? "LLM 요약" : "결정론 요약"}
                </span>
                <br />{s.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}

/* ── 단계별 차트 ── */

function StepSensitivityChart({ stepNumber, sensitivities }: { stepNumber?: number; sensitivities: DriverSensitivity[] }) {
  const ct = useChartTheme();
  const agg = new Map<string, number>();
  for (const ds of sensitivities) {
    if (!agg.has(ds.driver_label)) agg.set(ds.driver_label, 0);
    agg.set(ds.driver_label, Math.max(agg.get(ds.driver_label)!, Math.abs(ds.sensitivity)));
  }
  const labels = [...agg.keys()];
  const values = labels.map((l) => Math.round((agg.get(l) ?? 0) * 100) / 100);
  if (labels.length === 0) return <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">기록된 드라이버 민감도가 없습니다.</p>;
  const option = {
    grid: { left: 140, right: 40, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted, width: 120, overflow: "truncate" as const } },
    series: [{ type: "bar" as const, data: values, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 22 }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return (
    <div className="mt-4">
      {stepNumber !== undefined && <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">주요 드라이버 민감도 (민감도 절댓값 ≥ 0.3 → 주요 드라이버)</h4>}
      <EChart option={option} ariaLabel="주요 드라이버 민감도" height={Math.max(140, labels.length * 40 + 48)} />
    </div>
  );
}

function AnchorChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 170, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: {
      type: "category" as const,
      data: matrix.anchor.sources.map((s) => s.label),
      axisLabel: { color: ct.muted, width: 150, overflow: "truncate" as const },
    },
    series: [
      {
        type: "bar" as const,
        data: matrix.anchor.sources.map((s) => ({
          value: s.estimate,
          itemStyle: { color: s.status === "excluded" ? ct.muted : ct.color[0], opacity: s.status === "excluded" ? 0.4 : 1, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 24,
        markLine: {
          symbol: "none",
          data: [{ xAxis: matrix.anchor.total, label: { formatter: `앵커 $${Math.round(matrix.anchor.total).toLocaleString()}B`, color: ct.muted }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } }],
        },
      },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel="TAM/SAM/SOM 앵커 규모" height={170} />;
}

function RegionWeightDonut({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option: Record<string, unknown> = {
    tooltip: { trigger: "item", formatter: (p: { name?: string; percent?: number }) => `${p.name}: ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "pie" as const,
      radius: ["42%", "70%"],
      center: ["50%", "44%"],
      label: { color: ct.muted, formatter: "{d}%", fontSize: 10 },
      data: matrix.regions.map((r, i) => ({ name: r.label, value: r.weight, itemStyle: { color: ct.color[i % ct.color.length] } })),
    }],
  };
  return <EChart option={option as never} ariaLabel="지역별 가중치 비중" height={280} />;
}

function SegmentMixStack({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      stack: "mix",
      data: [...matrix.regions].reverse().map((r) => r.mix[seg.code]),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]] },
      barMaxWidth: 22,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} ariaLabel="부문별 시장 구성" height={280} />;
}

function RegionTable({ matrix }: { matrix: SizingMatrix }) {
  const segs = segmentsOf(matrix);
  return (
    <table className="data-table mt-3" aria-label="권역×세그먼트 배분표">
      <caption className="sr-only">권역×세그먼트 배분 및 2026 기준선</caption>
      <thead>
        <tr>
          <th scope="col">권역</th><th scope="col">가중치</th>
          {segs.map((seg) => <th key={seg.code} scope="col">{seg.label}</th>)}
          <th scope="col">2026 ($B)</th><th scope="col">주요 조정</th>
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            <td className="tabular-nums">{r.weight}%</td>
            {segs.map((seg) => <td key={seg.code} className="tabular-nums">{r.mix[seg.code] ?? 0}%</td>)}
            <td className="tabular-nums">{regionTotal(matrix, r.code, 0).toFixed(3)}</td>
            <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{r.adjustment}</td>
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          <td className="tabular-nums">100%</td>
          {(() => {
            const g = global2026(matrix);
            return (
              <>
                {segs.map((seg) => (
                  <td key={seg.code} className="tabular-nums">{Math.round(((g[seg.code] ?? 0) / g.total) * 1000) / 10}%</td>
                ))}
                <td className="tabular-nums font-semibold">{g.total.toFixed(2)} (앵커 ${Math.round(matrix.anchor.total).toLocaleString()})</td>
              </>
            );
          })()}
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function CagrGroupedBar({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => matrix.cagrBase[r.code]?.[seg.code] ?? 0),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]], borderRadius: [0, 3, 3, 0] },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%` },
  };
  return <EChart option={option} ariaLabel="부문별 CAGR 비교" height={280} />;
}

function ProjectionChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const proj = projection2030(matrix);
  const totals2026 = matrix.regions.map((r) => r3(regionTotal(matrix, r.code, 0)));
  const totals2030 = matrix.regions.map((r) => {
    const m = proj[r.code];
    return r3(segmentsOf(matrix).reduce((sum, seg) => sum + (m[seg.code] ?? 0), 0));
  });
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [
      { name: "2026", type: "bar" as const, data: [...totals2026].reverse(), itemStyle: { color: ct.color[0], opacity: 0.55, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
      { name: "2030 (기본)", type: "bar" as const, data: [...totals2030].reverse(), itemStyle: { color: ct.color[3], borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel="연도별 시장 규모 전망" height={280} />;
}

function ScenarioBandChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const rows = matrix.regions.flatMap((r) => segmentsOf(matrix).map((seg) => {
    const b = bandFor(matrix, r.code, seg.code);
    const isOverride = !!matrix.bandOverrides?.[`${r.code}|${seg.code}`];
    return { label: `${r.label} · ${seg.label}`, down: b.down, up: b.up, isOverride };
  }));
  const option = {
    grid: { left: 150, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: rows.map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 9.5 } },
    series: [
      { type: "bar" as const, stack: "band", data: rows.map((r) => r.down), itemStyle: { color: "transparent" }, barMaxWidth: 12, silent: true, tooltip: { show: false } },
      {
        type: "bar" as const,
        stack: "band",
        data: rows.map((r) => ({
          value: Math.round((r.up - r.down) * 10000) / 10000,
          itemStyle: { color: r.isOverride ? ct.color[3] : ct.color[1], opacity: r.isOverride ? 1 : 0.65, borderRadius: 3 },
        })),
        barMaxWidth: 12,
        tooltip: { show: true },
      },
    ],
    tooltip: {
      trigger: "item" as const,
      formatter: (p: unknown) => {
        const r = rows[(p as { dataIndex: number }).dataIndex];
        return `${r.label}<br/>비관 ${(r.down * 100).toFixed(1)}% ~ 낙관 ${(r.up * 100).toFixed(1)}%${r.isOverride ? "<br/><strong>문서화된 소스 불일치 → 넓은 밴드</strong>" : ""}`;
      },
    },
  };
  return <EChart option={option} ariaLabel="시나리오별 성장률 밴드" height={Math.max(280, rows.length * 17 + 48)} />;
}

const SCENARIOS_META = [
  { key: "down" as const, label: "비관" },
  { key: "base" as const, label: "기본" },
  { key: "up" as const, label: "낙관" },
];

function RegionScenarioChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 40, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `$${Number(v)}`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SCENARIOS_META.map((s) => ({
      name: s.label,
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => r3(regionTotal(matrix, r.code, 4, s.key))),
      itemStyle: {
        color: s.key === "base" ? ct.color[0] : s.key === "up" ? ct.color[3] : ct.color[1],
        opacity: s.key === "base" ? 1 : 0.6,
        borderRadius: [0, 3, 3, 0],
      },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel="지역·부문별 시나리오 CAGR" height={280} />;
}

function RegionScenarioTable({ matrix }: { matrix: SizingMatrix }) {
  const globals = SCENARIOS_META.map((s) => matrix.regions.reduce((a, r) => a + regionTotal(matrix, r.code, 4, s.key), 0));
  return (
    <table className="data-table" aria-label="시나리오별 권역 2030 전망">
      <caption className="sr-only">시나리오별 권역 2030 전망</caption>
      <thead><tr><th scope="col">권역</th><th scope="col">비관</th><th scope="col">기본</th><th scope="col">낙관</th></tr></thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {SCENARIOS_META.map((s) => (
              <td key={s.key} className="tabular-nums">{r3(regionTotal(matrix, r.code, 4, s.key)).toFixed(3)}</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          {globals.map((g, i) => (
            <td key={i} className="tabular-nums font-semibold">{r3(g).toFixed(2)}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ── 4-A 연도별 시장점유율 (기본 시나리오, 셀 CAGR 연간 복리) ── */
const YEARS = [2026, 2027, 2028, 2029, 2030];

function yearlyShareMatrix(matrix: SizingMatrix): { years: number[]; shares: Record<string, number[]>; totals: number[] } {
  const shares: Record<string, number[]> = {};
  const totals = YEARS.map(() => 0);
  for (const r of matrix.regions) {
    shares[r.code] = YEARS.map((_, y) => regionTotal(matrix, r.code, y));
    totals.forEach((_, y) => { totals[y] += shares[r.code][y]; });
  }
  for (const r of matrix.regions) {
    shares[r.code] = shares[r.code].map((v, y) => Math.round((v / totals[y]) * 1000) / 10);
  }
  return { years: YEARS, shares, totals: totals.map((t) => Math.round(t * 100) / 100) };
}

function YearlyShareAreaChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const { shares } = yearlyShareMatrix(matrix);
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), boundaryGap: false, axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "line" as const,
      stack: "share",
      data: shares[r.code],
      areaStyle: { opacity: 0.75 },
      lineStyle: { width: 1 },
      itemStyle: { color: ct.color[i % ct.color.length] },
      symbol: "none" as const,
    })),
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} ariaLabel="연도별 지역 점유율 추이" height={300} />;
}

function YearlySizeStackedBar({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "bar" as const,
      stack: "size",
      data: YEARS.map((_, y) => Math.round(regionTotal(matrix, r.code, y) * 100) / 100),
      itemStyle: { color: ct.color[i % ct.color.length] },
      barMaxWidth: 42,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel="연도별 지역 시장 규모" height={300} />;
}

function YearlyShareTable({ matrix }: { matrix: SizingMatrix }) {
  const { years, shares, totals } = yearlyShareMatrix(matrix);
  return (
    <table className="data-table mt-3" aria-label="연도별 권역 점유율">
      <caption className="sr-only">연도별 권역 점유율 및 글로벌 총시장</caption>
      <thead>
        <tr>
          <th scope="col">권역</th>
          {years.map((y) => <th key={y} scope="col">{y} 점유율</th>)}
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {years.map((_, y) => (
              <td key={y} className="tabular-nums">{shares[r.code][y].toFixed(1)}%</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌 총시장 ($B)</td>
          {totals.map((t, y) => <td key={y} className="tabular-nums font-semibold">{t.toFixed(2)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

function ConsistencyChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 130, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, min: 0, max: 8, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: ["매트릭스 롤업 (바텀업)", matrix.consistency.topDownCagr > 0 ? "컨센서스 (탑다운)" : "컨센서스 (미입력)"], axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "bar" as const,
      data: [
        { value: matrix.consistency.bottomUpCagr, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] } },
        { value: matrix.consistency.topDownCagr, itemStyle: { color: ct.color[2], opacity: 0.6, borderRadius: [0, 4, 4, 0] } },
      ],
      barMaxWidth: 26,
      label: { show: true, position: "right" as const, formatter: "{c}%", color: ct.muted, fontSize: 11 },
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel="가정 일관성 진단" height={140} />;
}

function RegistryStatus({ sizing, referenceImplementation }: {
  sizing: IndustryDetail["sizing"];
  referenceImplementation: string;
}) {
  const counts = useMemo(() => {
    const byPrefix: { baseline_2026: number; cagr: number } = { baseline_2026: 0, cagr: 0 };
    for (const a of sizing?.assumptions ?? []) {
      if (a.assumption_key.includes(".baseline_2026.")) byPrefix.baseline_2026++;
      else if (a.assumption_key.includes(".cagr.")) byPrefix.cagr++;
    }
    return { ...byPrefix, total: sizing?.assumptions.length ?? 0 };
  }, [sizing]);

  // 레지스트리 패널은 가정이 실제 등록된 run(현재: 유압브레이커 시드 run)에만
  // 표시한다 — isFrozen 센티널이 아니라 run_label 데이터로 판별한다 (ADR-0112).
  if (!sizing || sizing.run_label !== REGISTRY.runLabel) {
    return (
      <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">
        아직 가정 레지스트리에 등록되지 않았습니다. 분석 확정 후 {referenceImplementation} 패턴으로
        recordAssumption 등록하면 이 화면에 등록 상태가 표시됩니다.
      </p>
    );
  }
  const ok = counts.baseline_2026 === REGISTRY.expectedRows.baseline && counts.cagr === REGISTRY.expectedRows.cagr;
  return (
    <div>
      <div className="driver-derivation mb-3">
        <div className="driver-derivation-step">
          <span className={`status-chip ${ok ? "status-green" : "status-amber"}`}>{ok ? "등록 완료" : "불일치"}</span>
          <span>run <code className="text-[0.72rem]">{sizing.run_label}</code></span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">baseline {counts.baseline_2026}/{REGISTRY.expectedRows.baseline}</span>
          <span>2026 기준선 ($B)</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">cagr {counts.cagr}/{REGISTRY.expectedRows.cagr}</span>
          <span>비관/기본/낙관 밴드</span>
        </div>
      </div>
      <p className="text-[0.78rem] text-[color:var(--muted-fg)]">
        총 {counts.total} row · 전부 kind='assumed' (rationale + anchor_ref 필수, FR-DATA-07) · TTL {REGISTRY.ttlDays}일 ·
        append-only (수정 = 새 row)
      </p>
      <details className="mt-2">
        <summary className="text-[0.8rem] cursor-pointer text-[color:var(--accent)]">등록 row 전체 보기 ({counts.total}개)</summary>
        <table className="data-table mt-2" aria-label="레지스트리 등록 row">
          <caption className="sr-only">레지스트리 등록 row 목록</caption>
          <thead>
            <tr><th scope="col">assumption_key</th><th scope="col">kind</th><th scope="col">value</th><th scope="col">anchor_ref</th><th scope="col">TTL</th></tr>
          </thead>
          <tbody>
            {sizing.assumptions.map((a) => (
              <tr key={a.assumption_key}>
                <td><code className="text-[0.72rem]">{a.assumption_key}</code></td>
                <td><span className="status-chip status-in-progress">{a.kind}</span></td>
                <td className="tabular-nums">{a.value}</td>
                <td className="text-[0.72rem]">{a.anchor_ref ?? "—"}</td>
                <td className="tabular-nums">{a.ttl_days ?? "—"}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={null}>
      <MarketView />
    </Suspense>
  );
}
