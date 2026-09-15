"use client";

// S6/S7 후보 상세 화면 (/brownfield/targets/[targetId]) — 목록의 드릴다운을
// 대체하는 전용 페이지(사용자 결정, 2026-09-15). DART 연결 회사는 재무 facts와
// 공시(사업보고서 등)를 이 화면에서 바로 확인·활용하고, 재무 판정의 참고값을
// DART가 채워주므로 사람의 판정 작업이 기술 평가 중심이 된다(경계 #2 — 판정은
// 항상 사람이 select로 기록한다).

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { ListBackButton } from "../../../../components/ListBackButton.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { EChart } from "../../../../components/EChart.tsx";
import { useChartTheme } from "../../../../lib/echarts-theme.ts";

interface TargetDetail {
  id: string; opportunity_id: string; company_name: string; dart_corp_code: string | null;
  universe_note: string | null; status: "pending" | "shortlisted" | "excluded";
  rank: number | null; exclusion_reason: string | null; screening_json: string | null;
  company_id: string | null;
}
interface EvalItem {
  id: string; category: "financial" | "technical"; source: "builtin" | "seeded" | "custom";
  label: string; description: string | null; is_mandatory: 0 | 1; is_deletable: 0 | 1; weight: number;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
interface EvalCategoryScore { score: number | null; scoredWeight: number; totalWeight: number; excludedWeight: number }
interface DetailResponse {
  target: TargetDetail;
  opportunity: { id: string; name: string; market_scope: string | null };
  evalItems: EvalItem[];
  scores: Record<"financial" | "technical", EvalCategoryScore> & { combined: number | null };
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
const DISCLOSURE_DART_LINK = "https://dart.fss.or.kr";
const PROFILE_TABS: Array<["overview" | "aiprofile" | "financials" | "disclosures" | "eval" | "sources", string]> = [
  ["overview", "개요"],
  ["aiprofile", "강·약점 SWOT"],
  ["financials", "재무"],
  ["disclosures", "공시"],
  ["eval", "평가"],
  ["sources", "출처"],
];

export function TargetDetailView() {
  const params = useParams<{ targetId: string }>();
  const targetId = params?.targetId ?? "";
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  // 프로파일 탭 — 그룹/계열사 프로파일과 유사한 구조(library-tabs 패턴).
  const [profileTab, setProfileTab] = useState<"overview" | "aiprofile" | "financials" | "disclosures" | "eval" | "sources">("overview");
  // AI 분석 — 그룹/계열사 화면과 동일한 LLM 프로파일 파이프라인 재사용(일반화, 2026-09-15).
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileResp | null | undefined>(undefined);
  const [analyzing, setAnalyzing] = useState(false);
  // 후보 정보 수정/삭제(개요 탭) — 등록 후에도 고칠 수 있어야 한다(사용자 요청).
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ company_name: "", dart_corp_code: "", universe_note: "" });
  const { confirm, confirmDialog } = useConfirm();
  const ct = useChartTheme();
  // 재무·기술 평가
  const [evalBusy, setEvalBusy] = useState<string | null>(null);
  const [newCriterionLabel, setNewCriterionLabel] = useState<Record<string, string>>({});
  // DART
  const [financials, setFinancials] = useState<FinancialsResp | null | undefined>(undefined); // undefined=로딩
  const [financialsSyncing, setFinancialsSyncing] = useState(false);
  const [discPreset, setDiscPreset] = useState("business");
  const [disclosures, setDisclosures] = useState<DisclosuresResp | null | undefined>(undefined);

  const oppId = detail?.opportunity.id ?? "";
  const companyId = detail?.target.company_id ?? null;
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

  // DART 연결 회사인데 로컬에 재무 facts가 아직 없으면 자동으로 1회 동기화한다
  // — "DART 정보가 있는데 화면엔 안 보인다"는 문제는 실제로는 버그가 아니라
  // 수동 동기화 클릭이 필요했던 것이었다(사용자 리포트, 2026-09-15). companyId당
  // 1회만 시도(autoSyncedFor로 추적)해 무한 재시도를 막는다.
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

  async function syncFinancials() {
    if (!companyId) return;
    setFinancialsSyncing(true);
    try {
      await api.post(`/api/companies/${encodeURIComponent(companyId)}/sync`, {});
      loadFinancials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재무 데이터 동기화 실패");
    } finally {
      setFinancialsSyncing(false);
    }
  }

  async function setEvalVerdict(criterionId: string, status: "pending" | "pass" | "partial" | "fail" | "na" | "waived") {
    if (!oppId) return;
    setEvalBusy(criterionId);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(oppId)}/targets/${encodeURIComponent(targetId)}/eval-state/${encodeURIComponent(criterionId)}`, { status });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가 판정 저장 실패");
    } finally {
      setEvalBusy(null);
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

  const { target: t, opportunity, evalItems, scores } = detail;
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
            {PROFILE_TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={profileTab === key} className={`library-tab ${profileTab === key ? "library-tab-active" : ""}`} onClick={() => setProfileTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {/* 탭별 핵심 액션 — 탭 목록과 같은 줄 오른쪽에 배치(사용자 요청,
              2026-09-15). 개요=정보 수정·후보 삭제, 강·약점 SWOT=재분석. */}
          <span className="flex items-center gap-1">
            {profileTab === "overview" && !editing && (
              <>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>정보 수정</button>
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
              </>
            )}
            {profileTab === "aiprofile" && companyId && companyProfile != null && (
              <button type="button" className="btn-ghost btn-sm" disabled={analyzing || companyProfile.status === "in_progress" || !companyId} onClick={() => void runCompanyAnalysis()}>
                {companyProfile.status === "in_progress" ? "분석 중..." : companyProfile.profile ? "재분석" : "AI 분석 실행"}
              </button>
            )}
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
          <div className="card mt-3 text-[0.85rem]">
            <h4 className="text-[0.85rem] mb-2">🏢 {companyProfile.profile.companyName} AI 프로파일</h4>
            {companyProfile.profile.ragCapRecommendation && (
              <div className="sizing-grade-card mb-3">
                <h4 className="text-[0.85rem] mb-2">🚦 신뢰도 상한 권고</h4>
                <span className={`status-chip ${companyProfile.profile.ragCapRecommendation.grade === "green" ? "status-green" : companyProfile.profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                  상한 {companyProfile.profile.ragCapRecommendation.grade.toUpperCase()}
                </span>
                <p className="mt-2 mb-0 text-[0.8rem]">{companyProfile.profile.ragCapRecommendation.rationale}</p>
              </div>
            )}
            <h3 className="sizing-step-title text-[0.85rem]">종합 평가</h3>
            <p className="mb-3">{companyProfile.profile.businessAssessment || "—"}</p>
            <h3 className="sizing-step-title text-[0.85rem]">산업 노출</h3>
            {companyProfile.profile.industryExposure.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {companyProfile.profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
              </div>
            ) : <p className="text-[color:var(--muted-fg)] italic text-[0.78rem] mb-0">산업 노출 정보 없음</p>}
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
                        <ul className="report-bullet-list">{companyProfile.profile.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>🩹 약점</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                      {companyProfile.profile.swot && (
                        <>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>🌱 기회</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.opportunities.map((x, i) => <li key={i}>{x}</li>)}</ul>
                          </div>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>⛈️ 위협</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.threats.map((x, i) => <li key={i}>{x}</li>)}</ul>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {companyProfile.profile.businessAssessment || "—"}</p>

                    {companyProfile.profile.competitive && !companyProfile.profile.competitive.degraded && (
                      <>
                        <h3 className="sizing-step-title text-[0.95rem] mt-3">경쟁 포지셔닝</h3>
                        <p className="mb-2">{companyProfile.profile.competitive.positioning || "—"}</p>
                        {companyProfile.profile.competitive.competitors.length > 0 && (
                          <ul className="sizing-note-list mb-0">
                            {companyProfile.profile.competitive.competitors.map((c, i) => <li key={i}><b>{c.name}</b> — {c.note}</li>)}
                          </ul>
                        )}
                      </>
                    )}

                    {companyProfile.profile.researchSources.length > 0 && (
                      <p className="mt-3 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">
                        리서치 출처 {companyProfile.profile.researchSources.length}건 — <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>출처 탭</button>에서 확인하세요.
                      </p>
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
                  <h4 className="text-[0.85rem] mb-2">DART 재무 현황 ({companyProfile.profile.dartFinancials!.year}년)</h4>
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
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-[0.85rem] mb-0">
                재무 facts {dartCode ? <span className="status-chip status-green ml-1">DART · {dartCode}</span> : <span className="status-chip status-not-started ml-1">미연결</span>}
              </h4>
              <span className="flex items-center gap-1">
                {companyId && (
                  <button type="button" className="btn-ghost btn-sm" disabled={financialsSyncing} onClick={() => void syncFinancials()}>
                    {financialsSyncing ? "동기화 중..." : "재무 데이터 동기화"}
                  </button>
                )}
                {dartCode && (
                  <a className="btn-ghost btn-sm" href={`${DISCLOSURE_DART_LINK}`} target="_blank" rel="noreferrer">DART에서 열기</a>
                )}
              </span>
            </div>
            {!dartCode || !companyId ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">
                DART 고유번호가 없어 재무 facts를 조회할 수 없습니다 — 등록 시 8자리 고유번호를 입력하면 연결됩니다.
              </p>
            ) : financials === undefined ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">재무 데이터 불러오는 중...</p>
            ) : financials === null || financials.analysis.years.length === 0 ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">동기화된 재무 facts가 없습니다 — "재무 데이터 동기화"로 DART에서 가져오세요.</p>
            ) : (
              <div className="p-2 text-[0.78rem]" style={{ background: "var(--surface-2)", borderRadius: "0.5rem" }}>
                {financials.analysis.years.length < 5 && (
                  <p className="mb-1 text-[color:var(--muted-fg)]">데이터 부족 — {financials.analysis.years.length}개년만 확인됨(5개년 미만).</p>
                )}
                {(["revenue", "operatingProfit", "totalDebt"] as const).map((key) => {
                  const sr = financials.analysis.series.find((x) => x.key === key);
                  if (!sr) return null;
                  return (
                    <p key={key} className="mb-0.5">
                      {sr.label} {sr.points.map((pt) => (pt.value === null ? "—" : pt.value.toLocaleString())).join(" → ")}억원
                    </p>
                  );
                })}
                {(() => {
                  const latest = financials.analysis.ratios[financials.analysis.ratios.length - 1];
                  if (!latest) return null;
                  const pct = (v: number | null | undefined) => (v != null ? `${(v * 100).toFixed(1)}%` : "—");
                  return (
                    <p className="mb-0 text-[color:var(--muted-fg)]">
                      {latest.year} 참고 비율 — 영업이익률 {pct(latest.operatingMargin)} ·
                      {" "}순이익률 {pct(latest.netMargin)} ·
                      {" "}부채비율 {pct(latest.debtRatio)}
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
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
                  <ul className="sizing-note-list mb-0" style={{ maxHeight: "16rem", overflowY: "auto" }}>
                    {disclosures.disclosures.map((d) => (
                      <li key={d.rcept_no} className="flex flex-wrap items-center gap-2">
                        <code className="dd-item-id">{d.rcept_dt}</code>
                        <span className="flex-1 min-w-[16rem]">{d.report_nm}</span>
                        {d.viewer_url && (
                          <a href={d.viewer_url} target="_blank" rel="noreferrer" className="text-[0.75rem] text-[color:var(--accent)] underline">보고서 열기</a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
                    <h4 className="text-[0.85rem] mb-0">{EVAL_CATEGORY_LABEL[cat]}</h4>
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
                    <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                      참고값은 <b>재무</b> 탭(DART facts)에서 확인하세요 — 판정은 사람이 select로 기록합니다 (경계 #2).
                    </p>
                  )}
                  {items.length === 0 ? (
                    <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                      {cat === "technical"
                        ? "S3에 필요 역량이 정의되지 않아 기술 평가 항목이 없습니다 — 먼저 S3에서 정의하세요."
                        : "재무 평가 항목이 없습니다 — 불러오는 중이었을 수 있습니다."}
                    </p>
                  ) : (
                    <ul className="sizing-note-list mb-2">
                      {items.map((it) => (
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
                            value={it.state?.status ?? "pending"}
                            disabled={evalBusy === it.id}
                            onChange={(e) => void setEvalVerdict(it.id, e.target.value as "pending" | "pass" | "partial" | "fail" | "na" | "waived")}
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
                        </li>
                      ))}
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
            <h4 className="text-[0.85rem] mb-2">출처 · 데이터</h4>
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
                  <p className="mb-2 text-[0.78rem]">
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
                  <ul className="sizing-note-list mb-0">
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
