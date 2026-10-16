"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { MarketAnalysisStageState } from "./useMarketList.ts";
import { ColGroup } from "../../ui.tsx";
import type { FlatIndustryRow } from "./grouping.ts";

// 분석 대상 산업 목록 6열 — 산업명·분석 상태가 가장 긴 텍스트 열.
const INDUSTRY_COL_PCT = [26, 8, 10, 22, 12, 22] as const;
import type { AnalysisInfo } from "./types.ts";

export function IndustryTable({ ctx, rows }: { ctx: MarketAnalysisStageState; rows?: FlatIndustryRow[] }) {
  const { overview, editing, selectedIndustry, setEditing, canCurate, pinBusyId, togglePin, loadDetail, savingEdit, visibleIndustries, flatRows, saveEdit, deleteIndustry, STALE_DAYS, relDate, rerunAnalysis } = ctx;
  const shown = rows ?? flatRows;
  return (
    <>{overview === null ? (
          <p>불러오는 중...</p>
        ) : overview.industries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 산업이 없습니다. "신규 산업 분석"으로 시작하세요.</p>
        ) : visibleIndustries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">검색·필터 조건에 맞는 산업이 없습니다.</p>
        ) : shown.length === 0 ? (
          null
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table list-table market-list-table table-fixed-pct tmin-64" aria-label="분석 대상 산업 목록">
            <caption className="sr-only">분석 대상 산업 목록</caption>
            <ColGroup widths={INDUSTRY_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">산업명</th>
                <th scope="col">KSIC 코드</th>
                <th scope="col">연결 드라이버</th>
                {/* 분석 상태는 가장 긴 텍스트 열(재분석 진행률·버전 유지 문구 칩) —
                    10rem에서는 3줄로 뭉개지므로 14rem으로 늘린다(max-width는
                    market-list-table이 72rem으로 상향, 아래 styles.css 참조). */}
                <th scope="col">분석 상태</th>
                <th scope="col" className="col-date">분석일</th>
                <th scope="col"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ ind, relation, childCount, expanded, onToggle }) => {
                const a = ind.analysis;
                const inProgress = a?.status === "in_progress";
                // 보호 모드 재분석 중엔 status가 여전히 'completed'라 inProgress로는
                // 안 잡힌다 — 재분석/수정/삭제를 막으려면 이 플래그도 함께 봐야 한다.
                const busy = inProgress || !!a?.rerun_in_progress;
                // 큐 위치 표기(UX-4) — 같은 앵커의 대기열에서 몇 번째인지 칩 본문에 노출.
                const queueLabel = (() => {
                  if (a?.status !== "pending") return "연계 대기";
                  const sibs = (overview?.industries ?? [])
                    .map((i2) => i2.analysis)
                    .filter((x): x is AnalysisInfo => Boolean(x) && x!.status === "pending" && x!.after_analysis_id === a.after_analysis_id)
                    .sort((x, y) => x.created_at.localeCompare(y.created_at));
                  const idx = sibs.findIndex((x) => x.id === a.id);
                  return idx >= 0 ? `연계 대기 · ${idx + 1}번째` : "연계 대기";
                })();
                const analysisDate = a ? (a.completed_at ?? a.created_at).slice(0, 10) : null;
                const stale = a?.status === "completed" && analysisDate
                  ? (Date.now() - new Date(analysisDate).getTime()) / 86400000 > STALE_DAYS
                  : false;
                const isEditing = editing?.id === ind.id;
                return (
                  <tr key={ind.id} className={selectedIndustry === ind.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      {isEditing ? (
                        <input
                          aria-label="산업명 수정"
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          className="sizing-new-input"
                          autoFocus
                        />
                      ) : (
                        <span className="flex items-center gap-1.5" style={relation ? { paddingLeft: "2rem" } : undefined}>
                          {/* 핀(★)은 본 산업·연계 산업 모두에 렌더링한다 — 연계 산업도
                              개별 고정 대상(2026-09-14 사용자 리포트: 유압식 브레이커).
                              연계 행은 들여쓰기 + ↳ + 관계 칩으로 위계를 표현한다. */}
                          {canCurate ? (
                          <button
                            type="button"
                            disabled={pinBusyId === ind.id}
                            className={ind.pinned ? "text-[color:var(--amber-fg)]" : "text-[color:var(--muted-fg)] hover:text-[color:var(--amber-fg)]"}
                            title={ind.pinned ? "핵심 산업 고정 해제" : "핵심 산업으로 고정 — '핵심만 보기'에서 최상위로 표시됩니다"}
                            aria-label={ind.pinned ? `중요 표시 해제: ${ind.name_ko}` : `중요 표시: ${ind.name_ko}`}
                            aria-pressed={Boolean(ind.pinned)}
                            onClick={() => void togglePin(ind)}
                          >
                            {ind.pinned ? "★" : "☆"}
                          </button>
                          ) : null}
                          {relation && (
                            <>
                              <span aria-hidden="true" className="text-[color:var(--muted-fg)]">↳</span>
                              <span className={`status-chip ${relation === "전방" || relation === "전전방" ? "status-in-progress" : "status-amber"}`}>{relation}</span>
                            </>
                          )}
                          {onToggle && (
                            <button
                              type="button"
                              className="text-[color:var(--muted-fg)] hover:text-[color:var(--fg)]"
                              title={expanded ? "연계 산업 접기" : "연계 산업 펼치기"}
                              aria-expanded={expanded}
                              onClick={onToggle}
                            >
                              {expanded ? "▾" : "▸"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={relation ? "text-left underline-offset-2 hover:underline" : "font-semibold text-left underline-offset-2 hover:underline"}
                            title="분석 리포트 열기"
                            onClick={() => loadDetail(ind.id)}
                          >
                            {ind.name_ko}
                          </button>
                          {childCount > 0 && (
                            <button
                              type="button"
                              className="status-chip status-not-started"
                              title={expanded ? "연계 산업 접기" : "연계 산업 펼치기"}
                              onClick={onToggle ?? undefined}
                            >
                              연계 {childCount}건
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label="KSIC 코드 수정"
                          value={editing.code}
                          onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                          placeholder="예: 28121"
                          className="sizing-new-input sizing-new-input-sm"
                        />
                      ) : (
                        <code className="dd-item-id">{ind.ksic_code ?? "—"}</code>
                      )}
                    </td>
                    <td className="tabular-nums">{ind.driver_count}건</td>
                    <td>
                      {a?.status === "pending" ? (
                        <span className="status-chip status-not-started" title="선행 산업 분석이 완료되면 자동으로 시작됩니다. 시작 전에는 언제든 재분석 모달에서 제외할 수 있습니다.">{queueLabel}</span>
                      ) : inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a?.current_step ?? 0}/8단계)</span>
                      ) : a?.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0131 — 재분석 진행 중에도 status는 여전히 이전(완료) 버전을 가리킨다.
                        // 새 버전은 성공해야만 "교체"되므로, 지금 화면에 보이는 건 이전 버전 그대로다.
                        <span className="status-chip status-amber" title="이전 완료 버전은 그대로 표시되며, 재분석이 성공해야만 새 버전으로 교체됩니다.">재분석 중 ({a.current_step ?? 0}/8단계, 이전 v{a.latest_version ?? 1} 유지)</span>
                      ) : a?.status === "completed" && a.error_message ? (
                        // 보호 모드 재분석이 LLM 장애로 실패한 직후 — status/completed_at은 그대로,
                        // error_message만 이번 시도 실패 사유로 남는다(날짜·버전 변경 없음).
                        <span className="status-chip status-red" title={`${a.error_message} — 표시 중인 버전은 이전 완료 버전입니다.`}>재분석 실패 (v{a.latest_version ?? 1} 유지)</span>
                      ) : stale ? (
                        <span className="status-chip status-amber" title="분석일이 90일을 지났습니다 — 재분석로 최신화하세요.">업데이트 권장 (v{a?.latest_version ?? 1})</span>
                      ) : a?.status === "completed" && a.data_quality === "all_synthesis" ? (
                        // ADR-0131 후속 — 최신 완료 버전의 모든 단계가 AI 미설정/실패로
                        // 결정론 합성값으로 채워졌다. 수치를 전혀 신뢰할 수 없으므로
                        // "분석 완료"와 시각적으로 구별되는 경고 상태로 표시한다.
                        <span className="status-chip status-red" title="이 버전은 전체 단계가 AI 미설정/실패로 합성(더미) 값입니다 — 수치를 신뢰하지 말고 재분석하세요.">분석 완료 (v{a.latest_version ?? 1}) — 합성 데이터</span>
                      ) : a?.status === "completed" && a.data_quality === "partial_synthesis" ? (
                        <span className="status-chip status-amber" title="이 버전은 일부 단계가 AI 미설정/실패로 합성(더미) 값입니다 — 리포트에서 어느 단계인지 확인 후 필요시 재분석하세요.">분석 완료 (v{a.latest_version ?? 1}) — 일부 합성</span>
                      ) : a?.status === "completed" ? (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      ) : a?.status === "failed" && a.error_message && (a.error_message.startsWith("선행 분석 실패") || a.error_message.startsWith("루트 재분석") || a.error_message.startsWith("선행 분석 장기")) ? (
                        <span className="status-chip status-not-started" title={`${a.error_message} — 재분석 완료 후 모달에서 다시 선택하거나, 해당 산업을 직접 분석할 수 있습니다.`}>시작 취소</span>
                      ) : a?.status === "failed" ? (
                        <span className="status-chip status-red" title={a.error_message ?? "파이프라인 실행 중 오류가 발생했습니다."}>분석 실패</span>
                      ) : (
                        <span className="status-chip status-not-started">분석 대기</span>
                      )}
                    </td>
                    <td className="col-date">
                      {a ? (
                        <span className="tabular-nums" title={analysisDate ?? ""}>{relDate(analysisDate)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-ghost btn-sm" disabled={savingEdit || !editing.name.trim()} onClick={saveEdit}>
                            {savingEdit ? "저장 중..." : "저장"}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          {a && !busy && canCurate && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm sizing-rerun-btn"
                              title={stale ? "분석일이 90일 지났습니다" : "분석 실패 또는 갱신 필요 시 새 버전으로 재실행"}
                              onClick={() => rerunAnalysis(a.id, ind.name_ko)}
                            >
                              재분석
                            </button>
                          )}
                          {!busy && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              title="산업명·KSIC 코드 수정"
                              onClick={() => setEditing({ id: ind.id, name: ind.name_ko, code: ind.ksic_code ?? "" })}
                            >
                              수정
                            </button>
                          )}
                          {!busy && canCurate && (
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              title="이 산업과 시장분석 기록을 삭제합니다"
                              onClick={() => deleteIndustry(ind)}
                            >
                              삭제
                            </button>
                          )}
                        </>
                      )}
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}</>
  );
}
