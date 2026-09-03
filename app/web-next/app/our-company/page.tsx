"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useConfirm, RowEdit } from "../../components/crud.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import dynamic from "next/dynamic";
import { useChartTheme } from "../../lib/echarts-theme.ts";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// 그룹/계열사 분석 (/our-company) — 그룹/계열사 2단계 자사 프로파일.
// S3 시너지·적합성 평가의 입력(자사 역량·포트폴리오 정보)을 만든다.
// 레이아웃은 S1 시장분석 패턴: 그룹 선택 → 계열사 테이블 → 선택 시 탭 리포트.

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
}
interface GroupDetail {
  group: { id: string; name: string; created_at: string };
  members: MemberRow[];
  profiles: Array<{ member_id: string; company_name: string; role: string; latest_version: number | null; profile: Profile | null }>;
}

const PROFILE_TABS = [
  ["profile", "프로파일"],
  ["strengths", "강점/약점"],
  ["sources", "출처·데이터"],
] as const;

type ProfileTabKey = (typeof PROFILE_TABS)[number][0];

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

export function OurCompanyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [uploadingMember, setUploadingMember] = useState<string | null>(null);
  const [uploadedNames, setUploadedNames] = useState<Record<string, string>>({});
  const [openMember, setOpenMember] = useState<string | null>(null);

  const [profileTab, setProfileTab] = useState<ProfileTabKey>("profile");
  const [profiles, setProfiles] = useState<Record<string, Profile | "loading">>({});
  const { confirm, confirmDialog } = useConfirm();
  const ct = useChartTheme(); // 리포트 차트 테마 — 훅은 최상위에서 1회만 호출

  // 시너지 정합성과 동일한 선택→상세 흐름: ?member=<id> 가 상태의 유일한 원본
  const openDetail = useCallback((memberId: string) => {
    router.replace(`/our-company?member=${encodeURIComponent(memberId)}`);
    setOpenMember(memberId);
    if (!profiles[memberId] || profiles[memberId] === "loading") void loadProfile(memberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, loadProfile]);

  const backToList = useCallback(() => {
    router.replace("/our-company");
    setOpenMember(null);
  }, [router]);

  const memberIdParam = searchParams.get("member");
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

  // 열려있는 계열사 프로파일 폴링 — 분석 완료 시 자동 반영
  useEffect(() => {
    if (!selectedGroup || !openMember) return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<{ profile: Profile | null; status: string }>(`/api/our-company/members/${openMember}/profile`);
        if (r.data.status === "completed" && r.data.profile) {
          setProfiles((prev) => ({ ...prev, [openMember]: r.data.profile! }));
          loadGroup(selectedGroup.group.id);
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
      { body: "이 계열사와 분석 결과(프로파일 버전 전체)가 함께 삭제됩니다." },
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
    setProfileTab("profile");
    setError(null);
    try {
      await api.post(`/api/our-company/members/${memberId}/analyze`, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 시작 실패");
    }
  }

  async function loadProfile(memberId: string) {
    setProfiles((prev) => ({ ...prev, [memberId]: "loading" }));
    try {
      const r = await api.get<{ profile: Profile | null; status: string }>(`/api/our-company/members/${memberId}/profile`);
      if (r.data.profile) setProfiles((prev) => ({ ...prev, [memberId]: r.data.profile! }));
      else setProfiles((prev) => { const n = { ...prev }; delete n[memberId]; return n; });
    } catch { /* 프로파일 없음 */ }
  }

  return (
    <main>
      {confirmDialog}
      <StageFrame stageId="S3" heading="S3 그룹/계열사 분석">
        그룹과 계열사를 등록해 <strong>자사 강점/약점</strong>을 분석합니다 — 이 프로파일은 S3 시너지·적합성 평가의 입력(자사 역량·포트폴리오 정보)으로 사용됩니다. 상장 계열사는 DART 재무제표, 전체는 애널리스트 리포트·산업 동향 리서치로 분석합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {!openMember && (
      <>
      {/* ── 그룹 선택 ── */}
      <section aria-label="그룹" className="market-section">
        <SectionToolbar
          title="분석 대상 그룹"
          icon="🏢"
          actions={
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setShowGroupForm((v) => !v); setShowMemberForm(false); }}
              aria-expanded={showGroupForm}
            >
              ＋ 그룹 등록
            </button>
          }
        />
        {showGroupForm && (
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
              ) : (
                <>
                  <button type="button" className="btn-ghost btn-sm" title="그룹명 수정" onClick={() => { setGroupNameDraft(selectedGroup.group.name); setEditGroupName(true); }}>수정</button>
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
          {showMemberForm && (
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
            <table className="data-table" aria-label="계열사 목록">
              <caption className="sr-only">계열사 목록</caption>
              <thead>
                <tr>
                  <th scope="col">회사명</th><th scope="col">역할</th><th scope="col">DART 고유번호</th>
                  <th scope="col">분석 상태</th><th scope="col">분석일</th>
                  <th scope="col"><span className="sr-only">관리</span></th>
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
                      <td>{m.role === "hq" ? "지주/HQ" : "계열사"}</td>
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
                      <td className="tabular-nums">{m.analyzed_at ? m.analyzed_at.slice(0, 10) : "—"}</td>
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
                        <button type="button" className="btn-ghost btn-sm" disabled={profiles[m.id] === "loading"} onClick={() => analyzeMember(m.id)}>
                          {profiles[m.id] === "loading" ? "분석 중..." : analyzed ? "재분석" : "분석"}
                        </button>
                        {isEditing ? (
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
                        <button type="button" className="btn-danger btn-sm" title="이 계열사를 삭제합니다" onClick={() => removeMember(m.id)}>
                          삭제
                        </button>
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
                <button type="button" className="btn-ghost" disabled={profiles[openMember] === "loading"} onClick={() => analyzeMember(openMember)}>
                  {profiles[openMember] === "loading" ? "분석 중..." : "재분석"}
                </button>
                <button type="button" className="btn-ghost" onClick={backToList}>목록으로</button>
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

            {profileTab === "profile" && (
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
                                <td className="font-semibold">{a}</td>
                                {years.map((y) => {
                                  const v = byKey.get(`${y}|${a}`);
                                  return <td key={y} className="tabular-nums">{v !== undefined ? `${fmtEok(v)} 억원` : "—"}</td>;
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
                <h3 className="sizing-step-title text-[0.95rem] mt-4">산업 노출</h3>
                {profile.industryExposure && profile.industryExposure.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
                  </div>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">산업 노출 정보 없음</p>
                )}
              </div>
            )}

            {profileTab === "strengths" && (
              <div className="text-[0.88rem]">
                <div className="chart-pair">
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>💪 강점</h4>
                    <ul className="report-bullet-list">{(profile.strengths ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>🩹 약점</h4>
                    <ul className="report-bullet-list">{(profile.weaknesses ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                </div>
                <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {profile.businessAssessment || "—"}</p>
              </div>
            )}

            {profileTab === "sources" && (
              <div className="text-[0.88rem]">
                {(profile.researchSources ?? []).length > 0 ? (
                  <ul className="sizing-note-list">
                    {profile.researchSources!.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic">출처 기록이 없습니다.</p>
                )}
              </div>
            )}
          </>
        );
      })()}
        </section>
      )}

    </main>
  );
}

export default function OurCompanyPage() {
  return (
    <Suspense fallback={null}>
      <OurCompanyView />
    </Suspense>
  );
}
