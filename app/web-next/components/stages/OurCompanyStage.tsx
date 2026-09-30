"use client";

// S3 그룹/계열사 분석 본문 — ADR-0120 Wave 2 Phase C 추출(/our-company 페이지와
// /deals/[id]/s3?surface=company 탭이 동일 컴포넌트를 소비한다). StageFrame과
// main 셸은 호출자가 제공한다(공통 규칙 #6).
//
// 선택 모드: 독립 페이지(기본)는 URL ?member= 로 선택을 운반하고, embedded
// 모드는 내부 상태로 선택한다 — router를 건드리지 않는다. memberId prop으로
// 특정 계열사를 고정할 수 있다.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "../../lib/api.ts";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import { ListBackButton } from "../ListBackButton.tsx";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });
import { useConfirm, RowEdit } from "../crud.tsx";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { SectionToolbar } from "../layout.tsx";

interface GroupRow { id: string; name: string; created_at: string; member_count: number }
interface MemberRow {
  id: string; company_name: string; dart_corp_code: string | null;
  role: "hq" | "affiliate"; created_at: string; latest_version: number | null; analyzed_at: string | null;
}
interface Profile {
  companyName: string;
  dartFinancials?: { available?: boolean; year?: string; items?: Array<{ name: string; value: number; year?: string }>; reportUrl?: string; error?: string };
  strengths?: string[];
  weaknesses?: string[];
  businessAssessment?: string;
  industryExposure?: string[];
  degraded?: string | null;
  researchSources?: Array<{ title: string; url: string; snippet?: string }>;
  dataSources?: { dart: boolean; dartYear: string | null; creditReport: string | null; webResearchCount: number };
  // ── ADR-0093 확장 (schemaVersion 2) — 구 v1 payload에는 없는 optional 필드 ──
  financialAnalysis?: {
    available: boolean;
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{ year: string; revenueGrowth?: number | null; operatingMargin?: number | null; netMargin?: number | null; debtRatio?: number | null; roe?: number | null }>;
    missingAccounts: string[];
    notes: string[];
  };
  swot?: { opportunities: string[]; threats: string[] };
  // schemaVersion 3 — 공시·리서치 원문 대조 (ADR-0113)
  competitive?: {
    competitors: Array<{ name: string; note: string }>;
    positioning: string;
    degraded?: string | null;
    crossCheck?: CompetitiveCrossCheck;
  };
  industryLinkage?: Array<{
    industry: string; industryId: string | null; matrixFound: boolean;
    anchorTotalUsdB?: number | null; cagr?: number | null; externalGapPercent?: number | null;
    escalatedCagrPct?: number | null;
    qualitativeLinks?: { opportunityFactors: string[]; riskFactors: string[] };
    note?: string;
  }>;
  sectionConfidence?: Array<{ section: string; grade: string; note: string }>;
  verificationLedger?: Array<{ item: string; status: "confirmed" | "could_not_verify" | "needs_judgement"; evidence: string }>;
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
  stepSummaries?: Array<{ step: number; title: string; summary: string; source: string }>;
  schemaVersion?: number;
}
interface GroupDetail {
  group: { id: string; name: string; created_at: string };
  members: MemberRow[];
  profiles: Array<{ member_id: string; company_name: string; role: string; latest_version: number | null; profile: Profile | null }>;
}

const PROFILE_TABS = [
  ["overview", "개요"],
  ["financials", "재무"],
  ["swot", "강·약점 SWOT"],
  ["industry", "산업 연계"],
  ["competitive", "경쟁"],
  ["sources", "출처·데이터"],
] as const;

type ProfileTabKey = (typeof PROFILE_TABS)[number][0];

// ── 경쟁 포지셔닝 공시·리서치 원문 대조 (schemaVersion 3, ADR-0113) ──
type CrossCheckVerdict = "confirmed" | "directional" | "contradicted" | "unverified";
interface CompetitiveCrossCheck {
  status: "cross_checked" | "dart_unavailable" | "research_only";
  checkedAt: string;
  dartReport?: { rceptNo: string; reportNm: string; rceptDt: string; reportUrl: string } | null;
  claims: Array<{ claim: string; verdict: CrossCheckVerdict; source: string; evidence: string; url?: string }>;
  note?: string;
}

const CROSSCHECK_STATUS_META: Record<CompetitiveCrossCheck["status"], { label: string; chip: string }> = {
  cross_checked: { label: "공시 원문 대조 완료", chip: "status-green" },
  dart_unavailable: { label: "공시 대조 불가", chip: "status-amber" },
  research_only: { label: "리서치 대조만 (비상장)", chip: "status-in-progress" },
};
const CROSSCHECK_VERDICT_META: Record<CrossCheckVerdict, { label: string; chip: string }> = {
  confirmed: { label: "확인", chip: "status-green" },
  directional: { label: "방향성 일치", chip: "status-in-progress" },
  contradicted: { label: "상충", chip: "status-red" },
  unverified: { label: "검증 불가", chip: "status-amber" },
};

/** 상세 헤더 요약 칩 — 프로파일 메타 (DART·리서치·폴백 상태). */
function ProfileChips({ profile }: { profile: Profile | "loading" | undefined }) {
  if (!profile || profile === "loading") return null;
  return (
    <span className="flex items-center gap-1">
      {profile.dataSources?.dart && <span className="status-chip status-green">DART {profile.dataSources.dartYear ?? ""}</span>}
      {(profile.dataSources?.webResearchCount ?? 0) > 0 && <span className="status-chip status-in-progress">외부 리서치 {profile.dataSources!.webResearchCount}건</span>}
      {profile.degraded && <span className="status-chip status-amber" title={profile.degraded}>부분 분석(폴백)</span>}
    </span>
  );
}

export function OurCompanyStage({ memberId: memberIdProp, embedded }: { memberId?: string; embedded?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const urlSync = !embedded;
  const [localMember, setLocalMember] = useState<string | null>(memberIdProp ?? null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberForm, setMemberForm] = useState({ company_name: "", dart_corp_code: "", role: "affiliate" as "hq" | "affiliate" });
  // 계열사 등록 — DART 자동 검색 (시너지 정합성의 dart-search API 재사용)
  const [dartSearching, setDartSearching] = useState(false);
  const [dartResults, setDartResults] = useState<Array<{ corp_code: string; corp_name: string; source?: "dart" | "local" | "web"; validated?: boolean | null }>>([]);
  const [editGroupName, setEditGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  // 행 통합 편집 모드 — 액션 셀의 "수정" 하나로 시작·종료 (ADR-0083: 행 액션은 액션 셀로 모임)
  const [editMember, setEditMember] = useState<{ id: string; name: string; dart: string } | null>(null);
  const [savingMember, setSavingMember] = useState(false);
  // 역할(지주/HQ·계열사) 인라인 변경 중인 member id — 행별 저장 표시용.
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [uploadingMember, setUploadingMember] = useState<string | null>(null);
  const [uploadedNames, setUploadedNames] = useState<Record<string, string>>({});
  const [openMember, setOpenMember] = useState<string | null>(null);

  // 경쟁사 레지스트리 (ADR-0142) — 확정 목록은 사람의 수용/등록으로만 생기고,
  // payload 경쟁사는 "제안"으로만 표시된다.
  interface CompetitorRowView {
    id: string; name: string; dart_corp_code: string | null; note: string | null;
    status: "confirmed" | "excluded"; exclusion_reason: string | null;
    discovery_source: "manual" | "ai_proposal"; proposal_accepted_at: string;
    crosscheck_verdict: string | null; evidence_json: string | null;
  }
  interface CompetitorProposalView {
    name: string; note: string; verdict: string | null;
    evidence: Array<{ title: string | null; url: string }>; accepted: boolean;
  }
  const [competitors, setCompetitors] = useState<CompetitorRowView[] | null>(null);
  const [competitorProposals, setCompetitorProposals] = useState<CompetitorProposalView[] | null>(null);
  const [dismissedProposals, setDismissedProposals] = useState<string[]>([]);
  const [compBusy, setCompBusy] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [excludingCompetitor, setExcludingCompetitor] = useState<{ id: string; reason: string } | null>(null);
  const [editingCompetitor, setEditingCompetitor] = useState<{ id: string; note: string; dart: string } | null>(null);
  const [competitorForm, setCompetitorForm] = useState({ name: "", dart_corp_code: "", note: "" });
  const [competitorDartSearching, setCompetitorDartSearching] = useState(false);
  const [competitorDartResults, setCompetitorDartResults] = useState<Array<{ corp_code: string; corp_name: string; source?: string; validated?: boolean | null }>>([]);
  // 웹검색 재제안 (ADR-0142 후속) — 실검색 근거 기반 제안(저장 없음, 수용은 사람)
  interface WebSuggestionView { name: string; note: string; reliability: "A" | "B" | "C"; sources: Array<{ title: string; url: string }> }
  const [webSuggestions, setWebSuggestions] = useState<WebSuggestionView[] | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webNote, setWebNote] = useState<string | null>(null);

  const [profileTab, setProfileTab] = useState<ProfileTabKey>("overview");
  const [profiles, setProfiles] = useState<Record<string, Profile | "loading">>({});
  // 산업 연계 탭 — S1 시장분석 미보유 산업에 대한 분석 요청 상태
  const [s1Requests, setS1Requests] = useState<Record<string, { status: "creating" | "created"; industryId?: string; error?: string }>>({});
  // 상세 상단 "시너지 분석" 버튼 — 이 계열사의 기존 시너지 분석 id (없으면 /synergy 랜딩)
  const [synergyLink, setSynergyLink] = useState<{ analysisId: string | null; checked: boolean }>({ analysisId: null, checked: true });
  const { confirm, confirmDialog } = useConfirm();
  const ct = useChartTheme(); // 리포트 차트 테마 — 훅은 최상위에서 1회만 호출

  // 시너지 정합성과 동일한 선택→상세 흐름: ?member=<id> 가 상태의 유일한 원본
  const openDetail = useCallback((memberId: string) => {
    if (urlSync) router.replace(`/our-company?member=${encodeURIComponent(memberId)}`);
    else setLocalMember(memberId);
    setOpenMember(memberId);
    if (!profiles[memberId] || profiles[memberId] === "loading") void loadProfile(memberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSync, router, loadProfile]);

  const backToList = useCallback(() => {
    if (urlSync) router.replace("/our-company");
    else setLocalMember(null);
    setOpenMember(null);
  }, [urlSync, router]);

  // ── 경쟁사 레지스트리 액션 (ADR-0142) ──────────────────────────────
  const loadCompetitors = useCallback((memberId: string) => {
    api.get<{ competitors: CompetitorRowView[] }>(`/api/our-company/members/${encodeURIComponent(memberId)}/competitors`)
      .then((r) => setCompetitors(r.data.competitors)).catch(() => setCompetitors([]));
    api.get<{ proposals: CompetitorProposalView[] }>(`/api/our-company/members/${encodeURIComponent(memberId)}/competitor-proposals`)
      .then((r) => setCompetitorProposals(r.data.proposals)).catch(() => setCompetitorProposals([]));
  }, []);

  useEffect(() => {
    if (!openMember) return;
    setDismissedProposals([]);
    setExcludingCompetitor(null);
    setEditingCompetitor(null);
    loadCompetitors(openMember);
  }, [openMember, loadCompetitors]);

  async function acceptProposal(name: string) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, { name, discovery_source: "ai_proposal" });
      setDismissedProposals((prev) => [...prev, name]);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 수용 실패");
    } finally {
      setCompBusy(false);
    }
  }

  async function runCompetitorWebSearch() {
    if (!openMember || webBusy) return;
    setWebBusy(true); setCompError(null);
    try {
      const r = await api.post<{ source: "llm" | "llm_knowledge"; note: string; suggestions: WebSuggestionView[] }>(`/api/our-company/members/${encodeURIComponent(openMember)}/competitor-proposals/web-search`, {});
      setWebSuggestions(r.data.suggestions ?? []);
      setWebNote(r.data.note ?? null);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "웹검색 재제안 실패");
    } finally {
      setWebBusy(false);
    }
  }

  async function acceptWebSuggestion(ws: WebSuggestionView) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, {
        name: ws.name,
        note: ws.note || null,
        discovery_source: "ai_proposal",
        evidence: ws.sources.map((s) => ({ title: s.title, url: s.url })),
      });
      setWebSuggestions((prev) => (prev ?? []).filter((x) => x.name !== ws.name));
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 수용 실패");
    } finally {
      setCompBusy(false);
    }
  }

  async function registerManualCompetitor() {
    if (!openMember || compBusy || !competitorForm.name.trim()) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, {
        name: competitorForm.name,
        dart_corp_code: competitorForm.dart_corp_code || null,
        note: competitorForm.note || null,
        discovery_source: "manual",
      });
      setCompetitorForm({ name: "", dart_corp_code: "", note: "" });
      setCompetitorDartResults([]);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 등록 실패");
    } finally {
      setCompBusy(false);
    }
  }

  async function searchCompetitorDart() {
    const q = competitorForm.name.trim();
    if (!q || competitorDartSearching) return;
    setCompetitorDartSearching(true); setCompError(null);
    try {
      const res = await api.get<{ configured: boolean; results: Array<{ corp_code: string; corp_name: string; source?: string; validated?: boolean | null }>; error?: string }>(`/api/synergy/dart-search?q=${encodeURIComponent(q)}`);
      setCompetitorDartResults(res.data.results ?? []);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "DART 검색 실패");
    } finally {
      setCompetitorDartSearching(false);
    }
  }

  async function saveCompetitorExclude() {
    if (!openMember || !excludingCompetitor?.reason.trim() || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(excludingCompetitor.id)}/exclude`, { reason: excludingCompetitor.reason.trim() });
      setExcludingCompetitor(null);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 제외 실패");
    } finally {
      setCompBusy(false);
    }
  }

  async function restoreCompetitorRow(id: string) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(id)}/restore`, {});
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 복원 실패");
    } finally {
      setCompBusy(false);
    }
  }

  async function saveCompetitorEdit() {
    if (!openMember || !editingCompetitor || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.patch(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(editingCompetitor.id)}`, {
        note: editingCompetitor.note || null,
        dart_corp_code: editingCompetitor.dart || null,
      });
      setEditingCompetitor(null);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : "경쟁사 수정 실패");
    } finally {
      setCompBusy(false);
    }
  }

  // ADR-0094 역할 분리 — 프로파일 완성 후 시너지·전략적 적합성(/synergy)으로 이동.
  // 이 계열사를 대상으로 한 기존 분석이 있으면 상세로 딥링크한다.
  useEffect(() => {
    if (!openMember) return;
    setSynergyLink({ analysisId: null, checked: false });
    api.get<{ analyses: Array<{ id: string; member_id?: string | null; group_id?: string | null }> }>("/api/synergy/analyses")
      .then((r) => setSynergyLink({ analysisId: r.data.analyses.find((a) => a.member_id === openMember)?.id ?? null, checked: true }))
      .catch(() => setSynergyLink({ analysisId: null, checked: true }));
  }, [openMember]);

  const memberIdParam = urlSync ? searchParams.get("member") : localMember;
  useEffect(() => {
    if (memberIdParam && memberIdParam !== openMember) {
      setOpenMember(memberIdParam);
      if (!profiles[memberIdParam] || profiles[memberIdParam] === "loading") void loadProfile(memberIdParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIdParam]);

  const loadGroups = useCallback(() => {
    api.get<{ groups: GroupRow[] }>("/api/our-company/groups").then((r) => setGroups(r.data.groups)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadGroup = useCallback((id: string) => {
    api.get<GroupDetail>(`/api/our-company/groups/${encodeURIComponent(id)}`).then((r) => setSelectedGroup(r.data)).catch((e) => setError(e instanceof Error ? e.message : "그룹 불러오기 실패"));
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // 열려있는 계열사 프로파일 폴링 — 분석 완료 시 자동 반영, 실패 시 사용자에게 보고
  useEffect(() => {
    if (!selectedGroup || !openMember) return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<{ profile: Profile | null; status: string; error?: string }>(`/api/our-company/members/${openMember}/profile`);
        if (r.data.status === "completed" && r.data.profile) {
          setProfiles((prev) => ({ ...prev, [openMember]: r.data.profile! }));
          loadGroup(selectedGroup.group.id);
        } else if (r.data.status === "failed") {
          // 파이프라인이 죽으면 version이 생기지 않는다 — 실패를 보고하지 않으면 "분석 중..."에 영구 머문다.
          setError(`분석 실패 — ${r.data.error ?? "알 수 없는 오류"}. 재분석을 실행하세요.`);
          setProfiles((prev) => { const n = { ...prev }; delete n[openMember]; return n; });
        }
      } catch { /* 다음 폴링에서 재시도 */ }
    }, 4000);
    return () => clearInterval(t);
  }, [selectedGroup, openMember, loadGroup]);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ id: string }>("/api/our-company/groups", { name: groupName.trim() });
      setGroupName(""); setShowGroupForm(false);
      loadGroups();
      loadGroup(res.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "그룹 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function searchMemberDart() {
    const q = memberForm.company_name.trim();
    if (!q || dartSearching) return;
    setDartSearching(true);
    setError(null);
    try {
      const res = await api.get<{ configured: boolean; results: Array<{ corp_code: string; corp_name: string; source?: "dart" | "local" | "web"; validated?: boolean | null }>; error?: string }>(`/api/synergy/dart-search?q=${encodeURIComponent(q)}`);
      setDartResults(res.data.results);
      if (!res.data.configured) setError("DART API 키가 구성되지 않았습니다 — DART 고유번호 수동 입력으로 진행하세요.");
      else if (res.data.error) setError(res.data.error);
      else if (res.data.results.length === 0) setError("DART 검색 결과가 없습니다 — DART 고유번호를 수동 입력하거나 비상장으로 등록하세요.");
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DART 검색 실패");
    } finally {
      setDartSearching(false);
    }
  }

  async function saveGroupName() {
    if (!selectedGroup || !groupNameDraft.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/our-company/groups/${selectedGroup.group.id}`, { name: groupNameDraft.trim() });
      setEditGroupName(false);
      loadGroup(selectedGroup.group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "그룹명 수정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedGroup || !memberForm.company_name.trim() || busy) return;
    // DART 미입력 경고 — 상장·외감 계열사는 DART 고유번호 확인 권장, 비상장은 확인 후 등록
    if (!memberForm.dart_corp_code.trim()) {
      confirm(
        `"${memberForm.company_name.trim()}" DART 고유번호 미입력`,
        () => void doAddMember(),
        {
          body: "[🔍 DART 검색]으로 DART 고유번호를 찾거나, 비상장이라면 등록을 눌러 리서치 기반으로 등록합니다.",
          confirmLabel: "등록",
        },
      );
      return;
    }
    void doAddMember();
  }

  async function doAddMember() {
    if (!selectedGroup || !memberForm.company_name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/our-company/groups/${selectedGroup.group.id}/members`, {
        company_name: memberForm.company_name.trim(),
        dart_corp_code: memberForm.dart_corp_code.trim() || undefined,
        role: memberForm.role,
      });
      setMemberForm({ company_name: "", dart_corp_code: "", role: "affiliate" });
      setShowMemberForm(false);
      loadGroup(selectedGroup.group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계열사 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  function removeMember(memberId: string) {
    if (!selectedGroup) return;
    const m = selectedGroup.members.find((x) => x.id === memberId);
    confirm(
      `${m?.company_name ?? "계열사"} 삭제`,
      async () => {
        try {
          await api.delete(`/api/our-company/groups/${selectedGroup.group.id}/members`, { member_id: memberId });
          if (openMember === memberId) backToList();
          loadGroup(selectedGroup.group.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "계열사 삭제 실패");
        }
      },
      { body: "삭제 표시로 전환됩니다. 데이터는 보존되어 감사 시 열람할 수 있으며, 목록과 분석 화면에서는 사라집니다." },
    );
  }

  function removeGroup(groupId: string, name: string) {
    confirm(
      `${name} 삭제`,
      async () => {
        try {
          await api.delete(`/api/our-company/groups/${groupId}`);
          setSelectedGroup(null);
          void loadGroups();
        } catch (err) {
          setError(err instanceof Error ? err.message : "그룹 삭제 실패");
        }
      },
      { body: "이 그룹과 소속 계열사 전체가 삭제 표시로 전환됩니다. 데이터는 보존되어 감사 시 열람할 수 있습니다." },
    );
  }

  function startMemberEdit(memberId: string, name: string, dart: string | null) {
    setEditMember({ id: memberId, name, dart: dart ?? "" });
  }

  async function saveMemberEdit() {
    if (!selectedGroup || !editMember || savingMember) return;
    const name = editMember.name.trim();
    if (!name) { setError("회사명은 필수입니다."); return; }
    setSavingMember(true);
    setError(null);
    try {
      await api.patch(`/api/our-company/groups/${selectedGroup.group.id}/members`, {
        member_id: editMember.id,
        company_name: name,
        dart_corp_code: editMember.dart.trim() || null,
      });
      setEditMember(null);
      loadGroup(selectedGroup.group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계열사 정보 저장 실패");
    } finally {
      setSavingMember(false);
    }
  }

  // 역할(지주/HQ·계열사) 인라인 변경 — 기존 members PATCH 재사용. 즉시 저장된다.
  async function updateMemberRole(memberId: string, role: "hq" | "affiliate") {
    if (!selectedGroup || savingRole) return;
    setSavingRole(memberId);
    setError(null);
    try {
      await api.patch(`/api/our-company/groups/${selectedGroup.group.id}/members`, { member_id: memberId, role });
      loadGroup(selectedGroup.group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "역할 변경 실패");
      loadGroup(selectedGroup.group.id); // 실패 시 서버 값으로 되돌린다
    } finally {
      setSavingRole(null);
    }
  }

  async function uploadMemberFile(memberId: string, file: File) {
    setUploadingMember(memberId);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.upload<{ original_name: string }>(`/api/our-company/members/${memberId}/upload`, form);
      setUploadedNames((prev) => ({ ...prev, [memberId]: res.data.original_name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploadingMember(null);
    }
  }

  async function analyzeMember(memberId: string) {
    setProfiles((prev) => ({ ...prev, [memberId]: "loading" }));
    setOpenMember(memberId);
    setProfileTab("overview");
    setError(null);
    // 분석 시작은 멱등적(재호출 시 파이프라인 재실행)이므로, dev 재컴파일 창의
    // 빈 응답(invalid_response)에 한해 1회 재시도한다 — 그 외 에러는 그대로 보고.
    const start = () => api.post(`/api/our-company/members/${memberId}/analyze`, {});
    try {
      await start();
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_response") {
        try {
          await new Promise((resolve) => setTimeout(resolve, 800));
          await start();
          return;
        } catch (retryErr) {
          err = retryErr;
        }
      }
      setError(err instanceof Error ? err.message : "분석 시작 실패");
      // 시작 실패 시 loading 상태를 지우지 않으면 버튼이 "분석 중..."에 영구 머문다.
      setProfiles((prev) => { const n = { ...prev }; delete n[memberId]; return n; });
    }
  }

  async function loadProfile(memberId: string) {
    setProfiles((prev) => ({ ...prev, [memberId]: "loading" }));
    try {
      const r = await api.get<{ profile: Profile | null; versions?: unknown; status: string }>(`/api/our-company/members/${memberId}/profile`);
      if (r.data.profile) setProfiles((prev) => ({ ...prev, [memberId]: r.data.profile! }));
      else setProfiles((prev) => { const n = { ...prev }; delete n[memberId]; return n; });
    } catch { /* 프로파일 없음 */ }
  }

  // 산업 연계 탭 — S1 시장분석이 없는 산업에 신규 분석을 요청한다(8단계 파이프라인,
  // analyst+ 권한). 완료 여부·세부 결과는 /market 리포트에서 확인한다.
  async function requestS1Analysis(industry: string) {
    setS1Requests((prev) => ({ ...prev, [industry]: { status: "creating" } }));
    setError(null);
    try {
      const r = await api.post<{ analysis_id: string; reused: boolean }>("/api/market-overview/analyses", { name_ko: industry });
      const industryId = await api.get<{ industries: Array<{ id: string; name_ko: string }> }>("/api/market-overview")
        .then((res) => res.data.industries.find((i) => i.name_ko === industry)?.id);
      setS1Requests((prev) => ({ ...prev, [industry]: { status: "created", industryId } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "S1 분석 요청 실패");
      setS1Requests((prev) => { const n = { ...prev }; delete n[industry]; return n; });
    }
  }

  return (
    <>
      {confirmDialog}

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {!openMember && (
      <>
      {/* ── 그룹 선택 ── */}
      <section aria-label="그룹" className="market-section">
        <SectionToolbar
          title="분석 대상 그룹"
          icon="🏢"
          actions={
            canAct ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowGroupForm((v) => !v); setShowMemberForm(false); }}
                aria-expanded={showGroupForm}
              >
                ＋ 그룹 등록
              </button>
            ) : undefined
          }
        />
        {canAct && showGroupForm && (
          <form onSubmit={createGroup} className="sizing-new-form mb-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">그룹명 *</span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 테크크로스 그룹" required className="sizing-new-input" autoFocus />
              </label>
              <button type="submit" className="btn-ghost btn-sm" disabled={busy || !groupName.trim()}>등록</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setShowGroupForm(false)}>취소</button>
            </div>
          </form>
        )}
        {groups === null ? (
          <p>불러오는 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">등록된 그룹이 없습니다. "＋ 그룹 등록"으로 시작하세요.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={selectedGroup?.group.id === g.id}
                className={`sizing-industry-chip ${selectedGroup?.group.id === g.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => { backToList(); loadGroup(g.id); }}
              >
                <span className="font-semibold">{g.name}</span>
                <span className="sizing-chip-meta">계열사 {g.member_count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── 그룹 상세: 계열사 테이블 ── */}
      {selectedGroup && (
        <section aria-label="계열사" className="market-section">
          <SectionToolbar
            title={editGroupName ? undefined : `${selectedGroup.group.name} 계열사`}
            icon={editGroupName ? undefined : "🏭"}
            count={selectedGroup.members.length}
            actions={
              editGroupName ? (
                <span className="flex items-center gap-1">
                  <input
                    aria-label="그룹명 수정"
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    className="sizing-new-input sizing-new-input-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") void saveGroupName(); }}
                  />
                  <button type="button" className="btn-ghost btn-sm" disabled={busy || !groupNameDraft.trim()} onClick={() => saveGroupName()}>저장</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditGroupName(false)}>취소</button>
                </span>
              ) : !canAct ? undefined : (
                <>
                  <button type="button" className="btn-ghost btn-sm" title="그룹명 수정" onClick={() => { setGroupNameDraft(selectedGroup.group.name); setEditGroupName(true); }}>수정</button>
                  <button type="button" className="btn-danger btn-sm" title="이 그룹과 소속 계열사 전체를 삭제합니다" onClick={() => removeGroup(selectedGroup.group.id, selectedGroup.group.name)}>삭제</button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setShowMemberForm((v) => !v); setShowGroupForm(false); }}
                    aria-expanded={showMemberForm}
                  >
                    ＋ 계열사 등록
                  </button>
                </>
              )
            }
          />
          {canAct && showMemberForm && (
            <form onSubmit={addMember} aria-label="계열사 등록" className="sizing-new-form mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]">
                  <span className="block mb-1">회사명 *</span>
                  <span className="flex items-center gap-1">
                    <input value={memberForm.company_name} onChange={(e) => { setMemberForm({ ...memberForm, company_name: e.target.value }); setDartResults([]); }} required className="sizing-new-input" autoFocus />
                    <button type="button" className="btn-ghost btn-sm" disabled={dartSearching || !memberForm.company_name.trim()} onClick={() => void searchMemberDart()}>
                      {dartSearching ? "검색 중..." : "🔍 DART 검색"}
                    </button>
                  </span>
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">DART 고유번호</span>
                  <input value={memberForm.dart_corp_code} onChange={(e) => setMemberForm({ ...memberForm, dart_corp_code: e.target.value })} placeholder="자동 검색 또는 8자리 직접 입력" className="sizing-new-input sizing-new-input-sm" />
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">역할</span>
                  <select value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as "hq" | "affiliate" })} className="sizing-new-input sizing-new-input-sm">
                    <option value="affiliate">계열사</option>
                    <option value="hq">지주/HQ</option>
                  </select>
                </label>
                <button type="submit" className="btn-ghost btn-sm" disabled={busy || !memberForm.company_name.trim()}>등록</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMemberForm(false)}>취소</button>
              </div>
              {dartResults.length > 0 && (
                <ul className="sizing-note-list mt-2" role="listbox" aria-label="DART 검색 결과">
                  {dartResults.map((r) => (
                    <li key={r.corp_code}>
                      <button
                        type="button"
                        aria-pressed={memberForm.dart_corp_code === r.corp_code}
                        className={`btn-ghost btn-sm w-full text-left ${memberForm.dart_corp_code === r.corp_code ? "font-semibold" : ""}`}
                        onClick={() => setMemberForm((prev) => ({ ...prev, dart_corp_code: r.corp_code, company_name: r.corp_name }))}
                      >
                        {memberForm.dart_corp_code === r.corp_code ? "✔ " : ""}{r.corp_name} <code className="dd-item-id">{r.corp_code}</code>
                        {r.source === "web" && (
                          <span className={`status-chip ml-1 ${r.validated ? "status-green" : "status-amber"}`} title={r.validated ? "DART 기업개황으로 이름 일치 확인" : "웹 검색 폴백 — DART 역조회 실패(다중 소스 일치)"}>
                            웹 {r.validated ? "✔교차검증" : "미검증"}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                DART 고유번호는 시너지 정합성 화면의 DART 검색으로 확인하거나 비워둘 수 있습니다(비상장 — 리서치 기반 분석).
              </p>
            </form>
          )}
          {selectedGroup.members.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">계열사가 없습니다. "＋ 계열사 등록"으로 추가하세요.</p>
          ) : (
            <table className="data-table list-table" aria-label="계열사 목록">
              <caption className="sr-only">계열사 목록</caption>
              <thead>
                <tr>
                  <th scope="col">회사명</th><th scope="col" className="w-[5rem]">역할</th><th scope="col" className="w-[8rem]">DART 고유번호</th>
                  <th scope="col" className="w-[11rem]">분석 상태</th><th scope="col" className="col-date">분석일</th>
                  <th scope="col" className="w-[13rem]"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.members.map((m) => {
                  const analyzed = m.latest_version !== null;
                  const isOpen = openMember === m.id;
                  const isEditing = editMember?.id === m.id;
                  return (
                    <tr key={m.id} className={isOpen ? "row-selected" : undefined}>
                      <td className="cell-primary">
                        {isEditing ? (
                          <RowEdit
                            editing
                            value={editMember.name}
                            onChange={(v) => setEditMember((prev) => (prev ? { ...prev, name: v } : prev))}
                            onSave={() => saveMemberEdit()}
                            onCancel={() => setEditMember(null)}
                            saving={savingMember}
                            ariaLabel={`${m.company_name} 회사명 수정`}
                          />
                        ) : (
                          <button
                            type="button"
                            className="font-semibold text-left underline-offset-2 hover:underline"
                            title={analyzed ? "프로파일 리포트 열기" : "프로파일 분석 후 열립니다"}
                            onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}
                          >
                            {m.company_name}
                          </button>
                        )}
                      </td>
                      <td>
                        {/* 역할 인라인 변경 — 즉시 저장(PATCH members). viewer는
                            서버가 403으로 막는다. */}
                        <select
                          aria-label={`${m.company_name} 역할 변경`}
                          value={m.role}
                          disabled={savingRole === m.id}
                          onChange={(e) => void updateMemberRole(m.id, e.target.value as "hq" | "affiliate")}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="affiliate">계열사</option>
                          <option value="hq">지주/HQ</option>
                        </select>
                      </td>
                      <td>
                        {isEditing ? (
                          <RowEdit
                            editing
                            value={editMember.dart}
                            onChange={(v) => setEditMember((prev) => (prev ? { ...prev, dart: v } : prev))}
                            onSave={() => saveMemberEdit()}
                            onCancel={() => setEditMember(null)}
                            saving={savingMember}
                            ariaLabel={`${m.company_name} DART 고유번호 수정`}
                            width="6rem"
                            placeholder="8자리 고유번호"
                          />
                        ) : m.dart_corp_code ? (
                          <code className="dd-item-id">{m.dart_corp_code}</code>
                        ) : (
                          <span className="status-chip status-amber" title="DART 고유번호 미확인 — 행 액션의 수정으로 입력하세요">고유번호 미확인</span>
                        )}
                      </td>
                      <td>
                        {analyzed ? (
                          <span className="status-chip status-green">분석 완료 (v{m.latest_version})</span>
                        ) : (
                          <span className="status-chip status-not-started">분석 대기</span>
                        )}
                      </td>
                      <td className="col-date tabular-nums">{m.analyzed_at ? m.analyzed_at.slice(0, 10) : "—"}</td>
                      <td className="sizing-actions-cell"><span className="actions-row">
                        {/* 행 액션 표준 순서: 열기 → 재분석 → 수정(저장/취소) → 삭제 */}
                        {analyzed && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}
                          >
                            {isOpen ? "닫기" : "열기"}
                          </button>
                        )}
                        {canAct && (
                        <button type="button" className="btn-ghost btn-sm" disabled={profiles[m.id] === "loading"} onClick={() => analyzeMember(m.id)}>
                          {profiles[m.id] === "loading" ? "분석 중..." : analyzed ? "재분석" : "분석"}
                        </button>
                        )}
                        {!canAct ? null : isEditing ? (
                          <>
                            <button type="button" className="btn-ghost btn-sm" disabled={savingMember} onClick={() => saveMemberEdit()}>
                              {savingMember ? "저장 중..." : "저장"}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditMember(null)}>취소</button>
                          </>
                        ) : (
                          <button type="button" className="btn-ghost btn-sm" title="회사명·DART 고유번호 수정" onClick={() => startMemberEdit(m.id, m.company_name, m.dart_corp_code)}>
                            수정
                          </button>
                        )}
                        {canAct && (
                        <label className="btn-ghost btn-sm cursor-pointer" title="신용평가자료 등 근거 파일 업로드">
                          {uploadingMember === m.id ? "업로드 중..." : "근거파일"}
                          <input
                            type="file"
                            aria-label={`${m.company_name} 근거 파일 업로드`}
                            className="hidden"
                            disabled={uploadingMember === m.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMemberFile(m.id, f); }}
                          />
                        </label>
                        )}
                        {canAct && (
                        <button type="button" className="btn-danger btn-sm" title="이 계열사를 삭제합니다" onClick={() => removeMember(m.id)}>
                          삭제
                        </button>
                        )}
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── 계열사 간 시너지 매트릭스 (산업 노출 겹침 기반) ── */}
      {selectedGroup && (() => {
        const withProfiles = selectedGroup.profiles.filter((p) => p.profile);
        if (withProfiles.length < 2) return null;
        const pairs: Array<{ a: string; b: string; shared: string[]; score: number }> = [];
        for (let i = 0; i < withProfiles.length; i++) {
          for (let j = i + 1; j < withProfiles.length; j++) {
            const pa = withProfiles[i].profile!;
            const pb = withProfiles[j].profile!;
            const ea = new Set(pa.industryExposure ?? []);
            const eb = new Set(pb.industryExposure ?? []);
            const shared = [...ea].filter((x) => eb.has(x));
            // 산업 노출 겹침 비율 기반 시너지 점수 (0-100, 정성 지표)
            const union = new Set([...ea, ...eb]).size;
            const score = union === 0 ? 0 : Math.min(100, Math.round(((shared.length / union) * 100) * 1.5));
            if (shared.length > 0) pairs.push({ a: withProfiles[i].company_name, b: withProfiles[j].company_name, shared, score });
          }
        }
        if (pairs.length === 0) return null;
        pairs.sort((x, y) => y.score - x.score);
        return (
          <section aria-label="계열사 간 시너지" className="market-section">
            <div className="section-toolbar"><span className="section-title"><h2>🔗 계열사 간 시너지 매트릭스 — 산업 노출 겹침 기준</h2></span></div>
            <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
              각 계열사 프로파일의 산업 노출(industryExposure)이 겹치는 정도를 시너지 후보 지표로 환산한 정성 매트릭스입니다.
              겹침이 있는 계열사 쌍이 상위 표시됩니다 — 공동 R&BD·제휴·수직 통합 후보 발굴의 입력으로 활용하세요.
            </p>
            <table className="data-table" aria-label="계열사 간 시너지">
              <caption className="sr-only">계열사 간 시너지 매트릭스</caption>
              <thead>
                <tr><th scope="col">계열사 A</th><th scope="col">계열사 B</th><th scope="col">겹치는 산업</th><th scope="col" className="w-[7rem]">시너지 지표</th></tr>
              </thead>
              <tbody>
                {pairs.map((pr) => (
                  <tr key={`${pr.a}-${pr.b}`}>
                    <td className="font-semibold">{pr.a}</td>
                    <td className="font-semibold">{pr.b}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {pr.shared.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
                      </div>
                    </td>
                    <td className="tabular-nums">
                      <span className={`status-chip ${pr.score >= 60 ? "status-green" : pr.score >= 30 ? "status-amber" : "status-not-started"}`}>{pr.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })()}

      </>
      )}

      {/* ── 계열사 리포트 (상세 전용 뷰 — 시너지 정합성과 동일 흐름) ── */}
      {openMember && (
        <section aria-label="계열사 프로파일 리포트" className="market-section sizing-step">
          <SectionToolbar
            title="계열사 프로파일 분석"
            icon="🏢"
            summary={<ProfileChips profile={profiles[openMember]} />}
            actions={
              <>
                {profiles[openMember] && profiles[openMember] !== "loading" && (
                  <Link
                    href={synergyLink.analysisId ? `/synergy?company=${encodeURIComponent(synergyLink.analysisId)}` : "/synergy"}
                    className="btn-ghost"
                    title="이 계열사를 대상으로 시너지·전략적 적합성 분석을 진행합니다"
                  >
                    시너지 분석 →
                  </Link>
                )}
                {canAct && (
                <button type="button" className="btn-ghost" disabled={profiles[openMember] === "loading"} onClick={() => analyzeMember(openMember)}>
                  {profiles[openMember] === "loading" ? "분석 중..." : "재분석"}
                </button>
                )}
                <ListBackButton onClick={backToList} />
              </>
            }
          />
          {profiles[openMember] === "loading" && <p className="text-[0.85rem]" role="status">분석 중입니다 — 완료되면 자동으로 표시됩니다.</p>}
          {profiles[openMember] && profiles[openMember] !== "loading" && (() => {
        const profile = profiles[openMember] as Profile;
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className="text-[0.95rem] !mb-0">🏢 {profile.companyName} 프로파일</h2>
              {profile.dataSources?.dart && <span className="status-chip status-green">DART {profile.dataSources.dartYear ?? ""}</span>}
              {(profile.dataSources?.webResearchCount ?? 0) > 0 && <span className="status-chip status-in-progress">외부 리서치 {profile.dataSources!.webResearchCount}건</span>}
              {profile.degraded && <span className="status-chip status-amber" title={profile.degraded}>부분 분석(폴백) — 재분석 권장</span>}
            </div>
            <div className="library-tabs" role="tablist" aria-label="프로파일 섹션">
              {PROFILE_TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={profileTab === key} className={`library-tab ${profileTab === key ? "library-tab-active" : ""}`} onClick={() => setProfileTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            {profileTab === "overview" && (
              <div className="text-[0.88rem]">
                {profile.ragCapRecommendation && (
                  <div className="sizing-grade-card mb-3">
                    <h4 className="text-[0.9rem] mb-2">🚦 신뢰도 상한 권고</h4>
                    <span className={`status-chip ${profile.ragCapRecommendation.grade === "green" ? "status-green" : profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                      상한 {profile.ragCapRecommendation.grade.toUpperCase()}
                    </span>
                    <p className="mt-2 mb-0 text-[0.85rem]">{profile.ragCapRecommendation.rationale}</p>
                  </div>
                )}
                <h3 className="sizing-step-title text-[0.95rem]">종합 평가</h3>
                <p className="mb-3">{profile.businessAssessment || "—"}</p>
                <h3 className="sizing-step-title text-[0.95rem]">산업 노출</h3>
                {profile.industryExposure && profile.industryExposure.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
                  </div>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-3">산업 노출 정보 없음</p>
                )}
                {!profile.schemaVersion && (
                  <p className="sizing-note-list text-[0.78rem] text-[color:var(--amber-fg)]" role="note">
                    ⚠ 이 프로파일은 확장 분석(SWOT·산업 연계·신뢰도) 적용 이전 버전입니다 — <strong>재분석</strong>을 실행하면 전체 리포트가 생성됩니다.
                  </p>
                )}
              </div>
            )}

            {profileTab === "financials" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">재무 현황 {profile.dartFinancials?.available ? `(DART ${profile.dartFinancials.year ?? ""}년)` : "(DART 미입수)"}</h3>
                {profile.dartFinancials?.available && profile.dartFinancials.items ? (() => {
                  const items = profile.dartFinancials.items;
                  const years = [...new Set(items.map((i) => i.year ?? ""))].filter(Boolean).sort().reverse();
                  const accounts = [...new Set(items.map((i) => i.name))];
                  const byKey = new Map(items.map((i) => [`${i.year}|${i.name}`, i.value]));
                  const fmtEok = (v: number) => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
                                    const chartOption = {
                    tooltip: { trigger: "axis" as const },
                    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                    grid: { left: 60, right: 16, top: 32, bottom: 28 },
                    xAxis: { type: "category" as const, data: accounts, axisLabel: { color: ct.muted, fontSize: 11, interval: 0, rotate: accounts.length > 6 ? 20 : 0 } },
                    yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${fmtEok(v)}억` }, splitLine: { lineStyle: { color: ct.split } } },
                    series: years.map((y, i) => ({
                      name: y,
                      type: "bar" as const,
                      data: accounts.map((a) => byKey.get(`${y}|${a}`) ?? null),
                      itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] },
                    })),
                  };
                  return (
                    <>
                      <div className="report-chart-card">
                        <EChartsCore option={chartOption} style={{ height: 300 }} />
                        <p className="mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">단위: 억원 · 출처: DART 사업보고서</p>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table report-table" aria-label="DART 재무 요약 (계정 × 연도)">
                          <caption className="sr-only">DART 재무 요약 (계정 × 연도)</caption>
                          <thead>
                            <tr><th scope="col" className="col-label">계정</th>{years.map((y) => <th key={y} scope="col" className="col-num">{y}</th>)}</tr>
                          </thead>
                          <tbody>
                            {accounts.map((a) => (
                              <tr key={a}>
                                <td className="col-label font-semibold">{a}</td>
                                {years.map((y) => {
                                  const v = byKey.get(`${y}|${a}`);
                                  return <td key={y} className="col-num tabular-nums">{v !== undefined ? `${fmtEok(v)} 억원` : "—"}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[0.72rem] text-[color:var(--muted-fg)]">출처: <span className="status-chip status-green">DART</span> 전자공시 사업보고서{profile.dartFinancials?.reportUrl ? <> — <a href={profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a></> : null}</p>
                    </>
                  );
                })() : (
                  <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">{profile.dartFinancials?.error ?? "재무 데이터 없음"}</p>
                )}
                {profile.financialAnalysis && (
                  profile.financialAnalysis.available ? (
                    <>
                      <h3 className="sizing-step-title text-[0.95rem] mt-4">재무 비율·추세 (결정론 산출)</h3>
                      <div className="report-chart-card">
                        <EChartsCore
                          option={{
                            tooltip: { trigger: "axis" as const },
                            legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                            grid: { left: 60, right: 16, top: 32, bottom: 28 },
                            xAxis: { type: "category" as const, data: profile.financialAnalysis.years, axisLabel: { color: ct.muted, fontSize: 11 } },
                            yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${v}억` }, splitLine: { lineStyle: { color: ct.split } } },
                            series: profile.financialAnalysis.series.map((s, i) => ({
                              name: s.label,
                              type: "line" as const,
                              data: s.points.map((p) => p.value),
                              connectNulls: false,
                              itemStyle: { color: ct.color[i % ct.color.length] },
                            })),
                          }}
                          style={{ height: 280 }}
                        />
                      </div>
                      <div className="table-scroll">
                        <table className="data-table report-table mt-3 min-w-[40rem]" aria-label="재무 비율 (연도별)">
                          <caption className="sr-only">재무 비율 (연도별)</caption>
                          <thead>
                            <tr>
                              <th scope="col" className="col-label">연도</th>
                              <th scope="col" className="col-num">매출 증감률</th>
                              <th scope="col" className="col-num">영업이익률</th>
                              <th scope="col" className="col-num">순이익률</th>
                              <th scope="col" className="col-num">부채비율</th>
                              <th scope="col" className="col-num">ROE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.financialAnalysis.ratios.map((r) => {
                              const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
                              return (
                                <tr key={r.year}>
                                  <td className="col-label font-semibold tabular-nums">{r.year}</td>
                                  <td className="col-num tabular-nums">{pct(r.revenueGrowth)}</td>
                                  <td className="col-num tabular-nums">{pct(r.operatingMargin)}</td>
                                  <td className="col-num tabular-nums">{pct(r.netMargin)}</td>
                                  <td className="col-num tabular-nums">{pct(r.debtRatio)}</td>
                                  <td className="col-num tabular-nums">{pct(r.roe)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mt-3">재무 비율 분석 불가 — {profile.financialAnalysis.notes.join(" ") || "데이터 부족"}</p>
                  )
                )}
                {profile.financialAnalysis && profile.financialAnalysis.missingAccounts.length > 0 && (
                  <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">미수집 계정: {profile.financialAnalysis.missingAccounts.join(", ")}</p>
                )}
              </div>
            )}

            {profileTab === "swot" && (
              <div className="text-[0.88rem]">
                {profile.swot && (
                  <p className="sizing-note-list mb-2 text-[0.78rem] text-[color:var(--amber-fg)]" role="note">
                    ⚠ 기회·위협은 LLM 추정 — 분석가 확정 전까지 인용 시 검증 필요 표기를 유지하세요.
                  </p>
                )}
                <div className="chart-pair">
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>💪 강점</h4>
                    <ul className="report-bullet-list">{(profile.strengths ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>🩹 약점</h4>
                    <ul className="report-bullet-list">{(profile.weaknesses ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  {profile.swot && (
                    <>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>🌱 기회</h4>
                        <ul className="report-bullet-list">{(profile.swot.opportunities ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>⛈️ 위협</h4>
                        <ul className="report-bullet-list">{(profile.swot.threats ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {profile.businessAssessment || "—"}</p>
              </div>
            )}

            {profileTab === "industry" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">S1 시장분석 연계</h3>
                <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
                  산업 노출 항목을 S1 시장분석 매트릭스와 연결합니다 — 완료된 시장분석이 있으면 앵커·CAGR·외부 전망 격차가 실측 연결됩니다.
                </p>
                {profile.industryLinkage && profile.industryLinkage.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table report-table" aria-label="산업 노출 × S1 매트릭스 연계">
                      <caption className="sr-only">산업 노출 × S1 매트릭스 연계</caption>
                      <thead>
                        <tr>
                          <th scope="col">산업</th>
                          <th scope="col" className="col-num">S1 앵커</th>
                          <th scope="col" className="col-num">CAGR</th>
                          <th scope="col" className="col-num">외부 전망 격차</th>
                          <th scope="col" className="w-[11rem]">연결</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.industryLinkage.map((l, i) => {
                          const req = s1Requests[l.industry];
                          return (
                          <tr key={`${l.industry}-${i}`}>
                            <td>{l.industry}</td>
                            <td className="col-num tabular-nums">{l.anchorTotalUsdB != null ? `$${l.anchorTotalUsdB.toFixed(2)}B` : "—"}</td>
                            <td className="col-num tabular-nums">
                              {l.cagr != null ? `${l.cagr.toFixed(1)}%` : "—"}
                              {l.escalatedCagrPct != null && <span className="status-chip status-green ml-1" title="결정론 스케일링 에스컬레이션 적용 — 외부 참조 × 0.85 (사람 결정)">에스컬레이션 {l.escalatedCagrPct}%</span>}
                            </td>
                            <td className="col-num tabular-nums">{l.externalGapPercent != null ? `${l.externalGapPercent > 0 ? "+" : ""}${l.externalGapPercent}%` : "—"}</td>
                            <td className="text-[0.78rem]">
                              {l.matrixFound && l.industryId ? (
                                <Link href={`/market?industry=${encodeURIComponent(l.industryId)}`} className="text-[color:var(--accent)] underline">시장분석 리포트</Link>
                              ) : req?.status === "created" ? (
                                <span className="flex items-center gap-1">
                                  <span className="status-chip status-amber">S1 분석 중</span>
                                  {req.industryId && <Link href={`/market?industry=${encodeURIComponent(req.industryId)}`} className="text-[color:var(--accent)] underline">리포트</Link>}
                                </span>
                              ) : req?.status === "creating" ? (
                                <span className="status-chip status-not-started">요청 중...</span>
                              ) : !canAct ? (
                                <span className="text-[0.78rem] text-[color:var(--muted-fg)]">—</span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  title="이 산업의 S1 8단계 시장분석을 시작합니다 — 세부 결과는 /market 리포트에서 확인하세요"
                                  onClick={() => void requestS1Analysis(l.industry)}
                                >
                                  S1 분석 요청
                                </button>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
                    산업 연계 데이터가 없습니다 — 재분석 시 산업 노출이 S1 매트릭스와 자동 연결됩니다.
                  </p>
                )}
                {profile.industryLinkage?.some((l) => l.qualitativeLinks && (l.qualitativeLinks.opportunityFactors.length > 0 || l.qualitativeLinks.riskFactors.length > 0)) && (
                  <div className="chart-pair mt-3">
                    <div className="chart-half sizing-grade-card report-bullet-card">
                      <h4>✅ 연결 산업의 기회 요인</h4>
                      <ul className="report-bullet-list">
                        {profile.industryLinkage.flatMap((l) => l.qualitativeLinks?.opportunityFactors ?? []).slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                    <div className="chart-half sizing-grade-card report-bullet-card">
                      <h4>⚠️ 연결 산업의 위험 요인</h4>
                      <ul className="report-bullet-list">
                        {profile.industryLinkage.flatMap((l) => l.qualitativeLinks?.riskFactors ?? []).slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {profileTab === "competitive" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">경쟁 포지셔닝</h3>
                {compError && <p role="alert" className="mb-2 text-[0.8rem] text-[color:var(--red-fg)]">{compError}</p>}

                {/* ① 확정 경쟁사 — 사람의 수용·등록으로만 생긴 레지스트리(ADR-0142) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[0.9rem] font-semibold m-0">확정 경쟁사</h4>
                    <span className="status-chip status-green">{(competitors ?? []).filter((c) => c.status === "confirmed").length}건</span>
                  </div>
                  {(competitors ?? []).filter((c) => c.status === "confirmed").length === 0 ? (
                    <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">
                      아직 확정된 경쟁사가 없습니다 — 아래 AI 제안을 수용하거나 직접 등록하세요.
                    </p>
                  ) : (
                    <div className="table-scroll">
                      <table className="data-table report-table" aria-label="확정 경쟁사">
                        <caption className="sr-only">확정 경쟁사</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="col-label">경쟁사</th>
                            <th scope="col" className="w-[7rem]">DART 고유번호</th>
                            <th scope="col" className="col-text">경쟁 관계</th>
                            <th scope="col" className="w-[7rem]">출처</th>
                            <th scope="col" className="w-[6.5rem]">대조</th>
                            <th scope="col" className="w-[10rem]">관리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(competitors ?? []).filter((c) => c.status === "confirmed").map((c) => {
                            const meta = c.crosscheck_verdict ? CROSSCHECK_VERDICT_META[c.crosscheck_verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                            const editing = editingCompetitor?.id === c.id;
                            const excluding = excludingCompetitor?.id === c.id;
                            return (
                              <tr key={c.id}>
                                <td className="col-label font-semibold">{c.name}</td>
                                <td className="text-[0.78rem] tabular-nums">
                                  {editing ? <input value={editingCompetitor.dart} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, dart: e.target.value })} className="sizing-new-input" style={{ width: "7rem" }} placeholder="고유번호" /> : (c.dart_corp_code || "—")}
                                </td>
                                <td className="col-text text-[0.82rem] text-[color:var(--muted-fg)]">
                                  {editing ? <input value={editingCompetitor.note} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, note: e.target.value })} className="sizing-new-input" style={{ width: "100%" }} placeholder="경쟁 관계" /> : (c.note || "—")}
                                </td>
                                <td>{c.discovery_source === "ai_proposal" ? <span className="status-chip status-in-progress">AI 제안 수용</span> : <span className="status-chip status-not-started">수작업</span>}</td>
                                <td>{meta ? <span className={`status-chip ${meta.chip}`} title={String(c.crosscheck_verdict)}>{meta.label}</span> : <span className="text-[0.78rem] text-[color:var(--muted-fg)]">—</span>}</td>
                                <td>
                                  {editing ? (
                                    <span className="actions-row">
                                      <button type="button" className="btn-primary btn-sm" disabled={compBusy} onClick={() => void saveCompetitorEdit()}>저장</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor(null)}>취소</button>
                                    </span>
                                  ) : excluding ? (
                                    <span className="actions-row">
                                      <input value={excludingCompetitor.reason} onChange={(e) => setExcludingCompetitor({ ...excludingCompetitor, reason: e.target.value })} className="sizing-new-input" style={{ width: "8rem" }} placeholder="제외 사유 *" />
                                      <button type="button" className="btn-danger btn-sm" disabled={compBusy || !excludingCompetitor.reason.trim()} onClick={() => void saveCompetitorExclude()}>확인</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setExcludingCompetitor(null)}>취소</button>
                                    </span>
                                  ) : !canAct ? null : (
                                    <span className="actions-row">
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor({ id: c.id, note: c.note ?? "", dart: c.dart_corp_code ?? "" })}>수정</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setExcludingCompetitor({ id: c.id, reason: "" })}>제외</button>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(competitors ?? []).filter((c) => c.status === "excluded").length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[0.8rem] text-[color:var(--muted-fg)]">제외된 경쟁사 {(competitors ?? []).filter((c) => c.status === "excluded").length}건</summary>
                      <ul className="sizing-note-list mt-1">
                        {(competitors ?? []).filter((c) => c.status === "excluded").map((c) => (
                          <li key={c.id}>
                            {c.name} — {c.exclusion_reason ?? "사유 없음"}{" "}
                            {canAct && <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void restoreCompetitorRow(c.id)}>복원</button>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                {/* ② AI 제안 — 최신 프로필 분석의 경쟁사 후보. 수용은 사람(경계 #2) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[0.9rem] font-semibold m-0">AI 제안</h4>
                    <span className="text-[0.75rem] text-[color:var(--muted-fg)]">최신 프로필 분석 기준 — 제안 전용, 수용은 사람</span>
                    {canAct && (
                    <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void runCompetitorWebSearch()}>
                      {webBusy ? "웹검색 중..." : "웹검색 재제안"}
                    </button>
                    )}
                  </div>
                  {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).length === 0 ? (
                    <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">
                      새로운 제안이 없습니다 — 프로필을 재분석하면 최신 리서치 기반 후보가 제안됩니다.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).map((p) => {
                        const meta = p.verdict ? CROSSCHECK_VERDICT_META[p.verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                        return (
                          <div key={p.name} className="sizing-grade-card mb-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <strong className="text-[0.88rem]">{p.name}</strong>
                              {meta && <span className={`status-chip ${meta.chip}`} title="공시·리서치 원문 대조 판정 (제안 시점)">{meta.label}</span>}
                              <span className="status-chip status-not-started" title="이 제안은 확정 기록이 아니며, 수용 버튼으로만 등록됩니다">제안</span>
                            </div>
                            <p className="mb-1 text-[0.8rem]">{p.note || "—"}</p>
                            {p.evidence.length > 0 && (
                              <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                                근거:{" "}
                                {p.evidence.map((e, i) => (
                                  <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || "출처"}</a></span>
                                ))}
                              </p>
                            )}
                            {canAct && (<div className="flex flex-wrap gap-2">
                              <button type="button" className="btn-primary btn-sm" disabled={compBusy} onClick={() => void acceptProposal(p.name)}>수용</button>
                              <button type="button" className="btn-ghost btn-sm" onClick={() => setDismissedProposals((prev) => [...prev, p.name])}>무시</button>
                            </div>)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {webSuggestions && webSuggestions.length > 0 && (
                    <div className="grid gap-2 mt-2">
                      <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-0">{webNote ?? "웹검색 기반 추가 제안"}</p>
                      {webSuggestions.map((ws) => (
                        <div key={ws.name} className="sizing-grade-card mb-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <strong className="text-[0.88rem]">{ws.name}</strong>
                            <span className={`status-chip ${ws.reliability === "B" ? "status-in-progress" : "status-amber"}`} title="웹검색 근거 기반 제안 — 수용 전 출처를 확인하세요">
                              {ws.reliability === "B" ? "제안 · 웹검색 근거" : "제안 · 미검증"}
                            </span>
                          </div>
                          <p className="mb-1 text-[0.8rem]">{ws.note || "—"}</p>
                          {ws.sources.length > 0 && (
                            <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                              근거:{" "}
                              {ws.sources.map((e, i) => (
                                <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || "출처"}</a></span>
                              ))}
                            </p>
                          )}
                          {canAct && (<div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-primary btn-sm" disabled={compBusy} onClick={() => void acceptWebSuggestion(ws)}>수용</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setWebSuggestions((prev) => (prev ?? []).filter((x) => x.name !== ws.name))}>무시</button>
                          </div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ③ 수작업 등록 — 상시 노출 (브라운필드 후보 등록 폼 패턴) */}
                {canAct && (<div className="market-section mb-3">
                  <h4 className="text-[0.9rem] font-semibold mb-2">수작업 등록</h4>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <input value={competitorForm.name} onChange={(e) => setCompetitorForm({ ...competitorForm, name: e.target.value })} className="sizing-new-input" style={{ width: "14rem" }} placeholder="경쟁사명 *" aria-label="경쟁사명" />
                    <button type="button" className="btn-ghost btn-sm" disabled={competitorDartSearching || !competitorForm.name.trim()} onClick={() => void searchCompetitorDart()}>DART 검색</button>
                    <input value={competitorForm.dart_corp_code} onChange={(e) => setCompetitorForm({ ...competitorForm, dart_corp_code: e.target.value })} className="sizing-new-input" style={{ width: "10rem" }} placeholder="DART 고유번호 (선택, 8자리)" aria-label="경쟁사 DART 고유번호" />
                    <input value={competitorForm.note} onChange={(e) => setCompetitorForm({ ...competitorForm, note: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 14rem" }} placeholder="경쟁 관계 (선택)" aria-label="경쟁 관계" />
                    <button type="button" className="btn-primary btn-sm" disabled={compBusy || !competitorForm.name.trim()} onClick={() => void registerManualCompetitor()}>등록</button>
                  </div>
                  {competitorDartResults.length > 0 && (
                    <ul className="sizing-note-list">
                      {competitorDartResults.map((r) => (
                        <li key={r.corp_code}>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setCompetitorForm({ ...competitorForm, name: r.corp_name, dart_corp_code: r.corp_code })}>이 회사로 채우기</button>{" "}
                          <strong>{r.corp_name}</strong> <code className="text-[0.72rem]">{r.corp_code}</code>
                          {r.source === "web" && <span className="status-chip status-amber ml-1">웹 미검증 후보</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>)}

                {/* AI 분석 참고 — payload 원문(제안 원천). 확정 목록과 별개다. */}
                <details className="market-section">
                  <summary className="cursor-pointer text-[0.85rem] font-semibold">AI 분석 참고 — 포지셔닝·공시 대조 원문 (확정 목록과 별개)</summary>
                  {profile.competitive && !profile.competitive.degraded ? (
                    <>
                      <p className="mt-2 mb-2">{profile.competitive.positioning || "—"}</p>
                      {profile.competitive.competitors.length > 0 && (
                        <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                          이 분석에서 제안된 경쟁사 {profile.competitive.competitors.length}건 — 위 "AI 제안"에서 수용 여부를 결정하세요.
                        </p>
                      )}
                    {profile.competitive.crossCheck && (
                      <div className="mt-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h4 className="text-[0.9rem] font-semibold">공시·리서치 원문 대조</h4>
                          <span className={`status-chip ${CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].chip}`}>
                            {CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].label}
                          </span>
                        </div>
                        {profile.competitive.crossCheck.dartReport && (
                          <p className="mb-1 text-[0.78rem] text-[color:var(--muted-fg)]">
                            출처: DART {profile.competitive.crossCheck.dartReport.reportNm} (접수 {profile.competitive.crossCheck.dartReport.rceptDt.slice(0, 8)}) —{" "}
                            <a href={profile.competitive.crossCheck.dartReport.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a>
                          </p>
                        )}
                        {profile.competitive.crossCheck.claims.length > 0 ? (
                          <div className="table-scroll">
                            <table className="data-table" aria-label="경쟁 주장 대조 결과">
                              <caption className="sr-only">경쟁 주장 대조 결과</caption>
                              <thead>
                                <tr><th scope="col" className="col-label w-[34%]">항목</th><th scope="col" className="w-[7rem]">판정</th><th scope="col" className="col-text">근거</th></tr>
                              </thead>
                              <tbody>
                                {profile.competitive.crossCheck.claims.map((cl, i) => (
                                  <tr key={i}>
                                    <td className="col-label font-semibold">{cl.claim}</td>
                                    <td>
                                      <span className={`status-chip ${CROSSCHECK_VERDICT_META[cl.verdict].chip}`}>{CROSSCHECK_VERDICT_META[cl.verdict].label}</span>
                                      <span className="ml-1 text-[0.72rem] text-[color:var(--muted-fg)]">{cl.source}</span>
                                    </td>
                                    <td className="col-text text-[0.78rem] text-[color:var(--muted-fg)]">
                                      {cl.evidence}
                                      {cl.url && <> — <a href={cl.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">출처</a></>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[0.78rem] text-[color:var(--muted-fg)]">{profile.competitive.crossCheck.note ?? "대조 결과가 없습니다."}</p>
                        )}
                        {profile.competitive.crossCheck.note && profile.competitive.crossCheck.claims.length > 0 && (
                          <p className="mt-1 text-[0.78rem] text-[color:var(--muted-fg)]">비고: {profile.competitive.crossCheck.note}</p>
                        )}
                      </div>
                    )}
                    <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">
                      {profile.competitive.crossCheck
                        ? profile.competitive.crossCheck.status === "cross_checked"
                          ? "공시·리서치 원문 대조 완료 — 판정은 자동 대조 결과이며 분석가 확인 전까지 참고용입니다."
                          : "웹 리서치 기반 LLM 추정 — DART 원문 대조 불가(위 비고 참조)."
                        : "LLM 추정 (웹 리서치 발췌 기반) — 공시·리서치 원문 대조 전입니다."}
                    </p>
                  </>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
                    {profile.competitive?.degraded ?? "경쟁 포지셔닝 데이터가 없습니다 — 재분석 시 생성됩니다."}
                  </p>
                )}
                </details>
              </div>
            )}

            {profileTab === "sources" && (
              <div className="text-[0.88rem]">
                {(profile.researchSources ?? []).length > 0 ? (
                  <ul className="sizing-note-list mb-3">
                    {profile.researchSources!.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic">출처 기록이 없습니다.</p>
                )}
                {profile.sectionConfidence && profile.sectionConfidence.length > 0 && (
                  <>
                    <h3 className="sizing-step-title text-[0.95rem] mt-3">섹션별 데이터 신뢰도 등급 (A 확정 ~ D 추정 불가)</h3>
                    <table className="data-table" aria-label="섹션별 신뢰도 등급">
                      <caption className="sr-only">섹션별 신뢰도 등급</caption>
                      <thead><tr><th scope="col">섹션</th><th scope="col">등급</th><th scope="col">비고</th></tr></thead>
                      <tbody>
                        {profile.sectionConfidence.map((s, i) => (
                          <tr key={i}>
                            <td className="font-semibold">{s.section}</td>
                            <td>
                              <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
                                {s.grade}
                              </span>
                            </td>
                            <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{s.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {profile.verificationLedger && profile.verificationLedger.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[0.85rem] text-[color:var(--accent)]">
                      🔍 검증 원장 ({profile.verificationLedger.length}건 — 확인/확인불가/판단필요)
                    </summary>
                    <table className="data-table mt-2" aria-label="검증 원장">
                      <caption className="sr-only">주장별 검증 상태</caption>
                      <thead><tr><th scope="col" className="w-[34%]">항목</th><th scope="col">상태</th><th scope="col">근거</th></tr></thead>
                      <tbody>
                        {profile.verificationLedger.map((v, i) => (
                          <tr key={i}>
                            <td className="font-semibold">{v.item}</td>
                            <td>
                              <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                                {v.status === "confirmed" ? "확인" : v.status === "could_not_verify" ? "확인 불가" : "판단 필요"}
                              </span>
                            </td>
                            <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{v.evidence}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            )}

          </>
        );
      })()}
        </section>
      )}

    </>
  );
}
