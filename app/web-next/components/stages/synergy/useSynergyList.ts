"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useEffect, useRef } from "react";
import { useConfirm } from "../../crud.tsx";
import { api } from "../../../lib/api.ts";
import type { SynergyAnalysis } from "./types.ts";
import { tabFromParam, type TabKey } from "./synergyFormat.ts";

export function useSynergyList({ opportunityId, analysisId, embedded, noSourceOpportunity }: { opportunityId?: string; analysisId?: string; embedded?: boolean; noSourceOpportunity?: boolean }) {

  const { me } = useAuth();
  const canCurate = canWriteBusiness(me?.role);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [analyses, setAnalyses] = useState<SynergyAnalysis[] | null>(null);
  const [selected, setSelected] = useState<SynergyAnalysis | null>(null);
  const [detail, setDetail] = useState<SynergyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [corpCode, setCorpCode] = useState("");
  // 새 분석 폼 — 대상(그룹/계열사 레지스트리) + 기회 연결 (ADR-0090)
  const [showNewForm, setShowNewForm] = useState(false);
  const [targets, setTargets] = useState<Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }>>([]);
  const [targetSel, setTargetSel] = useState<{ kind: "affiliate" | "group"; id: string } | null>(null);
  const [opps, setOpps] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [oppSel, setOppSel] = useState("");
  const [creating, setCreating] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  // 딥링크 계약(2026-10-22 리뷰 N) — ?tab=decision이면 상세 화면을 「의사결정」
  // 탭으로 연다(의사결정 탭은 상세 뷰 안에 산다). 마운트 시 1회 해석한다.
  const [tab, setTab] = useState<TabKey>(() => tabFromParam(searchParams.get("tab")) ?? "linkage");
  // S3 deal scope (design 2026-10-11): inside a deal the list defaults to this deal's analyses.
  const dealScoped = !!embedded && (!!opportunityId || !!noSourceOpportunity);
  const [scope, setScope] = useState<"deal" | "all">("deal");
  const listUrl = dealScoped && scope === "deal"
    ? `/api/synergy/analyses?opportunityId=${encodeURIComponent(opportunityId!)}`
    : "/api/synergy/analyses";

  const urlSync = !analysisId && !embedded;
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(analysisId ?? null);
  const selectedId = urlSync ? searchParams.get("company") : localSelectedId;

  const changeScope = useCallback((next: "deal" | "all") => {
    if (next !== scope) { setAnalyses(null); setScope(next); }
  }, [scope]);

  const refresh = useCallback(() => {
    loadTargets(); // 대상(그룹/계열사 프로파일) 목록 갱신 — ADR-0090
    // Project deal without a source opportunity: nothing can be linked, skip the fetch.
    if (dealScoped && scope === "deal" && !opportunityId) { setAnalyses([]); setError(null); return Promise.resolve(); }
    return api.get<{ analyses: SynergyAnalysis[] }>(listUrl)
      .then((r) => { setAnalyses(r.data.analyses); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [listUrl, dealScoped, scope, opportunityId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL(?company=) 기반 선택 — 상단 바 뒤로 가기와 연동
  useEffect(() => {
    if (!selectedId) {
      // 뒤로 가기(목록 복귀) — 선택 상태를 해제한다
      setSelected(null);
      setDetail(null);
      return;
    }
    if (analyses === null) return;
    const found = analyses.find((a) => a.id === selectedId) ?? null;
    setSelected(found);
    if (!found) { setDetail(null); return; }
    if (found.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(found.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    } else {
      setDetail(null);
    }
  }, [selectedId, analyses]);

  const hasInProgress = analyses?.some((a) => a.status === "in_progress" || !!a.rerun_in_progress) ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [hasInProgress, refresh]);

  // 선택한 회사의 분석이 완료되면 상세 리포트를 자동으로 활성화한다
  useEffect(() => {
    if (!selectedId || selected?.status !== "in_progress") return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(selectedId)}`);
        if (r.data.status === "completed") { setDetail(r.data); setSelected(r.data); }
      } catch { /* 다음 폴링에서 재시도 */ }
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, selected?.status]);

  const refreshDetail = useCallback((analysisId: string) => {
    return api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(analysisId)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const openDetail = useCallback((a: SynergyAnalysis) => {
    if (urlSync) router.replace(`/synergy?company=${encodeURIComponent(a.id)}`);
    else setLocalSelectedId(a.id);
    setSelected(a);
    setDetail(null);
    if (a.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(a.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    }
  }, [urlSync, router]);

  // deals 탭 — 캐리어 기회에 연결된 분석을 1회 자동 선택한다(?analysis= 딥링크가
  // 없을 때). 완료된 분석을 우선하고, 없으면 진행 중인 분석이라도 선택한다.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (!embedded || analysisId || autoPickedRef.current || analyses === null) return;
    autoPickedRef.current = true;
    const linked = analyses.filter((a) => a.opportunity_id === opportunityId);
    const pick = linked.find((a) => a.status === "completed") ?? linked[0];
    if (pick) setLocalSelectedId(pick.id);
  }, [embedded, analysisId, opportunityId, analyses]);

  const loadTargets = useCallback(() => {
    api.get<{ groups: Array<{ id: string; name: string; member_count: number }> }>("/api/our-company/groups")
      .then(async (gr) => {
        const out: Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }> = [];
        for (const g of gr.data.groups) {
          const detail = await api.get<{ members: Array<{ id: string; company_name: string; latest_version: number | null }> }>(`/api/our-company/groups/${encodeURIComponent(g.id)}`);
          out.push({ kind: "group", id: g.id, label: `그룹 전체 (${g.name})`, groupName: g.name, hasProfile: detail.data.members.some((m) => m.latest_version !== null) });
          for (const m of detail.data.members) {
            out.push({ kind: "affiliate", id: m.id, label: m.company_name, groupName: g.name, hasProfile: m.latest_version !== null });
          }
        }
        setTargets(out);
      })
      .catch(() => setTargets([]));
    // GET /api/opportunities returns the rows array directly in `data` (same as
    // app/page.tsx) — parsing it as { rows } used to throw on undefined and the
    // .catch silently emptied the 기회 dropdown.
    api.get<Array<{ id: string; name: string; status: string }>>("/api/opportunities")
      .then((r) => setOpps(r.data))
      .catch(() => setOpps([]));
  }, []);

  async function createAnalysis() {
    if (!targetSel || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", {
        targetType: targetSel.kind,
        memberId: targetSel.kind === "affiliate" ? targetSel.id : undefined,
        groupId: targetSel.kind === "group" ? targetSel.id : undefined,
        opportunityId: oppSel || undefined,
      });
      const list = await api.get<{ analyses: SynergyAnalysis[] }>(listUrl);
      setAnalyses(list.data.analyses);
      setShowNewForm(false);
      const created = list.data.analyses.find((x) => x.id === res.data.analysis_id);
      if (created) openDetail({ ...created, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 시작 실패");
    } finally {
      setCreating(false);
    }
  }

  function removeAnalysis(a: SynergyAnalysis) {
    confirm(
      `${a.company_name} 시너지 분석 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/synergy/analyses/${encodeURIComponent(a.id)}`);
          if (selected?.id === a.id) backToList();
          refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "시너지 분석 삭제 실패");
        }
      },
      { body: "이 분석과 버전 전체가 삭제됩니다. 회사 마스터(그룹/계열사·프로젝트 연결)는 유지됩니다." },
    );
  }

  const backToList = useCallback(() => {
    if (urlSync) router.replace("/synergy");
    else setLocalSelectedId(null);
    setSelected(null);
    setDetail(null);
    void refresh();
  }, [refresh, urlSync, router]);




  async function rerun(a: SynergyAnalysis, opts: { stayOnList?: boolean } = {}) {
    setError(null);
    try {
      // ADR-0094 — 동일 분석 행을 재실행하고 파이프라인이 새 버전을 append한다.
      // 목록에서 누른 재분석은 목록에 머문다 — 진행 상태는 행의 "재분석 중
      // (N/5단계)" 칩으로 추적하고(진행 중에는 목록이 4초 폴링된다), 상세
      // 화면 이동은 사람이 연결 기회를 클릭했을 때만 일어난다(2026-09-15
      // 사용자 리포트). 상세 화면 안의 재분석은 그 화면에 머물며 진행 칩과
      // 완료 시 리포트 갱신을 위해 in_progress로 전환한다.
      await api.post<{ analysis_id: string; reused: boolean }>(`/api/synergy/analyses/${encodeURIComponent(a.id)}/rerun`, {});
      if (opts.stayOnList) void refresh();
      else openDetail({ ...a, status: "in_progress", latest_version: a.latest_version });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재분석 시작 실패");
    }
  }
  return { dealScoped, scope, setScope: changeScope, confirmDialog, error, opportunityId, selected, detail, tab, setTab, backToList, rerun, refreshDetail, analyses, canCurate, setShowNewForm, showNewForm, selectedId, openDetail, removeAnalysis, hasInProgress, targets, targetSel, setTargetSel, oppSel, setOppSel, opps, creating, createAnalysis };
}

export type SynergyStageState = ReturnType<typeof useSynergyList>;
