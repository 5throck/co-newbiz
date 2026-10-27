"use client";

// GateSnapshotAck - the acknowledged-GO block shared by the gate decision panel and the proposal confirm page.
// It shows the server-recomputed state of the gate (kill criteria, RAG and its data-confidence cap, validators,
// open items, WACC, waivers, ladder, AI recommendation), lists what a GO must acknowledge with one labelled reason
// per item, and shows binding blocks as a notice that cannot be acknowledged. It decides nothing: the person
// records, the server re-checks every reason.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api.ts";
import {
  type AckProblems, type AckState, type GateSnapshotEnvelope, type GateSnapshotView, type SnapshotRequiredAck,
  groupLead, reasonHint, unassessedProcedures, visibleAckKeys,
} from "../lib/gate-ack-view.ts";
import Link from "next/link";
import { KNOWN_HARD_BLOCKS, advisoryBlocks, enforcedBlocks } from "../lib/gate-integrity-view.ts";

/** Loads the snapshot for one gate; `replace` swaps in the fresh one returned by a 409. */
export function useGateSnapshot(basePath: string, gate: string, briefId: string | null, enabled: boolean) {
  const [env, setEnv] = useState<GateSnapshotEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    const n = ++seq.current;
    setLoading(true);
    const q = `gate=${encodeURIComponent(gate)}${briefId ? `&brief_id=${encodeURIComponent(briefId)}` : ""}`;
    return api.get<GateSnapshotEnvelope>(`${basePath}/gate-snapshot?${q}`)
      .then((r) => { if (n === seq.current) { setEnv(r.data); setFailed(false); } })
      // An unavailable snapshot degrades to the plain form: the server still guards the write.
      .catch(() => { if (n === seq.current) { setEnv(null); setFailed(true); } })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [basePath, gate, briefId, enabled]);
  useEffect(() => { void reload(); }, [reload]);
  const replace = useCallback((next: GateSnapshotEnvelope) => { seq.current++; setEnv(next); setFailed(false); }, []);
  return { env, loading, failed, reload, replace };
}

const CHIP = { green: "status-green", amber: "status-amber", red: "status-red" } as const;

function Chip({ tone, children }: { tone: "green" | "amber" | "red" | "neutral"; children: React.ReactNode }) {
  return <span className={`status-chip ${tone === "neutral" ? "status-not-started" : CHIP[tone]}`}>{children}</span>;
}

/** Compact, read-only summary of the snapshot. */
export function GateSnapshotSummary({ snapshot, gateLabel }: { snapshot: GateSnapshotView; gateLabel: (g: string) => string }) {
  const t = useTranslations("components.gateSnapshot");
  const ti = useTranslations("components.gateIntegrity");
  const tw = useTranslations("components.waccStatus");
  const k = snapshot.kill;
  const rag = snapshot.rag;
  const cap = rag?.data_confidence_cap;
  const grade = (g: string | null | undefined) => (g === "green" || g === "amber" || g === "red" ? t(`grade.${g}`) : t("gradeNone"));
  const tone = (g: string | null | undefined): "green" | "amber" | "red" | "neutral" => (g === "green" || g === "amber" || g === "red" ? g : "neutral");
  return (
    <dl className="grid gap-x-4 gap-y-1 text-[length:var(--fs-caption)] m-0" style={{ gridTemplateColumns: "max-content 1fr" }} aria-label={t("summaryLabel")}>
      <dt className="text-[color:var(--muted-fg)]">{t("sumKill")}</dt>
      <dd className="m-0">
        <Chip tone={k.triggered.length > 0 ? "red" : "neutral"}>{t("killTriggered", { count: k.triggered.length })}</Chip>{" "}
        <Chip tone={k.unassessed.length > 0 ? "amber" : "neutral"}>{t("killUnassessed", { count: k.unassessed.length })}</Chip>{" "}
        <span className="text-[color:var(--muted-fg)]">{t("killInert", { count: k.inert })}</span>
        {k.inert_list.length > 0 && (
          <details className="inline-block ml-1">
            <summary className="cursor-pointer text-[color:var(--accent)]">{t("inertShow")}</summary>
            <ul className="sizing-note-list">{k.inert_list.map((i) => <li key={i.key}>{i.title}</li>)}</ul>
          </details>
        )}
      </dd>
      {rag !== null && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{t("sumRag")}</dt>
          <dd className="m-0">
            <Chip tone={tone(rag.overall)}>{rag.overall ? `● ${grade(rag.overall)}` : t("ragAbsent")}</Chip>
            {cap?.applied && <span className="ml-2">{t("capApplied", { grade: grade(cap.grade) })}</span>}
          </dd>
        </>
      )}
      {snapshot.validators && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{t("sumValidators")}</dt>
          <dd className="m-0">
            <Chip tone={snapshot.validators.missing.length > 0 ? "amber" : "green"}>{t("validatorsDone", { done: snapshot.validators.completed, total: snapshot.validators.applicable })}</Chip>
            {snapshot.validators.missing.length > 0 && <span className="ml-2">{t("validatorsMissing", { list: snapshot.validators.missing.join(", ") })}</span>}
          </dd>
        </>
      )}
      {(snapshot.conditions_open?.length ?? 0) > 0 && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{ti("sumConditions")}</dt>
          <dd className="m-0"><Chip tone="amber">{ti("conditionsOpen", { count: snapshot.conditions_open!.length })}</Chip></dd>
        </>
      )}
      <dt className="text-[color:var(--muted-fg)]">{t("sumOpen")}</dt>
      <dd className="m-0"><Chip tone={snapshot.nonwaivable_open.length > 0 ? "amber" : "neutral"}>{t("openItems", { count: snapshot.nonwaivable_open.length })}</Chip></dd>
      {snapshot.wacc && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{t("sumWacc")}</dt>
          <dd className="m-0"><Chip tone={snapshot.wacc.status === "sourced" ? "green" : snapshot.wacc.status === "assumed" ? "amber" : "red"}>{t(`wacc.${snapshot.wacc.status}`)}</Chip></dd>
        </>
      )}
      <dt className="text-[color:var(--muted-fg)]">{t("sumWaivers")}</dt>
      <dd className="m-0">
        {t("waiversActive", { count: snapshot.waivers.active.length })}
        {snapshot.waivers.expiring_14d.length > 0 && <span className="ml-2"><Chip tone="amber">{t("waiversExpiring", { count: snapshot.waivers.expiring_14d.length })}</Chip></span>}
      </dd>
      {snapshot.ladder.prior_gate && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{t("sumLadder")}</dt>
          <dd className="m-0">
            {gateLabel(snapshot.ladder.prior_gate)} {snapshot.ladder.prior_decision ? snapshot.ladder.prior_decision.toUpperCase() : t("ladderNone")}
            {" "}<Chip tone={snapshot.ladder.effective ? "green" : "amber"}>{snapshot.ladder.effective ? t("ladderOk") : t("ladderOpen")}</Chip>
            {snapshot.ladder.prior_awaiting_countersign && <span className="block mt-1"><Chip tone="amber">{ti("awaiting")}</Chip> {ti("priorAwaiting")}</span>}
          </dd>
        </>
      )}
      {snapshot.ai && (
        <>
          <dt className="text-[color:var(--muted-fg)]">{t("sumAi")}</dt>
          <dd className="m-0">
            {snapshot.ai.recommended ? <Chip tone={snapshot.ai.recommended === "go" ? "green" : snapshot.ai.recommended === "hold" ? "amber" : "red"}>{snapshot.ai.recommended.toUpperCase()}</Chip> : t("aiNone")}
            {snapshot.ai.confidence && <span className="ml-2 text-[color:var(--muted-fg)]">{t("aiConfidence", { value: snapshot.ai.confidence })}</span>}
          </dd>
        </>
      )}
    </dl>
  );
}

/** Title and context line of one required acknowledgement. */
function useAckLabel(snapshot: GateSnapshotView) {
  const t = useTranslations("components.gateSnapshot");
  return (r: SnapshotRequiredAck): { title: string; kindLabel: string } => {
    const kindLabel = t(`kind.${r.kind}` as never);
    const kill = [...snapshot.kill.triggered, ...snapshot.kill.unassessed].find((i) => i.key === r.key.replace(/^kill:/, "") || `kill:${i.key}` === r.key || i.key === r.key);
    if (kill) return { title: kill.title, kindLabel };
    if (r.key === "rag:overall") return { title: t("ackRagRed"), kindLabel };
    if (r.key === "rag:absent") return { title: t("ackRagAbsent"), kindLabel };
    const np = snapshot.nonwaivable_open.find((n) => n.key === r.key);
    if (np) return { title: t("ackOpenItem", { checklist: np.checklist_id, item: np.item_id }), kindLabel };
    return { title: r.criterion_id ?? r.key, kindLabel };
  };
}

export interface DivergenceProps { aiRecommended: string; value: string; onChange: (v: string) => void; required: boolean; problem: string | null }

/** Hard blocks, acknowledgement list and (only when the decision differs from the AI) the divergence reason. */
export function GateAckBlock({ snapshot, state, onChange, problems, decision, divergence, notice, projectId }: {
  projectId?: string;
  snapshot: GateSnapshotView;
  state: AckState;
  onChange: (next: AckState) => void;
  problems: AckProblems | null;
  decision: "go" | "hold" | "kill";
  divergence: DivergenceProps | null;
  /** What changed on a refreshed snapshot (stale recovery). */
  notice: string | null;
}) {
  const t = useTranslations("components.gateSnapshot");
  const te = useTranslations("errors.rationale");
  const uid = useId().replace(/:/g, "");
  const label = useAckLabel(snapshot);
  const isGo = decision === "go";
  const required = snapshot.required_acks;
  const visible = visibleAckKeys(required, state);
  const procs = unassessedProcedures(required).filter((p) => required.filter((r) => r.kind === "kill_unassessed" && r.procedure === p).length > 1);
  const ti = useTranslations("components.gateIntegrity");
  const tw = useTranslations("components.waccStatus");
  const enforced = enforcedBlocks(snapshot.hard_blocks);
  const advisory = advisoryBlocks(snapshot.hard_blocks);
  const hardBlocked = enforced.length > 0;
  const keyTitle = (key: string) => {
    const r = required.find((x) => x.key === key);
    if (r) return label(r).title;
    const k = [...snapshot.kill.triggered, ...snapshot.kill.unassessed].find((i) => i.key === key || `kill:${i.key}` === key);
    return k ? k.title : key;
  };
  const blockText = (code: string, part: "title" | "body") => ti(`hardBlock.${(KNOWN_HARD_BLOCKS as readonly string[]).includes(code) ? code : "kill_binding_unoverridden"}.${part}` as never);
  const blockKeyTitle = (code: string, key: string) => {
    if (code === "condition_open") return snapshot.conditions_open?.find((c) => c.id === key)?.text ?? key;
    if (code === "kill_binding_unoverridden") return keyTitle(key);
    if (code === "wacc_unconfirmed") return tw(`missing.${key}` as never);
    return key;
  };
  const problemFor = (key: string): string | null => {
    if (!problems) return null;
    const weak = problems.weak.find((w) => w.key === key);
    if (weak) return te(weak.reason as never);
    if (problems.invalid.some((i) => i.key === key)) return t("problemInvalid");
    if (problems.missing.includes(key)) return t("problemMissing");
    return null;
  };

  return (
    <div className="mt-3" data-testid="gate-ack-block">
      {notice && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-2">↻ {notice}</p>}
      {isGo && enforced.map((b) => (
        <div key={b.code} role="alert" className="border border-[color:var(--red-fg)] rounded-lg px-3 py-2 mb-2 text-[length:var(--fs-caption)]" data-testid="gate-hard-block" data-block-code={b.code}>
          <p className="font-semibold m-0 text-[color:var(--red-fg)]"><span aria-hidden="true">⛔</span> {blockText(b.code, "title")}</p>
          <p className="m-0 mt-1">{blockText(b.code, "body")}</p>
          <ul className="sizing-note-list" aria-label={ti("hardBlock.listLabel")}>
            {b.keys.map((k) => <li key={`${b.code}:${k}`}>{blockKeyTitle(b.code, k)}</li>)}
          </ul>
          {b.code === "wacc_unconfirmed" && projectId && <p className="m-0 mt-1"><Link className="text-[color:var(--accent)] underline" href={`/projects/${encodeURIComponent(projectId)}/wacc`}>{tw("confirmLink")}</Link></p>}
          <p className="m-0 text-[color:var(--muted-fg)]">{ti("hardBlock.others")}</p>
        </div>
      ))}
      {isGo && advisory.map((b) => (
        <p key={b.code} role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0 mb-2" data-testid="gate-hard-block-advisory">
          ◐ {ti("hardBlock.notEnforced", { title: blockText(b.code, "title") })}
        </p>
      ))}
      {isGo && required.length > 0 && (
        <fieldset className="border border-[color:var(--border)] rounded-lg px-3 py-2 m-0" data-testid="gate-ack-list">
          <legend className="text-[length:var(--fs-caption)] font-semibold px-1">{t("ackLegend", { count: visible.length })}</legend>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0 mb-2">{t("ackIntro")}</p>
          {procs.map((p) => (
            <label key={p} className="flex items-center gap-2 text-[length:var(--fs-caption)] mb-2">
              <input
                type="checkbox"
                checked={!!state.shared[p]}
                onChange={(e) => onChange({ ...state, shared: { ...state.shared, [p]: e.target.checked } })}
              />
              <span>{t("shareReason", { procedure: p })}</span>
            </label>
          ))}
          <ul className="list-none p-0 m-0 grid gap-3">
            {visible.map((r) => {
              const id = `${uid}-${r.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
              const reason = state.reasons[r.key] ?? "";
              const hint = reasonHint(reason);
              const server = problemFor(r.key);
              const msg = server ?? (hint ? te(hint) : null);
              const l = label(r);
              const sharedCount = r.kind === "kill_unassessed" && r.procedure && state.shared[r.procedure]
                ? required.filter((x) => x.kind === "kill_unassessed" && x.procedure === r.procedure).length : 0;
              return (
                <li key={r.key}>
                  <label htmlFor={id} className="block text-[length:var(--fs-caption)]">
                    <span className="status-chip status-not-started mr-1">{l.kindLabel}</span>
                    <strong>{sharedCount > 1 ? t("sharedTitle", { procedure: r.procedure ?? "", count: sharedCount }) : l.title}</strong>
                    {r.action && sharedCount <= 1 && <span className="text-[color:var(--muted-fg)]"> · {t("actionLabel", { action: r.action })}</span>}
                    <span aria-hidden="true"> *</span>
                  </label>
                  <textarea
                    id={id}
                    className="sizing-new-input w-full mt-1"
                    rows={2}
                    aria-required="true"
                    aria-invalid={msg ? true : undefined}
                    aria-describedby={msg ? `${id}-msg` : undefined}
                    value={reason}
                    onChange={(e) => onChange({ ...state, reasons: { ...state.reasons, [r.key]: e.target.value } })}
                  />
                  {msg && <p id={`${id}-msg`} role={server ? "alert" : undefined} className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] m-0 mt-1">✕ {msg}</p>}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {isGo && required.length === 0 && !hardBlocked && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">{t("noAckNeeded")}</p>
      )}
      {divergence && (
        <div className="mt-3">
          <label htmlFor={`${uid}-divergence`} className="block text-[length:var(--fs-caption)]">
            <span className="block mb-1">{t(divergence.required ? "divergenceLabelRequired" : "divergenceLabelOptional", { ai: divergence.aiRecommended.toUpperCase() })}</span>
          </label>
          <textarea
            id={`${uid}-divergence`}
            className="sizing-new-input w-full"
            rows={2}
            aria-required={divergence.required}
            aria-invalid={divergence.problem ? true : undefined}
            aria-describedby={divergence.problem ? `${uid}-divergence-msg` : undefined}
            value={divergence.value}
            onChange={(e) => divergence.onChange(e.target.value)}
          />
          {divergence.problem && <p id={`${uid}-divergence-msg`} role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] m-0 mt-1">✕ {divergence.problem}</p>}
        </div>
      )}
    </div>
  );
}

export { groupLead };
