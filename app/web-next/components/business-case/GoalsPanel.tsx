"use client";

// S8 business goals (ADR-0159, design 2026-10-11-s8-project-business-goals-design.md).
// Analysts set PROJECT-level goals before comparing scenarios. Goals are
// reference evidence: a miss never blocks a gate and nothing here decides —
// every change is a recorded human act (supersede keeps history, retire needs a reason).
// All Korean strings in this file are INTERIM-WORDING pending glossary review.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { SectionToolbar } from "../layout.tsx";
import { TranslatorFn } from "../../i18n/config.ts";
import { useTranslations } from "next-intl";
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
export function shadowedText(shadowed: ResolvedGoal["shadowed"], unit: TargetUnit, t: TranslatorFn): string | null {
  if (shadowed.length === 0) return null;
  const parts = shadowed.map((s) => t("p1BasisP2", { p1: SOURCE_VIEW[s.source].label, p2: formatTargetValue(s.target_value, unit) }));
  return t("takesPrecedenceOverP1", { p1: parts.join(" · ") }); // INTERIM-WORDING
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
}) {const t = useTranslations("stages.s8.goalsPanel"); const tc = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const reasonId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const blockedReason = checkLabel && !checked ? t("youMustTickTheCheckbox") : textRequired && !text.trim() ? t("enterP1ToProceed", { p1: textLabel }) : null; // INTERIM-WORDING
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
        <label className="text-[length:var(--fs-caption)] block mb-1" htmlFor={reasonId}>{textLabel}{textRequired ? tc("requiredSuffix") : t("optional")}</label>
        <textarea id={reasonId} className="sizing-new-input w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {blockedReason && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">{blockedReason}</p>}
        <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 min-h-[1.25rem]">{errorText ? `✕ ${errorText}` : ""}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
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

export function GoalsPanel({ projectId, data, canAct, onChanged, loadError }: { projectId: string; data: GoalsData | null; canAct: boolean; onChanged: () => void; loadError?: string | null }) {const t = useTranslations("stages.s8.goalsPanel"); const tc = useTranslations("common");
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
    api.get<GoalsData>(`${base}?history=1`).then((r) => setHistory(r.data.goals)).catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheHistory"))); // INTERIM-WORDING
  }, [base]);
  useEffect(() => { if (showHistory) loadHistory(); }, [showHistory, loadHistory, data]);
  useEffect(() => {
    if (!editor) return;
    editorRef.current?.scrollIntoView?.({ block: "nearest" });
    editorRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
  }, [editor?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (stored == null) { setError(t("theTargetValueMustBe")); return; } // INTERIM-WORDING
    if (!editor.rationale.trim()) { setError(t("evidenceIsRequired")); return; } // INTERIM-WORDING
    if (editor.mode === "create" && editor.metricKey === CUSTOM && !editor.label.trim()) { setError(t("customMetricsNeedAName")); return; } // INTERIM-WORDING
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
      setError(goalErrorText(err, t));
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
      setError(goalErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const resolved = data?.resolved ?? [];
  const banner = goalsBannerState(data?.goal_count_by_source, data?.standards_resolvable ?? false);
  const labelOf = (r: ResolvedGoal): string => r.label ?? presetOf(r.metric_key)?.label ?? r.metric_key;
  const projectGoalFor = (r: ResolvedGoal): GoalRow | undefined => (r.source === "project" ? activeById.get(`${r.metric_key}\u0000${r.label ?? ""}`) : undefined);
  const takenKeys = new Set((data?.goals ?? []).filter((g) => !g.superseded_at && !g.retired_at && g.metric_key !== CUSTOM).map((g) => g.metric_key));
  const firstFreePreset = presets.find((p) => !takenKeys.has(p.key));
  const starters = STARTER_METRIC_KEYS.map((k) => presetOf(k)).filter((p): p is MetricPreset => !!p && !takenKeys.has(p.key));

  return (
    <section className="market-section" aria-label={t("businessGoals")}>
      <SectionToolbar
        filters={resolved.length > 0 ? <span className="section-meta" aria-label={t("numberOfApplicableTargets")}>{resolved.length}{t("itemSApplied")}</span> : undefined}
        actions={
          <>
            {canAct && data && resolved.length > 0 && !editor && (
              <button type="button" className="btn-premium btn-sm" onClick={() => startCreate(firstFreePreset?.key ?? CUSTOM)}>{t("addTarget")}</button> /* INTERIM-WORDING */
            )}
            <button type="button" className="btn-ghost btn-sm" aria-pressed={showHistory} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? t("hideHistory") : t("viewHistory")}
            </button>
          </>
        }
      />
      {data && (
        <div className="legacy-model-notice" role="status" aria-label={t("businessGoalStatus")}>
          <span className={`status-chip ${banner.kind === "none" ? "status-amber" : "status-green"}`}>
            <span aria-hidden="true">{banner.kind === "none" ? "⚠" : "✓"}</span> {banner.kind === "none" ? t("noTargetSet") : t("applyTarget")}
          </span>
          <p className="legacy-model-notice-text">
            {bannerText(banner).message} <span className="text-[color:var(--muted-fg)]">{bannerText(banner).standardsNote}</span>
          </p>
        </div>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("targetsAreReferenceEvidenceFor")} {/* INTERIM-WORDING */}
      </p>

      {!canAct && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"><span className="status-chip status-not-started mr-1">{tc("readOnly")}</span>{t("permissionTheTargetCannotBe")}</p>}
      {error && <p id={errId} role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2"><span aria-hidden="true">✕</span> {error}</p>}

      {canAct && data && !editor && resolved.length === 0 && (
        <div className="mb-3">
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("pickAStartingMetric")}</p> {/* INTERIM-WORDING */}
          <div className="flex flex-wrap items-center gap-2">
            {starters.map((p) => (
              <button key={p.key} type="button" className="btn-ghost btn-sm" onClick={() => startCreate(p.key)}>+ {p.label}</button>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => startCreate(CUSTOM)}>{t("customMetric")}</button>
          </div>
        </div>
      )}

      {canAct && editor && (
        <form ref={editorRef} onSubmit={save} className="sizing-new-form mb-3" aria-label={editor.mode === "create" ? t("addTarget2") : t("editTarget")} aria-describedby={error ? errId : undefined}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{editor.mode === "create" ? t("addTarget3") : t("editTargetP1", { p1: editor.goal.label ?? presetOf(editor.goal.metric_key)?.label ?? editor.goal.metric_key })}</h3>
          {editor.mode === "supersede" && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" role="note">{t("aNewVersionIsCreated")}</p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
            {editor.mode === "create" && (
              <label className="text-[length:var(--fs-caption)]">{tc("metric")}
                <select
                  className="sizing-new-input w-full"
                  value={editor.metricKey}
                  onChange={(e) => {
                    const p = presetOf(e.target.value);
                    setEditor({ ...editor, metricKey: e.target.value, direction: p?.direction ?? editor.direction, value: "" });
                  }}
                >
                  {presets.map((p) => <option key={p.key} value={p.key} disabled={takenKeys.has(p.key)}>{p.label}{takenKeys.has(p.key) ? t("set") : ""}</option>)} {/* INTERIM-WORDING */}
                  <option value={CUSTOM}>{t("userDefined")}</option>
                </select>
              </label>
            )}
            {editor.mode === "create" && editor.metricKey === CUSTOM && (
              <label className="text-[length:var(--fs-caption)]">{t("metricNameRequired")}
                <input className="sizing-new-input w-full" value={editor.label} onChange={(e) => setEditor({ ...editor, label: e.target.value })} required />
              </label>
            )}
            <label className="text-[length:var(--fs-caption)]">{tc("direction")}
              <select className="sizing-new-input w-full" value={editor.direction} onChange={(e) => setEditor({ ...editor, direction: e.target.value as TargetDirection })}>
                <option value="gte">{t("orAbove")}</option>
                <option value="lte">{t("orBelow")}</option>
              </select>
            </label>
            <label className="text-[length:var(--fs-caption)]">{t("targetValue")}{unitSpec(editorUnit(editor)).inputLabel ? ` (${unitSpec(editorUnit(editor)).inputLabel})` : ""}
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
          <label className="text-[length:var(--fs-caption)] block mt-2">{tc("evidenceRequiredMark")}
            <textarea className="sizing-new-input w-full" rows={3} value={editor.rationale} onChange={(e) => setEditor({ ...editor, rationale: e.target.value })} required />
          </label>
          <label className="text-[length:var(--fs-caption)] block mt-2">{t("sourceMemoOptional")}
            <input className="sizing-new-input w-full" value={editor.sourceNote} onChange={(e) => setEditor({ ...editor, sourceNote: e.target.value })} />
          </label>
          <div className="flex gap-1 mt-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? tc("saving") : editor.mode === "create" ? t("saveTarget") : t("saveNewVersion")}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditor(null); setError(null); }}>{tc("cancel")}</button>
          </div>
        </form>
      )}

      {data === null && loadError ? (
        <p role="alert" className="text-[length:var(--fs-body)] text-[color:var(--red-fg)]"><span aria-hidden="true">✕</span> {loadError}</p>
      ) : data === null ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{tc("loading")}</p>
      ) : resolved.length === 0 ? (
        <div className="mb-3" role="note">
          <p className="text-[length:var(--fs-body)] mb-1"><b>{t("noTargetsSetYet")}</b></p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {canAct ? t("startWithOneOfThe") : t("onceAnAnalystSetsA")}
          </p>
        </div>
      ) : (
        <div>
        <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("activeTargets")}</h3> {/* INTERIM-WORDING */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("affiliateAndGroupRowsAre")} {/* INTERIM-WORDING */}
        </p>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table" aria-label={t("activeBusinessGoals")}>
            <thead>
              <tr>
                <th scope="col" style={{ minWidth: "11rem" }}>{tc("metric")}</th>
                <th scope="col" style={{ minWidth: "9rem" }}>{t("targetValue2")}</th>
                <th scope="col" style={{ minWidth: "8rem" }}>{t("applicableSteps")}</th>
                <th scope="col" style={{ minWidth: "14rem" }}>{tc("evidence")}</th>
                {canAct && <th scope="col"><span className="sr-only">{tc("actions")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => {
                const g = projectGoalFor(r);
                const note = shadowedText(r.shadowed, r.unit, t);
                return (
                  <tr key={`${r.metric_key}:${r.label ?? ""}`}>
                    <td><strong>{labelOf(r)}</strong>{r.metric_key === CUSTOM && <span className="section-meta"> {t("userDefined2")}</span>}</td>
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
                          {g.source_note && <p className="section-meta mb-0">{t("sourceMemo")} {g.source_note}</p>}
                          <p className="section-meta mb-0">{g.created_by} · {g.created_at.slice(0, 10)}</p>
                        </details>
                      ) : (
                        <span className="section-meta">{t("upstreamStandardAdminMasterData")}</span>
                      )}
                    </td>
                    {canAct && (
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {g ? (
                            <>
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => startSupersede(g)} aria-label={t("editP1", { p1: labelOf(r) })}>{tc("edit")}</button>
                              <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => setRetiring(g)} aria-label={t("discardP1", { p1: labelOf(r) })}>{tc("discard")}</button>
                            </>
                          ) : (
                            r.metric_key !== CUSTOM && (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => startCreate(r.metric_key, r.direction, r.target_value)} aria-label={t("setAsProjectGoalP1", { p1: labelOf(r) })}>
                                {t("setAsTheProjectGoal")}
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
        </div>
      )}

      {showHistory && (
        <div className="mt-3">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("changeHistory")}</h3>
          {history === null ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loading")}</p>
          ) : history.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noRecordedProjectGoals")}</p>
          ) : (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table" aria-label={t("targetChangeHistory")}>
                <thead>
                  <tr><th scope="col">{tc("metric")}</th><th scope="col">{tc("target")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("settings")}</th><th scope="col">{tc("evidence")}</th></tr>
                </thead>
                <tbody>
                  {[...history].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((g) => {
                    const status = g.retired_at ? { icon: "✕", label: tc("discard"), cls: "status-red" } : g.superseded_at ? { icon: "↻", label: t("replaced"), cls: "status-not-started" } : { icon: "✓", label: t("current"), cls: "status-green" };
                    return (
                      <tr key={g.id}>
                        <td>{g.label ?? presetOf(g.metric_key)?.label ?? g.metric_key}</td>
                        <td className="mono-num">{formatDirectionSymbol(g.direction)} {formatTargetValue(g.target_value, g.unit)}</td>
                        <td><span className={`status-chip ${status.cls}`}><span aria-hidden="true">{status.icon}</span> {status.label}</span>{g.retire_reason && <span className="section-meta" style={{ display: "block" }}>{tc("reasonColon")} {g.retire_reason}</span>}</td>
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
          title={t("discardTargetP1", { p1: retiring.label ?? presetOf(retiring.metric_key)?.label ?? retiring.metric_key })}
          body={t("discardingKeepsItInHistory")}
          confirmLabel={tc("discard")}
          textLabel={t("discardReason")}
          textRequired
          danger
          onConfirm={(reason) => void retire(retiring, reason)}
          onClose={() => setRetiring(null)}
        />
      )}
    </section>
  );
}

function goalErrorText(err: unknown, t: TranslatorFn): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "goal_exists") return t("anActiveTargetAlreadyExists"); // INTERIM-WORDING
  if (code === "goal_not_active") return t("theTargetWasAlreadyReplaced"); // INTERIM-WORDING
  if (code === "role_required") return t("settingTargetsRequiresTheAnalyst"); // INTERIM-WORDING
  return err instanceof Error ? err.message : t("failedToSaveTheTarget"); // INTERIM-WORDING
}
