"use client";

// S5ConnectBlock - S8 `S5 연결` status + human-only actions at the top of the 설명·생성·권고 tab
// (Green Field only; decider feedback 2026-10-16, ADR-0178 follow-up). Shows where the S8
// investment numbers come from (S5 amounts vs ratio assumptions), the S5 simulation state and the
// pin's stale state. Amendment 2026-10-16: the pinned reference is the DEFAULT - the block reads
// `연결됨 (기본)`, and a person's revert keeps the copy (`복사본 (사람이 되돌림)`) with the connect
// button still available for re-linking or refreshing to the latest S5. Nothing runs automatically
// here; existing cases are never recalculated - the block always says that `자동 생성` has to be
// run again. Decision support only.

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../crud.tsx";
import { useTranslations } from "next-intl";
import {
  BASIS_LABEL,
  s5BasisHintKey,
  s5LinkageOf,
  s5ScopeNoteKeys,
  s5SourceLineParts,
  type InvestmentBasisKey,
} from "../../lib/s5-linkage-labels.ts";

interface PinView {
  path: "copy" | "pinned";
  optedIn: boolean;
  reverted?: boolean;
  pin: { id: string; planHash: string; pinnedAt: string; pinnedBy: string; reason: "initial" | "repin"; s5SimRunId: string | null } | null;
  state: "not_applicable" | "in_effect" | "stale";
  stale: boolean;
  reasons: string[];
}
interface ConnectView {
  sim: { state: "none" | "unconfirmed" | "confirmed" | "in_effect" | "stale"; staleReason: string | null; label: string; nextStep: string | null };
  run: { id: string; drawCount: number } | null;
}
interface ParamsResponse {
  params: { investmentBasis: InvestmentBasisKey; opexRatio: number; capexRatio: number; initialInvestmentRatio: number };
  s5_pin?: PinView | null;
  s5_connect?: ConnectView | null;
  track?: string | null;
  s5_pin_capex_total_krw_m?: number | null;
}
interface PlanSummary { totals: { capex: number; labor_opex: number; gov_rnd: number; staffing: number }; s5_sim_run_id: string | null }
interface ConnectPreview {
  import: { importable: number; manual_lines: number; capability_lines: number; skipped: Array<{ line: string; reason: string }> };
  pin: { has_pin: boolean; pinned: PlanSummary | null; current: PlanSummary; changed: boolean };
  confirmed_run_exists: boolean;
  current: { investment_basis: InvestmentBasisKey; s5_source: 0 | 1 };
  will_set: { investment_basis: "s5_plan" | null; s5_source: 1 };
}

const PIN_STALE_REASON = (tr: TranslatorFn): Record<string, string> => ({
  source_changed: "stages.s8.s5ConnectBlock.theS5InvestmentPlanStaffing",
  newer_confirmed_run: "stages.s8.s5ConnectBlock.anS5InvestmentSimulationWas",
  pinned_run_superseded: "stages.s8.s5ConnectBlock.theFixedS5SimulationRun",
  case_on_older_pin: "stages.s8.s5ConnectBlock.theMostRecentCaseWas",
});
const SIM_STALE_REASON = (tr: TranslatorFn): Record<string, string> => ({
  run_confirmed_after_generation: "stages.s8.s5ConnectBlock.theS5InvestmentSimulationWas",
  run_changed: "stages.s8.s5ConnectBlock.theConfirmedS5SimulationRun",
  s5_lines_changed: "stages.s8.s5ConnectBlock.theS5InvestmentPlanOr",
  run_missing: "stages.s8.s5ConnectBlock.theConfirmedS5SimulationRun2",
});
const SKIP_REASON = (tr: TranslatorFn): Record<string, string> => ({
  unit_unconfirmed: "stages.s8.s5ConnectBlock.unitUnconfirmed",
  currency_non_krw: "stages.s8.s5ConnectBlock.currency",
  invalid_line: "stages.s8.s5ConnectBlock.missingNameOrClassification",
  capability_unreflected_or_unpriced: "stages.s8.s5ConnectBlock.capabilitiesNotReflectedOrWithout",
});
const fmt = (n: number): string => Math.round(n).toLocaleString("ko-KR");

export function S5ConnectBlock({ projectId, canAct, onChanged }: { projectId: string; canAct: boolean; onChanged?: () => void }) {const tr = useTranslations(); const t = useTranslations("stages.s8.s5ConnectBlock"); const tc = useTranslations("common");
  const [data, setData] = useState<ParamsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const base = `/api/projects/${encodeURIComponent(projectId)}/business-case`;

  const load = useCallback(async () => {
    try {
      setData((await api.get<ParamsResponse>(`${base}/params`)).data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("failedToLoadTheS5"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  if (!data || data.track !== "greenfield") return null;
  const basis = data.params.investmentBasis;
  const pin = data.s5_pin ?? null;
  const link = s5LinkageOf(basis, pin?.path);
  const conn = data.s5_connect ?? null;
  const hintKey = s5BasisHintKey(basis);
  const pinned = pin?.path === "pinned";
  // 2026-10-16: the plan S8 uses carries no capex line at all — display-only warning.
  const capexZero = pinned && data.s5_pin_capex_total_krw_m === 0;
  const stale = !!pin?.pin && pin.state === "stale";
  const next = t("casesAlreadyGeneratedAreNot");

  function done(text: string) {
    setMsg(text); setErr(null);
    void load();
    onChanged?.();
  }

  async function startConnect() {
    setMsg(null); setErr(null); setBusy(true);
    try {
      const pv = (await api.get<{ preview: ConnectPreview }>(`${base}/s5-connect`)).data.preview;
      const skipped = pv.import.skipped.length > 0
        ? t("itemsNotImportedP1P2", { p1: pv.import.skipped.length, p2: pv.import.skipped.map((k) => `${k.line} (${SKIP_REASON(tr)[k.reason] ?? k.reason})`).join(", ") })
        : t("nothingIsLeftUnimported");
      const run = pv.confirmed_run_exists ? t("aConfirmedS5InvestmentSimulation") : t("noConfirmedS5InvestmentSimulation");
      const d = pv.pin.current.totals;
      const totals = t("s5PlanTotalKrwMillions", { p1: fmt(d.capex), p2: fmt(d.labor_opex), p3: fmt(d.gov_rnd) });
      const change = [
        pv.pin.has_pin ? t("refreshTheS5FixedReference") : t("createdTheS5FixedReference"),
        pv.will_set.investment_basis ? t("changeTheInvestmentBasisFrom", { p1: tr(BASIS_LABEL[pv.current.investment_basis]) }) : t("keepTheInvestmentBasisAs", { p1: tr(BASIS_LABEL[pv.current.investment_basis]) }),
        t("setTheS5PlanSource"),
      ].join(" / ");
      confirm(t("linkToS5"), () => {
        void (async () => {
          setBusy(true);
          try {
            await api.post(`${base}/s5-connect`, {});
            done(t("linkedToS5CasesAlready"));
          } catch (e) {
            setErr(e instanceof Error ? e.message : t("failedToLinkToS5"));
          } finally {
            setBusy(false);
          }
        })();
      }, {
        body: t("itemsToImportP1P2P3P4P5P6P7P8", { p1: pv.import.importable, p2: pv.import.manual_lines, p3: pv.import.capability_lines, p4: skipped, p5: run, p6: totals, p7: change, p8: next }),
        confirmLabel: tc("link"),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("couldNotVerifyAnS5"));
    } finally {
      setBusy(false);
    }
  }

  async function startUpdate() {
    setMsg(null); setErr(null); setBusy(true);
    try {
      const pv = (await api.get<{ preview: ConnectPreview }>(`${base}/s5-connect`)).data.preview;
      const dl = (a: number | undefined, b: number): string => (a === undefined ? fmt(b) : `${fmt(a)} → ${fmt(b)}`);
      const p = pv.pin.pinned?.totals; const c = pv.pin.current.totals;
      const diff = t("totalKrwMillionsCapexP1", { p1: dl(p?.capex, c.capex), p2: dl(p?.labor_opex, c.labor_opex), p3: dl(p?.gov_rnd, c.gov_rnd) });
      confirm(t("refreshFromLatestS5"), () => {
        void (async () => {
          setBusy(true);
          try {
            await api.post(`${base}/s5-pin`, {});
            done(t("theS5FixedReferenceWas"));
          } catch (e) {
            setErr(e instanceof Error ? e.message : t("failedToRefreshTheS5"));
          } finally {
            setBusy(false);
          }
        })();
      }, {
        body: t("p1RefreshingKeepsTheCurrent", { p1: diff, p2: next }),
        confirmLabel: t("refresh"),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("couldNotVerifyTheS5"));
    } finally {
      setBusy(false);
    }
  }

  function startDisconnect() {
    setMsg(null); setErr(null);
    confirm(t("revertToTheCopy"), () => {
      void (async () => {
        setBusy(true);
        try {
          await api.post(`${base}/s5-disconnect`, {});
          done(t("revertedToUsingTheCopy"));
        } catch (e) {
          setErr(e instanceof Error ? e.message : t("failedToRevertToThe"));
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: t("switchesThePlanToThe", { p1: next }),
      confirmLabel: t("revert"),
      tone: "danger",
    });
  }

  const simChip = conn?.sim.state === "stale" ? "status-amber" : conn?.sim.state === "in_effect" ? "status-green" : "status-gray";
  const connectable = link !== "pinned";
  return (
    <section className="market-section sizing-step mb-3" aria-label={t("s5Link")} data-testid="s8-s5-connect-block">
      {confirmDialog}
      <h3 className="sizing-step-title">{t("s5Link2")} <span className="status-chip status-info">{t("checkWhetherInvestmentAmountsAre")}</span></h3>
      <ul className="sizing-note-list" style={{ listStyle: "none", paddingLeft: 0 }}>
        <li data-testid="s8-s5-connect-source">
          <b>{t("investmentSources")}</b>{" "}
          <span className={`status-chip ${link === "pinned" ? "status-green" : link === "ratio" ? "status-amber" : "status-gray"}`}>
            {link === "pinned" ? t("linkedDefault") : link === "ratio" ? t("notLinked") : pin?.reverted ? t("copyRevertedByAPerson") : t("copy")}
          </span>{" "}
          {(() => { const part = s5SourceLineParts(link, pin?.pin ?? null, data.params); return tr(part.key, part.params); })()}
        </li>
        <li data-testid="s8-s5-connect-basis">
          <b>{t("activeInvestmentBasis")}</b> {tr(BASIS_LABEL[basis] ?? basis)}
          {hintKey && <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]"> — {tr(hintKey)}</span>}
        </li>
        <li data-testid="s8-s5-connect-sim">
          <b>{t("s5InvestmentSimulation")}</b>{" "}
          <span className={`status-chip ${simChip}`}>{conn?.sim.state === "stale" && <span aria-hidden="true">⏱ </span>}{conn?.sim.label ?? "—"}</span>
          {conn?.sim.state === "stale" && conn.sim.staleReason && <> {SIM_STALE_REASON(tr)[conn.sim.staleReason] ?? conn.sim.staleReason}.</>}
          {conn?.sim.nextStep && (
            <> {t("nextStep")} {link === "ratio" && conn.sim.state !== "stale"
              ? t("theInvestmentBasisIsRatio")
              : conn.sim.nextStep}</>
          )}
        </li>
        {pin?.pin && (
          <li data-testid="s8-s5-connect-pin">
            <b>{t("fixedReferenceStatus")}</b>{" "}
            <span className={`status-chip ${stale ? "status-amber" : "status-green"}`}>{stale && <span aria-hidden="true">⏱ </span>}{stale ? t("needed") : t("latest")}</span>
            {stale && <> {pin.reasons.map((r) => PIN_STALE_REASON(tr)[r] ?? r).join(" · ")}.</>}
            {!pinned && <> {t("notCurrentlyInUseUsing")}</>}
          </li>
        )}
        {capexZero && (
          <li data-testid="s8-s5-connect-capex-warning" role="note">
            <span className="status-chip status-amber"><span aria-hidden="true">⚠</span> {t("noCapex")}</span>{" "}
            {t("theS5PlanHasNo")}
          </li>
        )}
        <li data-testid="s8-s5-connect-scope" className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{s5ScopeNoteKeys(basis).map((k) => tr(k)).join("")}</li>
      </ul>

      {canAct && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="s8-s5-connect-actions">
          {connectable && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-button" disabled={busy} onClick={() => void startConnect()}>{t("linkToS52")}</button>
          )}
          {pinned && stale && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-update-button" disabled={busy} onClick={() => void startUpdate()}>{t("refreshFromLatestS52")}</button>
          )}
          {pinned && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-disconnect-button" disabled={busy} onClick={startDisconnect}>{t("revertToTheCopy2")}</button>
          )}
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("aPersonRunsItDirectly")}</span>
        </div>
      )}
      {msg && <p role="status" data-testid="s8-s5-connect-result" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mt-1">✓ {msg}</p>}
      {err && <p role="alert" data-testid="s8-s5-connect-error" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {err}</p>}
    </section>
  );
}
