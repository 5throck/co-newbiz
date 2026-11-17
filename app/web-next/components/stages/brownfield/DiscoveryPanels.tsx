"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { useTranslations } from "next-intl";
import { UniverseDraftPanel } from "./UniverseDraftPanel.tsx";

export function WebDiscoveryPanel({ ctx }: { ctx: BrownfieldStageState }) {
  const t = useTranslations("stages.s67.discoveryPanels");
  const tc = useTranslations("common");
  const {
    selected,
    discoveryPanel,
    webBusy,
    setDiscoveryPanel,
    webModalFocus,
    webProposals,
    webNote,
    webSource,
    acceptProposal,
    ignoreProposal,
    generateWebProposals,
  } = ctx;
  return (
    <>
      {selected && discoveryPanel === "web" && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with crud.tsx (Esc/Tab handled by useModalFocus)
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!webBusy) setDiscoveryPanel(null);
          }}
          onKeyDown={webModalFocus.onKeyDown}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click only stops propagation to the backdrop; keyboard handled on the backdrop */}
          <div
            ref={webModalFocus.panelRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("webSearchCandidateProposal")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{t("webSearchCandidateProposal2")}</h2>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setDiscoveryPanel(null)}
                disabled={webBusy}
                aria-label={tc("close")}
              >
                {tc("close")}
              </button>
            </div>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("liveWebSearchAndProposes")}
            </p>
            {webBusy && webProposals === null ? (
              <p className="my-4 text-center text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                {t("webSearchAndProposalGeneration")}
              </p>
            ) : webProposals !== null && webProposals.length === 0 ? (
              <>
                <p className="my-4 text-center text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                  {webNote ?? t("noCandidatesToProposeRefine")}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={webBusy}
                    onClick={() => void generateWebProposals()}
                  >
                    {tc("retry")}
                  </button>
                </div>
              </>
            ) : (
              <>
                {webProposals !== null && (
                  <p className="mb-2 text-[length:var(--fs-caption)]">
                    <span
                      className={`status-chip ${webSource === "llm" ? "status-green" : webSource === "llm_knowledge" ? "status-red" : "status-amber"}`}
                    >
                      {webSource === "llm"
                        ? t("proposalWebSearchEvidence")
                        : webSource === "llm_knowledge"
                          ? t("proposalUnverifiedNoEvidence")
                          : t("proposalDeterministicFallback")}
                    </span>
                    {webNote && <span className="ml-2 text-[color:var(--muted-fg)]">{webNote}</span>}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 mb-3" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  {(webProposals ?? []).map((s) => (
                    <div key={s.company_name} className="sizing-grade-card mb-0">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[length:var(--fs-body)]">{s.company_name}</strong>
                        {/* design 2026-11-11 §7.2 (D7) — 고유번호 미확인 칩:
                            exact-unique 부착 규칙이 코드를 못 붙였음을
                            침묵 대신 눈에 보이게 만든다. */}
                        <span className="flex items-center gap-1">
                          {!s.dart_corp_code && (
                            <span className="status-chip status-not-started" title={t("corpCodeUnverifiedTooltip")}>
                              {t("corpCodeUnverifiedChip")}
                            </span>
                          )}
                          {/* design 2026-11-13-proposal-ignore-suppression §3.5 —
                              무시 1회 칩: 1회 무시된 재제안 카드. 상태는 색이 아니라
                              텍스트로 전달되고, 두 번째 무시가 실수가 아님을 보게
                              한다(2회째부터는 서버가 억제해 카드 자체가 없다). */}
                          {s.ignore_count != null && s.ignore_count >= 1 && (
                            <span className="status-chip status-not-started">
                              {t("ignoredCountChip", { count: s.ignore_count })}
                            </span>
                          )}
                          <span
                            className="status-chip status-not-started"
                            title={t("sourceDomainConfidenceGovernmentAnd")}
                          >
                            {t("confidence")} {s.reliability}
                          </span>
                        </span>
                      </div>
                      <p className="mb-1 text-[length:var(--fs-caption)]">{s.rationale}</p>
                      {s.sources.slice(0, 2).map((src) => (
                        <a
                          key={src.url}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[length:var(--fs-caption)] text-[color:var(--accent)] underline truncate"
                          title={src.title}
                        >
                          {t("source")} {src.url}
                        </a>
                      ))}
                      <span className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={webBusy}
                          onClick={() =>
                            void acceptProposal(
                              s.company_name,
                              s.dart_corp_code ?? null,
                              "web_proposal",
                              t("webSearchProposalP1Source", {
                                p1: s.rationale.slice(0, 80),
                                p2: s.sources[0]?.url ?? t("none"),
                              }),
                            )
                          }
                        >
                          {t("registerInTheFullCandidate")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          title={t("clearsThisProposalFromThe")}
                          onClick={() => void ignoreProposal(s.company_name)}
                        >
                          {tc("ignore")}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={webBusy}
                    onClick={() => void generateWebProposals()}
                  >
                    {webBusy ? tc("regenerating") : t("regenerate")}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setDiscoveryPanel(null)}>
                    {tc("close")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function UniverseEditModal({ ctx }: { ctx: BrownfieldStageState }) {
  const t = useTranslations("stages.s67.discoveryPanels");
  const tc = useTranslations("common");
  const { editingUniverse, savingUniverse, closeUniverseEditor, universeModalFocus, universeForm } = ctx;
  return (
    <>
      {editingUniverse && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with crud.tsx (Esc/Tab handled by useModalFocus)
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!savingUniverse) closeUniverseEditor();
          }}
          onKeyDown={universeModalFocus.onKeyDown}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click only stops propagation to the backdrop; keyboard handled on the backdrop */}
          <div
            ref={universeModalFocus.panelRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={tc("editTargetMarketDefinition")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{tc("editTargetMarketDefinition")}</h2>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={closeUniverseEditor}
                disabled={savingUniverse}
                aria-label={tc("close")}
              >
                {tc("close")}
              </button>
            </div>
            <p className="mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("nothingIsReflectedUntilSaved")}
            </p>

            <UniverseDraftPanel ctx={ctx} />

            {universeForm()}
          </div>
        </div>
      )}
    </>
  );
}
