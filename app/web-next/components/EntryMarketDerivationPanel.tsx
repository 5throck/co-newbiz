"use client";

// EntryMarketDerivationPanel - step 3 (진입시장 유도) of the consolidated
// 진입시장 산정 card. 2026-10-17 entry-market flow redesign slices 1+2:
// PROPS-FED (the parent owns ALL loading; this panel's own GET is deleted)
// and the FIXED 2-step shape (design §5.3): two always-present named cards
// (1. 지역 비중, 2. 세그먼트 비율 - labels over positions, not new schema);
// free 단계 추가 removed; rows beyond two appear ONLY from the AI draft or
// legacy stored chains (editable/removable). AI 배수 추천 is the empty
// state's primary action and fills BOTH base cards in one action. Save
// payload byte-identical (base chain as before via the lib mappers).
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import {
  BASE_STEP_LABELS,
  EXTRA_STEP_LABEL,
  DERIVATION_BASE_STEP_COUNT,
  EMPTY_DERIVATION_STEP,
  emptyDerivationSteps,
  derivationStepToForm,
  derivationStepFromForm,
  buildDerivationSavePayload,
  derivationFormError,
  type DerivationStepForm,
} from "../lib/entry-market-flow-state.ts";
import { computeEntryMarketChain, ENTRY_MARKET_MAX_STEPS, REGION_DEFINITION_CAVEAT } from "../lib/entry-market.ts";

export interface StepResult {
  base: string;
  factor: number;
  input: number;
  result: number;
}

export interface EntryMarketDerivationData {
  reference: { version_no: number; confidence_grade: string | null; href: string; anchor_value_krw_m: number | null } | null;
  newer_version_available: boolean;
  derivation: { steps: Array<Record<string, unknown>>; set_by: string; set_at: string | null } | null;
  computed: { anchor_value_krw_m: number; factor_product: number; entry_market_krw_m: number; steps: StepResult[] } | null;
  scope_flag: { status: string; reason: string; note: string } | null;
  confidence: { lowering_count: number; note: string } | null;
  region_caveat: string | null;
  max_steps: number;
}

export function EntryMarketDerivationPanel({ opportunityId, canAct, scopeSet, disabledReason, scopeWarning, data, onDataChanged }: {
  opportunityId: string;
  canAct: boolean;
  scopeSet: boolean;
  disabledReason: string | null;
  scopeWarning: string | null;
  data: EntryMarketDerivationData | null;
  onDataChanged?: () => Promise<void>;
}) {
  // Form rows - initialized from the parent-fed stored chain; reset whenever
  // the parent refetches (fresh data prop identity) or a draft lands.
  const [steps, setSteps] = useState<DerivationStepForm[]>(emptyDerivationSteps());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset the form whenever the parent refetches (fresh data identity).
  // Empty state = exactly TWO named base cards (design §5.3).
  useEffect(() => {
    setSteps(data?.derivation?.steps?.length
      ? data.derivation.steps.map(derivationStepToForm)
      : emptyDerivationSteps());
  }, [data]);

  function updateStep(i: number, patch: Partial<DerivationStepForm>) {
    setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  // Extras (positions 3+) are removable; the fixed base two are not (an
  // empty state is exactly the two named cards - design §5.3).
  function removeStep(i: number) {
    if (i < DERIVATION_BASE_STEP_COUNT) return;
    setSteps((cur) => cur.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null); setFormError(null);
    try {
      const preCheck = derivationFormError(steps);
      if (preCheck) throw new Error(preCheck);
      const body = buildDerivationSavePayload(steps);
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`, { steps: body });
      setNotice("진입 시장 도출 사슬을 저장했습니다 — AI 표시는 검증 후 사라집니다.");
      await onDataChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function clearChain() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`, { steps: null });
      setNotice("도출 사슬을 지웠습니다 — 기존 시장 앵커 경로로 돌아갑니다.");
      await onDataChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우기 실패");
    } finally {
      setBusy(false);
    }
  }

  // AI 배수 추천 - the empty state's primary action: fills BOTH fixed cards
  // (factor + source + as_of drafts) in one action; a draft with >2 steps
  // lands the extras as 3+ rows (design §5.3/§5.4).
  async function recommend() {
    setBusy(true); setError(null); setNotice(null); setFormError(null);
    try {
      const r = await api.post<{ draft: { steps: Array<Record<string, unknown>> } | null; source: string; note: string }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation/draft`);
      if (r.data.draft?.steps?.length) {
        setSteps(r.data.draft.steps.map(derivationStepToForm));
        setNotice(r.data.note);
      } else {
        setError(r.data.note);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 추천 실패");
    } finally {
      setBusy(false);
    }
  }

  const anchor = data?.reference?.anchor_value_krw_m ?? null;
  const hasForm = steps.length > 0;
  const storedCount = data?.derivation?.steps?.length ?? 0;
  const dirty = JSON.stringify(steps) !== JSON.stringify((data?.derivation?.steps ?? []).map(derivationStepToForm));
  const formInvalid = derivationFormError(steps) != null;
  const isEmptyState = data?.derivation == null;

  // Live preview of the computed chain over the person's in-form values -
  // the stored value always comes from the server's computed block.
  function previewChain(anchorValue: number | null, form: DerivationStepForm[]) {
    const validFactors = form
      .map((s) => Number(s.factor))
      .filter((f) => Number.isFinite(f) && f > 0 && f <= 1);
    if (anchorValue == null || validFactors.length === 0) return null;
    return computeEntryMarketChain(anchorValue, validFactors.map((f) => ({ base: "s1_anchor" as const, factor: f, source: "x", as_of: "x" })));
  }

  const preview = previewChain(anchor, steps);

  return (
    <section aria-label="진입 시장 도출 (entry market derivation)" className="market-section" data-testid="entry-market-panel">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        3. 진입시장 유도 <span className="status-chip status-info">사람 입력 (ADR-0179 수정안)</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        연결된 S1 시장규모에서 배율 인자(0-1)만 곱해 이 딜의 진입 시장 규모를 도출합니다. 각 단계에 출처가 필수이며 절대값은 받지 않습니다.
      </p>
      {disabledReason && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="entry-market-not-linked">
          {disabledReason}
        </p>
      )}
      {scopeWarning && !disabledReason && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="entry-flow-scope-warning">
          <span className="status-chip status-warn">범위 미설정</span> {scopeWarning}
        </p>
      )}
      {data && (
        <div className="text-[length:var(--fs-caption)] mb-2" data-testid="entry-market-anchor">
          <span className="status-chip status-info">연결된 S1</span>{" "}
          <a href={data.reference?.href ?? "#"} className="underline">S1 화면에서 열기</a>
          {" · "}v{data.reference?.version_no}
          {anchor != null && <>{" · "}S1 앵커: <strong className="mono-num">{anchor.toLocaleString()}</strong> KRW M</>}
        </div>
      )}
      {data?.derivation?.set_at && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="entry-market-stored-meta">
          저장: {data.derivation.set_by} · {data.derivation.set_at.slice(0, 10)}
        </p>
      )}
      {/* Empty state - the AI 배수 추천 as the PRIMARY action; manual entry
          remains possible by typing into the two fixed cards. */}
      {canAct && isEmptyState && (
        <div className="mb-2" data-testid="entry-market-empty-primary">
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void recommend()} data-testid="entry-market-recommend">
            AI 배수 추천
          </button>
          <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            두 고정 단계(지역 비중 · 세그먼트 비율)의 배율·출처·기준 시점 초안을 한 번에 채웁니다. 직접 입력도 가능합니다.
          </span>
        </div>
      )}
      {canAct && !isEmptyState && (
        <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="entry-market-actions">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void recommend()} data-testid="entry-market-recommend">
            AI 배수 추천
            </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || !hasForm || !dirty || formInvalid} onClick={() => void save()} data-testid="entry-market-save">
            저장
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void clearChain()} data-testid="entry-market-clear">
            전체 지우기
          </button>
        </div>
      )}
      {/* FIXED 2-step shape (design §5.3): the two always-present named base
          cards; rows beyond two are ONLY from the AI draft or legacy stored
          chains, each removable. No free 단계 추가 anywhere. */}
      {steps.map((s, i) => (
        <div key={i} className="border border-[color:var(--border)] rounded p-2 mb-2" data-testid={`entry-market-step-${i}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[length:var(--fs-caption)] font-semibold">
              {i < DERIVATION_BASE_STEP_COUNT
                ? `${i + 1}. ${BASE_STEP_LABELS[i]}`
                : `${i + 1}. ${EXTRA_STEP_LABEL}`}
            </span>
            <span className="flex items-center gap-1">
              {s.origin === "ai_suggested" && (
                <span className="status-chip status-info" data-testid={`entry-market-step-${i}-ai`}>AI</span>
              )}
              {canAct && i >= DERIVATION_BASE_STEP_COUNT && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => removeStep(i)} data-testid={`entry-market-step-${i}-remove`}>
                  제거
                </button>
              )}
            </span>
          </div>
          {canAct ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <label className="text-[length:var(--fs-caption)]">
                배율 (0-1)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.factor} disabled={busy}
                  onChange={(e) => updateStep(i, { factor: e.target.value })} data-testid={`entry-market-step-${i}-factor`} />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                출처 (필수)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.source} disabled={busy}
                  onChange={(e) => updateStep(i, { source: e.target.value })} data-testid={`entry-market-step-${i}-source`} />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                기준 시점 (필수)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.as_of} disabled={busy}
                  onChange={(e) => updateStep(i, { as_of: e.target.value })} data-testid={`entry-market-step-${i}-as-of`} />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                지역 태그 (쉼표)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.region_tags} disabled={busy}
                  onChange={(e) => updateStep(i, { region_tags: e.target.value })} data-testid={`entry-market-step-${i}-region`} />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                세그먼트 태그 (쉼표)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.segment_tags} disabled={busy}
                  onChange={(e) => updateStep(i, { segment_tags: e.target.value })} data-testid={`entry-market-step-${i}-segment`} />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                비고 (선택)
                <input className="sizing-new-input sizing-new-input-sm" style={{ width: "100%" }} value={s.note} disabled={busy}
                  onChange={(e) => updateStep(i, { note: e.target.value })} data-testid={`entry-market-step-${i}-note`} />
              </label>
            </div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              S1 분석이 연결되지 않아 입력할 수 없습니다 — 1단계에서 연결하세요.
            </p>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
      {preview && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-preview">
          미리보기: 진입시장 {preview.entry_market_krw_m.toLocaleString()} KRW M (배율 곱 {preview.factor_product.toFixed(4)})
        </p>
      )}
      {data?.computed && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-computed">
          저장된 값: 진입시장 {data.computed.entry_market_krw_m.toLocaleString()} KRW M (배율 곱 {data.computed.factor_product.toFixed(4)})
        </p>
      )}
      {data?.scope_flag && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-scope-flag">
          <span className={data.scope_flag.status === "match" ? "status-chip status-info" : "status-chip status-warn"}>
            도달 범위 판정: {data.scope_flag.status}
          </span>{" "}
          {data.scope_flag.reason}
        </p>
      )}
      {data?.confidence && data.confidence.lowering_count > 0 && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-confidence">
          <span className="status-chip status-warn">신뢰도 하향 {data.confidence.lowering_count}건</span> {data.confidence.note}
        </p>
      )}
      {data?.region_caveat && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-market-caveat">
          {data.region_caveat}
        </p>
      )}
    </section>
  );
}
