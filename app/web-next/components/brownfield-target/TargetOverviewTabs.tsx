"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { renderWithCitations } from "./renderWithCitations.tsx";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { TargetDetail } from "./types.ts";

export function TargetOverviewEditTab({ ctx, t }: { ctx: TargetDetailViewState; t: TargetDetail }) {
  const { profileTab, editing, editDraft, setEditDraft, busy, setEditing, saveEdit } = ctx;
  return (
    <>{profileTab === "overview" && editing && (
          <div className="card mt-3 text-[length:var(--fs-body)]">
            <form
              className="sizing-new-form mb-0"
              onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">회사명 *</span>
                  <input
                    value={editDraft.company_name}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, company_name: e.target.value }))}
                    required
                    className="sizing-new-input"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">전자공시 고유번호 (8자리)</span>
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
              <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                전자공시 고유번호를 바꾸면 회사 마스터가 재연결되어 재무 facts·공시가 새 회사 기준으로 갱신됩니다.
              </p>
            </form>
          </div>
        )}</>
  );
}

export function TargetOverviewTab({ ctx }: { ctx: TargetDetailViewState }) {
  const { profileTab, companyProfile, setProfileTab } = ctx;
  return (
    <>{profileTab === "overview" && companyProfile?.profile && (
          <div className="card mt-3 text-[length:var(--fs-body)]">
            <h4 className="text-[length:var(--fs-body)] mb-2"><span aria-hidden="true">🏢</span> {companyProfile.profile.companyName} AI 프로파일</h4>
            {companyProfile.profile.ragCapRecommendation && (
              <div className="sizing-grade-card mb-3">
                <h4 className="text-[length:var(--fs-body)] mb-2">🚦 신뢰도 상한 권고</h4>
                <span className={`status-chip ${companyProfile.profile.ragCapRecommendation.grade === "green" ? "status-green" : companyProfile.profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                  상한 {companyProfile.profile.ragCapRecommendation.grade.toUpperCase()}
                </span>
                <p className="mt-2 mb-0 text-[length:var(--fs-body)]">{companyProfile.profile.ragCapRecommendation.rationale}</p>
              </div>
            )}
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">종합 평가</h3>
            <p className="mb-3">
              {companyProfile.profile.businessAssessment
                ? renderWithCitations(companyProfile.profile.businessAssessment, companyProfile.profile.researchSources)
                : "—"}
            </p>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">산업 노출</h3>
            {companyProfile.profile.industryExposure.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {companyProfile.profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
              </div>
            ) : <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)] mb-0">산업 노출 정보 없음</p>}
            {/* 외부 검색으로 얻은 정보가 이 프로파일에 실제로 쓰였음을 개요에서
                바로 보여준다(사용자 요청, 2026-09-16) — [n] 인용은 위 종합 평가의
                링크와 연결되고, 근거 출처 상위 3건을 이 자리에 노출한다. */}
            {companyProfile.profile.researchSources.length > 0 && (
              <>
                <h3 className="sizing-step-title text-[length:var(--fs-body)] mt-3">외부 리서치 근거 ({companyProfile.profile.researchSources.length}건)</h3>
                <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                  {companyProfile.profile.researchSources.slice(0, 3).map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                      {s.snippet && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.snippet}</span>}
                    </li>
                  ))}
                </ul>
                {companyProfile.profile.researchSources.length > 3 && (
                  <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    전체 {companyProfile.profile.researchSources.length}건은 <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>출처 탭</button>에서 확인하세요.
                  </p>
                )}
              </>
            )}
          </div>
        )}</>
  );
}
