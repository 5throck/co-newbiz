"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { SECTION_IDS } from "./constants.ts";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { useTranslations } from "next-intl";

export function UniverseSection({ ctx }: { ctx: BrownfieldStageState }) {const t = useTranslations("stages.s67.universeSection"); const tc = useTranslations("common");
  const { selected, canAct, discoveryPanel, setDiscoveryPanel, proposals, webProposals, newTarget, setNewTarget, setDartResults, dartBusy, searchDartCompanies, busy, dartError, dartResults, acceptProposal, openUniverseEditor, generateWebProposals, addTarget } = ctx;
  return (
    <>{selected && (
        <div id={SECTION_IDS.universe} className="grid gap-3 items-stretch md:grid-cols-[2fr_3fr]" style={{ scrollMarginTop: "1rem" }}>
        <section aria-label={t("targetMarketDefinition")} className="market-section mb-0 flex flex-col">
          <SectionToolbar
            title={t("targetMarketDefinition2")}
            actions={canAct && selected.universe && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={openUniverseEditor}>{tc("edit")}</button>}
          />
          <div className="sizing-grade-card flex-1">
            {selected.universe ? (
              <>
                {selected.universe.scope && <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("coverageScope")} {selected.universe.scope}</p>}
                <p className="mb-2 text-[length:var(--fs-body)]">{selected.universe.definition}</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("notYetDefinedThisIs")}
                </p>
                {canAct && <button type="button" className="btn-ghost btn-sm" onClick={openUniverseEditor}>{t("startTargetMarketDefinition")}</button>}
              </>
            )}
          </div>
        </section>

        {/* ── S6 ② 후보 발굴 — 시장·기업 마스터 기반 제안 / 웹 검색·LLM 제안
            두 방식을 한 카드에 모은다(mockup baseline-v5.html S6/S7 card② 차용).
            목표 시장 정의 옆에 좌/우로 배치한다(사용자 요청, 2026-09-15). ── */}
        <section aria-label={t("candidateDiscovery")} className="market-section mb-0 flex flex-col">
          <SectionToolbar title={t("candidateDiscoveryFillingTheFull")} />
          <div className="sizing-grade-card flex-1">
            {!canAct && <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("candidateDiscoveryAndRegistrationRequire")}</p>}
            {canAct && (<>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "master" ? "control-chip status-green" : ""}`}
                onClick={() => setDiscoveryPanel(discoveryPanel === "master" ? null : "master")}
              >
                {t("marketAndCompanyMaster")}{proposals && proposals.length > 0 ? ` (${proposals.length})` : ""}
              </button>
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "web" ? "control-chip status-green" : ""}`}
                onClick={() => {
                  setDiscoveryPanel("web");
                  if (webProposals === null) void generateWebProposals();
                }}
              >
                {t("webSearch")}{webProposals && webProposals.length > 0 ? ` (${webProposals.length})` : ""}
              </button>
            </div>

            {/* 등록 폼 + 전자공시 검색 통합(사용자 요청, 2026-09-15) — 회사명을 입력하고
                "전자공시 검색"으로 찾은 결과를 클릭하면 회사명·고유번호가 폼에 채워진다.
                전자공시에 없는(비상장 등) 회사는 그대로 직접 입력해 등록할 수 있다.
                dart_corp_code가 채워진 채 등록되면 상세 화면의 전자공시 정보(재무
                facts·공시)가 바로 활성화된다. */}
            <form onSubmit={addTarget} className="sizing-new-form mb-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
                  <span className="block mb-1">{t("candidateCompanyNameFullCandidate")}</span>
                  <input
                    value={newTarget.company_name}
                    onChange={(e) => { setNewTarget({ ...newTarget, company_name: e.target.value }); setDartResults(null); }}
                    placeholder={t("eGRainbowRobotics")}
                    required
                    className="sizing-new-input w-full"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 11rem" }}>
                  <span className="block mb-1">{t("filingIdOptional8Digits")}</span>
                  <input value={newTarget.dart_corp_code} onChange={(e) => setNewTarget({ ...newTarget, dart_corp_code: e.target.value })} placeholder={t("pickASearchResultOr")} className="sizing-new-input sizing-new-input-sm w-full" />
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm whitespace-nowrap shrink-0"
                  disabled={dartBusy || !newTarget.company_name.trim()}
                  onClick={() => void searchDartCompanies(newTarget.company_name)}
                >
                  {dartBusy ? tc("searching") : t("regulatoryFilingSearch")}
                </button>
                <button type="submit" className="btn-premium btn-sm shrink-0" disabled={busy || !newTarget.company_name.trim()}>{t("registerCandidate")}</button>
              </div>
              {dartError && <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{dartError}</p>}
              {dartResults !== null && dartResults.length === 0 && !dartError && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noFilingSearchResultsFor")}</p>
              )}
              {dartResults !== null && dartResults.length > 0 && (
                <ul className="sizing-note-list mt-1">
                  {dartResults.map((r) => (
                    <li key={r.corp_code} className="flex flex-wrap items-center gap-2">
                      <code className="dd-item-id">{r.corp_code}</code>
                      <span className="flex-1 min-w-[12rem] text-[length:var(--fs-caption)]">{r.corp_name}</span>
                      {r.source === "web" ? (
                        <span className="status-chip status-amber" title={t("unverifiedCandidatesUsedWhenDirect")}>{t("webCollection")}</span>
                      ) : (
                        <span className="status-chip status-green" title={r.source === "local" ? t("companyMaster") : t("queryTheFilingCompanyList")}>{t("verification")}</span>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm whitespace-nowrap"
                        aria-pressed={newTarget.dart_corp_code === r.corp_code}
                        onClick={() => { setNewTarget((prev) => ({ ...prev, company_name: r.corp_name, dart_corp_code: r.corp_code })); setDartResults(null); }}
                      >
                        {newTarget.dart_corp_code === r.corp_code ? t("selected") : t("fillFromThisCompany")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>

            {discoveryPanel === "master" && (
              <div className="mb-2">
                {proposals === null ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loading")}</p>
                ) : proposals.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noNewCandidatesCanBe")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {proposals.map((c) => (
                      <button key={c.id} type="button" className="control-chip"
                        title={c.dart_corp_code ? `DART ${c.dart_corp_code}` : undefined}
                        onClick={() => acceptProposal(c.name_ko, c.dart_corp_code)}>
                        ＋ {c.name_ko}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("onAcceptanceItIsRecorded")}</p>
              </div>
            )}
            </>)}
          </div>
        </section>
        </div>
      )}</>
  );
}
