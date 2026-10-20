"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { isFinancialDataRef, parseRubric, rubricFields } from "../../lib/brownfield-financial-rubric.ts";
import { EVAL_CATEGORY_LABEL, VERDICT_KO, EVAL_VERDICTS } from "./constants.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { EvalItem, EvalCategoryScore } from "./types.ts";

export function TargetEvalTab({ ctx, evalItems, scores, scoreChip, pendingFinancial, proposedCount, pendingTechnical }: { ctx: TargetDetailViewState; evalItems: EvalItem[]; scores: Record<"financial" | "technical", EvalCategoryScore> & { combined: number | null; }; scoreChip: (score: number | null) => string; pendingFinancial: EvalItem[]; proposedCount: number; pendingTechnical: EvalItem[] }) {
  const { detail, loadDetail, profileTab, canAct, draftBusy, draftCategory, evalDraft, busy, setEvalDraft, setDraftCategory, setDraftNote, rubricOpen, setRubricOpen, draftNote, evalBusy, rubricBusy, newCriterionLabel, setNewCriterionLabel, generateEvalDraft, saveDraftVerdicts, setEvalWeight, setEvalVerdict, removeEvalCriterion, saveRubric, addEvalCriterion } = ctx;
  return (
    <>{profileTab === "eval" && (
          <div className="mt-3">
            {(["financial", "technical"] as const).map((cat) => {
              const items = evalItems.filter((it) => it.category === cat);
              const catScore = scores[cat];
              return (
                <div key={cat} className="card mb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-[0.9rem] mb-0">{EVAL_CATEGORY_LABEL[cat]}</h4>
                    <span className={scoreChip(catScore.score)} title="충족 1점·부분충족 0.5점·미충족 0점을 항목 가중치로 가중평균 — 예외(해당없음·예외)는 계산에서 제외">
                      {catScore.score == null ? "점수 — 판정 필요" : `${catScore.score}점 / 100점`}
                    </span>
                  </div>
                  {catScore.totalWeight > catScore.scoredWeight && (
                    <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      미판정 가중치 {catScore.totalWeight - catScore.scoredWeight} / 전체 {catScore.totalWeight} 남음 — 전 항목 판정 전까지는 잠정 점수입니다.
                    </p>
                  )}
                  {canAct && cat === "financial" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingFinancial.length === 0}
                        title="전자공시 재무 정보를 루브릭으로 계산해 미판정 항목의 판정 초안을 만듭니다 — 저장 전까지 화면 표시일 뿐입니다"
                        onClick={() => void generateEvalDraft("financial")}
                      >
                        {draftBusy && draftCategory === "financial" ? "계산 중..." : "재무 판정 초안 (전자공시)"}
                      </button>
                      {evalDraft && draftCategory === "financial" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title="표시된 초안(판정·근거 노트)을 판정으로 저장합니다 — 저장자는 현재 사용자로 기록됩니다"
                            onClick={() => void saveDraftVerdicts()}
                          >
                            초안 저장 ({proposedCount}건)
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>초안 버리기</button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-expanded={rubricOpen}
                        title="자동 초안의 판정 기준치(CAGR·마진·부채비율 상한 등)를 항목별로 조정합니다"
                        onClick={() => setRubricOpen(!rubricOpen)}
                      >
                        임계값 {rubricOpen ? "닫기" : "편집"}
                      </button>
                      {draftCategory !== "technical" && (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          {draftNote ?? "전자공시 재무 정보로 미판정 항목의 판정 초안을 만듭니다 — 확인·수정 후 저장하며 확정은 항상 사람이 합니다 (경계 #2)."}
                        </span>
                      )}
                    </div>
                  )}
                  {canAct && cat === "technical" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingTechnical.length === 0}
                        title="최근 3년 전자공시·회사 AI 프로파일·항목별 웹 검색을 근거로 판정 초안을 만듭니다 — 근거로 확인 안 되는 항목은 '확인 안됨'으로 표시됩니다"
                        onClick={() => void generateEvalDraft("technical")}
                      >
                        {draftBusy && draftCategory === "technical" ? "근거 수집 중..." : "기술 판정 초안 (공시·프로파일·웹)"}
                      </button>
                      {evalDraft && draftCategory === "technical" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title="표시된 초안(판정·근거 노트)을 판정으로 저장합니다 — 저장자는 현재 사용자로 기록됩니다"
                            onClick={() => void saveDraftVerdicts()}
                          >
                            초안 저장 ({proposedCount}건)
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>초안 버리기</button>
                        </>
                      )}
                      {draftCategory === "technical" ? (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">{draftNote}</span>
                      ) : (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          최근 3년 공시·AI 프로파일·웹 검색으로 근거를 모아 판정 초안을 만듭니다 — 근거로 확인 안 되는 항목은 "확인 안됨"으로 표시되고, 판정 확정은 항상 사람이 합니다 (경계 #2).
                        </span>
                      )}
                    </div>
                  )}
                  {items.length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                      {cat === "technical"
                        ? "S3에 필요 역량이 정의되지 않아 기술 평가 항목이 없습니다 — 먼저 S3에서 정의하세요."
                        : "재무 평가 항목이 없습니다 — 불러오는 중이었을 수 있습니다."}
                    </p>
                  ) : (
                    <ul className="sizing-note-list mb-2" style={{ fontSize: "0.88rem" }}>
                      {items.map((it) => {
                        const draft = evalDraft?.[it.id];
                        return (
                          <li key={it.id} className="flex flex-wrap items-start gap-2">
                            <span className="flex-1 min-w-[14rem]">
                              {it.label}
                              {it.description && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{it.description}</span>}
                            </span>
                            {it.is_mandatory === 1 && <span className="status-chip status-amber">{it.source === "seeded" ? "S3 승계·필수" : "필수"}</span>}
                            {!canAct ? (
                              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title="가중치 — 카테고리 100점 점수 계산 시 이 항목의 상대 비중">가중치 {it.weight}</span>
                            ) : (
                            <label className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex items-center gap-1" title="가중치 — 카테고리 100점 점수 계산 시 이 항목의 상대 비중">
                              가중치
                              <input
                                type="number" min={1} step={1}
                                aria-label={`${it.label} 가중치`}
                                defaultValue={it.weight}
                                disabled={evalBusy === it.id}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (v > 0 && v !== it.weight) void setEvalWeight(it.id, v);
                                }}
                                className="sizing-new-input sizing-new-input-sm"
                                style={{ width: "4rem" }}
                              />
                            </label>
                            )}
                            {!canAct ? (
                              <span className="status-chip status-not-started" aria-label={`${it.label} 판정`}>{VERDICT_KO[it.state?.status ?? "pending"] ?? "미판정"}</span>
                            ) : (
                            <select
                              aria-label={`${it.label} 판정`}
                              value={draft?.status ?? it.state?.status ?? "pending"}
                              disabled={evalBusy === it.id}
                              onChange={(e) => {
                                const v = e.target.value as "pending" | "pass" | "partial" | "fail" | "na" | "waived";
                                // 초안이 떠 있는 항목을 직접 바꾸면 근거 노트를 함께 기록하고 초안을 치운다.
                                void setEvalVerdict(it.id, v, draft ? draft.note : undefined);
                                if (draft) setEvalDraft((prev) => {
                                  if (!prev) return prev;
                                  const next = { ...prev };
                                  delete next[it.id];
                                  return next;
                                });
                              }}
                              className="sizing-new-input sizing-new-input-sm"
                            >
                              <option value="pending">미판정</option>
                              {EVAL_VERDICTS.map((v) => (
                                <option key={v} value={v}>{VERDICT_KO[v]}</option>
                              ))}
                            </select>
                            )}
                            {canAct && it.is_deletable === 1 && (
                              <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === it.id} title="항목 삭제" onClick={() => void removeEvalCriterion(it.id)}>✕</button>
                            )}
                            {draft && (
                              <div className="w-full mt-1 flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  {draft.status ? (
                                    <span className="status-chip status-amber" title="근거 기반 자동 제안 — 확인·수정 후 저장하세요">자동 초안</span>
                                  ) : (
                                    <span className="status-chip status-not-started" title="근거로 확인되지 않아 판정 제안을 만들지 않았습니다 — 판정은 사람이 직접 내려주세요">확인 안됨</span>
                                  )}
                                  {draft.metrics.map((m) => (
                                    <span key={m.label} className="status-chip status-not-started" title={m.label}>{m.label} {m.value}</span>
                                  ))}
                                </div>
                                {!draft.status && draft.reason && (
                                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{draft.reason}</p>
                                )}
                                <input
                                  aria-label={`${it.label} 초안 근거 노트`}
                                  value={draft.note}
                                  placeholder="초안 근거 — 저장 시 판정 노트로 기록됩니다"
                                  onChange={(e) => setEvalDraft((prev) => (prev ? { ...prev, [it.id]: { ...prev[it.id], note: e.target.value } } : prev))}
                                  className="sizing-new-input sizing-new-input-sm"
                                />
                              </div>
                            )}
                            {rubricOpen && it.category === "financial" && it.source === "builtin" && isFinancialDataRef(it.data_ref) && (() => {
                              const rubric = parseRubric(it.data_ref, it.rubric_json);
                              return (
                                <div key={`${it.id}:${it.rubric_json ?? "default"}`} className="w-full mt-1 flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  <span>임계값 —</span>
                                  {rubricFields(it.data_ref).map((f) => (
                                    <label key={f.key} className="flex items-center gap-1" title={f.hint}>
                                      {f.label}
                                      <input
                                        type="number" min={f.min} max={f.max} step={f.step}
                                        defaultValue={rubric[f.key]}
                                        disabled={rubricBusy === it.id}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (Number.isFinite(v) && v >= f.min && v <= f.max && v !== rubric[f.key]) void saveRubric(it.id, { [f.key]: v });
                                        }}
                                        className="sizing-new-input sizing-new-input-sm"
                                        style={{ width: "5rem" }}
                                        aria-label={`${it.label} ${f.label}`}
                                      />
                                      {f.unit}
                                    </label>
                                  ))}
                                </div>
                              );
                            })()}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {/* 2026-10-20 decider: the per-target 필요 역량 점검 (judgement table with 처리할 것/전체)
                      left S7 — at S6/S7 the technical evaluation is the criteria above, scored from the
                      candidates' three-year disclosures, AI profile and web search; whether the chosen
                      target actually closes the S3 gaps is verified in S9 (capability-dd). S7 and S9
                      are not linked. */}
                  {canAct && (<div className="flex items-center gap-1">
                    <input
                      aria-label={`${EVAL_CATEGORY_LABEL[cat]} 항목 추가`}
                      placeholder="+ 항목 추가"
                      value={newCriterionLabel[cat] ?? ""}
                      onChange={(e) => setNewCriterionLabel((prev) => ({ ...prev, [cat]: e.target.value }))}
                      className="sizing-new-input sizing-new-input-sm"
                      style={{ flex: "1 1 12rem" }}
                    />
                    <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === cat || !(newCriterionLabel[cat] ?? "").trim()} onClick={() => void addEvalCriterion(cat)}>추가</button>
                  </div>)}
                </div>
              );
            })}
          </div>
        )}</>
  );
}
