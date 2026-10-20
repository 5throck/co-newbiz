"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { normalizeVerdict, precheckRecommendation, KNOCKOUT_IDS, SCREENING_VERDICT_KEYS, SCREENING_VERDICT_KO } from "../../../lib/brownfield-precheck.ts";
import { CommitteePanel } from "../../CommitteePanel.tsx";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { PromotionPanel } from "../../PromotionPanel.tsx";
import { ColGroup } from "../../ui.tsx";
import { SECTION_IDS, shortlistColPct } from "./constants.ts";
import { buildEvalBriefMd } from "./evalBrief.ts";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";

export function ShortlistSection({ ctx }: { ctx: BrownfieldStageState }) {
  const { selected, precheckOpen, setPrecheckOpen, recoBusy, recoProgress, precheckDraft, precheckDraftNote, canAct, setPrecheckDraft, precheckBusy, shortlistedTargets, precheckIncomplete, checklistItems, part1Count, part2Count, savePrecheck, runCommitteePrecheck } = ctx;
  return (
    <>{selected && (
        <div id={SECTION_IDS.shortlist} className="mt-3 flex flex-col gap-3 items-stretch" style={{ scrollMarginTop: "1rem" }}>
          {/* ── 사전 검토 — 대상 사전 검토 체크리스트 9개 항목 전 항목. 최종 후보 목록에
              오른 후보를 대상으로 "문제 없는지" 최종 점검하는 체크리스트다
              (사용자 결정, 2026-09-16). 판정 기록도 이 섹션에서 인라인으로 한다 —
              상세 화면·후보 전체 목록의 사전 검토 표면은 제거(사용자 결정, 2026-09-16).
              공식 판정이 아니며 승격/추진을 막지 않는다. 위원회가 이 판정을 근거로
              최종 후보 목록을 최종 검토해 사람에게 게이트 결정을 제안한다. ── */}
          {shortlistedTargets.length > 0 && (
            <section aria-label="사전 검토 · 위원회 추천" className="market-section">
              <SectionToolbar
                title="사전 검토 · 위원회 추천 — 대상 사전 검토 체크리스트(9개 항목)"
                summary={
                  <span className="note">
                    — 최종 후보 목록 최종 점검 · 공식 판정 아님
                    <span className={`status-chip ml-2 ${precheckIncomplete === 0 ? "status-green" : "status-amber"}`}>
                      {precheckIncomplete === 0 ? "전 후보 검토 완료" : `미완료 ${precheckIncomplete}/${shortlistedTargets.length}`}
                    </span>
                  </span>
                }
              />
              {/* 통합 플로우(사용자 결정, 2026-09-16): 아래 "위원회 추천 검토 · 소집"
                  버튼 하나가 (1) 후보별로 기확보 정보(전자공시 재무 정보·AI 프로파일·
                  공시 — 재검색 안 함)를 활용하고 부족한 정보만 검색해 판정 제안을
                  만들고 (2) 그 제안을 심의 근거로 위원회를 소집한다. 사람은 표에서
                  제안을 검토·수정한 뒤 저장으로 확정하고, 게이트 결정(사람)으로
                  이어진다. */}
              {(() => {
                // 접힘 기본값: 사용자 선택 > (미완료 → 펼침 / 완료 → 접음)
                const precheckOpenEffective = precheckOpen ?? precheckIncomplete > 0;
                return (
                  <details
                    open={precheckOpenEffective}
                    onToggle={(e) => setPrecheckOpen((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      판정표 열기/닫기 — 후보 {shortlistedTargets.length}건 × 대상 사전 검토 체크리스트 {checklistItems.length}항목
                    </summary>
              {recoBusy && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] mb-2" role="status">
                  근거 수집·판정 제안 생성 중 — {recoProgress ?? "준비 중"} (완료되면 이 표의 미판정 셀이 채워지고 위원회가 자동 소집됩니다. 수십 초 걸릴 수 있습니다)
                </p>
              )}
              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                이 표는 아래 위원회 패널의 <b>&quot;위원회 추천 검토 · 소집&quot;</b> 버튼으로 채웁니다 — 누르면 ① 후보별 판정 제안이 이 표의 미판정 셀에 채워지고(기확보 정보 활용 + 부족한 정보만 검색, 재실행 시 확정 판정을 유지한 채 미판정만 다시 제안) ② 그 제안을 근거로 위원회가 심의합니다. 셀을 검토·수정한 뒤 행별 <b>판정 저장</b>으로 확정하세요.
              </p>
              {/* 전치 테이블 — 평가 항목(9개 항목)이 컬럼 헤더, 후보가 행(사용자
                  제안, 2026-09-16). 후보 간 비교와 위원회 검토에 맞는 형태다.
                  셀은 판정 select 하나로 압축하고, 근거(제안 사유·출처·기확보
                  구분)는 툴팁과 표식으로 보여준다. */}
              <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                <table className="data-table table-fixed-pct tmin-80" aria-label="사전 검토 · 위원회 추천">
                  <caption className="sr-only">최종 후보 목록 후보 × 대상 사전 검토 체크리스트 항목 판정표</caption>
                  <ColGroup widths={shortlistColPct(checklistItems.length)} />
                  <thead>
                    <tr>
                      <th rowSpan={2} scope="col">후보</th>
                      <th colSpan={part1Count} scope="colgroup" className="text-center">1부 — 필수 항목(하나라도 미충족이면 제외 검토)</th>
                      <th colSpan={part2Count} scope="colgroup" className="text-center">2부 — 권장 평가</th>
                      <th rowSpan={2} scope="col">확정</th>
                    </tr>
                    <tr>
                      {checklistItems.map((it) => (
                        <th key={it.id} scope="col" title={`${it.text}${it.mandatory ? " (필수)" : ""}`}>
                          <code className="dd-item-id mr-1">{it.id}</code>{it.text.split(" — ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shortlistedTargets.map((t) => {
                      const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
                      const concern = ["t-01", "t-02"].some((id) => normalizeVerdict(states[id]) === "unfulfilled");
                      const sm = t.screening_summary;
                      const total = sm?.total ?? checklistItems.length;
                      const draft = precheckDraft[t.id] ?? {};
                      const dirtyCount = Object.keys(draft).length;
                      // 추천안 — 확정 판정 + 미확정 제안을 합쳐 결정론 규칙으로 도출
                      // (Part 1 knock-out 기준). 위원회 제안이며 확정은 사람이 저장으로 한다.
                      const mergedVerdicts: Record<string, string> = { ...states };
                      for (const [itemId, d] of Object.entries(draft)) {
                        if (d.verdict) mergedVerdicts[itemId] = d.verdict;
                      }
                      const reco = precheckRecommendation(mergedVerdicts);
                      const hasReco = [...KNOCKOUT_IDS].some((id) => mergedVerdicts[id] && mergedVerdicts[id] !== "pending");
                      // 진행 칩은 확정+미확정 제안을 합쳐 센다 — 제안으로 채워져도
                      // 0/9로 보이는 문제를 막는다(사용자 리포트, 2026-09-16).
                      const mergedAssessed = checklistItems.filter((it) => {
                        const nv = normalizeVerdict(mergedVerdicts[it.id]);
                        return nv !== "pending";
                      }).length;
                      const mergedClass = sm?.anyKnockOutFail
                        ? "status-red"
                        : mergedAssessed === 0
                          ? "status-not-started"
                          : mergedAssessed < total || (sm?.mandatoryOpen.length ?? 0) > 0
                            ? "status-amber"
                            : "status-green";
                      const note = precheckDraftNote[t.id];
                      return (
                        <tr key={t.id}>
                          <td className="cell-primary">
                            <div className="flex flex-col gap-1">
                              <strong className="text-[length:var(--fs-body)]">{t.company_name}{t.rank ? ` · rank ${t.rank}` : ""}</strong>
                              <span className="flex flex-wrap items-center gap-1">
                                {concern && <span className="status-chip status-red" title="1번 또는 2번 항목 미충족">인수 가능성 우려</span>}
                                {hasReco && (
                                  <span className={`status-chip ${reco.cls}`} title={`1부 필수 항목(1~5번) 기준 위원회 추천안 — 확정은 사람이 저장으로 합니다${dirtyCount > 0 ? " · 미확정 제안 포함" : ""}`}>
                                    추천안 · {reco.label}
                                  </span>
                                )}
                                <span
                                  className={`status-chip ${mergedClass}`}
                                  title={`9개 항목 판정 ${mergedAssessed}/${total}${dirtyCount > 0 ? ` (미확정 제안 ${dirtyCount}건 포함)` : ""}${sm?.mandatoryOpen.length ? ` · 미판정 필수: ${sm.mandatoryOpen.join(", ")}` : ""}${sm?.anyKnockOutFail ? " · 필수 미충족 있음" : ""}`}
                                >
                                  판정 {mergedAssessed}/{total}
                                </span>
                              </span>
                            </div>
                          </td>
                          {checklistItems.map((it) => {
                            const v = draft[it.id]?.verdict ?? states[it.id] ?? "pending";
                            const meta = draft[it.id];
                            // 근거(제안 사유·출처)는 셀 안 링크 대신 툴팁으로 — 링크가
                            // 셀 아래 줄을 만들어 행 높이가 어긋나는 문제를 막는다
                            // (사용자 UI 리포트, 2026-09-16). 전체 근거는 후보 상세
                            // '사전 검토 근거' 탭에서 본다.
                            const tip = [
                              it.text,
                              meta?.rationale ? `제안 사유: ${meta.rationale}` : null,
                              meta?.source_url ? `출처: ${meta.source_url}` : null,
                            ].filter(Boolean).join("\n");
                            return (
                              <td key={it.id}>
                                <select
                                  aria-label={`${t.company_name} ${it.id} 판정`}
                                  className="sizing-new-input sizing-new-input-sm w-full"
                                  style={{ minWidth: "5.5rem" }}
                                  title={tip}
                                  disabled={!canAct}
                                  value={v}
                                  onChange={(e) => setPrecheckDraft((prev) => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), [it.id]: { verdict: e.target.value } } }))}
                                >
                                  <option value="pending">미판정</option>
                                  {SCREENING_VERDICT_KEYS.map((sv) => (
                                    <option key={sv} value={sv}>{SCREENING_VERDICT_KO[sv]}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}
                          <td>
                            <div className="flex flex-col items-start gap-1">
                              {canAct && <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={precheckBusy === t.id || recoBusy || dirtyCount === 0}
                                title="화면에서 고른 판정을 저장합니다 — 수집 근거도 함께 저장되어 후보 상세 '사전 검토 근거' 탭에서 참고할 수 있습니다"
                                onClick={() => savePrecheck(t.id)}
                              >
                                판정 저장{dirtyCount > 0 ? ` (${dirtyCount}건)` : ""}
                              </button>}
                              {note && (
                                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] max-w-[10rem] truncate" title={note}>{note}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 위원회 심의 — "위원회 추천 검토 · 소집" 버튼 하나로 (1) 위 표의
                  판정 제안 생성(기확보 정보 활용 + 부족한 정보만 검색)과 (2) 그
                  제안을 근거로 한 위원회 소집이 함께 실행된다(ADR-0097 · 사용자
                  결정 2026-09-16 — 제안 생성과 소집의 역할 중복을 해소). 소집된
                  위원회의 심의 결과는 제안일 뿐이며, 확정은 사람이 한다.
                  재무·기술 평가(랭킹용)와 역할은 분리된다. */}
              <div className="flex flex-wrap items-center gap-2 mt-2 mb-0">
                {precheckIncomplete === 0 ? (
                  <span className="status-chip status-green">사전 검토 완료</span>
                ) : (
                  <span className="status-chip status-amber" title="판정이 덜 기록되었거나 필수 미충족이 있는 후보가 있습니다">
                    사전 검토 미완료 {precheckIncomplete}/{shortlistedTargets.length}
                  </span>
                )}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  버튼을 누르면 ① 위 표의 미판정 셀에 판정 제안이 채워지고(기확보 정보 활용 + 부족한 정보만 검색) ② 그 제안을 근거로 위원회가 심의해 ③ 아래 대상 선정 게이트 결정(사람)에 제안합니다. 제안 확정은 표의 판정 저장으로 합니다.
                </span>
              </div>
                  </details>
                );
              })()}
              <CommitteePanel
                opportunityId={selected.opportunity.id}
                committeeKey="target-longlist-shortlist-committee"
                committeeLabel="S6/S7 최종 후보 목록 최종 검토 위원회 (롱리스트→숏리스트)"
                gates={["target_screening"]}
                briefMd={buildEvalBriefMd(selected.targets, selected.checklist, precheckDraft)}
                beforeConvene={runCommitteePrecheck}
                conveneLabel="사전 검토 실행 (위원회 추천 검토)"
                headerPrimary
              />
            </section>
          )}

          {/* flow.spec target_screening killCriteria: knock-out 통과 후보가 0건이다. 2026-10-20 decider:
              the old proxy ("evaluation complete = every item judged") fired the kill language whenever
              later-seeded criteria stayed pending — evaluation completeness is informational, not a kill. */}
          <GateDecisionPanel
            opportunityId={selected.opportunity.id}
            gates={["target_screening"]}
            killHint={
              selected.targets.length > 0 && !selected.targets.some((t) => t.status !== "excluded")
                ? "knock-out 스크리닝을 통과한 후보가 0건입니다 — 중단 기준(진입 가능한 대상 없음)에 해당하는지 검토하세요."
                : null
            }
          />
          {(() => {
            const incomplete = selected.targets.filter((t) => t.status !== "excluded" && t.eval_summary && !t.eval_summary.complete);
            if (incomplete.length === 0) return null;
            return (
              <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="eval-incomplete-note">
                ⓘ 평가가 끝나지 않은 최종 후보 {incomplete.length}건 ({incomplete.map((t) => t.company_name).join(", ")}) — 후보 상세의 평가 탭에서 남은 항목을 판정하면 점수가 확정됩니다 (참고 정보이며 게이트 조건이 아닙니다).
              </p>
            );
          })()}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            ↓ 위 대상 선정 게이트가 <b>진행</b>으로 기록되어야 아래 프로젝트 추진이 가능합니다 — 승인 기록은 판단, 추진은 그 판단을 전제로 한 장부상 전환입니다.
          </p>
          {/* ADR-0095 — S7→S8 승격 표면: 완료 요건 충족 시 사람이 승격을 기록한다 */}
          <PromotionPanel
            opportunityId={selected.opportunity.id}
            heading={`${selected.opportunity.name} — 프로젝트로 추진 (대상 선정 승인 이후, S7 → S8)`}
          />
        </div>
      )}</>
  );
}
