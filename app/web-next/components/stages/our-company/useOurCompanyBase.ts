"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState } from "react";
import { useConfirm } from "../../crud.tsx";
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import type { GroupRow, GroupDetail, CompetitorRowView, CompetitorProposalView, WebSuggestionView, ProfileTabKey, Profile } from "./types.ts";

export function useOurCompanyBase({ memberId: memberIdProp, embedded }: { memberId?: string; embedded?: boolean }) {

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
  const ct = useChartTheme();
  return { setCompetitors, setCompetitorProposals, openMember, setDismissedProposals, setExcludingCompetitor, setEditingCompetitor, compBusy, setCompBusy, setCompError, webBusy, setWebBusy, setWebSuggestions, setWebNote, competitorForm, setCompetitorForm, setCompetitorDartResults, competitorDartSearching, setCompetitorDartSearching, excludingCompetitor, editingCompetitor, urlSync, router, setLocalMember, setOpenMember, profiles, setSynergyLink, searchParams, localMember, setGroups, setError, setSelectedGroup, selectedGroup, setProfiles, groupName, busy, setBusy, setGroupName, setShowGroupForm, memberForm, dartSearching, setDartSearching, setDartResults, groupNameDraft, setEditGroupName, confirm, setMemberForm, setShowMemberForm, setEditMember, editMember, savingMember, setSavingMember, savingRole, setSavingRole, setUploadingMember, setUploadedNames, setProfileTab, setS1Requests, confirmDialog, error, canAct, showGroupForm, groups, editGroupName, setGroupNameDraft, showMemberForm, dartResults, uploadingMember, profileTab, ct, s1Requests, compError, competitors, competitorProposals, dismissedProposals, webSuggestions, webNote, competitorDartResults };
}
