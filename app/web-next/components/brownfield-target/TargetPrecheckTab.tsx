"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { precheckRecommendation, KNOCKOUT_IDS, screeningVerdictChipClass, SCREENING_VERDICT_KO, normalizeVerdict } from "../../lib/brownfield-precheck.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { ScreeningSummary, ScreeningItem, ScreeningItemEvidence, EvidenceRow } from "./types.ts";

export function TargetPrecheckTab({ ctx, screening_summary, savedVerdicts, checklist, itemEvidence, evidence }: { ctx: TargetDetailViewState; screening_summary: ScreeningSummary; savedVerdicts: Record<string, string>; checklist: ScreeningItem[]; itemEvidence: Record<string, ScreeningItemEvidence>; evidence: EvidenceRow[] }) {
  const t = useTranslations("components.brownfieldTarget.precheckTab");
  const { profileTab } = ctx;
  return (
    <>{profileTab === "precheck" && (
          <div className="mt-3">
            <div className="card mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h4 className="text-[length:var(--fs-body)] mb-0">{t("precheckHeading")}</h4>
                <span
                  className={`status-chip ${screening_summary.anyKnockOutFail ? "status-red" : screening_summary.assessed === 0 ? "status-not-started" : screening_summary.assessed < screening_summary.total || screening_summary.mandatoryOpen.length > 0 ? "status-amber" : "status-green"}`}
                  title={`${t("confirmedChipTitle", { p1: screening_summary.assessed, p2: screening_summary.total })}${screening_summary.mandatoryOpen.length ? t("mandatoryOpenSuffix", { p1: screening_summary.mandatoryOpen.join(", ") }) : ""}`}
                >
                  {t("confirmedChip", { p1: screening_summary.assessed, p2: screening_summary.total })}
                </span>
              </div>
              {(() => {
                const reco = precheckRecommendation(savedVerdicts);
                const anyAssessed = [...KNOCKOUT_IDS].some((id) => savedVerdicts[id] && savedVerdicts[id] !== "pending");
                return anyAssessed ? (
                  <p className="mb-2">
                    <span className="text-[length:var(--fs-caption)] mr-2">{t("recoLabel")}</span>
                    <span className={`status-chip ${reco.cls}`}>{reco.label}</span>
                  </p>
                ) : (
                  <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noVerdictsYet")}</p>
                );
              })()}
              <ul className="sizing-note-list mb-1">
                {checklist.map((item) => {
                  const v = savedVerdicts[item.id];
                  const ev = itemEvidence[item.id];
                  return (
                    <li key={item.id} className="text-[length:var(--fs-caption)] flex flex-wrap items-start gap-2">
                      <code className="dd-item-id mt-1">{item.id}</code>
                      <span className="flex-1 min-w-[14rem]">
                        <span className="text-[color:var(--muted-fg)]">{item.text.split(" — ")[0]}</span>
                        {ev?.rationale && <span className="block text-[length:var(--fs-caption)]">{ev.rationale}</span>}
                        {ev?.source_url && (
                          <a href={ev.source_url} target="_blank" rel="noreferrer" className="block text-[length:var(--fs-caption)] text-[color:var(--accent)] underline truncate">
                            {t("sourceLine", { p1: ev.source_url })}
                          </a>
                        )}
                      </span>
                      {ev?.kind === "secured" && <span className="status-chip status-amber">{t("evidenceSecured")}</span>}
                      {ev?.kind === "web" && <span className="status-chip">{t("evidenceWeb")}</span>}
                      <span className={`status-chip ${screeningVerdictChipClass(v)}`}>
                        {SCREENING_VERDICT_KO[normalizeVerdict(v)]}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("verdictWhereNote")}
              </p>
            </div>
            {evidence.length > 0 && (
              <div className="card">
                <h4 className="text-[length:var(--fs-body)] mb-2">{t("timelineHeading")}</h4>
                <ul className="sizing-note-list mb-0">
                  {evidence.map((e) => (
                    <li key={e.id} className="text-[length:var(--fs-caption)]">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={`status-chip ${e.kind === "discovery" ? "status-amber" : e.kind === "analysis" ? "status-amber" : "status-green"}`}>
                          {e.kind === "discovery" ? t("kindDiscovery") : e.kind === "analysis" ? t("kindAnalysis") : t("kindPrecheck")}
                        </span>
                        <strong>{e.title}</strong>
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{e.created_at.slice(0, 16).replace("T", " ")}</span>
                      </span>
                      {e.detail && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] whitespace-pre-wrap">{e.detail}</span>}
                      {e.source_url && (
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">{t("sourceLink")}</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}</>
  );
}
