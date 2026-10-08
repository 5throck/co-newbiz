"use client";

// S3 그룹/계열사 분석 본문 — ADR-0120 Wave 2 Phase C 추출(/our-company 페이지와
// /deals/[id]/s3?surface=company 탭이 동일 컴포넌트를 소비한다). StageFrame과
// main 셸은 호출자가 제공한다(공통 규칙 #6).
//
// 선택 모드: 독립 페이지(기본)는 URL ?member= 로 선택을 운반하고, embedded
// 모드는 내부 상태로 선택한다 — router를 건드리지 않는다. memberId prop으로
// 특정 계열사를 고정할 수 있다.
// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useOurCompanyBase } from "./useOurCompanyBase.ts";
import { useOurCompetitors } from "./useOurCompetitors.ts";
import { useOurGroups } from "./useOurGroups.ts";
import { PrimaryAction } from "../../ui.tsx";
import { GroupSelectPanel, ProfileSummaryPanel } from "./GroupPanels.tsx";
import { MembersPanel } from "./MembersPanel.tsx";
import { ProfileSection } from "./ProfileSection.tsx";

export function OurCompanyStage(props0: { memberId?: string; embedded?: boolean }) {
  const h0 = useOurCompanyBase(props0);
  const h1 = useOurCompetitors({ ...h0 });
  const h2 = useOurGroups({ ...h0, ...h1 });
  const ctx = { ...h0, ...h1, ...h2 };
  const { confirmDialog, error, openMember, canAct, selectedGroup, profiles, analyzeMember, setShowGroupForm, setShowMemberForm } = ctx;
  return (
    <>
      {confirmDialog}
      {!canAct ? (
        <PrimaryAction label="계열사 추가" disabled disabledReason="그룹·계열사 편집은 analyst 권한이 필요합니다." />
      ) : openMember ? (
        <PrimaryAction
          label="프로파일 분석 실행"
          disabled={profiles[openMember] === "loading"}
          disabledReason="분석 중입니다 — 완료되면 자동으로 표시됩니다."
          onClick={() => analyzeMember(openMember)}
        />
      ) : !selectedGroup ? (
        <PrimaryAction label="그룹 등록" onClick={() => setShowGroupForm(true)} />
      ) : (
        <PrimaryAction label="계열사 추가" onClick={() => setShowMemberForm(true)} />
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {!openMember && (
      <>
      {/* ── 그룹 선택 ── */}
      <GroupSelectPanel ctx={ctx} />

      {/* ── 그룹 상세: 계열사 테이블 ── */}
      <MembersPanel ctx={ctx} />

      {/* ── 계열사 간 시너지 매트릭스 (산업 노출 겹침 기반) ── */}
      <ProfileSummaryPanel ctx={ctx} />

      </>
      )}

      {/* ── 계열사 리포트 (상세 전용 뷰 — 시너지 정합성과 동일 흐름) ── */}
      <ProfileSection ctx={ctx} />

    </>
  );
}
