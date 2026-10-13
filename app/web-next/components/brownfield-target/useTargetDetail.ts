"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useConfirm } from "../crud.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import { api } from "../../lib/api.ts";
import type { DetailResponse, CompanyProfileResp, EvalDraftItem, FinancialsResp, DisclosuresResp } from "./types.ts";

export function useTargetDetail() {

  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const params = useParams<{ targetId: string }>();
  const targetId = params?.targetId ?? "";
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  // 프로파일 탭 — 그룹/계열사 프로파일과 유사한 구조(library-tabs 패턴).
  // "사전 검토 근거"는 읽기 전용 참고 탭 — 수집된 근거가 있을 때만 탭 목록에
  // 나타난다. 판정 기록은 /brownfield 최종 후보 목록 "사전 검토" 섹션에서 한다.
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
    if (!canAct) return; // 쓰기 권한이 없으면 자동 동기화(POST)를 보내지 않는다 — 서버가 403으로 거부한다
    if (!companyId || !dartCode) return;
    if (financials === undefined) return; // 아직 로딩 중
    if (financials !== null && financials.analysis.years.length > 0) return; // 이미 있음
    if (autoSyncedFor === companyId) return; // 이미 자동 시도함(재동기화 없음 → 재요청 안 함)
    setAutoSyncedFor(companyId);
    api.post(`/api/companies/${encodeURIComponent(companyId)}/sync`, {}).then(loadFinancials).catch(() => {});
  }, [canAct, companyId, dartCode, financials, autoSyncedFor, loadFinancials]);

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
  return { oppId, setEvalBusy, targetId, loadDetail, setError, draftBusy, setDraftBusy, setDraftNote, setDraftCategory, setEvalDraft, evalDraft, busy, setBusy, setRubricBusy, newCriterionLabel, setNewCriterionLabel, excludeReason, editDraft, setEditing, error, canAct, setExcludeReason, profileTab, setProfileTab, analyzing, companyProfile, companyId, runCompanyAnalysis, confirm, confirmDialog, detail, editing, setEditDraft, ct, dartCode, discPreset, setDiscPreset, disclosures, draftCategory, rubricOpen, setRubricOpen, draftNote, evalBusy, rubricBusy };
}
