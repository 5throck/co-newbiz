"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import type { useOurCompanyBase } from "./useOurCompanyBase.ts";
import type { useOurCompetitors } from "./useOurCompetitors.ts";
import type { GroupRow, GroupDetail, Profile } from "./types.ts";
import { evidenceBody, evidenceFromProfile, type EvidenceDraft } from "./profile-evidence.ts";

export function useOurGroups(prev: ReturnType<typeof useOurCompanyBase> & ReturnType<typeof useOurCompetitors>) {
  const { urlSync, router, setLocalMember, setOpenMember, profiles, openMember, setSynergyLink, searchParams, localMember, setGroups, setError, setSelectedGroup, selectedGroup, setProfiles, groupName, busy, setBusy, setGroupName, setShowGroupForm, memberForm, dartSearching, setDartSearching, setDartResults, groupNameDraft, setEditGroupName, confirm, setMemberForm, setShowMemberForm, setEditMember, editMember, savingMember, setSavingMember, savingRole, setSavingRole, setUploadingMember, setUploadedNames, setProfileTab, setS1Requests } = prev;
 const [loadingGroupId, setLoadingGroupId] = useState<string | null>(null);
 // 분석가 제공 근거 입력(주소·메모) — 멤버별 초안. 없으면 마지막 저장 버전의 입력을 재사용한다.
 const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, EvidenceDraft>>({});
 const [profileVersions, setProfileVersions] = useState<Record<string, Array<{ version_no: number; source_ref: string | null; created_by: string; created_at: string }>>>({});
 const [editBusy, setEditBusy] = useState(false);
 const setEvidenceDraft = (memberId: string, draft: EvidenceDraft) => setEvidenceDrafts((p) => ({ ...p, [memberId]: draft }));
 // 리포트 차트 테마 — 훅은 최상위에서 1회만 호출

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
    setLoadingGroupId(id);
    api.get<GroupDetail>(`/api/our-company/groups/${encodeURIComponent(id)}`).then((r) => setSelectedGroup(r.data)).catch((e) => setError(e instanceof Error ? e.message : "그룹 불러오기 실패")).finally(() => setLoadingGroupId((cur) => (cur === id ? null : cur)));
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
    const body = evidenceBody(evidenceDrafts[memberId] ?? evidenceFromProfile(profiles[memberId]));
    const start = () => api.post(`/api/our-company/members/${memberId}/analyze`, body);
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
      const r = await api.get<{ profile: Profile | null; versions?: Array<{ version_no: number; source_ref: string | null; created_by: string; created_at: string }>; status: string }>(`/api/our-company/members/${memberId}/profile`);
      if (r.data.versions) setProfileVersions((prev) => ({ ...prev, [memberId]: r.data.versions! }));
      if (r.data.profile) setProfiles((prev) => ({ ...prev, [memberId]: r.data.profile! }));
      else setProfiles((prev) => { const n = { ...prev }; delete n[memberId]; return n; });
    } catch { /* 프로파일 없음 */ }
  }

  // 분석가 편집(출처 추가·필드 수정) — 사람이 직접 하는 변경이며 새 버전으로 저장된다(ADR-0172 개정 4).
  // 로딩 상태로 되돌리지 않고 최신 버전을 다시 읽는다.
  async function runProfileEdit(memberId: string, call: () => Promise<unknown>): Promise<boolean> {
    setEditBusy(true);
    setError(null);
    try {
      await call();
      const r = await api.get<{ profile: Profile | null; versions?: Array<{ version_no: number; source_ref: string | null; created_by: string; created_at: string }> }>(`/api/our-company/members/${memberId}/profile`);
      if (r.data.profile) setProfiles((prev) => ({ ...prev, [memberId]: r.data.profile! }));
      if (r.data.versions) setProfileVersions((prev) => ({ ...prev, [memberId]: r.data.versions! }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로파일 수정 실패");
      return false;
    } finally {
      setEditBusy(false);
    }
  }
  const addManualSource = (memberId: string, input: { url: string; title: string; excerpt: string }) =>
    runProfileEdit(memberId, () => api.post(`/api/our-company/members/${memberId}/profile/sources`, input));
  const updateManualSource = (memberId: string, sourceId: string, input: { url: string; title: string; excerpt: string }) =>
    runProfileEdit(memberId, () => api.patch(`/api/our-company/members/${memberId}/profile/sources/${sourceId}`, input));
  const removeManualSource = (memberId: string, sourceId: string) =>
    runProfileEdit(memberId, () => api.delete(`/api/our-company/members/${memberId}/profile/sources/${sourceId}`));
  const saveFieldOverrides = (memberId: string, input: Record<string, unknown>) =>
    runProfileEdit(memberId, () => api.post(`/api/our-company/members/${memberId}/profile/overrides`, input));

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
  return { loadingGroupId, evidenceDrafts, setEvidenceDraft, profileVersions, editBusy, addManualSource, updateManualSource, removeManualSource, saveFieldOverrides, createGroup, backToList, loadGroup, saveGroupName, removeGroup, addMember, searchMemberDart, saveMemberEdit, openDetail, updateMemberRole, analyzeMember, startMemberEdit, uploadMemberFile, removeMember, requestS1Analysis };
}

export type OurCompanyStageState = ReturnType<typeof useOurCompanyBase> & ReturnType<typeof useOurCompetitors> & ReturnType<typeof useOurGroups>;
