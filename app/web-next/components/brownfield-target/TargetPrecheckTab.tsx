"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { precheckRecommendation, KNOCKOUT_IDS, screeningVerdictChipClass, SCREENING_VERDICT_KO, normalizeVerdict } from "../../lib/brownfield-precheck.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { ScreeningSummary, ScreeningItem, ScreeningItemEvidence, EvidenceRow } from "./types.ts";

export function TargetPrecheckTab({ ctx, screening_summary, savedVerdicts, checklist, itemEvidence, evidence }: { ctx: TargetDetailViewState; screening_summary: ScreeningSummary; savedVerdicts: Record<string, string>; checklist: ScreeningItem[]; itemEvidence: Record<string, ScreeningItemEvidence>; evidence: EvidenceRow[] }) {
  const { profileTab } = ctx;
  return (
    <>{profileTab === "precheck" && (
          <div className="mt-3">
            <div className="card mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h4 className="text-[length:var(--fs-body)] mb-0">사전 검토 — 대상 사전 검토 체크리스트(9개 항목)</h4>
                <span
                  className={`status-chip ${screening_summary.anyKnockOutFail ? "status-red" : screening_summary.assessed === 0 ? "status-not-started" : screening_summary.assessed < screening_summary.total || screening_summary.mandatoryOpen.length > 0 ? "status-amber" : "status-green"}`}
                  title={`확정 판정 ${screening_summary.assessed}/${screening_summary.total}${screening_summary.mandatoryOpen.length ? ` · 미판정 필수: ${screening_summary.mandatoryOpen.join(", ")}` : ""}`}
                >
                  확정 판정 {screening_summary.assessed}/{screening_summary.total}
                </span>
              </div>
              {(() => {
                const reco = precheckRecommendation(savedVerdicts);
                const anyAssessed = [...KNOCKOUT_IDS].some((id) => savedVerdicts[id] && savedVerdicts[id] !== "pending");
                return anyAssessed ? (
                  <p className="mb-2">
                    <span className="text-[length:var(--fs-caption)] mr-2">사전 검토 결과(확정 판정 기준):</span>
                    <span className={`status-chip ${reco.cls}`}>{reco.label}</span>
                  </p>
                ) : (
                  <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">아직 확정된 판정이 없습니다 — 최종 후보 목록 승격 후 /brownfield 화면의 "사전 검토" 섹션에서 판정합니다.</p>
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
                            출처: {ev.source_url}
                          </a>
                        )}
                      </span>
                      {ev?.kind === "secured" && <span className="status-chip status-amber">기확보</span>}
                      {ev?.kind === "web" && <span className="status-chip">웹검색</span>}
                      <span className={`status-chip ${screeningVerdictChipClass(v)}`}>
                        {SCREENING_VERDICT_KO[normalizeVerdict(v)]}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                판정 기록은 /brownfield 화면의 "사전 검토" 섹션에서 합니다 — 이 탭은 수집된 정보의 참고 저장소입니다.
              </p>
            </div>
            {evidence.length > 0 && (
              <div className="card">
                <h4 className="text-[length:var(--fs-body)] mb-2">정보 수집 타임라인</h4>
                <ul className="sizing-note-list mb-0">
                  {evidence.map((e) => (
                    <li key={e.id} className="text-[length:var(--fs-caption)]">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={`status-chip ${e.kind === "discovery" ? "status-amber" : e.kind === "analysis" ? "status-amber" : "status-green"}`}>
                          {e.kind === "discovery" ? "등록" : e.kind === "analysis" ? "재분석" : "사전 검토"}
                        </span>
                        <strong>{e.title}</strong>
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{e.created_at.slice(0, 16).replace("T", " ")}</span>
                      </span>
                      {e.detail && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] whitespace-pre-wrap">{e.detail}</span>}
                      {e.source_url && (
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">출처</a>
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
