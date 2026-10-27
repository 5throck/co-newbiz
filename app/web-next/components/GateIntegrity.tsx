"use client";

// Gate-integrity surfaces: second review (countersign) form, conditions list with clear/withdraw, and
// stop-condition exception management. The server decides eligibility and every outcome (403/409/422 texts
// come from the errors catalog); these components only collect the person's input and show the result.
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { useConfirm } from "./crud.tsx";
import { useToast } from "./ui.tsx";
import {
  COUNTERSIGN_CHOICES, EMPTY_CONDITION, clearByOptions, conditionsPayload, countersignProblem, filterConditions,
  type ClearByView, type ConditionDraft, type CountersignChoice,
} from "../lib/gate-integrity-view.ts";

const small = "text-[length:var(--fs-caption)]";
const muted = "text-[color:var(--muted-fg)]";

/** Editor for `conditions[]` (IC GO and conditional second review). */
export function ConditionsEditor({ gate, value, onChange, required }: { gate: string; value: ConditionDraft[]; onChange: (v: ConditionDraft[]) => void; required?: boolean }) {
  const t = useTranslations("components.gateIntegrity");
  const options = clearByOptions(gate);
  const set = (i: number, patch: Partial<ConditionDraft>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <fieldset className="border border-[color:var(--border)] rounded-lg px-3 py-2 m-0 mt-2" data-testid="conditions-editor">
      <legend className={`${small} font-semibold px-1`}>{required ? t("conditionsEditor.legendRequired") : t("conditionsEditor.legend")}</legend>
      {value.length === 0 && <p className={`${small} ${muted} m-0 mb-2`}>{t("conditionsEditor.none")}</p>}
      <ul className="list-none p-0 m-0 grid gap-3">
        {value.map((c, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <label className={`${small} flex-1 min-w-[14rem]`}>
              <span className="block mb-1">{t("conditionsEditor.text", { n: i + 1 })}</span>
              <input className="sizing-new-input w-full" value={c.text} onChange={(e) => set(i, { text: e.target.value })} />
            </label>
            <label className={small}>
              <span className="block mb-1">{t("conditionsEditor.clearBy")}</span>
              <select className="sizing-new-input sizing-new-input-sm" value={c.clear_by} onChange={(e) => set(i, { clear_by: e.target.value as ClearByView })}>
                {options.map((o) => <option key={o} value={o}>{t(`clearBy.${o}`)}</option>)}
              </select>
            </label>
            <label className={small}>
              <span className="block mb-1">{t("conditionsEditor.owner")}</span>
              <input className="sizing-new-input sizing-new-input-sm" value={c.owner_role} onChange={(e) => set(i, { owner_role: e.target.value })} />
            </label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t("conditionsEditor.remove", { n: i + 1 })}</button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => onChange([...value, EMPTY_CONDITION(options[0])])}>{t("conditionsEditor.add")}</button>
    </fieldset>
  );
}

/** The second reviewer's form for an IC GO that awaits countersign. Visible to writers; the server checks the grant. */
export function GateCountersign({ projectId, decisionId, gate, gateLabel, recordedBy, onDone }: {
  projectId: string; decisionId: string; gate: string; gateLabel: string; recordedBy?: string; onDone: () => void;
}) {
  const t = useTranslations("components.gateIntegrity");
  const tc = useTranslations("common");
  const { me } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const uid = useId().replace(/:/g, "");
  const [choice, setChoice] = useState<CountersignChoice>("approved");
  const [reason, setReason] = useState("");
  const [conds, setConds] = useState<ConditionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = countersignProblem(choice, reason, conds);
  const hint = problem === "reason" ? t("countersign.needReason") : problem === "conditions" ? t("countersign.needCondition") : null;

  async function send() {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/gate-decisions/${encodeURIComponent(decisionId)}/countersign`, {
        decision: choice, reason: reason.trim(), ...(choice === "conditional" ? { conditions: conditionsPayload(conds) } : {}),
      });
      toast(t("countersign.done"));
      setReason(""); setConds([]); setChoice("approved");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("countersign.done"));
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <form
      className="sizing-new-form mt-2 mb-3"
      aria-label={t("countersign.heading")}
      data-testid="countersign-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || busy) return;
        confirm(t("countersign.confirmTitle", { decision: t(`countersign.choice.${choice}`) }), () => void send(), {
          body: t("countersign.confirmBody", { reason: reason.trim() }), confirmLabel: tc("record"), tone: choice === "rejected" ? "danger" : "neutral",
        });
      }}
    >
      <h4 className="text-[length:var(--fs-body)] mb-1">{gateLabel} · {t("countersign.heading")}</h4>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("countersign.intro")}</p>
      {recordedBy && me?.userId === recordedBy && <p className={`${small} m-0 mb-2`} role="note">{t("countersign.recorderHint")}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className={small}>
          <span className="block mb-1">{t("countersign.decisionLabel")}</span>
          <select className="sizing-new-input sizing-new-input-sm" value={choice} onChange={(e) => setChoice(e.target.value as CountersignChoice)}>
            {COUNTERSIGN_CHOICES.map((c) => <option key={c} value={c}>{t(`countersign.choice.${c}`)}</option>)}
          </select>
        </label>
        <label className={`${small} flex-1 min-w-[14rem]`} htmlFor={`${uid}-reason`}>
          <span className="block mb-1">{t("countersign.reasonLabel")}</span>
          <textarea id={`${uid}-reason`} className="sizing-new-input w-full" rows={2} aria-required="true" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      {choice === "conditional" && <ConditionsEditor gate={gate} value={conds} onChange={setConds} required />}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !!problem} aria-describedby={hint ? `${uid}-hint` : undefined}>
          {busy ? t("countersign.saving") : t("countersign.submit")}
        </button>
        {hint && <span id={`${uid}-hint`} className={`${small} ${muted}`}>{hint}</span>}
      </div>
      {error && <p role="alert" className={`${small} text-[color:var(--red-fg)] mt-1 mb-0`}>✕ {error}</p>}
      {confirmDialog}
    </form>
  );
}

export interface ConditionView {
  id: string; gate: string; text: string; clear_by: string; owner_role: string | null; status: "open" | "cleared" | "withdrawn";
  created_by: string; created_at: string; cleared_by: string | null; cleared_at: string | null; clear_note: string | null; evidence_ref: string | null;
}
const COND_ICON = { open: "◐", cleared: "●", withdrawn: "✕" } as const;
const COND_CLS = { open: "status-amber", cleared: "status-green", withdrawn: "status-not-started" } as const;

/** Conditions of a project's IC decisions with clear / withdraw actions (server checks the grant and the person). */
export function GateConditionsPanel({ projectId, conditions, canAct, onChanged }: {
  projectId: string; conditions: readonly ConditionView[]; canAct: boolean; onChanged: () => void;
}) {
  const t = useTranslations("components.gateIntegrity");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState<"all" | "open" | "cleared" | "withdrawn">("all");
  const [acting, setActing] = useState<{ id: string; mode: "clear" | "withdraw" } | null>(null);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = filterConditions(conditions, filter);
  const openCount = conditions.filter((c) => c.status === "open").length;

  async function submit(c: ConditionView, mode: "clear" | "withdraw") {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/conditions/${encodeURIComponent(c.id)}/${mode}`, {
        note: note.trim(), ...(mode === "clear" && evidence.trim() ? { evidence_ref: evidence.trim() } : {}),
      });
      toast(t("conditions.done"));
      setActing(null); setNote(""); setEvidence("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally { setBusy(false); onChanged(); }
  }
  function ask(c: ConditionView, mode: "clear" | "withdraw") {
    if (!note.trim()) { setError(t("conditions.needNote")); return; }
    if (mode === "clear" && c.clear_by === "closing" && !evidence.trim()) { setError(t("conditions.needEvidence")); return; }
    setError(null);
    confirm(mode === "clear" ? t("conditions.confirmClear") : t("conditions.confirmWithdraw"), () => void submit(c, mode), { body: c.text, confirmLabel: tc("record") });
  }
  useEffect(() => { setError(null); }, [acting]);

  return (
    <section className="market-section sizing-step mt-3" aria-label={t("conditions.heading")} data-testid="conditions-panel">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("conditions.heading")}</h3>
      {openCount > 0 && <p className={`${small} m-0 mb-2`} role="status"><span className="status-chip status-amber"><span aria-hidden="true">◐</span> {t("conditions.openBlocks", { count: openCount })}</span></p>}
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label={t("conditions.filterLabel")}>
        {(["all", "open", "cleared", "withdrawn"] as const).map((f) => (
          <button key={f} type="button" className="control-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`conditions.filter.${f}`)}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className={`${small} ${muted}`}>{t("conditions.empty")}</p> : (
        <div className="table-scroll" role="region" aria-label={t("conditions.heading")} tabIndex={0}>
          <table className="data-table" aria-label={t("conditions.heading")}>
            <caption className="sr-only">{t("conditions.heading")}</caption>
            <thead><tr>
              <th scope="col">{t("conditions.colText")}</th><th scope="col">{t("conditions.colClearBy")}</th><th scope="col">{t("conditions.colOwner")}</th>
              <th scope="col">{t("conditions.colStatus")}</th>{canAct && <th scope="col">{t("conditions.colAction")}</th>}
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.text}
                    {c.clear_note && <span className={`block ${small} ${muted}`}>{c.clear_note}{c.evidence_ref ? ` · ${c.evidence_ref}` : ""}</span>}
                  </td>
                  <td>{t(`clearBy.${c.clear_by}` as never)}</td>
                  <td>{c.owner_role ?? "—"}</td>
                  <td>
                    <span className={`status-chip ${COND_CLS[c.status]}`}><span aria-hidden="true">{COND_ICON[c.status]}</span> {t(`conditions.status.${c.status}`)}</span>
                    {c.cleared_by && <span className={`block ${small} ${muted}`}>{t("conditions.by", { by: c.cleared_by, date: (c.cleared_at ?? "").slice(0, 10) })}</span>}
                  </td>
                  {canAct && (
                    <td>
                      {c.status === "open" && (acting?.id === c.id ? (
                        <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); ask(c, acting.mode); }} aria-label={t("conditions.actionLabel", { action: t(`conditions.${acting.mode}`), text: c.text })}>
                          <label className={small}><span className="block">{t("conditions.note")}</span><textarea className="sizing-new-input w-full" rows={2} aria-required="true" value={note} onChange={(e) => setNote(e.target.value)} /></label>
                          {acting.mode === "clear" && (
                            <label className={small}><span className="block">{c.clear_by === "closing" ? t("conditions.evidenceRequired") : t("conditions.evidence")}</span><input className="sizing-new-input w-full" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
                          )}
                          <span className="flex gap-2">
                            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{acting.mode === "clear" ? t("conditions.submitClear") : t("conditions.submitWithdraw")}</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setActing(null)}>{t("conditions.cancel")}</button>
                          </span>
                        </form>
                      ) : (
                        <span className="actions-row">
                          <button type="button" className="btn-ghost btn-sm" aria-label={t("conditions.actionLabel", { action: t("conditions.clear"), text: c.text })} onClick={() => { setActing({ id: c.id, mode: "clear" }); setNote(""); setEvidence(""); }}>{t("conditions.clear")}</button>
                          <button type="button" className="btn-ghost btn-sm" aria-label={t("conditions.actionLabel", { action: t("conditions.withdraw"), text: c.text })} onClick={() => { setActing({ id: c.id, mode: "withdraw" }); setNote(""); setEvidence(""); }}>{t("conditions.withdraw")}</button>
                        </span>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canAct && <p className={`${small} ${muted} mt-1 mb-0`}>{t("conditions.readOnly")}</p>}
      {error && <p role="alert" className={`${small} text-[color:var(--red-fg)] mt-1 mb-0`}>✕ {error}</p>}
      {confirmDialog}
    </section>
  );
}

interface OverrideRow { id: string; procedure_key: string; criterion_id: string; reason: string; issued_by: string; issued_at: string; revoked_at: string | null; revoked_by: string | null }
export interface TriggeredKill { key: string; procedure: string; criterion_id: string; title: string; binding?: boolean; override_id?: string | null }

/** Stop-condition exceptions (project and opportunity): list, issue from the triggered list, revoke. */
export function KillOverridePanel({ entityType, entityId, triggered, canAct, onChanged }: {
  entityType: "project" | "opportunity"; entityId: string; triggered: readonly TriggeredKill[]; canAct: boolean; onChanged: () => void;
}) {
  const t = useTranslations("components.gateIntegrity.overrides");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const base = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(entityId)}/kill-overrides`;
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [showRevoked, setShowRevoked] = useState(false);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId().replace(/:/g, "");
  const load = useCallback(() => {
    api.get<{ overrides: OverrideRow[] }>(`${base}${showRevoked ? "?include_revoked=1" : ""}`).then((r) => setRows(r.data.overrides)).catch(() => setRows([]));
  }, [base, showRevoked]);
  useEffect(() => { load(); }, [load]);
  const active = new Set(rows.filter((r) => !r.revoked_at).map((r) => `${r.procedure_key}|${r.criterion_id}`));
  const candidates = triggered.filter((k) => k.binding !== false && !k.override_id && !active.has(`${k.procedure}|${k.criterion_id}`));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); toast(t("done")); setPick(""); setReason(""); } catch (e) { setError(e instanceof Error ? e.message : ""); } finally { setBusy(false); load(); onChanged(); }
  }
  const visible = rows.length > 0 || triggered.length > 0;
  if (!visible) return null;
  return (
    <section className="market-section sizing-step mt-3" aria-label={t("heading")} data-testid="kill-override-panel">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("heading")}</h3>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("intro")}</p>
      {rows.length === 0 ? <p className={`${small} ${muted}`}>{t("empty")}</p> : (
        <table className="data-table" aria-label={t("heading")}>
          <caption className="sr-only">{t("heading")}</caption>
          <thead><tr><th scope="col">{t("colCriterion")}</th><th scope="col">{t("colReason")}</th><th scope="col">{t("colIssued")}</th>{canAct && <th scope="col">{t("colAction")}</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{triggered.find((k) => k.procedure === r.procedure_key && k.criterion_id === r.criterion_id)?.title ?? `${r.procedure_key} · ${r.criterion_id}`}</td>
                <td className={`${small} ${muted}`}>{r.reason}</td>
                <td className={small}>{t("issuedBy", { by: r.issued_by, date: r.issued_at.slice(0, 10) })}
                  {r.revoked_at && <span className="block"><span className="status-chip status-not-started"><span aria-hidden="true">✕</span> {t("revoked", { by: r.revoked_by ?? "", date: r.revoked_at.slice(0, 10) })}</span></span>}
                </td>
                {canAct && <td>{!r.revoked_at && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => confirm(t("confirmRevoke"), () => void run(() => api.post(`${base}/${encodeURIComponent(r.id)}/revoke`, {})), { confirmLabel: t("revoke"), tone: "danger" })}>{t("revoke")}</button>
                )}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className={`${small} flex items-center gap-2 mt-1`}><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />{t("showRevoked")}</label>
      {canAct && (candidates.length === 0 ? <p className={`${small} ${muted} mt-2`}>{t("none")}</p> : (
        <form className="sizing-new-form mt-2" aria-label={t("issue")} onSubmit={(e) => {
          e.preventDefault();
          const [procedure_key, criterion_id] = pick.split("|");
          if (!procedure_key || !criterion_id || !reason.trim()) { setError(t("needReason")); return; }
          confirm(t("confirmIssue"), () => void run(() => api.post(base, { procedure_key, criterion_id, reason: reason.trim() })), { body: reason.trim(), confirmLabel: tc("record") });
        }}>
          <div className="flex flex-wrap items-end gap-2">
            <label className={small}><span className="block mb-1">{t("pick")}</span>
              <select className="sizing-new-input sizing-new-input-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-required="true">
                <option value="">{t("pickPlaceholder")}</option>
                {candidates.map((k) => <option key={k.key} value={`${k.procedure}|${k.criterion_id}`}>{k.title}</option>)}
              </select>
            </label>
            <label className={`${small} flex-1 min-w-[14rem]`} htmlFor={`${uid}-r`}><span className="block mb-1">{t("reason")}</span>
              <textarea id={`${uid}-r`} className="sizing-new-input w-full" rows={2} aria-required="true" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{t("submit")}</button>
          </div>
        </form>
      ))}
      {error && <p role="alert" className={`${small} text-[color:var(--red-fg)] mt-1 mb-0`}>✕ {error}</p>}
      {confirmDialog}
    </section>
  );
}
