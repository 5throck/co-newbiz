"use client";

// S8 business goals (ADR-0159, design 2026-10-11-s8-project-business-goals-design.md).
// Analysts set PROJECT-level goals before comparing scenarios. Goals are
// reference evidence: a miss never blocks a gate and nothing here decides —
// every change is a recorded human act (supersede keeps history, retire needs a reason).
// All Korean strings in this file are INTERIM-WORDING pending glossary review.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { SectionToolbar } from "../layout.tsx";
import {
  formatDirectionLabel,
  formatDirectionSymbol,
  formatTargetValue,
  unitSpec,
  type MetricPreset,
  type TargetDirection,
  type TargetUnit,
} from "../../lib/business-targets-format.ts";
import {
  SOURCE_VIEW,
  STARTER_METRIC_KEYS,
  bannerText,
  goalsBannerState,
  goalsLoadErrorText,
  type GoalCountBySource,
  type GoalSource,
} from "../../lib/business-goals-view.ts";

export interface GoalRow {
  id: string;
  metric_key: string;
  label: string | null;
  direction: TargetDirection;
  target_value: number;
  unit: TargetUnit;
  rationale: string;
  source_note: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
  created_by: string;
  created_at: string;
  retired_at: string | null;
  retired_by: string | null;
  retire_reason: string | null;
}

export interface ResolvedGoal {
  metric_key: string;
  label: string | null;
  direction: TargetDirection;
  target_value: number;
  unit: TargetUnit;
  source: GoalSource;
  source_name: string | null;
  shadowed: Array<{ source: "affiliate" | "group"; target_value: number }>;
}

export interface GoalsData {
  goals: GoalRow[];
  resolved: ResolvedGoal[];
  presets: MetricPreset[];
  standards_resolvable: boolean;
  goal_count_by_source: GoalCountBySource;
}

const CUSTOM = "custom";

export function SourceBadge({ source }: { source: GoalSource }) {
  const v = SOURCE_VIEW[source];
  return (
    <span className={`status-chip ${v.cls}`}>
      <span aria-hidden="true">{v.icon}</span> {v.label}
    </span>
  );
}

/** "shadows ..." note shared by the goals list (text, not colour). */
export function shadowedText(shadowed: ResolvedGoal["shadowed"], unit: TargetUnit): string | null {
  if (shadowed.length === 0) return null;
  const parts = shadowed.map((s) => `${SOURCE_VIEW[s.source].label} 기준 ${formatTargetValue(s.target_value, unit)}`);
  return `${parts.join(" · ")}보다 우선 적용`; // INTERIM-WORDING
}

// ── State banner (all S8 tabs) ───────────────────────────────────────────

export function GoalsBanner({ data, onOpenGoals, hideAction, loadError }: { data: GoalsData | null; onOpenGoals: () => void; hideAction: boolean; loadError?: string | null }) {
  if (!data && loadError) {
    return (
      <div className="legacy-model-notice" role="alert" aria-label="사업 목표 상태">
        <span className="status-chip status-amber"><span aria-hidden="true">⚠</span> 목표 불러오기 실패</span>
        <p className="legacy-model-notice-text">{loadError}</p>
      </div>
    );
  }
  if (!data) return null;
  const state = goalsBannerState(data.goal_count_by_source, data.standards_resolvable);
  const text = bannerText(state);
  const none = state.kind === "none";
  return (
    <div className="legacy-model-notice" role="status" aria-label="사업 목표 상태">
      <span className={`status-chip ${none ? "status-amber" : "status-green"}`}>
        <span aria-hidden="true">{none ? "⚠" : "✓"}</span> {none ? "목표 미설정" : "목표 적용"}
      </span>
      <p className="legacy-model-notice-text">
        {text.message} <span className="text-[color:var(--muted-fg)]">{text.standardsNote}</span>
      </p>
      {!hideAction && (
        <button type="button" className={none ? "btn-premium btn-sm" : "btn-ghost btn-sm"} onClick={onOpenGoals}>
          {text.actionLabel}
        </button>
      )}
    </div>
  );
}

// ── Prompt dialog (reason / acknowledgement) ─────────────────────────────
// ConfirmDialog has no inputs; this reuses its modal markup and focus contract.

export function GoalPromptDialog({
  title,
  body,
  confirmLabel,
  textLabel,
  textRequired,
  checkLabel,
  danger,
  errorText,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  textLabel: string;
  textRequired: boolean;
  /** When set, the confirm button stays disabled until this box is ticked. */
  checkLabel?: string;
  danger?: boolean;
  /** Server-side rejection (e.g. goals_ack_note_required) shown inside the dialog. */
  errorText?: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const reasonId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const blockedReason = checkLabel && !checked ? "확인란에 체크해야 진행할 수 있습니다." : textRequired && !text.trim() ? `${textLabel}을(를) 입력해야 진행할 수 있습니다.` : null; // INTERIM-WORDING
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="alertdialog" aria-modal="true" aria-label={title} style={{ maxWidth: "28rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">{body}</p>
        {checkLabel && (
          <label className="flex items-start gap-2 text-[length:var(--fs-body)] mb-2">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{checkLabel}</span>
          </label>
        )}
        <label className="text-[length:var(--fs-caption)] block mb-1" htmlFor={reasonId}>{textLabel}{textRequired ? " (필수)" : " (선택)"}</label>
        <textarea id={reasonId} className="sizing-new-input w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {blockedReason && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">{blockedReason}</p>}
        <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 min-h-[1.25rem]">{errorText ? `✕ ${errorText}` : ""}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className={danger ? "btn-danger btn-sm" : "btn-ghost btn-sm"} disabled={!!blockedReason} onClick={() => onConfirm(text.trim())}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Goals tab ────────────────────────────────────────────────────────────

type Editor =
  | { mode: "create"; metricKey: string; label: string; direction: TargetDirection; value: string; rationale: string; sourceNote: string }
  | { mode: "supersede"; goal: GoalRow; direction: TargetDirection; value: string; rationale: string; sourceNote: string };

function toInput(stored: number, unit: TargetUnit): string {
  const f = unitSpec(unit).factor;
  return String(Math.round((stored / f) * 1e6) / 1e6);
}
function toStored(input: string, unit: TargetUnit): number | null {
  if (input.trim() === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * unitSpec(unit).factor * 1e9) / 1e9;
}

export function GoalsPanel({ projectId, data, canAct, onChanged, loadError }: { projectId: string; data: GoalsData | null; canAct: boolean; onChanged: () => void; loadError?: string | null }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [retiring, setRetiring] = useState<GoalRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<GoalRow[] | null>(null);
  const errId = useId();
  const editorRef = useRef<HTMLFormElement>(null);

  const base = `/api/projects/${encodeURIComponent(projectId)}/business-goals`;
  const presets = data?.presets ?? [];
  const activeById = useMemo(() => {
    const m = new Map<string, GoalRow>();
    for (const g of data?.goals ?? []) if (!g.superseded_at && !g.retired_at) m.set(`${g.metric_key}\u0000${g.label ?? ""}`, g);
    return m;
  }, [data]);

  const loadHistory = useCallback(() => {
    api.get<GoalsData>(`${base}?history=1`).then((r) => setHistory(r.data.goals)).catch((e) => setError(e instanceof Error ? e.message : "이력을 불러오지 못했습니다.")); // INTERIM-WORDING
  }, [base]);
  useEffect(() => { if (showHistory) loadHistory(); }, [showHistory, loadHistory, data]);
  useEffect(() => { if (editor) editorRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus(); }, [editor?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const presetOf = (key: string): MetricPreset | undefined => presets.find((p) => p.key === key);
  const editorUnit = (e: Editor): TargetUnit => (e.mode === "create" ? presetOf(e.metricKey)?.unit ?? "none" : e.goal.unit);

  function startCreate(metricKey: string, prefillDirection?: TargetDirection, prefillValue?: number) {
    const p = presetOf(metricKey);
    setError(null);
    setEditor({
      mode: "create",
      metricKey,
      label: "",
      direction: prefillDirection ?? p?.direction ?? "gte",
      value: prefillValue != null ? toInput(prefillValue, p?.unit ?? "none") : "",
      rationale: "",
      sourceNote: "",
    });
  }
  function startSupersede(goal: GoalRow) {
    setError(null);
    setEditor({ mode: "supersede", goal, direction: goal.direction, value: toInput(goal.target_value, goal.unit), rationale: "", sourceNote: goal.source_note ?? "" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editor || busy) return;
    const unit = editorUnit(editor);
    const stored = toStored(editor.value, unit);
    if (stored == null) { setError("목표 값은 0 이상의 숫자여야 합니다."); return; } // INTERIM-WORDING
    if (!editor.rationale.trim()) { setError("근거는 필수입니다."); return; } // INTERIM-WORDING
    if (editor.mode === "create" && editor.metricKey === CUSTOM && !editor.label.trim()) { setError("사용자 지정 지표에는 이름이 필요합니다."); return; } // INTERIM-WORDING
    setBusy(true); setError(null);
    try {
      if (editor.mode === "create") {
        await api.post(base, {
          action: "create",
          metric_key: editor.metricKey,
          ...(editor.metricKey === CUSTOM ? { label: editor.label.trim() } : {}),
          direction: editor.direction,
          target_value: stored,
          rationale: editor.rationale.trim(),
          ...(editor.sourceNote.trim() ? { source_note: editor.sourceNote.trim() } : {}),
        });
      } else {
        await api.post(base, {
          action: "supersede",
          goal_id: editor.goal.id,
          direction: editor.direction,
          target_value: stored,
          rationale: editor.rationale.trim(),
          source_note: editor.sourceNote.trim(),
        });
      }
      setEditor(null);
      onChanged();
    } catch (err) {
      setError(goalErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function retire(goal: GoalRow, reason: string) {
    setBusy(true); setError(null);
    try {
      await api.post(base, { action: "retire", goal_id: goal.id, reason });
      setRetiring(null);
      onChanged();
    } catch (err) {
      setRetiring(null);
      setError(goalErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const resolved = data?.resolved ?? [];
  const labelOf = (r: ResolvedGoal): string => r.label ?? presetOf(r.metric_key)?.label ?? r.metric_key;
  const projectGoalFor = (r: ResolvedGoal): GoalRow | undefined => (r.source === "project" ? activeById.get(`${r.metric_key}\u0000${r.label ?? ""}`) : undefined);
  const takenKeys = new Set((data?.goals ?? []).filter((g) => !g.superseded_at && !g.retired_at && g.metric_key !== CUSTOM).map((g) => g.metric_key));
  const starters = STARTER_METRIC_KEYS.map((k) => presetOf(k)).filter((p): p is MetricPreset => !!p && !takenKeys.has(p.key));

  return (
    <section className="market-section" aria-label="사업 목표">
      <SectionToolbar
        title="사업 목표" // INTERIM-WORDING
        count={resolved.length || undefined}
        actions={
          <button type="button" className="btn-ghost btn-sm" aria-pressed={showHistory} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "이력 숨기기" : "이력 보기"}
          </button>
        }
      />
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        시나리오를 비교하기 전에 이 프로젝트가 달성해야 할 목표를 정합니다. 목표는 참고 근거이며 미달이어도 게이트가 자동으로 막히지 않고, 채택 판단은 사람이 합니다.
      </p>

      {!canAct && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"><span className="status-chip status-not-started mr-1">읽기 전용</span>보기 권한만 있어 목표를 수정할 수 없습니다.</p>}
      {error && <p id={errId} role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2"><span aria-hidden="true">✕</span> {error}</p>}

      {data === null && loadError ? (
        <p role="alert" className="text-[length:var(--fs-body)] text-[color:var(--red-fg)]"><span aria-hidden="true">✕</span> {loadError}</p>
      ) : data === null ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">불러오는 중...</p>
      ) : resolved.length === 0 ? (
        <div className="mb-3" role="note">
          <p className="text-[length:var(--fs-body)] mb-1"><b>아직 설정된 목표가 없습니다.</b></p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {canAct ? "아래 지표 중 하나로 시작하세요. 값과 근거를 입력해야 저장됩니다." : "분석가가 목표를 설정하면 여기에 표시됩니다."}
          </p>
        </div>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table" aria-label="적용 중인 사업 목표">
            <thead>
              <tr>
                <th scope="col" style={{ minWidth: "11rem" }}>지표</th>
                <th scope="col" style={{ minWidth: "9rem" }}>목표</th>
                <th scope="col" style={{ minWidth: "8rem" }}>출처</th>
                <th scope="col" style={{ minWidth: "14rem" }}>근거</th>
                {canAct && <th scope="col"><span className="sr-only">작업</span></th>}
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => {
                const g = projectGoalFor(r);
                const note = shadowedText(r.shadowed, r.unit);
                return (
                  <tr key={`${r.metric_key}:${r.label ?? ""}`}>
                    <td><strong>{labelOf(r)}</strong>{r.metric_key === CUSTOM && <span className="section-meta"> · 사용자 지정</span>}</td>
                    <td className="mono-num">
                      <span aria-hidden="true">{formatDirectionSymbol(r.direction)}</span>
                      <span className="sr-only">{formatDirectionLabel(r.direction)}</span> {formatTargetValue(r.target_value, r.unit)}
                    </td>
                    <td>
                      <SourceBadge source={r.source} />
                      {r.source_name && <span className="section-meta" style={{ display: "block" }}>{r.source_name}</span>}
                      {note && <span className="section-meta" style={{ display: "block" }}>{note}</span>}
                    </td>
                    <td>
                      {g ? (
                        <details>
                          <summary className="cursor-pointer">{g.rationale.length > 40 ? `${g.rationale.slice(0, 40)}…` : g.rationale}</summary>
                          <p className="mt-1 mb-0">{g.rationale}</p>
                          {g.source_note && <p className="section-meta mb-0">출처 메모: {g.source_note}</p>}
                          <p className="section-meta mb-0">{g.created_by} · {g.created_at.slice(0, 10)}</p>
                        </details>
                      ) : (
                        <span className="section-meta">상위 기준(관리자 마스터 데이터)</span>
                      )}
                    </td>
                    {canAct && (
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {g ? (
                            <>
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => startSupersede(g)} aria-label={`수정 — ${labelOf(r)}`}>수정</button>
                              <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => setRetiring(g)} aria-label={`폐기 — ${labelOf(r)}`}>폐기</button>
                            </>
                          ) : (
                            r.metric_key !== CUSTOM && (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => startCreate(r.metric_key, r.direction, r.target_value)} aria-label={`프로젝트 목표 설정 — ${labelOf(r)}`}>
                                프로젝트 목표 설정
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canAct && data && !editor && (
        <div className="mt-3">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{resolved.length === 0 ? "시작 지표" : "지표 추가"}</p>
          <div className="flex flex-wrap items-center gap-2">
            {starters.map((p) => (
              <button key={p.key} type="button" className="btn-ghost btn-sm" onClick={() => startCreate(p.key)}>+ {p.label}</button>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => startCreate(CUSTOM)}>+ 사용자 지정 지표</button>
          </div>
        </div>
      )}

      {canAct && editor && (
        <form ref={editorRef} onSubmit={save} className="sizing-new-form mt-3" aria-label={editor.mode === "create" ? "목표 추가" : "목표 수정"} aria-describedby={error ? errId : undefined}>
          <h3 className="sizing-step-title text-[0.9rem]">{editor.mode === "create" ? "목표 추가" : `목표 수정 — ${editor.goal.label ?? presetOf(editor.goal.metric_key)?.label ?? editor.goal.metric_key}`}</h3>
          {editor.mode === "supersede" && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" role="note">새 버전이 만들어지며 이전 값은 이력에 남습니다.</p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
            {editor.mode === "create" && (
              <label className="text-[length:var(--fs-caption)]">지표
                <select
                  className="sizing-new-input w-full"
                  value={editor.metricKey}
                  onChange={(e) => {
                    const p = presetOf(e.target.value);
                    setEditor({ ...editor, metricKey: e.target.value, direction: p?.direction ?? editor.direction, value: "" });
                  }}
                >
                  {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  <option value={CUSTOM}>사용자 지정</option>
                </select>
              </label>
            )}
            {editor.mode === "create" && editor.metricKey === CUSTOM && (
              <label className="text-[length:var(--fs-caption)]">지표 이름 (필수)
                <input className="sizing-new-input w-full" value={editor.label} onChange={(e) => setEditor({ ...editor, label: e.target.value })} required />
              </label>
            )}
            <label className="text-[length:var(--fs-caption)]">방향
              <select className="sizing-new-input w-full" value={editor.direction} onChange={(e) => setEditor({ ...editor, direction: e.target.value as TargetDirection })}>
                <option value="gte">≥ 이상</option>
                <option value="lte">≤ 이하</option>
              </select>
            </label>
            <label className="text-[length:var(--fs-caption)]">목표 값{unitSpec(editorUnit(editor)).inputLabel ? ` (${unitSpec(editorUnit(editor)).inputLabel})` : ""}
              <input
                className="sizing-new-input w-full"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={editor.value}
                onChange={(e) => setEditor({ ...editor, value: e.target.value })}
                required
              />
            </label>
          </div>
          <label className="text-[length:var(--fs-caption)] block mt-2">근거 (필수)
            <textarea className="sizing-new-input w-full" rows={3} value={editor.rationale} onChange={(e) => setEditor({ ...editor, rationale: e.target.value })} required />
          </label>
          <label className="text-[length:var(--fs-caption)] block mt-2">출처 메모 (선택)
            <input className="sizing-new-input w-full" value={editor.sourceNote} onChange={(e) => setEditor({ ...editor, sourceNote: e.target.value })} />
          </label>
          <div className="flex gap-1 mt-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? "저장 중..." : editor.mode === "create" ? "목표 저장" : "새 버전 저장"}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditor(null); setError(null); }}>취소</button>
          </div>
        </form>
      )}

      {showHistory && (
        <div className="mt-3">
          <h3 className="sizing-step-title text-[0.9rem]">변경 이력</h3>
          {history === null ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중...</p>
          ) : history.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기록된 프로젝트 목표가 없습니다.</p>
          ) : (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table" aria-label="목표 변경 이력">
                <thead>
                  <tr><th scope="col">지표</th><th scope="col">목표</th><th scope="col">상태</th><th scope="col">설정</th><th scope="col">근거</th></tr>
                </thead>
                <tbody>
                  {[...history].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((g) => {
                    const status = g.retired_at ? { icon: "✕", label: "폐기", cls: "status-red" } : g.superseded_at ? { icon: "↻", label: "교체됨", cls: "status-not-started" } : { icon: "✓", label: "현재", cls: "status-green" };
                    return (
                      <tr key={g.id}>
                        <td>{g.label ?? presetOf(g.metric_key)?.label ?? g.metric_key}</td>
                        <td className="mono-num">{formatDirectionSymbol(g.direction)} {formatTargetValue(g.target_value, g.unit)}</td>
                        <td><span className={`status-chip ${status.cls}`}><span aria-hidden="true">{status.icon}</span> {status.label}</span>{g.retire_reason && <span className="section-meta" style={{ display: "block" }}>사유: {g.retire_reason}</span>}</td>
                        <td className="section-meta">{g.created_by} · {g.created_at.slice(0, 10)}</td>
                        <td>{g.rationale}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {retiring && (
        <GoalPromptDialog
          title={`목표 폐기 — ${retiring.label ?? presetOf(retiring.metric_key)?.label ?? retiring.metric_key}`}
          body="폐기해도 이력에는 남습니다. 상위(계열사·그룹) 기준이 있으면 그 기준이 다시 적용됩니다."
          confirmLabel="폐기"
          textLabel="폐기 사유"
          textRequired
          danger
          onConfirm={(reason) => void retire(retiring, reason)}
          onClose={() => setRetiring(null)}
        />
      )}
    </section>
  );
}

function goalErrorText(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "goal_exists") return "같은 지표의 활성 목표가 이미 있습니다 — 새로고침한 뒤 수정하세요."; // INTERIM-WORDING
  if (code === "goal_not_active") return "이미 교체되었거나 폐기된 목표입니다 — 새로고침하세요."; // INTERIM-WORDING
  if (code === "role_required") return "목표 설정은 분석가 이상 역할이 필요합니다."; // INTERIM-WORDING
  return err instanceof Error ? err.message : "목표를 저장하지 못했습니다."; // INTERIM-WORDING
}

/** Self-fetching banner for S8 tabs that live on their own page (WACC, 재무분석). */
export function S8GoalsBannerLoader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<GoalsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.get<GoalsData>(`/api/projects/${encodeURIComponent(projectId)}/business-goals`)
      .then((r) => { if (live) { setData(r.data); setLoadError(null); } })
      .catch((e) => { if (live) setLoadError(goalsLoadErrorText(e, "사업 목표를 불러오지 못했습니다.")); }); // INTERIM-WORDING
    return () => { live = false; };
  }, [projectId]);
  return <GoalsBanner data={data} loadError={loadError} hideAction={false} onOpenGoals={() => router.push(`/projects/${encodeURIComponent(projectId)}/business-case?tab=goals`)} />;
}
