"use client";

// S6/S7 후보 상세 화면 (/brownfield/targets/[targetId]) — 목록의 드릴다운을
// 대체하는 전용 페이지(사용자 결정, 2026-09-15). DART 연결 회사는 재무 facts와
// 공시(사업보고서 등)를 이 화면에서 바로 확인·활용하고, 재무 판정의 참고값을
// DART가 채워주므로 사람의 판정 작업이 기술 평가 중심이 된다(경계 #2 — 판정은
// 항상 사람이 select로 기록한다).

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { ListBackButton } from "../../../../components/ListBackButton.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { EChart } from "../../../../components/EChart.tsx";
import { useChartTheme } from "../../../../lib/echarts-theme.ts";
import { parseRubric, rubricFields, isFinancialDataRef } from "../../../../lib/brownfield-financial-rubric.ts";
import { KNOCKOUT_IDS, precheckRecommendation, normalizeVerdict, SCREENING_VERDICT_KO, screeningVerdictChipClass } from "../../../../lib/brownfield-precheck.ts";

interface TargetDetail {
  id: string; opportunity_id: string; company_name: string; dart_corp_code: string | null;
  universe_note: string | null; status: "pending" | "shortlisted" | "excluded";
  rank: number | null; exclusion_reason: string | null; screening_json: string | null;
  screening_evidence_json: string | null;
  company_id: string | null;
}
interface EvalItem {
  id: string; category: "financial" | "technical"; source: "builtin" | "seeded" | "custom";
  label: string; description: string | null; is_mandatory: 0 | 1; is_deletable: 0 | 1; weight: number;
  data_ref: string | null; rubric_json: string | null;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
// 재무 평가 자동 초안(ADR-0140) — 서버가 만든 제안. 클라이언트 상태로만
// 존재하고 확인·수정 후 기존 판정 저장(PUT eval-state)으로 확정된다.
interface EvalDraftItem {
  criterion_id: string; label: string; data_ref: string;
  status: "pass" | "partial" | "fail" | null; reason: string | null;
  metrics: Array<{ label: string; value: string }>; note: string;
}
interface EvalDraftResp { source: string; years: string[]; latest_sync_at: string | null; drafts: EvalDraftItem[]; note: string }
interface EvalCategoryScore { score: number | null; scoredWeight: number; totalWeight: number; excludedWeight: number }
// 사전 검토(chk-target-screening) 근거 — 위원회 추천 검토·등록·재분석에서
// 수집된 "나중에 참고할" 정보(사용자 결정, 2026-09-16). 이 화면은 읽기 전용
// 저장소다 — 판정 기록은 /brownfield Short List "사전 검토" 섹션에서 한다.
interface ScreeningItem { id: string; text: string; mandatory: boolean; waiver_eligible: boolean }
interface ScreeningSummary { assessed: number; total: number; knockOutsPassed: boolean; anyKnockOutFail: boolean; mandatoryOpen: string[] }
interface ScreeningItemEvidence { verdict?: string; rationale?: string; source_url?: string | null; kind?: string }
interface EvidenceRow {
  id: string; kind: string; title: string; detail: string | null;
  source_url: string | null; source_kind: string | null; created_by: string | null; created_at: string;
}
interface DetailResponse {
  target: TargetDetail;
  opportunity: { id: string; name: string; market_scope: string | null };
  evalItems: EvalItem[];
  scores: Record<"financial" | "technical", EvalCategoryScore> & { combined: number | null };
  checklist: ScreeningItem[];
  screening_summary: ScreeningSummary;
  evidence: EvidenceRow[];
}
interface FinancialsResp {
  latest_sync_at: string | null;
  analysis: {
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{ year: string; operatingMargin?: number | null; netMargin?: number | null; debtRatio?: number | null }>;
  };
}
interface DisclosureRow { rcept_no: string; report_nm: string; rcept_dt: string; viewer_url: string | null }
interface DisclosuresResp {
  dart_linked: boolean;
  presets: Array<{ key: string; label: string }>;
  error: string | null;
  disclosures: DisclosureRow[];
}
// 회사 AI 프로파일 — 그룹/계열사 프로파일과 동일한 파이프라인 재사용(일반화,
// 2026-09-15). 전체 필드는 company-profile-pipeline.ts CompanyProfilePayload
// 참조 — 화면에서 쓰는 필드만 좁혀 선언한다.
interface CompanyProfile {
  companyName: string;
  strengths: string[];
  weaknesses: string[];
  businessAssessment: string;
  industryExposure: string[];
  degraded?: string | null;
  researchSources: Array<{ title: string; url: string; snippet?: string }>;
  dataSources: { dart: boolean; dartYear: string | null; webResearchCount: number };
  swot?: { opportunities: string[]; threats: string[] };
  competitive?: { competitors: Array<{ name: string; note: string }>; positioning: string; degraded?: string | null };
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
  // DART 원계정 상세(자산총계·영업이익 등 전 계정 × 연도) — AI 분석 파이프라인
  // 1단계에서 이미 입수된 데이터를 재무 탭의 그래프·표에 재사용한다.
  dartFinancials?: {
    available?: boolean;
    year?: string;
    items?: Array<{ name: string; value: number; year?: string }>;
    reportUrl?: string;
    error?: string;
  };
}
interface CompanyProfileResp {
  profile: CompanyProfile | null;
  status: "completed" | "in_progress" | "failed" | "not_started";
  error?: string;
}

const STATUS_LABEL: Record<TargetDetail["status"], string> = { pending: "심사 중", shortlisted: "Short List", excluded: "제외" };
const EVAL_VERDICTS = ["pass", "partial", "fail", "na", "waived"] as const;
const VERDICT_KO: Record<string, string> = { pass: "충족", partial: "부분충족", fail: "미충족", na: "해당없음", waived: "예외", pending: "미판정" };
const EVAL_CATEGORY_LABEL: Record<EvalItem["category"], string> = { financial: "재무적 평가", technical: "기술적 평가" };
const PROFILE_TABS: Array<["overview" | "aiprofile" | "financials" | "disclosures" | "precheck" | "eval" | "sources", string]> = [
  ["overview", "개요"],
  ["aiprofile", "강·약점 SWOT"],
  ["financials", "재무"],
  ["disclosures", "공시"],
  ["precheck", "사전 검토 근거"],
  ["eval", "평가"],
  ["sources", "출처"],
];

// ── 외부 검색 근거의 [n] 인용 마커를 출처 링크로 바꿔 렌더링한다 ──
// 프로파일 파이프라인(Step 3·4)이 웹 리서치 근거에 붙이는 출처 번호(예:
// "…소재 양산 개시 [3]")를 개요·SWOT 화면에서 바로 열 수 있게 연결한다
// (사용자 요청, 2026-09-16). 번호가 리서치 범위 밖이면 원문 그대로 둔다.
function renderWithCitations(text: string, sources: Array<{ title: string; url: string }>): ReactNode {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    const src = m ? sources[Number(m[1]) - 1] : undefined;
    if (!m || !src) return <span key={i}>{part}</span>;
    return (
      <a key={i} href={src.url} target="_blank" rel="noreferrer" title={`외부 리서치 출처 — ${src.title}`} className="text-[color:var(--accent)] underline text-[0.75em] align-super">
        {part}
      </a>
    );
  });
}

export function TargetDetailView() {
  const params = useParams<{ targetId: string }>();
  const targetId = params?.targetId ?? "";
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  // 프로파일 탭 — 그룹/계열사 프로파일과 유사한 구조(library-tabs 패턴).
  // "사전 검토 근거"는 읽기 전용 참고 탭 — 수집된 근거가 있을 때만 탭 목록에
  // 나타난다. 판정 기록은 /brownfield Short List "사전 검토" 섹션에서 한다.
  const [profileTab, setProfileTab] = useState<"overview" | "aiprofile" | "financials" | "disclosures" | "precheck" | "eval" | "sources">("overview");
  // AI 분석 — 그룹/계열사 화면과 동일한 LLM 프로파일 파이프라인 재사용(일반화, 2026-09-15).
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileResp | null | undefined>(undefined);
  const [analyzing, setAnalyzing] = useState(false);
  // 후보 정보 수정/삭제 — 등록 후에도 고칠 수 있어야 한다(사용자 요청).
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ company_name: "", dart_corp_code: "", universe_note: "" });
  const { confirm, confirmDialog } = useConfirm();
  const ct = useChartTheme();
  // 재무·기술 평가
  const [evalBusy, setEvalBusy] = useState<string | null>(null);
  const [newCriterionLabel, setNewCriterionLabel] = useState<Record<string, string>>({});
  // 재무·기술 평가 자동 초안(ADR-0140/0141) — 초안은 클라이언트 상태(미저장).
  // 사람이 select를 바꾸거나 "초안 저장"을 누를 때 비로소 판정으로 기록된다.
  const [evalDraft, setEvalDraft] = useState<Record<string, EvalDraftItem> | null>(null);
  const [draftCategory, setDraftCategory] = useState<"financial" | "technical" | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [rubricOpen, setRubricOpen] = useState(false);
  const [rubricBusy, setRubricBusy] = useState<string | null>(null);
  // DART
  const [financials, setFinancials] = useState<FinancialsResp | null | undefined>(undefined); // undefined=로딩
  const [discPreset, setDiscPreset] = useState("business");
  const [disclosures, setDisclosures] = useState<DisclosuresResp | null | undefined>(undefined);

  const oppId = detail?.opportunity.id ?? "";
  const companyId = detail?.target.company_id ?? null;
  // ADR-0142 — 확정 경쟁사 레지스트리 (사람의 수용·등록으로만 생긴 목록)
  const [confirmedCompetitors, setConfirmedCompetitors] = useState<Array<{ id: string; name: string; note: string | null }> | null>(null);

  useEffect(() => {
    if (!companyId) {
      setConfirmedCompetitors(null);
      return;
    }
    api.get<{ competitors: Array<{ id: string; name: string; note: string | null; status: string }> }>(`/api/companies/${encodeURIComponent(companyId)}/competitors`)
      .then((r) => setConfirmedCompetitors((r.data.competitors ?? []).filter((c) => c.status === "confirmed")))
      .catch(() => setConfirmedCompetitors([]));
  }, [companyId]);
  const dartCode = detail?.target.dart_corp_code ?? null;

  const loadDetail = useCallback(() => {
    if (!targetId) return;
    api.get<DetailResponse>(`/api/brownfield/targets/${encodeURIComponent(targetId)}`)
      .then((r) => {
        setDetail(r.data);
        setError(null);
        setEditDraft({
          company_name: r.data.target.company_name,
          dart_corp_code: r.data.target.dart_corp_code ?? "",
          universe_note: r.data.target.universe_note ?? "",
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "후보 상세 불러오기 실패"));
  }, [targetId]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const loadFinancials = useCallback(() => {
    if (!companyId) return;
    setFinancials(undefined);
    api.get<FinancialsResp>(`/api/companies/${encodeURIComponent(companyId)}/financials`)
      .then((r) => setFinancials(r.data))
      .catch(() => setFinancials(null));
  }, [companyId]);
  useEffect(() => { loadFinancials(); }, [loadFinancials]);

  // DART 연결 회사인데 로컬에 재무 facts가 아직 없으면 자동으로 1회 동기화한다.
  // 재무 facts 카드는 제거됐지만(사용자 요청, 2026-09-16) fact_financial는 평가
  // 탭의 "재무 판정 초안"(ADR-0140)이 읽는 데이터 원천이므로 화면 진입 시
  // 자동 동기화는 유지한다. companyId당 1회만 시도(autoSyncedFor로 추적)해
  // 무한 재시도를 막는다.
  const [autoSyncedFor, setAutoSyncedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId || !dartCode) return;
    if (financials === undefined) return; // 아직 로딩 중
    if (financials !== null && financials.analysis.years.length > 0) return; // 이미 있음
    if (autoSyncedFor === companyId) return; // 이미 자동 시도함(재동기화 없음 → 재요청 안 함)
    setAutoSyncedFor(companyId);
    api.post(`/api/companies/${encodeURIComponent(companyId)}/sync`, {}).then(loadFinancials).catch(() => {});
  }, [companyId, dartCode, financials, autoSyncedFor, loadFinancials]);

  const loadCompanyProfile = useCallback(() => {
    if (!companyId) return;
    api.get<CompanyProfileResp>(`/api/companies/${encodeURIComponent(companyId)}/profile`)
      .then((r) => setCompanyProfile(r.data))
      .catch(() => setCompanyProfile(null));
  }, [companyId]);
  useEffect(() => { loadCompanyProfile(); }, [loadCompanyProfile]);
  // 분석이 in_progress면 짧은 간격으로 폴링해 완료·실패를 반영한다.
  useEffect(() => {
    if (companyProfile?.status !== "in_progress") return;
    const t = setTimeout(loadCompanyProfile, 2500);
    return () => clearTimeout(t);
  }, [companyProfile?.status, loadCompanyProfile]);

  async function runCompanyAnalysis() {
    if (!companyId || analyzing) return;
    setAnalyzing(true);
    try {
      await api.post(`/api/companies/${encodeURIComponent(companyId)}/analyze`, {});
      setCompanyProfile({ profile: null, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 분석 실행 실패");
    } finally {
      setAnalyzing(false);
    }
  }

  const loadDisclosures = useCallback(() => {
    if (!companyId) return;
    setDisclosures(undefined);
    api.get<DisclosuresResp>(`/api/companies/${encodeURIComponent(companyId)}/disclosures?preset=${encodeURIComponent(discPreset)}`)
      .then((r) => setDisclosures(r.data))
      .catch(() => setDisclosures(null));
  }, [companyId, discPreset]);
  useEffect(() => { loadDisclosures(); }, [loadDisclosures]);

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
  // 서버가 DART facts(재무) 또는 공시·프로파일·웹 근거(기술)로 계산한 제안을
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
      setError(err instanceof Error ? err.message : "Short List 승격 실패");
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

  if (!detail) {
    return (
      <main>
        <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정 — 후보 상세" />
        {error ? <p role="alert" className="text-[color:var(--red-fg)]">{error}</p> : <p className="text-[color:var(--muted-fg)]">불러오는 중...</p>}
      </main>
    );
  }

  const { target: t, opportunity, evalItems, scores, checklist, screening_summary, evidence } = detail;
  // 사전 검토 확정 판정 + 항목별 근거(위원회 추천 검토에서 수집·저장된 것).
  const savedVerdicts = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
  const itemEvidence = t.screening_evidence_json
    ? (JSON.parse(t.screening_evidence_json) as Record<string, ScreeningItemEvidence>)
    : {};
  const hasPrecheckData = evidence.length > 0 || screening_summary.assessed > 0;
  // 재무 자동 초안 대상 — 재무 빌트인 + data_ref 있는 항목 중 미판정만.
  const pendingFinancial = evalItems.filter(
    (it) => it.category === "financial" && it.source === "builtin" && isFinancialDataRef(it.data_ref) && (it.state?.status ?? "pending") === "pending",
  );
  // 기술 자동 초안 대상 — 기술 항목(시딩·커스텀 무관) 중 미판정만.
  const pendingTechnical = evalItems.filter((it) => it.category === "technical" && (it.state?.status ?? "pending") === "pending");
  const proposedCount = evalDraft ? Object.values(evalDraft).filter((d) => d.status != null).length : 0;
  const scoreChip = (score: number | null) =>
    `status-chip ${score == null ? "status-not-started" : score >= 70 ? "status-green" : score >= 40 ? "status-amber" : "status-red"}`;
  // 승격 가능 여부 = 재무·기술 평가 전 항목 판정 완료(서버 shortlist와 동일 기준)
  const evalComplete = (["financial", "technical"] as const).every(
    (c) => scores[c].totalWeight > 0 && scores[c].scoredWeight === scores[c].totalWeight,
  );

  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정 — 후보 상세">
        {opportunity.name} · {t.company_name}
        {t.dart_corp_code ? <> · DART <code className="dd-item-id">{t.dart_corp_code}</code></> : null}
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)] mb-2">{error}</p>}

      {/* ── 헤더 카드 — 상태·점수 요약 + 목록 복귀 ── */}
      <section aria-label="후보 요약" className="market-section">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-[1rem] mb-0">{t.company_name}</h2>
              <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
              </span>
            </div>
            <ListBackButton href={`/brownfield?opportunity=${encodeURIComponent(opportunity.id)}`} label="Long List 목록으로" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`status-chip ${scoreChip(scores.financial.score)}`} title="재무 평가 100점 가중 점수">재무 {scores.financial.score ?? "—"}</span>
            <span className={`status-chip ${scoreChip(scores.technical.score)}`} title="기술 평가 100점 가중 점수(S3 필요 역량 기준)">기술 {scores.technical.score ?? "—"}</span>
            <span className={`status-chip ${scoreChip(scores.combined)}`} title="재무·기술 종합 점수(financial·technical 평균)">
              종합 {scores.combined != null ? `${scores.combined}점 / 100점` : "— 판정 필요"}
            </span>
            {t.exclusion_reason && <span className="text-[0.75rem] text-[color:var(--muted-fg)]">제외 사유: {t.exclusion_reason}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {t.status !== "shortlisted" && (
              <button
                type="button"
                className="btn-premium btn-sm"
                disabled={busy || !evalComplete}
                title={evalComplete ? "Short List로 승격" : "재무·기술 평가를 모두 판정한 뒤 승격할 수 있습니다"}
                onClick={() => void shortlist()}
              >
                Short List 승격
              </button>
            )}
            {t.status !== "excluded" && (
              <span className="flex items-center gap-1">
                <input
                  aria-label="제외 사유"
                  placeholder="제외 사유"
                  value={excludeReason}
                  onChange={(e) => setExcludeReason(e.target.value)}
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 12rem" }}
                />
                <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={busy || !excludeReason.trim()} onClick={() => void exclude()}>제외</button>
              </span>
            )}
            {t.status === "shortlisted" && <span className="text-[0.75rem] text-[color:var(--muted-fg)]">Short List 승격 완료 — 순위 조정은 목록 화면에서</span>}
          </div>
        </div>
      </section>

      {/* ── 회사 프로파일 탭 — 그룹/계열사 프로파일과 유사한 구조(사용자 요청,
          2026-09-15). 개요 / 재무 / 공시 / 평가로 회사 정보를 구조화한다. ── */}
      <section aria-label="회사 프로파일" className="market-section">
        <SectionToolbar title="회사 프로파일" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="library-tabs" role="tablist" aria-label="후보 회사 프로파일 섹션">
            {PROFILE_TABS.filter(([key]) => key !== "precheck" || hasPrecheckData).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={profileTab === key} className={`library-tab ${profileTab === key ? "library-tab-active" : ""}`} onClick={() => setProfileTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {/* 핵심 액션 — 탭 목록과 같은 줄 오른쪽에 배치. 정보 수정·후보 삭제·
              재분석은 활성 탭과 무관하게 항상 노출한다(사용자 요청, 2026-09-16).
              수정 폼은 개요 탭에 있으므로 정보 수정 클릭 시 개요 탭으로 전환한다. */}
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={analyzing || companyProfile === undefined || companyProfile?.status === "in_progress" || !companyId}
              title={companyId ? undefined : "회사 마스터가 연결되면 실행할 수 있습니다"}
              onClick={() => void runCompanyAnalysis()}
            >
              {companyProfile?.status === "in_progress" ? "분석 중..." : companyProfile?.profile ? "재분석" : "AI 분석 실행"}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setProfileTab("overview"); setEditing(true); }}>정보 수정</button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => confirm(
                `${t.company_name} 삭제`,
                () => void deleteTarget(),
                { body: "평가 판정을 포함해 완전히 삭제되며 되돌릴 수 없습니다. 사유를 남기고 싶다면 삭제 대신 \"제외\"를 쓰세요.", confirmLabel: "삭제" },
              )}
            >
              후보 삭제
            </button>
          </span>
        </div>

        {/* 후보 정보(소속 기회·상태·DART·평가 점수)는 위 요약 카드에 이미
            표시되므로 여기서는 반복하지 않는다 — 수정 폼만 필요할 때 보인다
            (사용자 요청, 2026-09-15 — "다 제거될 필요가 있어"). */}
        {profileTab === "overview" && editing && (
          <div className="card mt-3 text-[0.85rem]">
            <form
              className="sizing-new-form mb-0"
              onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]">
                  <span className="block mb-1">회사명 *</span>
                  <input
                    value={editDraft.company_name}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, company_name: e.target.value }))}
                    required
                    className="sizing-new-input"
                  />
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">DART 고유번호 (8자리)</span>
                  <input
                    value={editDraft.dart_corp_code}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, dart_corp_code: e.target.value }))}
                    placeholder="8자리 고유번호"
                    className="sizing-new-input sizing-new-input-sm"
                  />
                </label>
                <button type="submit" className="btn-premium btn-sm" disabled={busy || !editDraft.company_name.trim()}>저장</button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setEditDraft({ company_name: t.company_name, dart_corp_code: t.dart_corp_code ?? "", universe_note: t.universe_note ?? "" });
                  }}
                >
                  취소
                </button>
              </div>
              <p className="mt-1 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                DART 고유번호를 바꾸면 회사 마스터가 재연결되어 재무 facts·공시가 새 회사 기준으로 갱신됩니다.
              </p>
            </form>
          </div>
        )}

        {/* AI 분석 요약(신뢰도 상한 권고·종합 평가·산업 노출) — 서브탭 없이 개요
            탭에 바로 붙인다(사용자 요청, 2026-09-15 — "서브탭을 만들면 안될 듯"). */}
        {profileTab === "overview" && companyProfile?.profile && (
          <div className="card mt-3 text-[0.88rem]">
            <h4 className="text-[0.9rem] mb-2">🏢 {companyProfile.profile.companyName} AI 프로파일</h4>
            {companyProfile.profile.ragCapRecommendation && (
              <div className="sizing-grade-card mb-3">
                <h4 className="text-[0.9rem] mb-2">🚦 신뢰도 상한 권고</h4>
                <span className={`status-chip ${companyProfile.profile.ragCapRecommendation.grade === "green" ? "status-green" : companyProfile.profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                  상한 {companyProfile.profile.ragCapRecommendation.grade.toUpperCase()}
                </span>
                <p className="mt-2 mb-0 text-[0.88rem]">{companyProfile.profile.ragCapRecommendation.rationale}</p>
              </div>
            )}
            <h3 className="sizing-step-title text-[0.9rem]">종합 평가</h3>
            <p className="mb-3">
              {companyProfile.profile.businessAssessment
                ? renderWithCitations(companyProfile.profile.businessAssessment, companyProfile.profile.researchSources)
                : "—"}
            </p>
            <h3 className="sizing-step-title text-[0.9rem]">산업 노출</h3>
            {companyProfile.profile.industryExposure.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {companyProfile.profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
              </div>
            ) : <p className="text-[color:var(--muted-fg)] italic text-[0.78rem] mb-0">산업 노출 정보 없음</p>}
            {/* 외부 검색으로 얻은 정보가 이 프로파일에 실제로 쓰였음을 개요에서
                바로 보여준다(사용자 요청, 2026-09-16) — [n] 인용은 위 종합 평가의
                링크와 연결되고, 근거 출처 상위 3건을 이 자리에 노출한다. */}
            {companyProfile.profile.researchSources.length > 0 && (
              <>
                <h3 className="sizing-step-title text-[0.9rem] mt-3">외부 리서치 근거 ({companyProfile.profile.researchSources.length}건)</h3>
                <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                  {companyProfile.profile.researchSources.slice(0, 3).map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                      {s.snippet && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{s.snippet}</span>}
                    </li>
                  ))}
                </ul>
                {companyProfile.profile.researchSources.length > 3 && (
                  <p className="mt-1 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                    전체 {companyProfile.profile.researchSources.length}건은 <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>출처 탭</button>에서 확인하세요.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {profileTab === "aiprofile" && (
          <div className="mt-3">
            {!companyId ? (
              <div className="card"><p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">회사 마스터가 아직 연결되지 않았습니다 — 후보 등록/수정 시 회사명이 확정되면 연결됩니다.</p></div>
            ) : companyProfile === undefined ? (
              <div className="card"><p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">불러오는 중...</p></div>
            ) : companyProfile === null ? (
              <div className="card"><p className="mb-0 text-[0.78rem] text-[color:var(--red-fg)]">AI 분석 상태를 불러오지 못했습니다.</p></div>
            ) : (
              <>
                {/* 헤더 — 회사명·배지만 표시. 분석 실행/재분석 버튼은 탭 목록과
                    같은 줄 오른쪽으로 이동했다(사용자 요청, 2026-09-15). */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h2 className="text-[0.95rem] !mb-0">🏢 {companyProfile.profile?.companyName ?? t.company_name} 강·약점 SWOT</h2>
                  {companyProfile.profile?.dataSources?.dart && <span className="status-chip status-green">DART {companyProfile.profile.dataSources.dartYear ?? ""}</span>}
                  {(companyProfile.profile?.dataSources?.webResearchCount ?? 0) > 0 && (
                    <span className="status-chip status-in-progress">외부 리서치 {companyProfile.profile!.dataSources.webResearchCount}건</span>
                  )}
                  {companyProfile.profile?.degraded && <span className="status-chip status-amber" title={companyProfile.profile.degraded}>부분 분석(폴백) — 재분석 권장</span>}
                </div>

                {companyProfile.status === "in_progress" ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">DART·웹 리서치·LLM 분석 진행 중 — 완료되면 자동으로 갱신됩니다.</p>
                ) : companyProfile.status === "failed" ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--red-fg)]">분석 실패 — {companyProfile.error ?? "사유 없음"}</p>
                ) : companyProfile.status === "not_started" || !companyProfile.profile ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">아직 분석된 프로파일이 없습니다 — "AI 분석 실행"으로 강점·약점·산업 노출·경쟁 포지셔닝을 생성하세요.</p>
                ) : (
                  <div className="text-[0.88rem]">
                    {companyProfile.profile.swot && (
                      <p className="sizing-note-list mb-2 text-[0.78rem] text-[color:var(--amber-fg)]" role="note">
                        ⚠ 기회·위협은 LLM 추정 — 분석가 확정 전까지 인용 시 검증 필요 표기를 유지하세요.
                      </p>
                    )}
                    <div className="chart-pair">
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>💪 강점</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.strengths.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>🩹 약점</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.weaknesses.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                      </div>
                      {companyProfile.profile.swot && (
                        <>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>🌱 기회</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.opportunities.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                          </div>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>⛈️ 위협</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.threats.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="mt-3 mb-0 text-[0.88rem]">
                      <strong>종합 평가:</strong>{" "}
                      {companyProfile.profile.businessAssessment
                        ? renderWithCitations(companyProfile.profile.businessAssessment, companyProfile.profile?.researchSources ?? [])
                        : "—"}
                    </p>

                    {companyProfile.profile.competitive && !companyProfile.profile.competitive.degraded && (
                      <>
                        <h3 className="sizing-step-title text-[0.95rem] mt-3">경쟁 포지셔닝</h3>
                        <p className="mb-2">{renderWithCitations(companyProfile.profile.competitive.positioning || "—", companyProfile.profile?.researchSources ?? [])}</p>
                        {/* ADR-0142 — 확정 경쟁사 레지스트리가 1순위. 없으면 payload
                            제안을 "미확정" 표기와 함께 보여준다(제안≠확정). */}
                        {companyId && (
                          <CompetitorRegistryBlock
                            companyId={companyId}
                            payloadCompetitors={companyProfile.profile.competitive.competitors.map((c) => ({ name: c.name, note: c.note }))}
                          />
                        )}
                      </>
                    )}

                    {/* 이 분석에 사용된 외부 검색 출처를 그 자리에 기록한다(사용자
                        요청, 2026-09-16) — 위 [n] 인용 링크의 실체. 전체 목록은
                        출처 탭에 누적된다. */}
                    {companyProfile.profile.researchSources.length > 0 && (
                      <div className="mt-3 mb-0">
                        <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-1">
                          본 분석에 사용된 외부 리서치 {companyProfile.profile.researchSources.length}건 — 위 <span className="text-[color:var(--accent)]">[n]</span> 표시가 아래 출처로 연결됩니다. 전체 목록은{" "}
                          <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>출처 탭</button>에서.
                        </p>
                        <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                          {companyProfile.profile.researchSources.slice(0, 5).map((s) => (
                            <li key={s.url}>
                              <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {profileTab === "financials" && (
          <div className="mt-3">
            {/* DART 원계정 현황 — AI 분석(1단계)에서 입수된 전 계정 × 연도 데이터를
                그래프·표로 보여준다(그룹/계열사 화면 재무 탭과 동일 구성, 사용자
                요청 2026-09-15 — "세부항목 분석을 보면 추가적인 정보를 더 확보하고
                그래프화가 되어야 할 듯"). AI 분석을 아직 실행하지 않았다면 아래
                요약(fact_financial 동기화 기반)만 보인다. */}
            {companyProfile?.profile?.dartFinancials?.available && companyProfile.profile.dartFinancials.items && (() => {
              const items = companyProfile.profile.dartFinancials.items!;
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
                  itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] as [number, number, number, number] },
                })),
              };
              return (
                <div className="card mb-3">
                  <h4 className="text-[0.9rem] mb-2">DART 재무 현황 ({companyProfile.profile.dartFinancials!.year}년)</h4>
                  <EChart option={chartOption} height={300} ariaLabel="DART 재무 현황 — 계정별 연도 비교" />
                  <p className="mt-1 mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">단위: 억원 · 출처: DART 사업보고서</p>
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
                </div>
              );
            })()}
            {!companyProfile?.profile?.dartFinancials?.available && (
              <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
                계정별 상세 그래프는 AI 분석 실행 후 표시됩니다 — <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("aiprofile")}>AI 분석 탭</button>에서 실행하세요.
              </p>
            )}
          </div>
        )}

        {profileTab === "disclosures" && (
          <div className="card mt-3">
            {!dartCode || !companyId ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">
                DART 고유번호가 없어 공시를 조회할 수 없습니다 — 등록 시 8자리 고유번호를 입력하면 연결됩니다.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <label className="text-[0.78rem] flex items-center gap-1">
                    공시
                    <select value={discPreset} onChange={(e) => setDiscPreset(e.target.value)} className="sizing-new-input sizing-new-input-sm" aria-label="공시 프리셋">
                      {(disclosures?.presets ?? [{ key: "recent", label: "최근 공시" }, { key: "business", label: "사업보고서" }]).map((pr) => (
                        <option key={pr.key} value={pr.key}>{pr.label}</option>
                      ))}
                    </select>
                  </label>
                  {disclosures === undefined && <span className="text-[0.75rem] text-[color:var(--muted-fg)]">조회 중...</span>}
                </div>
                {disclosures === undefined ? null : disclosures === null ? (
                  <p className="mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">공시 목록을 불러오지 못했습니다.</p>
                ) : disclosures.error ? (
                  <p className="mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">{disclosures.error}</p>
                ) : disclosures.disclosures.length === 0 ? (
                  <p className="mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">해당 프리셋의 공시가 최근 12개월 내 없습니다.</p>
                ) : (
                  <ul className="sizing-note-list mb-0" style={{ maxHeight: "16rem", overflowY: "auto", fontSize: "0.88rem" }}>
                    {disclosures.disclosures.map((d) => (
                      <li key={d.rcept_no} className="flex flex-wrap items-center gap-2">
                        <code className="dd-item-id">{d.rcept_dt}</code>
                        <span className="flex-1 min-w-[16rem]">{d.report_nm}</span>
                        {d.viewer_url && (
                          <a href={d.viewer_url} target="_blank" rel="noreferrer" className="text-[0.88rem] text-[color:var(--accent)] underline">보고서 열기</a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 사전 검토 근거(읽기 전용 참고 탭) — 위원회 추천 검토·등록·
            재분석에서 수집된 정보의 저장소(사용자 결정, 2026-09-16). 판정
            기록은 /brownfield Short List "사전 검토" 섹션에서 하고, 여기서는
            확정된 판정·항목별 근거·수집 타임라인을 나중에 참고할 수 있게
            보여준다. 수집된 근거가 없으면 탭 자체가 숨는다. ── */}
        {profileTab === "precheck" && (
          <div className="mt-3">
            <div className="card mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h4 className="text-[0.9rem] mb-0">사전 검토 — chk-target-screening (t-01~t-09)</h4>
                <span
                  className={`status-chip ${screening_summary.anyKnockOutFail ? "status-red" : screening_summary.assessed === 0 ? "status-not-started" : screening_summary.assessed < screening_summary.total || screening_summary.mandatoryOpen.length > 0 ? "status-amber" : "status-green"}`}
                  title={`확정 판정 ${screening_summary.assessed}/${screening_summary.total}${screening_summary.mandatoryOpen.length ? ` · 미판정 필수: ${screening_summary.mandatoryOpen.join(", ")}` : ""}`}
                >
                  확정 판정 {screening_summary.assessed}/{screening_summary.total}
                </span>
              </div>
              {(() => {
                const reco = precheckRecommendation(savedVerdicts);
                const anyAssessed = [...KNOCKOUT_IDS].some((id) => savedVerdicts[id] && savedVerdicts[id] !== "pending");
                return anyAssessed ? (
                  <p className="mb-2">
                    <span className="text-[0.78rem] mr-2">사전 검토 결과(확정 판정 기준):</span>
                    <span className={`status-chip ${reco.cls}`}>{reco.label}</span>
                  </p>
                ) : (
                  <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">아직 확정된 판정이 없습니다 — Short List 승격 후 /brownfield 화면의 "사전 검토" 섹션에서 판정합니다.</p>
                );
              })()}
              <ul className="sizing-note-list mb-1">
                {checklist.map((item) => {
                  const v = savedVerdicts[item.id];
                  const ev = itemEvidence[item.id];
                  return (
                    <li key={item.id} className="text-[0.78rem] flex flex-wrap items-start gap-2">
                      <code className="dd-item-id mt-1">{item.id}</code>
                      <span className="flex-1 min-w-[14rem]">
                        <span className="text-[color:var(--muted-fg)]">{item.text.split(" — ")[0]}</span>
                        {ev?.rationale && <span className="block text-[0.75rem]">{ev.rationale}</span>}
                        {ev?.source_url && (
                          <a href={ev.source_url} target="_blank" rel="noreferrer" className="block text-[0.72rem] text-[color:var(--accent)] underline truncate">
                            출처: {ev.source_url}
                          </a>
                        )}
                      </span>
                      {ev?.kind === "secured" && <span className="status-chip status-amber">기확보</span>}
                      {ev?.kind === "web" && <span className="status-chip">웹검색</span>}
                      <span className={`status-chip ${screeningVerdictChipClass(v)}`}>
                        {SCREENING_VERDICT_KO[normalizeVerdict(v)]}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                판정 기록은 /brownfield 화면의 "사전 검토" 섹션에서 합니다 — 이 탭은 수집된 정보의 참고 저장소입니다.
              </p>
            </div>
            {evidence.length > 0 && (
              <div className="card">
                <h4 className="text-[0.9rem] mb-2">정보 수집 타임라인</h4>
                <ul className="sizing-note-list mb-0">
                  {evidence.map((e) => (
                    <li key={e.id} className="text-[0.78rem]">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={`status-chip ${e.kind === "discovery" ? "status-amber" : e.kind === "analysis" ? "status-amber" : "status-green"}`}>
                          {e.kind === "discovery" ? "등록" : e.kind === "analysis" ? "재분석" : "사전 검토"}
                        </span>
                        <strong>{e.title}</strong>
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)]">{e.created_at.slice(0, 16).replace("T", " ")}</span>
                      </span>
                      {e.detail && <span className="block text-[0.75rem] text-[color:var(--muted-fg)] whitespace-pre-wrap">{e.detail}</span>}
                      {e.source_url && (
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="text-[0.72rem] text-[color:var(--accent)] underline">출처</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {profileTab === "eval" && (
          <div className="mt-3">
            {(["financial", "technical"] as const).map((cat) => {
              const items = evalItems.filter((it) => it.category === cat);
              const catScore = scores[cat];
              return (
                <div key={cat} className="card mb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-[0.9rem] mb-0">{EVAL_CATEGORY_LABEL[cat]}</h4>
                    <span className={scoreChip(catScore.score)} title="충족 1점·부분충족 0.5점·미충족 0점을 항목 가중치로 가중평균 — 예외(해당없음·예외)는 계산에서 제외">
                      {catScore.score == null ? "점수 — 판정 필요" : `${catScore.score}점 / 100점`}
                    </span>
                  </div>
                  {catScore.totalWeight > catScore.scoredWeight && (
                    <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                      미판정 가중치 {catScore.totalWeight - catScore.scoredWeight} / 전체 {catScore.totalWeight} 남음 — 전 항목 판정 전까지는 잠정 점수입니다.
                    </p>
                  )}
                  {cat === "financial" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingFinancial.length === 0}
                        title="DART 재무 facts를 루브릭으로 계산해 미판정 항목의 판정 초안을 만듭니다 — 저장 전까지 화면 표시일 뿐입니다"
                        onClick={() => void generateEvalDraft("financial")}
                      >
                        {draftBusy && draftCategory === "financial" ? "계산 중..." : "재무 판정 초안 (DART)"}
                      </button>
                      {evalDraft && draftCategory === "financial" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title="표시된 초안(판정·근거 노트)을 판정으로 저장합니다 — 저장자는 현재 사용자로 기록됩니다"
                            onClick={() => void saveDraftVerdicts()}
                          >
                            초안 저장 ({proposedCount}건)
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>초안 버리기</button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-expanded={rubricOpen}
                        title="자동 초안의 판정 기준치(CAGR·마진·부채비율 상한 등)를 항목별로 조정합니다"
                        onClick={() => setRubricOpen(!rubricOpen)}
                      >
                        임계값 {rubricOpen ? "닫기" : "편집"}
                      </button>
                      {draftCategory !== "technical" && (
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          {draftNote ?? "DART facts로 미판정 항목의 판정 초안을 만듭니다 — 확인·수정 후 저장하며 확정은 항상 사람이 합니다 (경계 #2)."}
                        </span>
                      )}
                    </div>
                  )}
                  {cat === "technical" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingTechnical.length === 0}
                        title="최근 3년 DART 공시·회사 AI 프로파일·항목별 웹 검색을 근거로 판정 초안을 만듭니다 — 근거로 확인 안 되는 항목은 '확인 안됨'으로 표시됩니다"
                        onClick={() => void generateEvalDraft("technical")}
                      >
                        {draftBusy && draftCategory === "technical" ? "근거 수집 중..." : "기술 판정 초안 (공시·프로파일·웹)"}
                      </button>
                      {evalDraft && draftCategory === "technical" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title="표시된 초안(판정·근거 노트)을 판정으로 저장합니다 — 저장자는 현재 사용자로 기록됩니다"
                            onClick={() => void saveDraftVerdicts()}
                          >
                            초안 저장 ({proposedCount}건)
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>초안 버리기</button>
                        </>
                      )}
                      {draftCategory === "technical" ? (
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">{draftNote}</span>
                      ) : (
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          최근 3년 공시·AI 프로파일·웹 검색으로 근거를 모아 판정 초안을 만듭니다 — 근거로 확인 안 되는 항목은 "확인 안됨"으로 표시되고, 판정 확정은 항상 사람이 합니다 (경계 #2).
                        </span>
                      )}
                    </div>
                  )}
                  {items.length === 0 ? (
                    <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                      {cat === "technical"
                        ? "S3에 필요 역량이 정의되지 않아 기술 평가 항목이 없습니다 — 먼저 S3에서 정의하세요."
                        : "재무 평가 항목이 없습니다 — 불러오는 중이었을 수 있습니다."}
                    </p>
                  ) : (
                    <ul className="sizing-note-list mb-2" style={{ fontSize: "0.88rem" }}>
                      {items.map((it) => {
                        const draft = evalDraft?.[it.id];
                        return (
                          <li key={it.id} className="flex flex-wrap items-start gap-2">
                            <span className="flex-1 min-w-[14rem]">
                              {it.label}
                              {it.description && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{it.description}</span>}
                            </span>
                            {it.is_mandatory === 1 && <span className="status-chip status-amber">{it.source === "seeded" ? "S3 승계·필수" : "필수"}</span>}
                            <label className="text-[0.72rem] text-[color:var(--muted-fg)] flex items-center gap-1" title="가중치 — 카테고리 100점 점수 계산 시 이 항목의 상대 비중">
                              가중치
                              <input
                                type="number" min={1} step={1}
                                aria-label={`${it.label} 가중치`}
                                defaultValue={it.weight}
                                disabled={evalBusy === it.id}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (v > 0 && v !== it.weight) void setEvalWeight(it.id, v);
                                }}
                                className="sizing-new-input sizing-new-input-sm"
                                style={{ width: "4rem" }}
                              />
                            </label>
                            <select
                              aria-label={`${it.label} 판정`}
                              value={draft?.status ?? it.state?.status ?? "pending"}
                              disabled={evalBusy === it.id}
                              onChange={(e) => {
                                const v = e.target.value as "pending" | "pass" | "partial" | "fail" | "na" | "waived";
                                // 초안이 떠 있는 항목을 직접 바꾸면 근거 노트를 함께 기록하고 초안을 치운다.
                                void setEvalVerdict(it.id, v, draft ? draft.note : undefined);
                                if (draft) setEvalDraft((prev) => {
                                  if (!prev) return prev;
                                  const next = { ...prev };
                                  delete next[it.id];
                                  return next;
                                });
                              }}
                              className="sizing-new-input sizing-new-input-sm"
                            >
                              <option value="pending">미판정</option>
                              {EVAL_VERDICTS.map((v) => (
                                <option key={v} value={v}>{VERDICT_KO[v]}</option>
                              ))}
                            </select>
                            {it.is_deletable === 1 && (
                              <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === it.id} title="항목 삭제" onClick={() => void removeEvalCriterion(it.id)}>✕</button>
                            )}
                            {draft && (
                              <div className="w-full mt-1 flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  {draft.status ? (
                                    <span className="status-chip status-amber" title="근거 기반 자동 제안 — 확인·수정 후 저장하세요">자동 초안</span>
                                  ) : (
                                    <span className="status-chip status-not-started" title="근거로 확인되지 않아 판정 제안을 만들지 않았습니다 — 판정은 사람이 직접 내려주세요">확인 안됨</span>
                                  )}
                                  {draft.metrics.map((m) => (
                                    <span key={m.label} className="status-chip status-not-started" title={m.label}>{m.label} {m.value}</span>
                                  ))}
                                </div>
                                {!draft.status && draft.reason && (
                                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{draft.reason}</p>
                                )}
                                <input
                                  aria-label={`${it.label} 초안 근거 노트`}
                                  value={draft.note}
                                  placeholder="초안 근거 — 저장 시 판정 노트로 기록됩니다"
                                  onChange={(e) => setEvalDraft((prev) => (prev ? { ...prev, [it.id]: { ...prev[it.id], note: e.target.value } } : prev))}
                                  className="sizing-new-input sizing-new-input-sm"
                                />
                              </div>
                            )}
                            {rubricOpen && it.category === "financial" && it.source === "builtin" && isFinancialDataRef(it.data_ref) && (() => {
                              const rubric = parseRubric(it.data_ref, it.rubric_json);
                              return (
                                <div key={`${it.id}:${it.rubric_json ?? "default"}`} className="w-full mt-1 flex flex-wrap items-center gap-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                                  <span>임계값 —</span>
                                  {rubricFields(it.data_ref).map((f) => (
                                    <label key={f.key} className="flex items-center gap-1" title={f.hint}>
                                      {f.label}
                                      <input
                                        type="number" min={f.min} max={f.max} step={f.step}
                                        defaultValue={rubric[f.key]}
                                        disabled={rubricBusy === it.id}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (Number.isFinite(v) && v >= f.min && v <= f.max && v !== rubric[f.key]) void saveRubric(it.id, { [f.key]: v });
                                        }}
                                        className="sizing-new-input sizing-new-input-sm"
                                        style={{ width: "5rem" }}
                                        aria-label={`${it.label} ${f.label}`}
                                      />
                                      {f.unit}
                                    </label>
                                  ))}
                                </div>
                              );
                            })()}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      aria-label={`${EVAL_CATEGORY_LABEL[cat]} 항목 추가`}
                      placeholder="+ 항목 추가"
                      value={newCriterionLabel[cat] ?? ""}
                      onChange={(e) => setNewCriterionLabel((prev) => ({ ...prev, [cat]: e.target.value }))}
                      className="sizing-new-input sizing-new-input-sm"
                      style={{ flex: "1 1 12rem" }}
                    />
                    <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === cat || !(newCriterionLabel[cat] ?? "").trim()} onClick={() => void addEvalCriterion(cat)}>추가</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {profileTab === "sources" && (
          <div className="card mt-3">
            <h4 className="text-[0.9rem] mb-2">출처 · 데이터</h4>
            {!companyId ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">회사 마스터가 아직 연결되지 않았습니다.</p>
            ) : companyProfile === undefined ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">불러오는 중...</p>
            ) : !companyProfile?.profile ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">AI 분석을 먼저 실행하면 리서치 출처가 여기에 표시됩니다.</p>
            ) : (
              <>
                <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                  DART {companyProfile.profile.dataSources?.dart ? `공시(${companyProfile.profile.dataSources.dartYear ?? "—"}년)` : "미입수"} ·
                  {" "}외부 웹 리서치 {companyProfile.profile.dataSources?.webResearchCount ?? 0}건
                </p>
                {companyProfile.profile.dartFinancials?.available && (
                  <p className="mb-2 text-[0.88rem]">
                    <span className="status-chip status-green mr-1">DART</span>
                    전자공시 사업보고서 ({companyProfile.profile.dartFinancials.year}년)
                    {companyProfile.profile.dartFinancials.reportUrl && (
                      <> — <a href={companyProfile.profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a></>
                    )}
                  </p>
                )}
                {companyProfile.profile.researchSources.length === 0 ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">웹 리서치 출처가 없습니다.</p>
                ) : (
                  <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                    {companyProfile.profile.researchSources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                        {s.snippet && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{s.snippet}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>
      {confirmDialog}
    </main>
  );
}

export default function BrownfieldTargetPage() {
  return (
    <Suspense fallback={null}>
      <TargetDetailView />
    </Suspense>
  );
}

// ── 경쟁사 레지스트리 블록 (ADR-0142 후속) — md_company 주체 관리 표면.
// 확정 목록·payload 제안 수용·수작업 등록·제외/복원을 이 화면에서 끝낸다.
// 수용·등록은 사람의 행위(경계 #2) — 제안은 어디까지나 제안이다.
function CompetitorRegistryBlock({ companyId, payloadCompetitors }: {
  companyId: string;
  payloadCompetitors: Array<{ name: string; note: string }>;
}) {
  interface Row { id: string; name: string; dart_corp_code: string | null; note: string | null; status: "confirmed" | "excluded"; exclusion_reason: string | null; discovery_source: "manual" | "ai_proposal"; proposal_accepted_at: string; crosscheck_verdict: string | null }
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<{ id: string; reason: string } | null>(null);
  const [form, setForm] = useState({ name: "", dart_corp_code: "", note: "" });

  const load = useCallback(() => {
    api.get<{ competitors: Row[] }>(`/api/companies/${encodeURIComponent(companyId)}/competitors?includeExcluded=1`)
      .then((r) => setRows(r.data.competitors ?? []))
      .catch(() => setRows([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const confirmed = (rows ?? []).filter((r) => r.status === "confirmed");
  const excluded = (rows ?? []).filter((r) => r.status === "excluded");
  const confirmedNames = new Set(confirmed.map((c) => c.name));
  const openProposals = payloadCompetitors.filter((p) => !confirmedNames.has(p.name));

  async function post(url: string, body: unknown) {
    setBusy(true); setError(null);
    try {
      await api.post(url, body);
      load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      return false;
    } finally { setBusy(false); }
  }

  return (
    <div className="market-section mt-2">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h4 className="text-[0.88rem] font-semibold m-0">확정 경쟁사</h4>
        <span className="status-chip status-green">{confirmed.length}건</span>
        <span className="text-[0.72rem] text-[color:var(--muted-fg)]">AI 제안 수용 또는 수작업 등록으로만 생긴다 (ADR-0142)</span>
      </div>
      {error && <p role="alert" className="mb-2 text-[0.78rem] text-[color:var(--red-fg)]">{error}</p>}
      {confirmed.length === 0 ? (
        <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">아래 AI 제안을 수용하거나 직접 등록하세요.</p>
      ) : (
        <ul className="sizing-note-list mb-2">
          {confirmed.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b> — {c.note || "—"}{" "}
              <span className={`status-chip ml-1 ${c.discovery_source === "ai_proposal" ? "status-in-progress" : "status-not-started"}`}>{c.discovery_source === "ai_proposal" ? "AI 제안 수용" : "수작업"}</span>
              {excluding?.id === c.id ? (
                <span className="actions-row ml-2">
                  <input value={excluding.reason} onChange={(e) => setExcluding({ ...excluding, reason: e.target.value })} className="sizing-new-input" style={{ width: "10rem" }} placeholder="제외 사유 *" aria-label="제외 사유" />
                  <button type="button" className="btn-danger btn-sm" disabled={busy || !excluding.reason.trim()} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors/${encodeURIComponent(c.id)}/exclude`, { reason: excluding.reason.trim() }).then((ok) => { if (ok) setExcluding(null); })}>확인</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setExcluding(null)}>취소</button>
                </span>
              ) : (
                <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => setExcluding({ id: c.id, reason: "" })}>제외</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {excluded.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[0.78rem] text-[color:var(--muted-fg)]">제외됨 {excluded.length}건</summary>
          <ul className="sizing-note-list">
            {excluded.map((c) => (
              <li key={c.id}>{c.name} — {c.exclusion_reason ?? "사유 없음"}{" "}
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors/${encodeURIComponent(c.id)}/restore`, {})}>복원</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {openProposals.length > 0 && (
        <div className="mb-2">
          <p className="text-[0.78rem] font-semibold mb-1">AI 제안 (미확정) {openProposals.length}건</p>
          <ul className="sizing-note-list mb-0">
            {openProposals.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b> — {p.note || "—"}{" "}
                <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors`, { name: p.name, note: p.note || null, discovery_source: "ai_proposal" })}>수용</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="sizing-new-input" style={{ width: "12rem" }} placeholder="경쟁사명 *" aria-label="경쟁사명" />
        <input value={form.dart_corp_code} onChange={(e) => setForm({ ...form, dart_corp_code: e.target.value })} className="sizing-new-input" style={{ width: "9rem" }} placeholder="DART 고유번호 (선택)" aria-label="경쟁사 DART 고유번호" />
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 10rem" }} placeholder="경쟁 관계 (선택)" aria-label="경쟁 관계" />
        <button type="button" className="btn-primary btn-sm" disabled={busy || !form.name.trim()} onClick={() => void post(`/api/companies/${encodeURIComponent(companyId)}/competitors`, { name: form.name, dart_corp_code: form.dart_corp_code || null, note: form.note || null, discovery_source: "manual" }).then((ok) => { if (ok) setForm({ name: "", dart_corp_code: "", note: "" }); })}>등록</button>
      </div>
    </div>
  );
}
