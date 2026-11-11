"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { renderWithCitations } from "./renderWithCitations.tsx";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { TargetDetail } from "./types.ts";

export function TargetOverviewEditTab({ ctx, t }: { ctx: TargetDetailViewState; t: TargetDetail }) {
  const tr = useTranslations("components.brownfieldTarget.overviewTabs");
  const tc = useTranslations("common");
  const { profileTab, editing, editDraft, setEditDraft, busy, setEditing, saveEdit } = ctx;
  return (
    <>
      {profileTab === "overview" && editing && (
        <div className="card mt-3 text-[length:var(--fs-body)]">
          <form
            className="sizing-new-form mb-0"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{tr("companyNameLabel")}</span>
                <input
                  value={editDraft.company_name}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, company_name: e.target.value }))}
                  required
                  className="sizing-new-input"
                />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{tr("dartCodeLabel")}</span>
                <input
                  value={editDraft.dart_corp_code}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, dart_corp_code: e.target.value }))}
                  placeholder={tr("dartCodePlaceholder")}
                  className="sizing-new-input sizing-new-input-sm"
                />
              </label>
              <button type="submit" className="btn-premium btn-sm" disabled={busy || !editDraft.company_name.trim()}>
                {tc("save")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setEditDraft({
                    company_name: t.company_name,
                    dart_corp_code: t.dart_corp_code ?? "",
                    universe_note: t.universe_note ?? "",
                  });
                }}
              >
                {tc("cancel")}
              </button>
            </div>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {tr("dartCodeNote")}
            </p>
          </form>
        </div>
      )}
    </>
  );
}

/** design 2026-11-11 §7.1 (D6) — DART 재무 동기화 상태 배너(헤더 슬롯).
 *  ① 코드 미등록 → 정보성 배너(수정 폼 안내, 요청 없음),
 *  ② 동기화 실패 → 경고 배너(봉투 메시지 + 재시도),
 *  ③ 불일치 경고와 함께 성공(D5) → mismatch 라인(DART 등록 법인명 포함) 노출.
 *  모두 토큰 클래스만 사용(card·status-chip·btn-ghost). */
export function TargetSyncBanner({ ctx }: { ctx: TargetDetailViewState }) {
  const tr = useTranslations("components.brownfieldTarget.overviewTabs");
  const { syncError, syncWarnings, retrySync } = ctx;
  if (syncError?.code === "corp_code_unregistered") {
    return (
      <div role="status" className="card mt-3 text-[length:var(--fs-caption)]">
        <span className="status-chip status-amber mr-1">{tr("syncNoCodeChip")}</span>
        {tr("syncNoCodeBanner")}
      </div>
    );
  }
  if (syncError) {
    return (
      <div role="alert" className="card mt-3 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
        <p className="mb-1">{syncError.message}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void retrySync()}>
          {tr("syncRetry")}
        </button>
      </div>
    );
  }
  if (syncWarnings.length > 0) {
    return (
      <div role="status" className="card mt-3 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">
        <p className="mb-1">
          <span className="status-chip status-amber mr-1">{tr("syncMismatchChip")}</span>
          {tr("syncMismatchBanner")}
        </p>
        <ul className="sizing-note-list mb-0">
          {syncWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    );
  }
  return null;
}

export function TargetOverviewTab({ ctx }: { ctx: TargetDetailViewState }) {
  const tr = useTranslations("components.brownfieldTarget.overviewTabs");
  const { profileTab, companyProfile, setProfileTab } = ctx;
  return (
    <>
      {profileTab === "overview" && companyProfile?.profile && (
        <div className="card mt-3 text-[length:var(--fs-body)]">
          <h4 className="text-[length:var(--fs-body)] mb-2">
            <span aria-hidden="true">🏢</span> {tr("aiProfileHeading", { p1: companyProfile.profile.companyName })}
          </h4>
          {companyProfile.profile.ragCapRecommendation && (
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[length:var(--fs-body)] mb-2">{tr("ragCapHeading")}</h4>
              <span
                className={`status-chip ${companyProfile.profile.ragCapRecommendation.grade === "green" ? "status-green" : companyProfile.profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}
              >
                {tr("capLabel", { p1: companyProfile.profile.ragCapRecommendation.grade.toUpperCase() })}
              </span>
              <p className="mt-2 mb-0 text-[length:var(--fs-body)]">
                {companyProfile.profile.ragCapRecommendation.rationale}
              </p>
            </div>
          )}
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tr("assessmentHeading")}</h3>
          <p className="mb-3">
            {companyProfile.profile.businessAssessment
              ? renderWithCitations(
                  companyProfile.profile.businessAssessment,
                  companyProfile.profile.researchSources,
                  tr("citationTitlePrefix"),
                )
              : "—"}
          </p>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tr("industryExposureHeading")}</h3>
          {companyProfile.profile.industryExposure.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {companyProfile.profile.industryExposure.map((x) => (
                <span key={x} className="status-chip status-in-progress">
                  {x}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)] mb-0">
              {tr("noIndustryExposure")}
            </p>
          )}
          {/* 외부 검색으로 얻은 정보가 이 프로파일에 실제로 쓰였음을 개요에서
                바로 보여준다(사용자 요청, 2026-09-16) — [n] 인용은 위 종합 평가의
                링크와 연결되고, 근거 출처 상위 3건을 이 자리에 노출한다. */}
          {companyProfile.profile.researchSources.length > 0 && (
            <>
              <h3 className="sizing-step-title text-[length:var(--fs-body)] mt-3">
                {tr("researchEvidenceHeading", { p1: companyProfile.profile.researchSources.length })}
              </h3>
              <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                {companyProfile.profile.researchSources.slice(0, 3).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
                      {s.title}
                    </a>
                    {s.snippet && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {s.snippet}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {companyProfile.profile.researchSources.length > 3 && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tr("allSourcesPre", { p1: companyProfile.profile.researchSources.length })}{" "}
                  <button
                    type="button"
                    className="text-[color:var(--accent)] underline"
                    onClick={() => setProfileTab("sources")}
                  >
                    {tr("sourcesTabLink")}
                  </button>
                  {tr("allSourcesPost")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
