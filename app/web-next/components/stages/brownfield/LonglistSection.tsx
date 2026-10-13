"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { Fragment } from "react";
import { SECTION_IDS, STATUS_LABEL } from "./constants.ts";
import { ColGroup } from "../../ui.tsx";

// 후보 전체 목록 — 후보명·DART·재무기술 칩 2개·잠정 순위·상태·제외 사유 6열.
// 상태 열에는 칩+버튼이 들어가고 후보명·제외 사유는 긴 텍스트다.
const LONG_LIST_COL_PCT = [22, 12, 18, 14, 18, 16] as const;
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";

export function LonglistSection({ ctx }: { ctx: BrownfieldStageState }) {
  const { selected, canAct, busy, targets, shortlistedTargets, displayedTargets, shortlistOrder, evalRank, shortlist, rerank } = ctx;
  return (
    <>{selected && (
        <div id={SECTION_IDS.longlist} style={{ scrollMarginTop: "1rem" }}>
        {/* ── S6/S7: 후보 등록 + 후보 전체 목록 + 스크리닝 ── */}
        <section aria-label="대상 후보 스크리닝" className="market-section">
          {/* 후보 등록 폼은 위 "후보 발굴" 카드에 항상 표시된다(사용자 요청,
              2026-09-15) — 시장·기업 마스터/웹 검색·LLM 제안과 나란히 묶인다. */}

          {/* S7 선정 퍼널·게이트·위원회·승격은 아래 이어지는 섹션에서 계속된다
              (mockup처럼 탭 없이 한 화면 — 사용자 요청, 2026-09-15). */}

          {/* 후보 전체 목록 테이블 — 목표 시장 정의·후보 발굴 카드와 같은 카드 표면으로
              감싸 화면 위계를 맞춘다(UX 정리, 2026-09-15). */}
          <SectionToolbar
            title="후보 전체 목록 → 판정 · 랭킹 → 최종 후보 목록"
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">후보 전체 목록 {targets.length} · 최종 후보 목록 {shortlistedTargets.length}</span>}
          />
          <div className="sizing-grade-card">
          {targets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">후보 전체 목록 후보가 없습니다 — 위에서 후보를 등록하세요.</p>
          ) : displayedTargets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">해당 상태의 후보가 없습니다.</p>
          ) : (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label="후보 전체 목록">
              <caption className="sr-only">후보 전체 목록 후보 — 평가 점수·잠정 순위·상태</caption>
              <ColGroup widths={LONG_LIST_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">후보</th><th scope="col">DART</th>
                  <th scope="col" title="재무·기술 평가 100점 가중 점수 — 충족 1점·부분충족 0.5점·미충족 0점을 가중평균, 예외(해당없음·예외)는 제외">재무·기술 평가</th>
                  <th scope="col" title="위 재무·기술 평가 종합 점수(financial·technical 평균) — 후보 전체 목록 잠정 순위(최종 후보 목록 rank와 별개)">잠정 순위</th>
                  <th scope="col">상태</th>
                  <th scope="col">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {displayedTargets.map((t) => {
                  const es = t.eval_summary;
                  const orderIdx = shortlistOrder.indexOf(t.id);
                  const canPromote = t.status === "pending" && t.eval_summary?.complete === true;
                  return (
                    <Fragment key={t.id}>
                      <tr>
                        <td className="cell-primary cell-truncate">
                          <a
                            href={`/brownfield/targets/${encodeURIComponent(t.id)}`}
                            className="font-semibold text-[color:var(--fg)] underline-offset-2 hover:underline"
                            title="후보 상세 화면(판정·평가·전자공시 정보)으로 이동합니다"
                          >
                            {t.company_name}
                          </a>
                          {/* 발굴 근거(universe_note — 웹검색 제안 문구 등)는 테이블
                              가독성을 해치므로 표시하지 않는다(사용자 요청, 2026-09-15).
                              제외 사유만 별도 컬럼으로 남는다. */}
                        </td>
                        <td><code className="dd-item-id">{t.dart_corp_code ?? "—"}</code></td>
                        <td>
                          <span className="flex items-center gap-1">
                            <span className={`status-chip ${es?.financial.score == null ? "status-not-started" : es.financial.score >= 70 ? "status-green" : es.financial.score >= 40 ? "status-amber" : "status-red"}`} title="재무 평가 100점 가중 점수">
                              재무 {es?.financial.score ?? "—"}
                            </span>
                            <span className={`status-chip ${es?.technical.score == null ? "status-not-started" : es.technical.score >= 70 ? "status-green" : es.technical.score >= 40 ? "status-amber" : "status-red"}`} title="기술 평가 100점 가중 점수(S3 필요 역량 기준)">
                              기술 {es?.technical.score ?? "—"}
                            </span>
                          </span>
                        </td>
                        <td className="tabular-nums" title="재무·기술 평가 종합 점수(financial·technical 평균) 기준 잠정 순위 — 제외를 뺀 전 후보 대상으로 유지(승격해도 사라지지 않음). 최종 후보 목록 rank(사람이 조정)와 별개">
                          {t.status === "excluded" ? (
                            <span className="text-[color:var(--muted-fg)]">—</span>
                          ) : es?.combined != null ? (
                            t.status === "shortlisted" ? (
                              <span className="text-[color:var(--muted-fg)]" title="승격 시점 평가 기준 잠정 순위(참고) — 최종 후보 목록 표시 순위는 사람이 조정한 rank입니다">
                                #{evalRank.get(t.id)} ({es.combined}점)
                              </span>
                            ) : (
                              <>#{evalRank.get(t.id)} <span className="text-[color:var(--muted-fg)]">({es.combined}점)</span></>
                            )
                          ) : (
                            <span className="text-[color:var(--muted-fg)]">평가 필요</span>
                          )}
                        </td>
                        <td>
                          <span className="flex items-center gap-1">
                            <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                              {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
                            </span>
                            {canAct && canPromote && (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} title="재무·기술 평가 완료 — 최종 후보 목록으로 승격" onClick={() => shortlist(t.id)}>승격</button>
                            )}
                            {canAct && t.status === "shortlisted" && (
                              <span role="group" aria-label="최종 후보 목록 순위 조정" className="flex items-center gap-0.5">
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx <= 0} aria-label={`${t.company_name} 순위 올리기`} onClick={() => rerank(t.id, "up")}>↑</button>
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx < 0 || orderIdx >= shortlistOrder.length - 1} aria-label={`${t.company_name} 순위 내리기`} onClick={() => rerank(t.id, "down")}>↓</button>
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                          {t.exclusion_reason ? (
                            <span className="inline-block max-w-[18rem] truncate align-bottom" title={t.exclusion_reason}>{t.exclusion_reason}</span>
                          ) : "—"}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          </div>
        </section>
        </div>
      )}</>
  );
}
