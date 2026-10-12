"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { ColGroup } from "../../ui.tsx";
import { CAPABILITY_REG_COL_PCT, SCORE_LABEL } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";

export function EvalTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {
  const { tab, advisory, opportunityId, intent, canAct, setIntent, scored, setScore, draftSaving, performSaveDraft, draftSavedAt, totalScore, setTab } = ctx;
  return (
    <>{tab === "eval" && (
        <div className="card">
          <h2>{selected.name} — 진출방식 적합도 평가 근거</h2>

          <div className="sizing-grade-card mb-3" aria-label="S1 시장·경쟁·역량 평가">
            {advisory === null ? (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                근거를 불러오지 못했습니다 — 새로고침하거나 S1 시장분석·S3 필요 역량 수준을 먼저 완료하세요.
              </p>
            ) : (
              <>
                {/* 신호 테이블 — 판정에 필요한 건 "근거 있음"의 확인이므로 요약 카드가
                    본문이다. 표는 기본 접고(필요 역량 상세와 같은 패턴), 요약에 건수를
                    표시한다 (2026-09-18 리뷰: eval 탭이 지나치게 길었다). */}
                <details className="mb-3">
                  <summary className="cursor-pointer text-[length:var(--fs-body)]">신호별 근거 (S1~S3 — {advisory.signals.length}건)</summary>
                  <h4 className="text-[length:var(--fs-body)] mb-2 mt-2">신호별 근거 (S1~S3)</h4>
                  <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                    <table className="data-table mb-3" aria-label="신호별 근거">
                      <caption className="sr-only">신호별 근거</caption>
                      <thead>
                        <tr><th scope="col">신호</th><th scope="col">방향</th><th scope="col">가중치</th><th scope="col">근거</th></tr>
                      </thead>
                      <tbody>
                        {advisory.signals.map((s) => (
                          <tr key={s.key}>
                            <td className="text-[length:var(--fs-caption)]">{s.label}</td>
                            <td>
                              <span className={`status-chip ${s.leans === "greenfield" ? "status-green" : s.leans === "brownfield" ? "status-amber" : "status-not-started"}`}>
                                {s.leans === "greenfield" ? "그린필드" : s.leans === "brownfield" ? "브라운필드" : "중립"}
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
                      <h4 className="text-[length:var(--fs-body)] m-0">필요 역량 수준</h4>
                      <span className="status-chip status-not-started">필요 역량 <strong className="ml-1">{advisory.capabilityGap.total}건</strong></span>
                      <span className="status-chip status-green">충족 <strong className="ml-1">{advisory.capabilityGap.met}건</strong></span>
                      <span className="status-chip status-amber">부분 충족 <strong className="ml-1">{advisory.capabilityGap.partial}건</strong></span>
                      <span className="status-chip status-not-started">미충족 <strong className="ml-1">{advisory.capabilityGap.unmet}건</strong></span>
                      {advisory.capabilityGap.coveragePct !== null && (
                        <span className="status-chip status-not-started">충족률 <strong className="ml-1">{advisory.capabilityGap.coveragePct}%</strong></span>
                      )}
                    </div>
                    {advisory.capabilityGap.unmetRows.length > 0 && (
                      <p className="text-[length:var(--fs-caption)] mb-0">
                        미충족: {advisory.capabilityGap.unmetRows.map((r) => r.capability).join(", ")}
                        <span className="text-[color:var(--muted-fg)]"> — 그룹/계열사 프로필 기준, 내부(자사 단독) 역량 평가는 추후 보강</span>
                      </p>
                    )}
                    {/* S3에서 확정한 필요 역량 수준 전체 행 — 역량 관련 5기준
                        (역량 결정성·통합 역량·역량확보 속도) 채점의 직접 근거
                        (2026-09-15 사용자 요구). 행이 많아 접힘 스캐폴드로 제공 —
                        기본 닫힘, 요약(요약: 충족 X·부분 Y·미보유 Z·미판정 W)만
                        표시하고 열면 전체 레지스터가 나온다. 읽기 전용. */}
                    {advisory.capabilityGap.rows && advisory.capabilityGap.rows.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">
                          필요 역량 수준 상세 ({advisory.capabilityGap.rows.length}건
                          {advisory.capabilityGap.coveragePct !== null ? ` · 충족률 ${advisory.capabilityGap.coveragePct}%` : ""}) 보기
                        </summary>
                        <div className="table-scroll mt-2">
                          <table className="data-table mb-0 table-fixed-pct tmin-56" aria-label="필요 역량 수준 레지스터 (S3 연계)">
                            <caption className="sr-only">필요 역량 수준 레지스터 — S3 연계, 읽기 전용</caption>
                            <ColGroup widths={CAPABILITY_REG_COL_PCT} />
                            <thead>
                              <tr>
                                <th scope="col">필요 역량</th><th scope="col">보유 판정</th>
                                <th scope="col">보유 주체·근거</th><th scope="col">해소 힌트</th>
                              </tr>
                            </thead>
                            <tbody>
                              {advisory.capabilityGap.rows.map((r) => (
                                <tr key={r.capability}>
                                  <td className="cell-primary">
                                    <span className="font-semibold text-[length:var(--fs-caption)]">{r.capability}</span>
                                    <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                      출처: {r.source === "s2_sketch" ? "S2 스케치" : r.source === "s1_factors" ? "S1 요인" : r.source === "synergy_area" ? "S3 시너지 영역" : "수동"}
                                    </span>
                                  </td>
                                  <td>
                                    <span className={`status-chip ${r.held.status === "met" ? "status-green" : r.held.status === "partial" ? "status-amber" : r.held.status === "unmet" ? "status-red" : "status-not-started"}`}>
                                      {r.held.status === "met" ? "충족" : r.held.status === "partial" ? "부분 충족" : r.held.status === "unmet" ? "미보유" : "미판정"}
                                    </span>
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {r.held.status !== "unevaluated" && (r.held.holders.length > 0 || r.held.evidence) ? (
                                      <>
                                        {r.held.holders.length > 0 && <span className="block">{r.held.holders.join(", ")}</span>}
                                        {r.held.evidence && <span className="block text-[color:var(--muted-fg)]">{r.held.evidence}</span>}
                                      </>
                                    ) : "—"}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">{r.resolution ? (r.resolution === "build" ? "구축" : r.resolution === "partner" ? "파트너" : r.resolution === "hire" ? "영입" : "투자") : "—"}</td>
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
                    필요 역량 수준 미작성 —{" "}
                    <Link href={`/deals/${encodeURIComponent(opportunityId)}/s3`} className="text-[color:var(--accent)] underline">S3 시너지 탭</Link>
                    {" "}에서 필요 역량과 보유 판정을 기록하세요.
                  </p>
                )}
              </>
            )}
          </div>

          <h4 className="text-[length:var(--fs-body)] mb-1">5기준 채점 (Stage 2, 각 20%)</h4>
          {/* route_decision_score.intent는 NOT NULL이라 의도가 없으면 서버가 채점 행을
              통째로 버린다(draft/route.ts) — 원래 의도 선택은 "결정" 탭에만 있어서, 이
              탭에서 채점만 채우고 저장하면 "초안 저장됨"은 뜨지만 채점은 저장되지
              않고 되돌아왔을 때 빈 화면으로 보이는 혼란이 있었다. 이 탭에서도 바로
              고칠 수 있게 같은 상태를 공유하는 선택자를 둔다. */}
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1 font-medium">의도 (Stage 1) <span className="text-[color:var(--red-fg)]">*</span></span>
              <select value={intent} disabled={!canAct} onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")} className="sizing-new-input">
                <option value="">선택...</option>
                <option value="integration">통합</option>
                <option value="capability_access">역량접근</option>
              </select>
            </label>
            {canAct && intent === "" && (
              <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-0">
                의도를 선택하지 않으면 아래 채점·근거는 저장되지 않습니다 (서버가 의도 없는 채점을 저장하지 않음).
              </p>
            )}
          </div>
          <table className="data-table mb-2" aria-label="5기준 채점">
            <caption className="sr-only">5기준 채점</caption>
            <thead>
              <tr><th scope="col">기준 (각 20%)</th><th scope="col">채점 1–3</th><th scope="col">근거 *</th></tr>
            </thead>
            <tbody>
              {scored.map((c) => (
                <tr key={c.key}>
                  <td className="text-[length:var(--fs-caption)]">
                    {c.label}
                    <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.hint}</span>
                    {/* 역량 관련 3기준 — S3 필요 역량 수준 레지스터를 채점 참고로
                        직접 인용한다(2026-09-15 사용자 요구). */}
                    {["capability_criticality", "integration_capacity", "speed_to_capability"].includes(c.key) && advisory?.capabilityGap && (
                      <span className="block text-[length:var(--fs-caption)] mt-0.5" style={{ color: "var(--accent)" }}>
                        역량 참고: {advisory.capabilityGap.total}건 중 충족 {advisory.capabilityGap.met}·부분 {advisory.capabilityGap.partial}·미보유 {advisory.capabilityGap.unmet}
                        {advisory.capabilityGap.coveragePct !== null ? ` (충족률 ${advisory.capabilityGap.coveragePct}%)` : ""}
                        {advisory.capabilityGap.unmetRows.length > 0 ? ` · 미보유: ${advisory.capabilityGap.unmetRows.slice(0, 2).map((r) => r.capability).join(", ")}${advisory.capabilityGap.unmetRows.length > 2 ? " 외" : ""}` : ""}
                      </span>
                    )}
                  </td>
                  <td>
                    <div role="group" aria-label={`${c.label} 점수`} className="flex gap-1">
                      {[1, 2, 3].map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={c.score === v}
                          disabled={!canAct}
                          className={`control-chip ${c.score === v ? "status-green" : ""}`}
                          onClick={() => setScore(c.key, { score: v })}
                        >
                          {v} · {SCORE_LABEL[v]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      value={c.note}
                      disabled={!canAct}
                      onChange={(e) => setScore(c.key, { note: e.target.value })}
                      placeholder="점수의 근거 (S1·S3 산출물 인용)"
                      aria-label={`${c.label} 근거`}
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
                {draftSaving ? "저장 중..." : "저장"}
              </button>
            )}
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {draftSavedAt && `초안 저장됨 · ${draftSavedAt.slice(0, 16).replace("T", " ")} · `}
              {totalScore !== null ? `합산 ${totalScore} / 3.0 · ` : ""}양 트랙 공통 채점 · 사전배제 검증 자동
            </span>
            <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setTab("decision")}>결정 탭으로 →</button>
          </div>

          {/* ── 판정 규칙 — 이 딜과 무관한 고정 규칙 참고용. 예전엔 모달이었으나
              탭 안 접힘으로 단순화(2026-09-14). ── */}
          <details>
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">판정 규칙 보기 (참고용 — 이 딜과 무관한 고정 규칙)</summary>
            <div className="mt-2">
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                AI가 아니라 이미 시스템에 기록된 S1~S3 데이터를 아래 고정 규칙으로 채점하는 방식입니다.
                신호별로 Greenfield/Brownfield 방향과 가중치(1~3)를 매기고, 트랙별 가중치 합을 100점 만점 비율로 환산해
                한쪽이 60점 이상이면 그 트랙을 추천하며, 그렇지 않으면 &quot;중립(신호 부족)&quot;으로 표시합니다. 위 &quot;신호별
                근거&quot; 표가 바로 이 규칙을 이 딜에 적용한 결과입니다.
              </p>
              <table className="data-table" aria-label="판정 규칙">
                <caption className="sr-only">판정 규칙</caption>
                <thead>
                  <tr><th scope="col">신호</th><th scope="col">판정 기준</th><th scope="col">방향</th><th scope="col">가중치</th></tr>
                </thead>
                <tbody>
                  <tr><td className="cell-primary">시장 성장률 (S1)</td><td>CAGR 15% 이상 — 고성장</td><td>Greenfield</td><td>3</td></tr>
                  <tr><td className="cell-primary">시장 성장률 (S1)</td><td>CAGR 15% 미만 — 성숙 시장</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">경쟁 구조 (S1)</td><td>독과점·집중 시장</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">경쟁 구조 (S1)</td><td>분산·불명확</td><td>중립</td><td>1</td></tr>
                  <tr><td className="cell-primary">시너지 확정 (S3)</td><td>사람이 확정한 점수 60 이상</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">시너지 확정 (S3)</td><td>사람이 확정한 점수 60 미만</td><td>중립</td><td>2</td></tr>
                  <tr><td className="cell-primary">시너지 권고 (S3)</td><td>사람 확정 전 권고값</td><td>중립</td><td>1</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>보유 역량 70% 이상</td><td>Greenfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>보유 역량 40% 이하</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>40~70% (중간)</td><td>중립</td><td>1</td></tr>
                </tbody>
              </table>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3 mb-1">
                함께 제공되는 정보 — 해당 근거가 아직 없을 때(예: S1 미완료, 필요 역량 수준 미작성)는 그 신호가 중립·약한 가중치로 처리됩니다.
              </p>
              <ul className="sizing-note-list mb-2">
                <li><b>기저율</b> — 과거 트랙별 결정 건수와 그중 법인 투자심의위원회를 통과한 건수를 함께 보여줍니다.</li>
                <li><b>재점검 트리거</b> — 추천과 실제 데이터가 모순될 때(예: Brownfield 추천인데 쇼트리스트가 비어 있음) 경고합니다.</li>
              </ul>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                원칙 (경계 #2): 이 추천은 제안일 뿐이며, 최종 트랙 결정은 결정 탭의 결정 폼에 사람이 직접 기록합니다.
              </p>
            </div>
          </details>
        </div>
      )}</>
  );
}
