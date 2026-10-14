// S5 investment section, capability part (ADR-0173 slice 1, Proposed): the read-only block
// "역량 해소 비용 (S5 판정에서 연동)" with a per-line "투자비에 반영" checkbox, the totals, the
// double-count warnings and the read-only milestone candidate list. Presentational and hook-free:
// GreenfieldStage owns the state. Amounts follow the judgement; the person only decides whether
// a line is reflected and which category it carries. Decision support, never a gate.
import {
  CAPABILITY_BLOCK_TITLE, MILESTONE_BLOCK_TITLE, MILESTONE_START_NOTE, formatKrwM,
  type CapabilityCostLine, type LineSaveState, type CostCategory, type DuplicateWarning, type InvestmentTotals, type MilestoneCandidateView, type OrphanCapabilityEntry,
} from "../../lib/capability-cost-lines.ts";

const CATEGORY_LABEL: Record<CostCategory, string> = { labor: "인건비", opex: "운영비", capex: "설비투자" };

export interface ReflectionUi {
  states: Record<string, LineSaveState>;
  dirty: boolean;
  saving: boolean;
  onReflect: () => void;
  note: string | null;
  error: string | null;
  onDismissNote: () => void;
  /** Saved (persisted) reflection: count and 백만원 sum, for the downstream line. */
  saved: { count: number; krwM: number };
  /** True when the opportunity is already promoted to a project. */
  promoted: boolean;
}

export function CapabilityCostBlock({ lines, orphans, totals, warnings, candidates, canAct, onToggle, onCategory, onDismiss, reflection }: {
  lines: CapabilityCostLine[];
  orphans: OrphanCapabilityEntry[];
  totals: InvestmentTotals;
  warnings: DuplicateWarning[];
  candidates: MilestoneCandidateView[];
  canAct: boolean;
  onToggle: (capabilityKey: string, reflected: boolean) => void;
  onCategory: (capabilityKey: string, category: CostCategory) => void;
  onDismiss: (w: DuplicateWarning) => void;
  reflection?: ReflectionUi;
}) {
  const r = reflection;
  const reflectDisabledReason = !canAct ? "analyst 권한이 필요합니다." : r?.saving ? "저장 중입니다." : r && !r.dirty ? "저장된 반영과 달라진 선택이 없습니다." : null;
  return (
    <>
      <div className="sizing-grade-card mb-3" role="group" aria-label={CAPABILITY_BLOCK_TITLE}>
        <h4 className="text-[length:var(--fs-caption)] mb-1">{CAPABILITY_BLOCK_TITLE}</h4>
        <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          읽기 전용입니다. 금액은 S5 판정의 해소 비용에서 정해지며(백만원, 일시불), 바꾸려면 판정을 바꾸세요.
          투자비에 담을지는 사람이 줄마다 정하며, "선택한 비용을 투자비에 반영"을 눌러 저장해야 반영됩니다. 확정된 판정만 처음부터 선택됩니다.
        </p>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">금액 (단위: 백만원)</p>
        {r && canAct && (
          <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="reflect-actions">
            <button type="button" className={r.dirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={reflectDisabledReason !== null} aria-describedby="cap-reflect-hint" onClick={r.onReflect}>
              {r.saving ? "반영 중…" : "선택한 비용을 투자비에 반영"}
            </button>
            {r.dirty && <span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> 저장하지 않은 변경</span>}
            {reflectDisabledReason && <span id="cap-reflect-hint" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{reflectDisabledReason}</span>}
          </div>
        )}
        {r?.note && (
          <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="reflect-note">
            <p className="legacy-model-notice-text">{r.note}</p>
            <button type="button" className="btn-ghost btn-sm" aria-label="반영 결과 닫기" onClick={r.onDismissNote}>닫기</button>
          </div>
        )}
        {r?.error && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="reflect-error">{r.error}</p>}
        {lines.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">해소 비용이 입력된 역량이 없습니다.</p>
        ) : (
          <ul className="sizing-note-list mb-2">
            {lines.map((l) => {
              const hintId = `cap-cost-hint-${l.capabilityKey}`;
              const disabled = !canAct || (!l.reflected && l.disabledReason !== null);
              return (
                <li key={l.capabilityKey} className="flex flex-wrap items-center gap-2 mb-1">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={l.reflected}
                      disabled={disabled}
                      aria-label={`${l.name} 투자비에 반영`}
                      aria-describedby={l.disabledReason && !l.reflected ? hintId : undefined}
                      onChange={(e) => onToggle(l.capabilityKey, e.target.checked)}
                    />
                    <span className="text-[length:var(--fs-caption)]">투자비에 반영</span>
                  </label>
                  <span className="font-semibold">{l.name}</span>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">해소 방식 {l.resolutionLabel}</span>
                  <span className="font-semibold">{formatKrwM(l.costKrwM)}</span>
                  <select
                    aria-label={`${l.name} 분류`}
                    value={l.category}
                    disabled={!canAct}
                    onChange={(e) => onCategory(l.capabilityKey, e.target.value as CostCategory)}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {(Object.keys(CATEGORY_LABEL) as CostCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">달성 기간 {l.monthsToAttain !== null ? `${l.monthsToAttain}개월` : "미입력"}</span>
                  <span className={`status-chip ${l.state === "reflectable" ? "status-green" : "status-not-started"}`}>{l.stateLabel}</span>
                  {r?.states[l.capabilityKey] === "saved" && <span className="status-chip status-green" data-testid={`reflect-saved-${l.capabilityKey}`}><span aria-hidden="true">✓</span> 반영됨 · 저장됨</span>}
                  {r?.states[l.capabilityKey] === "unsaved" && <span className="status-chip status-amber" data-testid={`reflect-unsaved-${l.capabilityKey}`}><span aria-hidden="true">!</span> 저장 전</span>}
                  {l.needsRejudge && <span className="status-chip status-amber">재판정 필요</span>}
                  {l.amountChanged && <span className="status-chip status-amber">금액 변경됨 (이전 {l.previousAmountKrwM !== null ? formatKrwM(l.previousAmountKrwM) : "-"})</span>}
                  {l.categoryHint && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.categoryHint}</span>}
                  {l.alternativeCategory && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">비용이 대부분 인력이면 분류 대안: {CATEGORY_LABEL[l.alternativeCategory]}</span>}
                  {l.disabledReason && !l.reflected && <span id={hintId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.disabledReason}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {orphans.length > 0 && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-2">
            삭제되었거나 해소 비용이 없어진 역량 {orphans.length}건은 저장할 때 목록에서 빠집니다: {orphans.map((o) => o.line || o.capabilityKey).join(", ")}
          </p>
        )}
        <p className="text-[length:var(--fs-caption)] mb-1" role="status">
          역량 해소 비용 합계 <b>{formatKrwM(totals.capabilityKrwM)}</b>
          {" · "}반영 합계 <b>{formatKrwM(totals.reflectedKrwM)}</b> ({totals.reflectedCount}건{totals.needsRejudgeCount > 0 ? `, 포함(재판정 필요) ${totals.needsRejudgeCount}건` : ""})
          {r?.dirty && <span className="text-[color:var(--muted-fg)]" data-testid="reflect-totals-note"> · 저장 전 변경 있음 (저장된 반영 {r.saved.count}건, {formatKrwM(r.saved.krwM)})</span>}
        </p>
        <p className="text-[length:var(--fs-caption)] mb-1" role="status">
          수동 입력 합계 <b>{formatKrwM(totals.manualKrwM)}</b> (원화, 일시불은 그대로·반복 항목은 연 환산, 수익·정부 R&amp;D 제외{totals.manualExcludedNonKrw > 0 ? `, 외화 ${totals.manualExcludedNonKrw}건 제외` : ""})
          {" · "}투자비 검토 합계 <b>{formatKrwM(totals.grandKrwM)}</b>
        </p>
        {r && (r.promoted ? (
          <p className="mb-0" data-testid="reflect-promoted"><span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> 이미 승격된 프로젝트 — S5의 변경은 S8에 자동 전달되지 않습니다 (재가져오기는 이후 단계)</span></p>
        ) : r.saved.count > 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0" data-testid="reflect-downstream">S8 사업성 분석 입력: 프로젝트 승격 시 반영된 {r.saved.count}건(합계 {formatKrwM(r.saved.krwM)})이 투자비 입력으로 복사됩니다</p>
        ) : null)}
      </div>

      {warnings.map((w) => (
        <div key={`${w.capabilityKey}:${w.manualIndex}`} role="alert" className="flex flex-wrap items-center gap-2 mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))]">
          <span>
            중복 가능성: 수동 항목 &quot;{w.manualLine}&quot;이(가) 반영된 역량 해소 비용 &quot;{w.capabilityName}&quot;과(와) 같은 항목일 수 있습니다 — 합계에 두 번 들어갈 수 있으니 확인하세요.
          </span>
          {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => onDismiss(w)}>수동 항목 유지</button>}
        </div>
      ))}

      <div className="sizing-grade-card mb-3" role="group" aria-label={MILESTONE_BLOCK_TITLE}>
        <h4 className="text-[length:var(--fs-caption)] mb-1">{MILESTONE_BLOCK_TITLE}</h4>
        {candidates.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">달성 기간이 입력된 역량이 없습니다.</p>
        ) : (
          <ul className="sizing-note-list mb-1">
            {candidates.map((c) => (
              <li key={c.rowId} className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-semibold">{c.name}</span>
                <span>{c.months}개월</span>
                {c.stale && <span className="status-chip status-amber">재판정 필요</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">읽기 전용 후보입니다. {MILESTONE_START_NOTE}</p>
      </div>
    </>
  );
}
