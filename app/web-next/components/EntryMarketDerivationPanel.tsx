"use client";

// EntryMarketDerivationPanel - ADR-0179 amendment slice B (2026-10-17,
// design 12.2): step 3 of the consolidated 진입시장 산정 card
// (EntryMarketFlow). Previously a standalone panel mounted next to the
// target-scope editor. Shows the linked S1
// anchor, the factor steps (factor, source, as_of, per-step result, computed
// result), the computed entry-market value and the confidence note. Writes
// are person-only server-side (PUT entry-market-derivation is human-only);
// the person adds/edits/removes local steps and confirms the save. The
// AI-recommendation button (analyst+, only when the S1 link exists) fills
// the FORM - never the store - and every AI-suggested step carries a visible
// "AI 추천 — 검증 전" chip until the person edits/sources it and saves; the
// saved lineage keeps the display-only `origin: ai_suggested` marker (never
// affects the math).
// Presentational consolidation (decider feedback 2026-10-17): without an S1
// link the parent passes disabledReason and this step renders disabled with
// the reason; with a link but no target scope the parent passes scopeWarning
// (the scope verdict cannot be graded). Routes and payloads unchanged.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { computeEntryMarketChain, ENTRY_MARKET_MAX_STEPS, REGION_DEFINITION_CAVEAT } from "../lib/entry-market.ts";

const REGION_LABEL: Record<string, string> = {
  kr: "국내 (KR)", we: "서유럽 (WE)", ee: "동유럽 (EE)", ru: "러시아 (RU)", na: "북미 (NA)", cn: "중국 (CN)",
  sea: "동남아 (SEA)", sa: "남미 (SA)", af: "아프리카 (AF)", me: "중동 (ME)", worldwide: "전 세계 (worldwide)",
};

interface DerivationStepForm {
  factor: string;
  "source": string;
  as_of: string;
  note: string;
  region_tags: string;
  segment_tags: string;
  origin: "ai_suggested" | null;
}

const EMPTY_STEP: DerivationStepForm = { factor: "", source: "", as_of: "", note: "", region_tags: "", segment_tags: "", origin: null };

interface StepResult {
  base: string;
  factor: number;
  input: number;
  result: number;
}

interface GetResponse {
  link: { analysis_id: string; version_id: string } | null;
  reference: { anchor_value_krw_m: number | null; version_no: number; confidence_grade: string | null; href: string } | null;
  link_provenance: "auto" | "manual" | "none";
  newer_version_available: boolean;
  derivation: { steps: Array<Record<string, unknown>>; set_by: string; set_at: string } | null;
  derivation_error: string | null;
  computed: { anchor_value_krw_m: number; factor_product: number; entry_market_krw_m: number; steps: StepResult[] } | null;
  scope_flag: { status: string; reason: string; note: string } | null;
  confidence: { lowering_count: number; note: string } | null;
  region_caveat: string;
  max_steps: number;
}

function toForm(s: Record<string, unknown>): DerivationStepForm {
  const tags = (v: unknown): string => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").join(", ") : "");
  return {
    factor: typeof s.factor === "number" ? String(s.factor) : "",
    source: typeof s.source === "string" ? s.source : "",
    as_of: typeof s.as_of === "string" ? s.as_of : "",
    note: typeof s.note === "string" ? s.note : "",
    region_tags: tags(s.region_tags),
    segment_tags: tags(s.segment_tags),
    origin: s.origin === "ai_suggested" ? "ai_suggested" : null,
  };
}

function fromForm(s: DerivationStepForm): Record<string, unknown> {
  const tags = (v: string): string[] =>
    v.split(",").map((t) => t.trim()).filter(Boolean);
  const out: Record<string, unknown> = {
    base: "",
    factor: Number(s.factor),
    source: s.source.trim(),
    as_of: s.as_of.trim(),
  };
  if (s.note.trim() !== "") out.note = s.note.trim();
  if (tags(s.region_tags).length > 0) out.region_tags = tags(s.region_tags);
  if (tags(s.segment_tags).length > 0) out.segment_tags = tags(s.segment_tags);
  if (s.origin === "ai_suggested") out.origin = "ai_suggested";
  return out;
}

export function EntryMarketDerivationPanel({ opportunityId, canAct, scopeSet, disabledReason, scopeWarning, onDataChanged }: {
  opportunityId: string;
  canAct: boolean;
  scopeSet: boolean;
  disabledReason: string | null;
  scopeWarning: string | null;
  onDataChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<GetResponse | null>(null);
  const [steps, setSteps] = useState<DerivationStepForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<GetResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`);
      setData(r.data);
      setSteps((r.data.derivation?.steps ?? []).map(toForm));
      setError(null);
    } catch (e) {
      // 409 not_linked: the honest empty state, never a blocking failure.
      setData(null);
      setSteps([]);
    } finally {
      setLoaded(true);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateStep(i: number, patch: Partial<DerivationStepForm>) {
    setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch, origin: j === i && s.origin === "ai_suggested" && patchKeepsOrigin(patch) ? "ai_suggested" : s.origin } : s)));
  }

  function patchKeepsOrigin(_patch: Partial<DerivationStepForm>): boolean {
    return true;
  }

  function addStep() {
    if (!data) return;
    if (steps.length >= (data.max_steps ?? ENTRY_MARKET_MAX_STEPS)) return;
    setSteps((cur) => [...cur, { ...EMPTY_STEP }]);
  }

  function removeStep(i: number) {
    setSteps((cur) => cur.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null); setFormError(null);
    try {
      // Client-side pre-check for an early message; the server re-validates
      // strictly (400 with a reason, never a silent drop).
      const body = steps.map((s, i): Record<string, unknown> => ({ ...fromForm(s), base: i === 0 ? "s1_anchor" : `step:${i - 1}` }));
      for (let i = 0; i < body.length; i++) {
        const f = body[i].factor;
        if (typeof f !== "number" || !Number.isFinite(f) || f <= 0 || f > 1) throw new Error(`steps[${i}].factor는 (0, 1] 배율이어야 합니다.`);
        if (typeof body[i].source !== "string" || (body[i].source as string).trim() === "") throw new Error(`steps[${i}].source는 필수입니다.`);
        if (typeof body[i].as_of !== "string" || (body[i].as_of as string).trim() === "") throw new Error(`steps[${i}].as_of는 필수입니다.`);
      }
      if (body.length === 0) throw new Error("최소 1단계가 필요합니다 (지우려면 전체 지우기를 사용하세요).");
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`, { steps: body });
      setNotice("진입 시장 도출 사슬을 저장했습니다 — AI 표시는 검증 후 사라집니다.");
      await load();
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
      await load();
      await onDataChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우기 실패");
    } finally {
      setBusy(false);
    }
  }

  async function recommend() {
    setBusy(true); setError(null); setNotice(null); setFormError(null);
    try {
      const r = await api.post<{ draft: { steps: Array<Record<string, unknown>> } | null; source: string; note: string }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation/draft`);
      if (r.data.draft?.steps?.length) {
        setSteps(r.data.draft.steps.map(toForm));
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

  // Live preview of the computed chain over the person's in-form values —
  // the stored value always comes from the server's computed block.
  function previewChain(anchorValue: number | null, form: DerivationStepForm[]) {
    const steps = form
      .map((s) => ({ factor: Number(s.factor), ok: Number.isFinite(Number(s.factor)) && Number(s.factor) > 0 && Number(s.factor) <= 1 }))
      .filter((s) => s.ok)
      .map((s) => s.factor);
    if (anchorValue == null || steps.length === 0) return null;
    return computeEntryMarketChain(anchorValue, steps.map((f) => ({ base: "s1_anchor" as const, factor: f, source: "x", as_of: "x" })));
  }

  const preview = previewChain(anchor, steps);
  const hasForm = steps.length > 0;
  const dirty = JSON.stringify(steps) !== JSON.stringify((data?.derivation?.steps ?? []).map(toForm));

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
          {/* link provenance chip + newer-version rail hint moved to the
              EntryMarketFlow step-1 / status rail (single source). */}
          {data.newer_version_available && (
            <span className="ml-2 text-[color:var(--muted-fg)]" data-testid="entry-market-newer-version">더 최신 S1 버전 있음 — 수동 연결은 유지됩니다</span>
          )}
          {anchor != null && <>{" · "}S1 앵커: <strong className="mono-num">{anchor.toLocaleString()}</strong> KRW M</>}
        </div>
      )}
      {data?.derivation?.set_at && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="entry-market-stored-meta">
          저장: {data.derivation.set_by} · {data.derivation.set_at.slice(0, 10)}
        </p>
      )}
      {canAct && data && (
        <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="entry-market-actions">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || steps.length >= data.max_steps} onClick={addStep} data-testid="entry-market-add-step">
            단계 추가
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void recommend()} data-testid="entry-market-recommend">
            AI 배수 추천
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || !hasForm || !dirty} onClick={() => void save()} data-testid="entry-market-save">
            저장
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void clearChain()} data-testid="entry-market-clear">
            전체 지우기
          </button>
        </div>
      )}
      {formError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{formError}</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-error">{error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-notice">{notice}</p>}
      {steps.length > 0 && (
        <div data-testid="entry-market-steps">
          {steps.map((s, i) => {
            const stepNo = i + 1;
            return (
              <div key={i} className="border-b border-[color:var(--border)] py-2" data-testid={`entry-market-step-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[length:var(--fs-caption)] font-semibold">단계 {stepNo}</span>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">base {i === 0 ? "s1_anchor" : `step:${i - 1}`}</span>
                  {s.origin === "ai_suggested" && <span className="status-chip status-warn" data-testid={`entry-market-step-${i}-ai-chip`}>AI 추천 — 검증 전</span>}
                  {canAct && (
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => removeStep(i)} data-testid={`entry-market-remove-step-${i}`}>
                      제거
                    </button>
                  )}
                </div>
                {canAct ? (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <input aria-label={`단계 ${stepNo} 배율`} placeholder="배율 0-1" value={s.factor}
                      onChange={(e) => updateStep(i, { factor: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} />
                    <input aria-label={`단계 ${stepNo} 출처`} placeholder="출처 (필수)" value={s.source}
                      onChange={(e) => updateStep(i, { source: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 16rem" }} />
                    <input aria-label={`단계 ${stepNo} 기준 시점`} placeholder="기준 시점 (예: 2026-06)" value={s.as_of}
                      onChange={(e) => updateStep(i, { as_of: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "9rem" }} />
                    <input aria-label={`단계 ${stepNo} 메모`} placeholder="메모 (선택)" value={s.note}
                      onChange={(e) => updateStep(i, { note: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
                    <input aria-label={`단계 ${stepNo} 도달 지역 태그`} placeholder="도달 지역 태그 (쉼표 구분)" value={s.region_tags}
                      onChange={(e) => updateStep(i, { region_tags: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
                    <input aria-label={`단계 ${stepNo} 도달 세그먼트 태그`} placeholder="도달 세그먼트 태그 (쉼표 구분)" value={s.segment_tags}
                      onChange={(e) => updateStep(i, { segment_tags: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
                  </div>
                ) : (
                  <>
                    <div className="text-[length:var(--fs-caption)]">
                      배율 {s.factor} · {s.source} ({s.as_of})
                      {s.note && ` · ${s.note}`}
                    </div>
                    <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      입력 {(i === 0 ? anchor : prevPreviewValue(preview, i))?.toLocaleString() ?? "-"} × {s.factor} =
                      <strong className="mono-num"> {prevPreviewValue(preview, i)?.toLocaleString() ?? "-"}</strong>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {preview && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-preview">
          미리보기: 앵커 {anchor?.toLocaleString()} × 배율 곱 {preview.factor_product.toFixed(4)} ={" "}
          <strong className="mono-num">{preview.entry_market_krw_m.toLocaleString()}</strong> KRW M
        </p>
      )}
      {data?.computed && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-computed">
          저장된 도출값: <strong className="mono-num">{data.computed.entry_market_krw_m.toLocaleString()}</strong> KRW M
          {" "}({data.computed.steps.length}단계, 배율 곱 {data.computed.factor_product.toFixed(4)}) — S8 시장 앵커로 사용됩니다.
        </p>
      )}
      {data?.scope_flag && (
        <p className="text-[length:var(--fs-caption)] mb-1" data-testid="entry-market-scope-flag">
          사슬 도달 범위 판정: <strong>{data.scope_flag.status}</strong> — {data.scope_flag.reason} {data.scope_flag.note}
        </p>
      )}
      {(data?.confidence?.lowering_count ?? 0) > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-market-confidence">
          신뢰도 하향 단계: {data!.confidence!.lowering_count}단계 — {data!.confidence!.note}
        </p>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-market-region-caveat">
        {REGION_DEFINITION_CAVEAT}
      </p>
    </section>
  );
}

function prevPreviewValue(preview: ReturnType<typeof computeEntryMarketChain> | null, i: number): number | null {
  if (!preview) return null;
  if (i === 0) return preview.steps[0]?.input ?? null;
  return preview.steps[i]?.input ?? null;
}
