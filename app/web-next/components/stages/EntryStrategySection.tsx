"use client";

// S5 "1️⃣ 진출전략" (ADR-0171 amendment 2026-10-15 (2)): four selectable entry modes (multi-select, exactly one main),
// ONE rationale textarea and ONE optional textarea for considered-but-rejected alternatives, a muted caution when a
// capability's 해소 방식 is not among the selected modes (decision support, never a gate), and the secondary action
// "진출전략 제안 (AI)" that fills EMPTY parts only as unsaved drafts. GreenfieldStage owns the values and the save;
// this component owns only the AI marks/notes. Read-only for users without canAct (the parent fieldset is disabled).
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  ENTRY_AI_FIELD_LABEL, ENTRY_ALTERNATIVES_CAP, ENTRY_MODES, ENTRY_MODE_HINT, ENTRY_MODE_LABEL, ENTRY_RATIONALE_CAP,
  cautionText, mergeEntryProposal, normalizeModes, strategyMismatches, toggleMode,
  type CautionRow, type EntryAiField, type EntryFormState, type EntryMode, type EntryStrategyProposal,
} from "../../lib/greenfield-entry-strategy.ts";

interface DraftResponse { proposal: EntryStrategyProposal | null; source: "llm" | "synthesis"; note: string }

export interface EntryStrategySaveUi {
  /** Unsaved changes (human edits or AI drafts) in this section. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** Short success note, e.g. "저장됨 · 14:05". */
  note: string | null;
  error: string | null;
  onDismissNote: () => void;
}

export function EntryStrategySection({ opportunityId, value, onChange, canAct, rows, resetKey, save }: {
  opportunityId: string;
  value: EntryFormState;
  /** Every change (human edit or AI draft) goes through here so the page can keep unsaved text across refetches. */
  onChange: (next: EntryFormState) => void;
  canAct: boolean;
  /** Judgement 해소 방식 per capability (attainability rows already loaded on the page). */
  rows: CautionRow[];
  /** Changes when the page saved or switched opportunity: AI drafts are no longer "unsaved". */
  resetKey: number;
  /** Own save of ONLY the strategy fields (modes, main, rationale, alternatives). */
  save?: EntryStrategySaveUi;
}) {
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState<EntryAiField[]>([]);
  const [info, setInfo] = useState<{ proposal: EntryStrategyProposal } | null>(null);
  const valueRef = useRef(value); valueRef.current = value;
  const marksRef = useRef(marks); marksRef.current = marks;

  useEffect(() => { setMarks([]); setInfo(null); setNote(null); setError(null); }, [resetKey]);

  const clearMark = (f: EntryAiField) => setMarks((m) => m.filter((x) => x !== f));
  const mismatches = strategyMismatches(value.modes, rows);
  const main = value.modes.main;

  function pickMode(mode: EntryMode) { clearMark("modes"); onChange({ ...value, modes: toggleMode(value.modes, mode) }); }
  function pickMain(mode: EntryMode) { clearMark("modes"); onChange({ ...value, modes: normalizeModes(value.modes.modes, mode) }); }

  async function propose() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<DraftResponse>(`/api/greenfield/${encodeURIComponent(opportunityId)}/entry-strategy-draft`, {});
      const { proposal, note: n } = res.data;
      setNote(n);
      if (!proposal) return;
      // Merge against the latest committed values (the person may have typed while the request ran).
      const merged = mergeEntryProposal(valueRef.current, proposal);
      if (merged.marks.length > 0) {
        onChange(merged.state);
        setMarks((prev) => [...new Set([...prev, ...merged.marks])]);
        setInfo({ proposal });
      } else {
        setNote(`${n} 이미 입력된 칸은 그대로 두었고 새로 채울 빈 칸이 없습니다.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "진출전략 제안 실패");
    } finally {
      setBusy(false);
    }
  }

  // Only fields still marked (= not edited since) are reverted; they were empty before the proposal.
  function discard() {
    const next: EntryFormState = { ...valueRef.current };
    for (const f of marksRef.current) {
      if (f === "modes") next.modes = { modes: [], main: null };
      else if (f === "rationale") next.rationale = "";
      else next.alternatives = "";
    }
    onChange(next);
    setMarks([]); setInfo(null);
  }

  const aiChip = (f: EntryAiField) => marks.includes(f)
    ? <span className="status-chip status-not-started" data-testid={`entry-ai-chip-${f}`} title={`AI 초안(저장 전): ${ENTRY_AI_FIELD_LABEL[f]} — 사람이 검토·수정한 뒤 저장하세요.`}><span aria-hidden="true">✦</span> AI 초안</span>
    : null;
  const basisLine = (f: EntryAiField, text: string | undefined) => marks.includes(f) && text
    ? <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid={`entry-ai-basis-${f}`}>AI 근거: {text}</p>
    : null;
  const modeReasons = info && marks.includes("modes")
    ? info.proposal.modes.map((m) => `${ENTRY_MODE_LABEL[m.mode]}${m.main ? "(주)" : ""} — ${m.reason}`).join(" / ")
    : undefined;

  return (
    <div className="mb-3" data-testid="entry-strategy-section">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-[length:var(--fs-body)] mb-0">1️⃣ 진출전략</h3>
        {marks.length > 0 && (
          <span className="flex items-center gap-1" data-testid="entry-ai-unsaved">
            <span className="status-chip status-not-started" role="status"><span aria-hidden="true">✦</span> 저장하지 않은 AI 초안 {marks.length}건</span>
            {canAct && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={discard}>AI 초안 버리기</button>}
          </span>
        )}
        {canAct && (
          <button type="button" className="btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => void propose()}
            title="AI가 S3 필요 역량·S4 결정 기록·기회 맥락·프로필 근거로 비어 있는 칸(방식 선택·선택 근거·대안)을 초안으로 제안합니다 — 제안일 뿐이며 저장·결정은 사람이 합니다. 외부 웹 검색은 쓰지 않습니다.">
            {busy ? "제안 중…" : "진출전략 제안 (AI)"}
          </button>
        )}
      </div>
      {note && (
        <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="entry-ai-note">
          <p className="legacy-model-notice-text">{note}</p>
          <button type="button" className="btn-ghost btn-sm" aria-label="AI 제안 결과 닫기" onClick={() => setNote(null)}>닫기</button>
        </div>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}

      <div className="flex items-center gap-2 mb-1">
        <span id={`${uid}-modes`} className="text-[length:var(--fs-caption)] font-semibold">진출 방식 선택 (복수 선택 가능 · 주된 방식 1개)</span>
        {aiChip("modes")}
      </div>
      <div role="group" aria-labelledby={`${uid}-modes`} className="flex flex-wrap gap-2 mb-1">
        {ENTRY_MODES.map((m) => {
          const on = value.modes.modes.includes(m);
          return (
            <div key={m} className="sizing-grade-card" style={{ minWidth: 190, flex: "1 1 190px" }} data-testid={`entry-mode-${m}`}>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={on} onChange={() => pickMode(m)} aria-describedby={`${uid}-${m}-hint`} />
                <span className="font-semibold">{ENTRY_MODE_LABEL[m]}</span>
                {on && <span className="status-chip status-green" data-testid={`entry-selected-${m}`}><span aria-hidden="true">✓</span> 선택</span>}
              </label>
              <p id={`${uid}-${m}-hint`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{ENTRY_MODE_HINT[m]}</p>
              {on && (
                <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                  <input type="radio" name={`${uid}-main`} checked={main === m} disabled={value.modes.modes.length === 1} onChange={() => pickMain(m)} />
                  <span>주된 방식{main === m ? " (현재)" : ""}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {basisLine("modes", modeReasons)}
      {basisLine("modes", info?.proposal.basis.modes)}

      <div className="flex items-center gap-2 mt-2 mb-1">
        <label htmlFor={`${uid}-rationale`} className="text-[length:var(--fs-caption)] font-semibold">선택 근거</label>
        {aiChip("rationale")}
        <span className="ml-auto text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-rationale-count">{value.rationale.length}/{ENTRY_RATIONALE_CAP}</span>
      </div>
      <textarea
        id={`${uid}-rationale`}
        aria-label="선택 근거"
        value={value.rationale}
        maxLength={ENTRY_RATIONALE_CAP}
        onChange={(e) => { clearMark("rationale"); onChange({ ...value, rationale: e.target.value }); }}
        rows={3}
        placeholder="이 방식을 고른 이유와 역량 격차를 어떻게 해소하는지 — 예: 핵심 제조 역량은 직접 구축, 부족한 물류 운영은 외부 업체와 제휴"
        className="sizing-new-input mb-1"
        style={{ width: "100%" }}
      />
      {basisLine("rationale", [info?.proposal.basis.rationale, info?.proposal.basis.assumption ? `핵심 가정: ${info.proposal.basis.assumption}` : ""].filter(Boolean).join(" · "))}

      <div className="flex items-center gap-2 mt-1 mb-1">
        <label htmlFor={`${uid}-alt`} className="text-[length:var(--fs-caption)] font-semibold">검토했으나 선택하지 않은 대안과 사유 (선택)</label>
        {aiChip("alternatives")}
        <span className="ml-auto text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-alternatives-count">{value.alternatives.length}/{ENTRY_ALTERNATIVES_CAP}</span>
      </div>
      <textarea
        id={`${uid}-alt`}
        aria-label="검토했으나 선택하지 않은 대안과 사유"
        value={value.alternatives}
        maxLength={ENTRY_ALTERNATIVES_CAP}
        onChange={(e) => { clearMark("alternatives"); onChange({ ...value, alternatives: e.target.value }); }}
        rows={2}
        className="sizing-new-input mb-1"
        style={{ width: "100%" }}
      />
      {basisLine("alternatives", info?.proposal.basis.alternatives)}

      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
        역량별 해소 방식(아래 판정)은 역량마다 다른 층위이며 여기서 고른 진출전략과 다르면 주의가 표시됩니다
      </p>
      {mismatches.length > 0 && (
        <p className="mb-1" data-testid="entry-mismatch">
          <span className="status-chip status-not-started" role="status"><span aria-hidden="true">⚠</span> {cautionText(mismatches)}</span>
        </p>
      )}
      {save && canAct && (
        <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="entry-save-actions">
          <button type="button" className={save.dirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={!save.dirty || save.saving} aria-describedby={`${uid}-save-hint`} onClick={save.onSave}>
            {save.saving ? "저장 중…" : "진출전략 저장"}
          </button>
          {save.dirty && <span className="status-chip status-amber" role="status" data-testid="entry-dirty"><span aria-hidden="true">!</span> 저장하지 않은 변경</span>}
          {!save.dirty && <span id={`${uid}-save-hint`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">저장할 변경이 없습니다.</span>}
          {save.note && (
            <span className="flex items-center gap-1" role="status" data-testid="entry-save-note">
              <span className="status-chip status-green"><span aria-hidden="true">✓</span> {save.note}</span>
              <button type="button" className="btn-ghost btn-sm" aria-label="저장 결과 닫기" onClick={save.onDismissNote}>닫기</button>
            </span>
          )}
          {save.error && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" data-testid="entry-save-error">{save.error}</span>}
        </div>
      )}
      {info && info.proposal.cautions.length > 0 && marks.length > 0 && (
        <ul className="sizing-note-list text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-ai-cautions">
          {info.proposal.cautions.map((c, i) => <li key={i}><span aria-hidden="true">⚠</span> AI 주의: {c}</li>)}
        </ul>
      )}
    </div>
  );
}
