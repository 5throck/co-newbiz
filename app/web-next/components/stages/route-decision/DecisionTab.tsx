"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup, ParamTable } from "../../ui.tsx";
import { DECISION_COL_PCT, OVERRIDDEN_SUBS, BF_SUB, GF_SUB } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";

export function DecisionTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {
  const { tab, decisions, saveDecision, canAct, track, setTrack, setIntent, setSubTrack, subTrack, subs, overrideBlocked, intent, stagingHint, rationale, setRationale, alternatives, setAlternatives, draftSaving, performSaveDraft, saving, canSubmit, draftSavedAt, totalScore, allScored, setTab, historyYear, historyMonth, historyOpen, setHistoryOpen, setHistoryYear, setHistoryMonth, sessions } = ctx;
  return (
    <>{tab === "decision" && (
        <div className="card">
          <h2>
            {selected.name} — 트랙·라우트 결정{" "}
            <span className={`status-chip ${decisions.length > 0 ? "status-green" : "status-amber"}`}>
              {decisions.length > 0 ? "결정 기록됨" : "결정 대기"}
            </span>
          </h2>
          <ParamTable
            caption="검토 안건 사실"
            labelHeader="사실"
            valueAlign="start"
            rows={[
              {
                label: "시장",
                value: `${selected.market_scope ?? "—"}${selected.market_size_krw_m ? ` (규모 ${selected.market_size_krw_m.toLocaleString()} 백만원)` : ""}${selected.growth_rate !== null ? ` · CAGR ${(selected.growth_rate * 100).toFixed(1)}%` : ""}`,
              },
              { label: "발굴 근거", value: selected.rationale ?? "—" },
            ]}
          />

          <form id="route-form" onSubmit={saveDecision}>
          <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="flex flex-wrap items-end gap-4 mb-3">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1 font-medium">트랙 <span className="text-[color:var(--red-fg)]">*</span></span>
                <select value={track} onChange={(e) => { setTrack(e.target.value as "greenfield" | "brownfield"); setIntent(""); setSubTrack(""); }} className="sizing-new-input">
                  <option value="greenfield">Greenfield — 자체 역량으로 진출</option>
                  <option value="brownfield">Brownfield — 기존 기업·자산과 결합</option>
                </select>
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1 font-medium">라우트 {track === "brownfield" ? <><span className="text-[color:var(--red-fg)]">*</span> (Brownfield)</> : "(선택)"}</span>
                <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                  <option value="">선택...</option>
                  {Object.entries(subs)
                    .filter(([k]) => !overrideBlocked || !OVERRIDDEN_SUBS.includes(k))
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1 font-medium">의도 (Stage 1) <span className="text-[color:var(--red-fg)]">*</span></span>
                <select value={intent} onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")} className="sizing-new-input">
                  <option value="">선택...</option>
                  <option value="integration">통합</option>
                  <option value="capability_access">역량접근</option>
                </select>
              </label>
            </div>
            {overrideBlocked && (
              <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">
                사전배제: 통제 필요도=高 + 역량접근 의도에서는 파트너십·R&BD·CVC 라우트를 선택할 수 없습니다 (합산 점수와 무관).
              </p>
            )}
            {stagingHint && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)] mb-2">
                스테이징 권고: 시장 불확실성이 高이고 통제 필요도가 中 이하 — 소수지분/공동개발 + 사전 협약된 step-up(call option / ROFR / 전환 트리거)을 권고합니다.
              </p>
            )}
            <label className="text-[length:var(--fs-caption)] block mb-2">
              <span className="block mb-1">결정 근거 * (S1 시장분석·S3 적합성 판단을 인용 — 채점을 보완하는 서술)</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} required className="sizing-new-input" style={{ width: "100%" }} placeholder="예: S3 적합성 평가 Go(시너지 72) — 자사 역량 보유, 시장 성장 지속..." />
            </label>
            <label className="text-[length:var(--fs-caption)] block mb-3">
              <span className="block mb-1">검토한 대안 * (고려했으나 선택하지 않은 트랙·라우트와 사유 — 초안 저장은 선택, 결정은 필수)</span>
              <textarea value={alternatives} onChange={(e) => setAlternatives(e.target.value)} rows={2} required className="sizing-new-input" style={{ width: "100%" }} placeholder="고려했지만 선택하지 않은 트랙·라우트와 사유" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {canAct && (
                <button type="button" className="btn-ghost" disabled={draftSaving} onClick={() => void performSaveDraft()}>
                  {draftSaving ? "저장 중..." : "저장"}
                </button>
              )}
              {canAct && (
                <button type="submit" className="btn-ghost" disabled={saving || !canSubmit}>
                  {saving ? "확정 중..." : "결정"}
                </button>
              )}
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {draftSavedAt && `초안 저장됨 · ${draftSavedAt.slice(0, 16).replace("T", " ")} · `}
                {totalScore !== null ? `합산 ${totalScore} / 3.0 · ` : ""}양 트랙 공통 채점 · 사전배제 검증 자동
                {canAct && !allScored && (
                  <>
                    {" · "}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setTab("eval")}>평가 근거 탭에서 5기준 완료 →</button>
                  </>
                )}
              </span>
            </div>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
              저장 = 초안을 서버에 보관(완결성 검증 없음) · 결정 = 5기준·근거 완료 후 불변 기록
            </p>
          </fieldset>
          </form>

          {/* ── 결정 이력 — 과거 기록 열람용 참고자료라 기본 접힘(2026-09-14
              재설계). 오늘 결정에 필요한 평가 근거와 달리, 접혀 있어도
              감사성이 훼손되지 않는다. ── */}
          {(() => {
            const years = [...new Set(decisions.map((d) => d.decided_at.slice(0, 4)))].sort().reverse();
            const months = historyYear
              ? [...new Set(decisions.filter((d) => d.decided_at.slice(0, 4) === historyYear).map((d) => d.decided_at.slice(5, 7)))].sort()
              : [];
            const filtered = decisions.filter((d) =>
              (!historyYear || d.decided_at.slice(0, 4) === historyYear) &&
              (!historyMonth || d.decided_at.slice(5, 7) === historyMonth),
            );
            return (
              <details className="sizing-grade-card mt-3" open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer text-[length:var(--fs-body)] font-semibold">결정 이력 ({decisions.length}건) 보기</summary>
                <div className="mt-2">
                  {decisions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <label className="text-[length:var(--fs-caption)]">
                        <span className="sr-only">연도</span>
                        <select
                          value={historyYear}
                          onChange={(e) => { setHistoryYear(e.target.value); setHistoryMonth(""); }}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 연도</option>
                          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                      </label>
                      <label className="text-[length:var(--fs-caption)]">
                        <span className="sr-only">월</span>
                        <select
                          value={historyMonth}
                          onChange={(e) => setHistoryMonth(e.target.value)}
                          disabled={!historyYear}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 월</option>
                          {months.map((m) => <option key={m} value={m}>{Number(m)}월</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  {decisions.length === 0 ? (
                    <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">아직 기록된 결정이 없습니다.</p>
                  ) : filtered.length === 0 ? (
                    <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">선택한 기간에 기록된 결정이 없습니다.</p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                      <table className="data-table report-table table-fixed-pct tmin-64" aria-label="진출방식 결정 이력">
                        <caption className="sr-only">진출방식 결정 이력</caption>
                        <ColGroup widths={DECISION_COL_PCT} />
                        <thead>
                          <tr>
                            <th scope="col">트랙</th><th scope="col">라우트</th><th scope="col">의도</th>
                            <th scope="col">채점</th><th scope="col">근거</th><th scope="col">대안</th><th scope="col">결정자/일시</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((d) => (
                            <tr key={d.id}>
                              <td>
                                <span className={`status-chip ${d.track === "brownfield" ? "status-amber" : "status-green"}`}>
                                  {d.track === "brownfield" ? "Brownfield" : "Greenfield"}
                                </span>
                              </td>
                              <td className="text-[length:var(--fs-caption)]">{d.sub_track ? (d.track === "brownfield" ? BF_SUB[d.sub_track] ?? d.sub_track : GF_SUB[d.sub_track] ?? d.sub_track) : "—"}</td>
                              <td className="text-[length:var(--fs-caption)]">{d.intent ? (d.intent === "integration" ? "통합" : "역량접근") : "—"}</td>
                              <td className="text-[length:var(--fs-caption)]">
                                {d.total_score !== null ? (
                                  <span title={(d.scores ?? []).map((s) => `${s.criterion}: ${s.score} — ${s.evidence_note}`).join("\n")}>
                                    <strong className="tabular-nums">{d.total_score}</strong>/3.0
                                  </span>
                                ) : "—"}
                                {d.staging_recommended && (
                                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--accent)]" title={d.staging_recommended}>step-up 권고</span>
                                )}
                              </td>
                              <td className="cell-truncate text-[length:var(--fs-caption)]">{d.rationale}</td>
                              <td className="cell-truncate text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{d.alternatives_considered ?? "—"}</td>
                              <td className="text-[length:var(--fs-caption)] tabular-nums">{d.decided_by} · {d.decided_at.slice(0, 10)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {sessions.length > 0 && (
                    <>
                      <SectionToolbar title="위원회 심의 이력" />
                      <ul className="text-[length:var(--fs-body)] space-y-1">
                        {sessions.map((s2) => (
                          <li key={s2.sessionId}>
                            <span className={`status-chip ${s2.status === "done" ? "status-green" : "status-in-progress"}`}>{s2.status}</span>{" "}
                            {s2.decisionMode ?? "—"} · {s2.createdAt.slice(0, 10)} ·{" "}
                            <a className="text-[color:var(--accent)] underline" href={`/api/opportunities/${encodeURIComponent(selected.id)}/committee-sessions/${s2.sessionId}/minutes`} target="_blank" rel="noreferrer">회의록</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            );
          })()}
        </div>
      )}</>
  );
}
