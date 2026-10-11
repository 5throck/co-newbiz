"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import { CheckIcon } from "./icons.tsx";

export function GroupSelectPanel({ ctx }: { ctx: OurCompanyStageState }) {
  const { canAct, setShowGroupForm, setShowMemberForm, showGroupForm, groupName, setGroupName, busy, groups, selectedGroup, createGroup, backToList, loadGroup } = ctx;
  return (
    <section aria-label="그룹" className="market-section" aria-busy={groups === null}>
        <SectionToolbar
          title="분석 대상 그룹"
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
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">그룹명 *</span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 테크크로스 그룹" required className="sizing-new-input" autoFocus />
              </label>
              <span className="flex items-center gap-2">
                <button type="submit" className="btn-ghost btn-sm" disabled={busy || !groupName.trim()}>등록</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowGroupForm(false)}>취소</button>
              </span>
            </div>
          </form>
        )}
        {groups === null ? (
          <p>불러오는 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">등록된 그룹이 없습니다. "＋ 그룹 등록"으로 시작하세요.</p>
        ) : (
          <div role="group" aria-label="분석 대상 그룹" className="group-card-list">
            {groups.map((g) => {
              const active = selectedGroup?.group.id === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={active}
                  className={`group-card ${active ? "group-card-active" : ""}`}
                  onClick={() => { backToList(); loadGroup(g.id); }}
                >
                  <span className="group-card-check">{active && <CheckIcon />}</span>
                  <span className="group-card-body">
                    <span className="group-card-name" title={g.name}>{g.name}</span>
                    <span className="sizing-chip-meta">계열사 {g.member_count}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
  );
}

export function ProfileSummaryPanel({ ctx }: { ctx: OurCompanyStageState }) {
  const { selectedGroup } = ctx;
  return (
    <>{selectedGroup && (() => {
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
            <div className="section-toolbar"><span className="section-title"><h2>계열사 간 시너지 매트릭스 — 산업 노출 겹침 기준</h2></span></div>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
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
      })()}</>
  );
}
