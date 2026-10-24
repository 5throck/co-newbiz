"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { ColGroup } from "../../ui.tsx";
import { HELD_STATUS_CHIP, HELD_STATUS_LABEL, NECESSITY_LABEL, NECESSITY_UNSET_LABEL, gapSourceLabel, type GapHeldStatus, type GapNecessity } from "../../../lib/capability-gap.ts";
import { CAPABILITY_REG_COL_PCT, SCORE_LABEL } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function EvalTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {const tr = useTranslations(); const t = useTranslations("stages.s4.evalTab"); const tc = useTranslations("common");
  const { tab, advisory, opportunityId, intent, canAct, setIntent, scored, setScore, draftSaving, performSaveDraft, draftSavedAt, totalScore, setTab } = ctx;
  return (
    <>{tab === "eval" && (
        <div className="card">
          <h2>{selected.name} {t("routeFitEvaluationEvidence")}</h2>

          <div className="sizing-grade-card mb-3" aria-label={t("s1MarketCompetitionAndCapability")}>
            {advisory === null ? (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                {t("failedToLoadEvidenceRefresh")}
              </p>
            ) : (
              <>
                {/* 신호 테이블 — 판정에 필요한 건 "근거 있음"의 확인이므로 요약 카드가
                    본문이다. 표는 기본 접고(필요 역량 상세와 같은 패턴), 요약에 건수를
                    표시한다 (2026-09-18 리뷰: eval 탭이 지나치게 길었다). */}
                <details className="mb-3">
                  <summary className="cursor-pointer text-[length:var(--fs-body)]">{t("evidenceBySignal")} {advisory.signals.length}{tc("countSuffixParen")}</summary>
                  <h4 className="text-[length:var(--fs-body)] mb-2 mt-2">{t("evidenceBySignal2")}</h4>
                  <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                    <table className="data-table mb-3" aria-label={t("evidenceBySignal3")}>
                      <caption className="sr-only">{t("evidenceBySignal4")}</caption>
                      <thead>
                        <tr><th scope="col">{tc("signal")}</th><th scope="col">{tc("direction")}</th><th scope="col">{tc("weight")}</th><th scope="col">{tc("evidence")}</th></tr>
                      </thead>
                      <tbody>
                        {advisory.signals.map((s) => (
                          <tr key={s.key}>
                            <td className="text-[length:var(--fs-caption)]">{s.label}</td>
                            <td>
                              <span className={`status-chip ${s.leans === "greenfield" ? "status-green" : s.leans === "brownfield" ? "status-amber" : "status-not-started"}`}>
                                {s.leans === "greenfield" ? t("greenfield") : s.leans === "brownfield" ? t("brownfield") : tc("neutral")}
                              </span>
                            </td>
                            <td className="tabular-nums text-[length:var(--fs-caption)]">{s.weight}</td>
                            <td className="text-[length:var(--fs-caption)]">{s.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>

                {advisory.capabilityGap ? (
                  <>
                    {/* 제목과 요약 칩을 한 줄에 나란히 배치 (2026-09-15 사용자 요구) */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="text-[length:var(--fs-body)] m-0">{t("requiredCapabilityLevel")}</h4>
                      <span className="status-chip status-not-started">{tc("requiredCapability")} <strong className="ml-1">{advisory.capabilityGap.total}{tc("countUnit")}</strong></span>
                      <span className="status-chip status-green">{t("industryLeadingAndAverage")} <strong className="ml-1">{advisory.capabilityGap.leading + advisory.capabilityGap.average}{tc("countUnit")}</strong></span>
                      <span className="status-chip status-amber">{t("partiallyHeld")} <strong className="ml-1">{advisory.capabilityGap.partial}{tc("countUnit")}</strong></span>
                      <span className="status-chip status-not-started">{t("notHeld")} <strong className="ml-1">{advisory.capabilityGap.none}{tc("countUnit")}</strong></span>
                      {advisory.capabilityGap.coveragePct !== null && (
                        <span className="status-chip status-not-started">{t("holdingRate")} <strong className="ml-1">{advisory.capabilityGap.coveragePct}%</strong></span>
                      )}
                    </div>
                    {(advisory.capabilityGap.largeGapRows?.length ?? 0) > 0 && (
                      <p className="text-[length:var(--fs-caption)] mb-0">
                        <span className="status-chip status-red"><span aria-hidden="true">▲</span> {t("largeGapCaution")}</span>{" "}
                        {advisory.capabilityGap.largeGapRows!.map((r) => r.capability).join(", ")}
                        <span className="text-[color:var(--muted-fg)]"> {t("partialOrNoHoldingAmong")}</span>
                      </p>
                    )}
                    {advisory.capabilityGap.unmetRows.length > 0 && (
                      <p className="text-[length:var(--fs-caption)] mb-0">
                        {t("notHeld2")} {advisory.capabilityGap.unmetRows.map((r) => r.capability).join(", ")}
                        <span className="text-[color:var(--muted-fg)]"> {t("basedOnGroupAffiliateProfiles")}</span>
                      </p>
                    )}
                    {/* S3에서 확정한 필요 역량 수준 전체 행 — 역량 관련 5기준
                        (역량 결정성·통합 역량·역량확보 속도) 채점의 직접 근거
                        (2026-09-15 사용자 요구). 행이 많아 접힘 스캐폴드로 제공 —
                        기본 닫힘, 요약(요약: 리딩·평균 X·부분 Y·미보유 Z·미판정 W)만
                        표시하고 열면 전체 레지스터가 나온다. 읽기 전용. */}
                    {advisory.capabilityGap.rows && advisory.capabilityGap.rows.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">
                          {t("requiredCapabilityLevelDetails")}{advisory.capabilityGap.rows.length}{tc("countUnit")}
                          {advisory.capabilityGap.coveragePct !== null ? t("holdingRateP1", { p1: advisory.capabilityGap.coveragePct }) : ""}{t("view")}
                        </summary>
                        <div className="table-scroll mt-2">
                          <table className="data-table mb-0 table-fixed-pct tmin-56" aria-label={t("requiredCapabilityLevelRegisterS3")}>
                            <caption className="sr-only">{t("requiredCapabilityLevelRegisterS32")}</caption>
                            <ColGroup widths={CAPABILITY_REG_COL_PCT} />
                            <thead>
                              <tr>
                                <th scope="col">{tc("requiredCapability")}</th><th scope="col">{tc("necessity")}</th><th scope="col">{tc("heldJudgement")}</th>
                                <th scope="col">{tc("heldEvidence")}</th><th scope="col">{t("resolutionMethod")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {advisory.capabilityGap.rows.map((r) => (
                                <tr key={r.capability}>
                                  <td className="cell-primary">
                                    <span className="font-semibold text-[length:var(--fs-caption)]">{r.capability}</span>
                                    <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                      {gapSourceLabel(r.source, false)}
                                    </span>
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {r.necessity ? NECESSITY_LABEL[r.necessity as Exclude<GapNecessity, "">] ?? NECESSITY_UNSET_LABEL : <span className="text-[color:var(--muted-fg)]">{NECESSITY_UNSET_LABEL}</span>}
                                  </td>
                                  <td>
                                    <span className={`status-chip ${HELD_STATUS_CHIP[r.held.status as GapHeldStatus] ?? "status-not-started"}`}>
                                      {HELD_STATUS_LABEL[r.held.status as GapHeldStatus] ?? HELD_STATUS_LABEL.unevaluated}
                                    </span>
                                    {(r.cautions ?? []).map((c) => (
                                      <span key={c.key} className={`status-chip mt-1 ${c.tone === "red" ? "status-red" : c.tone === "amber" ? "status-amber" : "status-not-started"}`}>
                                        <span aria-hidden="true">{c.tone === "red" ? "▲" : c.tone === "amber" ? "!" : "·"}</span> {c.label}
                                      </span>
                                    ))}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {r.held.status !== "unevaluated" && (r.held.holders.length > 0 || r.held.evidence) ? (
                                      <>
                                        {r.held.evidence && <span className="block">{r.held.evidence}</span>}
                                        {r.held.holders.length > 0 && <span className="block text-[color:var(--muted-fg)]">{t("existingHoldingEntity")} {r.held.holders.join(", ")}</span>}
                                      </>
                                    ) : "—"}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">{r.resolution ? (r.resolution === "build" ? t("build") : r.resolution === "partner" ? t("partner") : r.resolution === "hire" ? t("hiring") : t("investment")) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                    {t("requiredCapabilityLevelsNotWritten")}{" "}
                    <Link href={`/deals/${encodeURIComponent(opportunityId)}/s3`} className="text-[color:var(--accent)] underline">{t("s3SynergyTab")}</Link>
                    {" "}{t("recordRequiredCapabilitiesAndHeld")}
                  </p>
                )}
              </>
            )}
          </div>

          <h4 className="text-[length:var(--fs-body)] mb-1">{t("scoringStage2Each")}</h4>
          {/* route_decision_score.intent는 NOT NULL이라 의도가 없으면 서버가 채점 행을
              통째로 버린다(draft/route.ts) — 원래 의도 선택은 "결정" 탭에만 있어서, 이
              탭에서 채점만 채우고 저장하면 "초안 저장됨"은 뜨지만 채점은 저장되지
              않고 되돌아왔을 때 빈 화면으로 보이는 혼란이 있었다. 이 탭에서도 바로
              고칠 수 있게 같은 상태를 공유하는 선택자를 둔다. */}
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1 font-medium">{t("intentStage1")} <span className="text-[color:var(--red-fg)]">*</span></span>
              <select value={intent} disabled={!canAct} onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")} className="sizing-new-input">
                <option value="">{tc("selectEllipsis")}</option>
                <option value="integration">{t("consolidated")}</option>
                <option value="capability_access">{tc("capabilityApproach")}</option>
              </select>
            </label>
            {canAct && intent === "" && (
              <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-0">
                {t("withoutAnIntentSelectedThe")}
              </p>
            )}
          </div>
          <table className="data-table mb-2" aria-label={t("scoring")}>
            <caption className="sr-only">{t("scoring2")}</caption>
            <thead>
              <tr><th scope="col">{t("criteriaEach")}</th><th scope="col">{t("scoring3")}</th><th scope="col">{tc("evidenceAsterisk")}</th></tr>
            </thead>
            <tbody>
              {scored.map((c) => (
                <tr key={c.key}>
                  <td className="text-[length:var(--fs-caption)]">
                    {tr(c.label)}
                    <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr(c.hint)}</span>
                    {/* 역량 관련 3기준 — S3 필요 역량 수준 레지스터를 채점 참고로
                        직접 인용한다(2026-09-15 사용자 요구). */}
                    {["capability_criticality", "integration_capacity", "speed_to_capability"].includes(c.key) && advisory?.capabilityGap && (
                      <span className="block text-[length:var(--fs-caption)] mt-0.5" style={{ color: "var(--accent)" }}>
                        {t("capabilityReference")} {advisory.capabilityGap.total}{t("itemSWithLeadingAnd")} {advisory.capabilityGap.leading + advisory.capabilityGap.average}{t("item")} {advisory.capabilityGap.partial}{t("notHeld3")} {advisory.capabilityGap.none}
                        {advisory.capabilityGap.coveragePct !== null ? t("holdingRateP12", { p1: advisory.capabilityGap.coveragePct }) : ""}
                        {advisory.capabilityGap.unmetRows.length > 0 ? t("notHeldP1P2", { p1: advisory.capabilityGap.unmetRows.slice(0, 2).map((r) => r.capability).join(", "), p2: advisory.capabilityGap.unmetRows.length > 2 ? t("others") : "" }) : ""}
                      </span>
                    )}
                  </td>
                  <td>
                    <div role="group" aria-label={t("p1Score", { p1: tr(c.label) })} className="flex gap-1">
                      {[1, 2, 3].map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={c.score === v}
                          disabled={!canAct}
                          className={`control-chip ${c.score === v ? "status-green" : ""}`}
                          onClick={() => setScore(c.key, { score: v })}
                        >
                          {v} · {SCORE_LABEL(tr)[v]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      value={c.note}
                      disabled={!canAct}
                      onChange={(e) => setScore(c.key, { note: e.target.value })}
                      placeholder={t("scoreEvidenceCitingS1And")}
                      aria-label={t("p1Evidence", { p1: c.label })}
                      className="sizing-new-input sizing-new-input-sm"
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {canAct && (
              <button type="button" className="btn-ghost" disabled={draftSaving} onClick={() => void performSaveDraft()}>
                {draftSaving ? tc("saving") : tc("save")}
              </button>
            )}
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {draftSavedAt && t("draftSavedP1", { p1: draftSavedAt.slice(0, 16).replace("T", " ") })}
              {totalScore !== null ? t("totalP130", { p1: totalScore }) : ""}{t("sharedScoringForBothTracks")}
            </span>
            <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setTab("decision")}>{t("toTheDecisionTab")}</button>
          </div>

          {/* ── 판정 규칙 — 이 딜과 무관한 고정 규칙 참고용. 예전엔 모달이었으나
              탭 안 접힘으로 단순화(2026-09-14). ── */}
          <details>
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("viewJudgementRulesReferenceFixed")}</summary>
            <div className="mt-2">
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                {t("notAiItScoresThe")}
              </p>
              <table className="data-table" aria-label={t("judgementRule")}>
                <caption className="sr-only">{t("judgementRule2")}</caption>
                <thead>
                  <tr><th scope="col">{tc("signal")}</th><th scope="col">{t("judgementCriteria")}</th><th scope="col">{tc("direction")}</th><th scope="col">{tc("weight")}</th></tr>
                </thead>
                <tbody>
                  <tr><td className="cell-primary">{t("marketGrowthS1")}</td><td>{t("cagrOrMoreHighGrowth")}</td><td>Greenfield</td><td>3</td></tr>
                  <tr><td className="cell-primary">{t("marketGrowthS12")}</td><td>{t("cagrUnderMatureMarket")}</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">{t("competitiveStructureS1")}</td><td>{t("monopolyOrConcentratedMarket")}</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">{t("competitiveStructureS12")}</td><td>{t("dispersedOrUnclear")}</td><td>{tc("neutral")}</td><td>1</td></tr>
                  <tr><td className="cell-primary">{t("confirmSynergyS3")}</td><td>{t("score60OrMore")}</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">{t("confirmSynergyS32")}</td><td>{t("scoreUnder60")}</td><td>{tc("neutral")}</td><td>2</td></tr>
                  <tr><td className="cell-primary">{t("synergyRecommendationS3")}</td><td>{t("recommendationValueBeforeHumanConfirmation")}</td><td>{tc("neutral")}</td><td>1</td></tr>
                  <tr><td className="cell-primary">{tc("holdingRateS3")}</td><td>{t("heldCapabilitiesOrMore")}</td><td>Greenfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">{tc("holdingRateS3")}</td><td>{t("heldCapabilitiesOrLess")}</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">{tc("holdingRateS3")}</td><td>{t("middle")}</td><td>{tc("neutral")}</td><td>1</td></tr>
                </tbody>
              </table>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3 mb-1">
                {t("accompanyingInformationWhenTheUnderlying")}
              </p>
              <ul className="sizing-note-list mb-2">
                <li><b>{t("baseRate")}</b> {t("showsPastDecisionCountsPer")}</li>
                <li><b>{t("trigger")}</b> {t("warnsWhenTheRecommendationContradicts")}</li>
              </ul>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                {t("principleBoundaryThisRecommendationIs")}
              </p>
            </div>
          </details>
        </div>
      )}</>
  );
}
