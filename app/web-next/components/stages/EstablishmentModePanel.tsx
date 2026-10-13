"use client";

// S10 설립 방식 (ADR-0167): 신규 법인 설립 / 신규 사업부 추진. 사람만 확정하고 에이전트는 제안만 한다 (경계 #2).
// 규칙의 권위는 서버이고, 이 화면은 일찍 거절하고 오류 코드를 쉬운 한국어로 옮길 뿐이다.

import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api.ts";
import { useToast } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import {
  buildModeBody, isModeValue, MODE_CHANGE_WARNING, MODE_CHANGED_AFTER_GATE_TEXT, modeEventSummary, modeErrorText,
  modeLabel, modeOptions, suggestionText, validateModeChange, BUSINESS_UNIT_NO_ISOLATION_NOTE,
  type EstablishmentModeValue, type ModeState,
} from "../../lib/establishment-mode-view.ts";

export function EstablishmentModePanel({ projectId, canAct, onState }: {
  projectId: string;
  canAct: boolean;
  /** Lets the structure form follow the stored mode. */
  onState?: (state: ModeState | null) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const { toast } = useToast();
  const [state, setState] = useState<ModeState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [choice, setChoice] = useState<EstablishmentModeValue | null>(null);
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/projects/${encodeURIComponent(projectId)}/establishment-mode`;

  async function reload() {
    try {
      const r = await api.get<ModeState>(url);
      setState(r.data);
      onState?.(r.data);
    } catch {
      setState(null);
      onState?.(null);
    } finally {
      setLoaded(true);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [projectId]);

  if (!loaded || !state || !state.applicable) {
    return loaded && state && !state.applicable ? (
      <section className="market-section sizing-step mb-3" aria-label="설립 방식">
        <h3 className="sizing-step-title text-[0.9rem]">설립 방식</h3>
        <p role="note" className="status-chip status-not-started" style={{ whiteSpace: "normal" }}>ⓘ 이 프로젝트의 추진 방식에는 설립 방식 선택이 적용되지 않습니다. 설립 방식은 내부 추진·합작 프로젝트에만 있습니다.</p>
      </section>
    ) : null;
  }

  const current = state.mode;
  const options = modeOptions(state, null);
  const suggestion = suggestionText(state.suggested);
  const selecting = current === null || changing;

  function save() {
    const next = choice;
    const problem = validateModeChange(current, next, reason);
    if (problem || !next) { setError(problem); return; }
    confirm(current ? "설립 방식 변경" : "설립 방식 확정", () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.put(url, buildModeBody(current, next, reason));
          toast(`설립 방식을 ${modeLabel(next)}(으)로 ${current ? "변경" : "확정"}했습니다.`);
          setChanging(false); setChoice(null); setReason("");
          await reload();
        } catch (e) {
          setError(e instanceof ApiError ? modeErrorText(e.code, e.message) : e instanceof Error ? e.message : "설립 방식 저장 실패");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: current
        ? `${modeLabel(current)} → ${modeLabel(next)}. ${MODE_CHANGE_WARNING} 이 변경은 사유와 함께 감사 기록에 남습니다.`
        : `${modeLabel(next)}(으)로 확정합니다. 설립 방식은 사람이 정하는 결정이며 감사 기록에 남습니다. 이후 S11의 설립 실행 단계는 이 방식을 따릅니다.`,
      confirmLabel: current ? "변경" : "확정",
      tone: "neutral",
    });
  }

  return (
    <section className="market-section sizing-step mb-3" aria-label="설립 방식">
      <h3 className="sizing-step-title text-[0.9rem]">설립 방식</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        새 법인을 세울지, 기존 법인 안에서 사업부로 추진할지를 정합니다. 사람이 직접 확정하며 에이전트는 제안만 할 수 있습니다. 확정한 방식이 S11 설립 실행 단계를 정합니다.
      </p>
      {suggestion && <p role="note" className="text-[length:var(--fs-caption)] mb-2">ⓘ {suggestion}</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {state.changed_after_gate && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg,var(--accent))] mb-2">⚠ {MODE_CHANGED_AFTER_GATE_TEXT}</p>}

      {current && !changing && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="status-chip status-green">● {modeLabel(current)}</span>
          {state.steps_started && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">S11 설립 실행이 이미 시작되었습니다.</span>}
          {canAct && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setChanging(true); setChoice(null); setReason(""); setError(null); }}>방식 변경</button>
          )}
        </div>
      )}

      {selecting && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={current ? "설립 방식 변경" : "설립 방식 확정"}>
          <fieldset className="mb-2" disabled={!canAct || busy}>
            <legend className="text-[length:var(--fs-caption)] mb-1">{current ? `현재: ${modeLabel(current)} — 바꿀 방식을 선택하세요` : "설립 방식을 선택하세요 (기본값 없음)"}</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => {
                const disabled = o.disabled || o.value === current;
                const checked = choice === o.value;
                const descId = `est-mode-${o.value}-desc`;
                return (
                  <label key={o.value} className={`sizing-grade-card flex-1 min-w-[16rem] ${disabled ? "opacity-70" : "cursor-pointer"}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="establishment-mode" value={o.value} checked={checked} disabled={disabled} aria-describedby={descId}
                        onChange={() => { setChoice(o.value); setError(null); }} />
                      <span className="font-semibold">{o.label}</span>
                      {o.value === current && <span className="status-chip status-not-started">현재</span>}
                    </span>
                    <span id={descId} className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                      {o.description}
                      {o.disabled && o.disabledReason && <span className="block mt-1">ⓘ {o.disabledReason}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {choice === "business_unit" && <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg,var(--accent))] mb-2">⚠ {BUSINESS_UNIT_NO_ISOLATION_NOTE}</p>}
          {current && (
            <>
              <label className="block text-[length:var(--fs-caption)] mb-1">
                <span className="block mb-1">변경 사유 (필수, 10자 이상)</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="sizing-new-input w-full" rows={2} aria-required="true" disabled={!canAct || busy} />
              </label>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{MODE_CHANGE_WARNING}</p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={!canAct || busy || !choice}>{busy ? "저장 중..." : current ? "방식 변경 확정" : "설립 방식 확정"}</button>
            {changing && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setChanging(false); setChoice(null); setReason(""); setError(null); }}>취소</button>}
            {!canAct && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">설립 방식 확정은 분석가 이상 역할이 필요합니다.</span>}
          </div>
        </form>
      )}

      {state.history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">설립 방식 이력 ({state.history.length}건)</summary>
          <ul className="sizing-note-list" aria-label="설립 방식 이력">
            {state.history.map((h) => (
              <li key={h.id} className="text-[length:var(--fs-caption)]">
                <span className="tabular-nums">{h.created_at.slice(0, 16).replace("T", " ")}</span> · {h.actor_name ?? h.actor_user_id} · {isModeValue(h.to_mode) ? modeEventSummary(h) : h.kind}
                {h.reason && <span className="block text-[color:var(--muted-fg)]">사유: {h.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {confirmDialog}
    </section>
  );
}
