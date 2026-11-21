"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
// design 2026-11-21-s67-completion-visibility Fix ② — the overview edit form gains the
// Universe 적합 메모 field (D6) and the 발굴 출처 fieldset (D7), plus the S6 후보 자격
// chip pair (D8) so an unqualified candidate is marked — and curable — on the detail too.
import { useTranslations } from "next-intl";
import { renderWithCitations } from "./renderWithCitations.tsx";
import { clientCandidateGaps, type CandidateGap } from "../../lib/target-qualification.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { TargetDetail } from "./types.ts";

// The enum literals of brownfield_target.discovery_source (lib/brownfield-targets.ts
// DISCOVERY_SOURCES). Declared locally: that lib imports the db client and must not
// enter the client bundle — the parity is pinned by the route tests (s67-completion-visibility).
const DISCOVERY_SOURCE_VALUES = ["manual", "master_proposal", "web_proposal"] as const;
const DISCOVERY_SOURCE_LABEL_KEY: Record<(typeof DISCOVERY_SOURCE_VALUES)[number], string> = {
  manual: "discoverySourceManual",
  master_proposal: "discoverySourceMasterProposal",
  web_proposal: "discoverySourceWebProposal",
};

/** Client-side gaps from the detail payload (mirror of longListCandidateGaps — see lib/target-qualification.ts). */
function qualGapsOf(ctx: TargetDetailViewState): CandidateGap[] {
  const d = ctx.detail;
  if (!d) return [];
  return clientCandidateGaps(d.target, d.evidence);
}

/** The S6 후보 자격 chip pair — glyph + text (the i18n values carry the ✓/✕ glyphs), never color-only. */
function QualificationChips({ gaps }: { gaps: CandidateGap[] }) {
  const tr = useTranslations("components.brownfieldTarget.overviewTabs");
  const attrOpen = gaps.includes("attributes");
  const srcOpen = gaps.includes("source");
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="target-qualification">
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("qualsLabel")}</span>
      <span
        className={`status-chip ${attrOpen ? "status-amber" : "status-green"}`}
        title={attrOpen ? tr("qualAttributesOpen") : tr("qualAttributesMet")}
      >
        {attrOpen ? tr("qualAttributesOpen") : tr("qualAttributesMet")}
      </span>
      <span
        className={`status-chip ${srcOpen ? "status-amber" : "status-green"}`}
        title={srcOpen ? tr("qualSourceOpen") : tr("qualSourceMet")}
      >
        {srcOpen ? tr("qualSourceOpen") : tr("qualSourceMet")}
      </span>
    </div>
  );
}

export function TargetOverviewEditTab({ ctx, t }: { ctx: TargetDetailViewState; t: TargetDetail }) {
  const tr = useTranslations("components.brownfieldTarget.overviewTabs");
  const tc = useTranslations("common");
  const {
    profileTab,
    editing,
    editDraft,
    setEditDraft,
    busy,
    setEditing,
    saveEdit,
    setDiscoveryTouched,
    discoveryError,
    setDiscoveryError,
  } = ctx;
  if (profileTab !== "overview" || !editing) return null;
  const cancelEdit = () => {
    setEditing(false);
    setDiscoveryTouched(false);
    setDiscoveryError(null);
    setEditDraft({
      company_name: t.company_name,
      dart_corp_code: t.dart_corp_code ?? "",
      universe_note: t.universe_note ?? "",
      discovery_source: t.discovery_source ?? "manual",
      discovery_source_url: "",
      discovery_note: "",
    });
  };
  const helperId = "target-discovery-helper";
  const errorId = "target-discovery-error";
  return (
    <div className="card mt-3 text-[length:var(--fs-body)]">
      <form
        className="sizing-new-form mb-0"
        onSubmit={(e) => {
          e.preventDefault();
          void saveEdit();
        }}
        data-testid="target-edit-form"
      >
        {/* design Fix ②-c — the chips read BEFORE the fields they describe. */}
        <QualificationChips gaps={qualGapsOf(ctx)} />
        <div className="flex flex-wrap items-end gap-2 mt-2">
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
        </div>
        {/* design Fix ②-a (D6) — the cure field for the `attributes` gap; saveEdit already PATCHes this value. */}
        <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor="target-universe-note">
          <span className="block mb-1">{tr("universeNoteLabel")}</span>
          <textarea
            id="target-universe-note"
            rows={3}
            className="sizing-new-input w-full"
            placeholder={tr("universeNotePlaceholder")}
            value={editDraft.universe_note}
            onChange={(e) => setEditDraft((prev) => ({ ...prev, universe_note: e.target.value }))}
          />
        </label>
        {/* design Fix ②-b (D7) — 발굴 출처 fieldset: the select records provenance; URL or note
            (≥1 non-empty) appends ONE discovery evidence row on save and cures the `source` gap. */}
        <fieldset
          className="border border-[color:var(--border)] rounded-lg px-3 py-2 mt-2 mb-0"
          aria-describedby={helperId}
          data-testid="target-discovery-fieldset"
          aria-invalid={discoveryError ? true : undefined}
        >
          <legend className="text-[length:var(--fs-caption)] px-1">{tr("discoveryHeading")}</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1">{tr("discoverySourceLabel")}</span>
              <select
                value={editDraft.discovery_source}
                onChange={(e) => setEditDraft((prev) => ({ ...prev, discovery_source: e.target.value }))}
                className="sizing-new-input sizing-new-input-sm"
              >
                {DISCOVERY_SOURCE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {tr(DISCOVERY_SOURCE_LABEL_KEY[v])}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1">{tr("discoveryUrlLabel")}</span>
              <input
                type="url"
                inputMode="url"
                value={editDraft.discovery_source_url}
                aria-invalid={discoveryError ? true : undefined}
                aria-describedby={discoveryError ? errorId : undefined}
                onChange={(e) => {
                  setDiscoveryTouched(true);
                  setDiscoveryError(null);
                  setEditDraft((prev) => ({ ...prev, discovery_source_url: e.target.value }));
                }}
                className="sizing-new-input sizing-new-input-sm"
                style={{ minWidth: "16rem" }}
              />
            </label>
          </div>
          <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor="target-discovery-note">
            <span className="block mb-1">{tr("discoveryNoteLabel")}</span>
            <textarea
              id="target-discovery-note"
              rows={3}
              className="sizing-new-input w-full"
              value={editDraft.discovery_note}
              aria-invalid={discoveryError ? true : undefined}
              aria-describedby={discoveryError ? errorId : undefined}
              onChange={(e) => {
                setDiscoveryTouched(true);
                setDiscoveryError(null);
                setEditDraft((prev) => ({ ...prev, discovery_note: e.target.value }));
              }}
            />
          </label>
          <p id={helperId} className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            <span aria-hidden="true">ⓘ </span>
            {tr("discoveryHelper")}
          </p>
          {discoveryError && (
            <p
              id={errorId}
              role="alert"
              className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]"
            >
              <span aria-hidden="true">✕</span> {discoveryError}
            </p>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button type="submit" className="btn-premium btn-sm" disabled={busy || !editDraft.company_name.trim()}>
            {tc("save")}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={cancelEdit}>
            {tc("cancel")}
          </button>
        </div>
        <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("dartCodeNote")}</p>
      </form>
    </div>
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
  const gaps = qualGapsOf(ctx);
  return (
    <>
      {/* design Fix ②-c (D8) — the qualification state outside the form: an already-registered candidate
          whose evidence is empty is marked here (open gaps + cure hint), or shown quiet green when both
          are met. Plus the discoverySaved note from a save that recorded 발굴 출처. */}
      {profileTab === "overview" && !ctx.editing && (
        <div className="card mt-3 text-[length:var(--fs-caption)]" data-testid="target-qualification-strip">
          <QualificationChips gaps={gaps} />
          {gaps.length > 0 && (
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              <span aria-hidden="true">ⓘ </span>
              {tr("qualCureHint")}
            </p>
          )}
          {ctx.discoverySaved && (
            <p role="status" className="mt-1 mb-0 text-[length:var(--fs-caption)]">
              <span aria-hidden="true">✓ </span>
              {tr("discoverySaved")}
            </p>
          )}
        </div>
      )}
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
