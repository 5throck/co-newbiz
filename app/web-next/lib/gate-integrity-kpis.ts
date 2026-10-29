// @version 1.0.0
/**
 * Gate-integrity KPIs G1-G12 - ADR-0186 P5, docs/governance/governance-operations.md section 4.1.
 *
 * One pure reader over the database (READ-ONLY, aggregate counts only: no rationale text, no project ids, nothing an
 * information wall could hide). Every KPI returns the same envelope:
 *   { id, name, li, li_families, period, value, numerator, denominator, rate, breach: { breached, reasons[] }, note? }
 * `breach.breached` evaluates the documented trigger of the KPI; `null` rate means the denominator is 0.
 * Where the shipped schema differs from the governance table the shipped schema wins (decided_at, not created_at;
 * acknowledgements live in gate_decision_snapshot.acknowledgements_json).
 */
import type { Database } from "bun:sqlite";
import { GATE_INTEGRITY_FAMILIES, gateIntegrityMode } from "../../../db/lib/gate-integrity-flags.ts";
import { buildBreach, familyStatus, type BreachItem, type FamilyStatus } from "./gate-integrity-readiness.ts";
import { resolveWaccConfirmation } from "../../../db/lib/wacc-confirmation.ts";
import { isMandatoryChecklistItem } from "./dd-checklist-tailor.ts";
import { validateRationale } from "./rationale-check.ts";
import { CODE_FAMILY, buildShadowReport, missingNeeds, pendingEntry, NEED, type SchemaNeed, type MigrationPending, unappliedGateIntegrityMigrations } from "../../../scripts/co-newbiz/gate-integrity-shadow-report.ts";

export const KPI_GATES = ["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"] as const;
const DAY = 86_400_000;

/** `reasons` = English fallback text; `items` = the same findings as structured codes + params (parallel arrays) for the UI to localize. */
export interface Breach { breached: boolean; reasons: string[]; items: BreachItem[] }
export interface Kpi {
  id: string;
  name: string;
  li: boolean;
  li_families: string[];
  period: { from: string; to: string };
  value: unknown;
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  breach: Breach;
  /** ok = computed; migration_pending = the database lacks a gate-integrity migration this KPI needs; unavailable = read failed. */
  status: "ok" | "migration_pending" | "unavailable";
  migration_pending?: MigrationPending;
  note?: string;
}
export interface KpiResponse {
  generated_at: string;
  period: { from: string; to: string; prior_from: string; prior_to: string };
  gate: string | null;
  unapplied_migrations: string[];
  /** Per rule family: current mode (server-side flag resolution) and the shadow-to-enforce readiness verdict. */
  families: FamilyStatus[];
  kpis: Kpi[];
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 10_000) / 10_000);
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
/** Weekdays between two instants (Mon-Fri), fractional days not counted. */
export function businessDays(fromIso: string, toIso: string): number {
  let n = 0;
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}
const ok = (): Breach => ({ breached: false, reasons: [], items: [] });
type Found = Array<readonly [import("./gate-integrity-readiness.ts").BreachCode, Record<string, string | number>, string]>;

interface DecisionRow {
  id: string; entity_type: string; entity_id: string; gate: string; decision: string; decided_by: string; decided_at: string;
  ai: string | null; divergence_reason: string | null; has_snapshot: number; ack_json: string | null; snapshot_json: string | null;
}

function decisionsIn(db: Database, from: string, to: string, gate: string | null): DecisionRow[] {
  return db
    .query(
      `SELECT g.id, g.entity_type, g.entity_id, g.gate, g.decision, g.decided_by, g.decided_at,
              g.ai_recommended_decision AS ai, g.divergence_reason, (n.decision_id IS NOT NULL) AS has_snapshot,
              n.acknowledgements_json AS ack_json, n.snapshot_json
       FROM gate_decision g
       LEFT JOIN gate_decision_snapshot n ON n.decision_id = g.id
       WHERE g.decided_at >= ? AND g.decided_at < ? AND (? IS NULL OR g.gate = ?)
         AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
       ORDER BY g.decided_at, g.id`,
    )
    .all(from, to, gate, gate) as DecisionRow[];
}

/** Latest decision per (entity, gate) inside the window. */
function latestPerEntityGate(rows: DecisionRow[]): DecisionRow[] {
  const m = new Map<string, DecisionRow>();
  for (const r of rows) m.set(`${r.entity_type}:${r.entity_id}:${r.gate}`, r);
  return [...m.values()];
}

function mixByGate(rows: DecisionRow[]) {
  const out: Record<string, { go: number; hold: number; kill: number; total: number; legacy: number; go_share: number | null }> = {};
  for (const r of latestPerEntityGate(rows)) {
    const g = (out[r.gate] ??= { go: 0, hold: 0, kill: 0, total: 0, legacy: 0, go_share: null });
    if (r.decision === "go" || r.decision === "hold" || r.decision === "kill") g[r.decision] += 1;
    g.total += 1;
    if (!r.has_snapshot) g.legacy += 1;
  }
  for (const g of Object.values(out)) g.go_share = rate(g.go, g.total);
  return out;
}

export function buildGateIntegrityKpis(db: Database, o: { from: string; to: string; gate?: string | null; now?: string; minWrites?: number; env?: Record<string, string | undefined> }): KpiResponse {
  const now = o.now ?? new Date().toISOString();
  const gate = o.gate ?? null;
  const period = { from: o.from, to: o.to };
  const span = Date.parse(o.to) - Date.parse(o.from);
  const priorFrom = new Date(Date.parse(o.from) - 28 * DAY).toISOString();
  const priorTo = o.from;
  void span;
  // lazy: the decision tables of an unmigrated DB are only touched by sections that need them (guarded by `section`)
  const lazy = <T,>(f: () => T) => { let v: T | undefined; let done = false; return () => { if (!done) { v = f(); done = true; } return v as T; }; };
  const curRows = lazy(() => decisionsIn(db, o.from, o.to, gate));
  const priorRows = lazy(() => decisionsIn(db, priorFrom, priorTo, gate));
  const kpis: Kpi[] = [];
  const add = (k: Omit<Kpi, "period" | "status"> & { period?: Kpi["period"] }) => kpis.push({ period, status: "ok", ...k });
  const section = (id: string, name: string, li: boolean, fams: string[], needs: readonly SchemaNeed[], body: () => void) => {
    const base = { id, name, li, li_families: fams, period, value: null, numerator: null, denominator: null, rate: null, breach: ok() };
    const missing = missingNeeds(db, needs);
    if (missing.length > 0) { kpis.push({ ...base, status: "migration_pending", migration_pending: pendingEntry(id, missing) }); return; }
    const before = kpis.length;
    try { body(); } catch (e) {
      kpis.length = before;
      kpis.push({ ...base, status: "unavailable", note: `could not be computed: ${e instanceof Error ? e.message.slice(0, 160) : "read failed"}` });
    }
  };
  let rep: ReturnType<typeof buildShadowReport> | null = null;
  const g12ByFamily: Record<string, { cleanDays: number; decisions: number; wouldBlocks14d: number }> = {};

  section("G1", "GO/HOLD/KILL mix", false, [], [NEED.snapshot, NEED.aiColumn], () => {
    const mix = mixByGate(curRows());
    const priorMix = mixByGate(priorRows());
    const found: Found = [];
    for (const [g, m] of Object.entries(mix)) {
      if (m.total >= 10 && (m.go_share ?? 0) > 0.95) found.push(["go_share_high", { gate: g, pct: Math.round(100 * (m.go_share ?? 0)), total: m.total }, `${g}: GO share ${(100 * (m.go_share ?? 0)).toFixed(0)}% over ${m.total} decisions`]);
      const p = priorMix[g];
      if (p && p.total > 0 && m.go_share !== null && p.go_share !== null && Math.abs(m.go_share - p.go_share) > 0.3) found.push(["go_share_shift", { gate: g, points: Math.round(100 * Math.abs(m.go_share - p.go_share)) }, `${g}: GO share moved ${(100 * Math.abs(m.go_share - p.go_share)).toFixed(0)} points versus the prior 4 weeks`]);
    }
    const all = Object.values(mix);
    const total = all.reduce((n, m) => n + m.total, 0);
    add({ id: "G1", name: "GO/HOLD/KILL mix", li: false, li_families: [], value: { by_gate: mix, prior_4_weeks_by_gate: priorMix }, numerator: all.reduce((n, m) => n + m.go, 0), denominator: total, rate: rate(all.reduce((n, m) => n + m.go, 0), total), breach: buildBreach(found), note: "numerator/denominator = GO decisions / latest decisions per entity and gate; legacy = no snapshot row" });
  });
  section("G2", "AI-vs-human divergence rate", false, [], [NEED.snapshot, NEED.aiColumn], () => {
    const withAi = curRows().filter((r) => r.ai !== null);
    const div = withAi.filter((r) => r.ai !== r.decision);
    const r = rate(div.length, withAi.length);
    const found: Found = [];
    if (withAi.length >= 10 && r !== null && (r > 0.4 || r === 0)) found.push(r === 0 ? ["divergence_zero", { total: withAi.length }, "0% divergence over 10 or more decisions"] : ["divergence_high", { pct: Math.round(100 * r) }, `divergence ${(100 * r).toFixed(0)}% above 40%`]);
    add({ id: "G2", name: "AI-vs-human divergence rate", li: false, li_families: [], value: { divergent: div.length, with_recommendation: withAi.length }, numerator: div.length, denominator: withAi.length, rate: r, breach: buildBreach(found) });
  });
  section("G3", "Divergence-reason presence", true, ["divergence"], [NEED.snapshot, NEED.aiColumn], () => {
    const div = curRows().filter((r) => r.ai !== null && r.ai !== r.decision && r.decision === "go");
    const good = div.filter((r) => r.divergence_reason && validateRationale(r.divergence_reason, "decision").ok);
    const wb = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_integrity.would_block:divergence_reason_required' AND created_at >= ? AND created_at < ?").get(o.from, o.to) as { c: number }).c;
    const shortfall = div.length - good.length;
    add({ id: "G3", name: "Divergence-reason presence", li: true, li_families: ["divergence"], value: { shortfall, would_block_divergence_reason_required: wb }, numerator: good.length, denominator: div.length, rate: rate(good.length, div.length), breach: buildBreach([...(shortfall > 0 ? [["divergence_reason_missing", { count: shortfall }, `${shortfall} divergent GO without a passing reason`] as const] : []), ...(wb > 0 ? [["would_block_events", { count: wb }, `${wb} would-block events`] as const] : [])]), note: "GO decisions only (the enforced set); HOLD/KILL reasons are optional" });
  });
  section("G4", "Acknowledgements per kind", false, [], [NEED.snapshot, NEED.aiColumn], () => {
    const byKind: Record<string, Record<string, number>> = {};
    const reasonUse = new Map<string, Set<string>>();
    let total = 0;
    for (const r of curRows()) {
      if (!r.ack_json) continue;
      let acks: Array<{ kind?: string; reason?: string }> = [];
      try { acks = JSON.parse(r.ack_json); } catch { continue; }
      for (const a of acks) {
        const k = (byKind[r.gate] ??= {});
        k[a.kind ?? "other"] = (k[a.kind ?? "other"] ?? 0) + 1;
        total += 1;
        if (a.reason) (reasonUse.get(a.reason) ?? reasonUse.set(a.reason, new Set()).get(a.reason)!).add(r.id);
      }
    }
    const reused = [...reasonUse.values()].filter((s) => s.size > 5).length;
    const rej = (db.query("SELECT COUNT(*) c FROM audit_log WHERE (action = 'gate_integrity.would_block:rationale_insufficient' OR action LIKE '%.refused:rationale_insufficient') AND created_at >= ? AND created_at < ?").get(o.from, o.to) as { c: number }).c;
    const found: Found = [];
    if (total > 0 && rej / total > 0.1) found.push(["rationale_rejections_high", { rejections: rej, total }, `rationale-substance rejections ${rej} exceed 10% of ${total} acknowledgements`]);
    if (reused > 0) found.push(["ack_reason_reused", { count: reused }, `${reused} acknowledgement reason text(s) reused across more than 5 decisions`]);
    add({ id: "G4", name: "Acknowledgements per kind", li: false, li_families: [], value: { by_gate_and_kind: byKind, rationale_rejections: rej, reused_reason_texts: reused }, numerator: rej, denominator: total, rate: rate(rej, total), breach: buildBreach(found), note: "rate = substance rejections (any rationale_insufficient event in the window, an upper bound for acknowledgements) / acknowledgements" });
  });
  section("G5", "Unassessed kill-criteria share at GO", true, ["kill_binding", "snapshot_ack"], [NEED.snapshot, NEED.aiColumn], () => {
    const per: Record<string, { unassessed: number; applicable: number; share: number | null }> = {};
    for (const r of curRows()) {
      if (r.decision !== "go" || !r.snapshot_json) continue;
      try {
        const k = (JSON.parse(r.snapshot_json) as { kill?: { evaluated?: number; unassessed?: unknown[] } }).kill;
        if (!k) continue;
        const p = (per[r.gate] ??= { unassessed: 0, applicable: 0, share: null });
        p.unassessed += k.unassessed?.length ?? 0;
        p.applicable += (k.evaluated ?? 0);
      } catch { /* unreadable snapshot ignored */ }
    }
    const found: Found = [];
    for (const [g, p] of Object.entries(per)) { p.share = rate(p.unassessed, p.applicable); if (p.share !== null && p.share > 0.25) found.push(["unassessed_high", { gate: g, pct: Math.round(100 * p.share) }, `${g}: ${(100 * p.share).toFixed(0)}% unassessed`]); }
    const n = Object.values(per).reduce((a, p) => a + p.unassessed, 0);
    const d = Object.values(per).reduce((a, p) => a + p.applicable, 0);
    add({ id: "G5", name: "Unassessed kill-criteria share at GO", li: true, li_families: ["kill_binding", "snapshot_ack"], value: { by_gate: per }, numerator: n, denominator: d, rate: rate(n, d), breach: buildBreach(found) });
  });
  section("G6", "would_block counts (shadow)", true, [...GATE_INTEGRITY_FAMILIES], [], () => {
    rep = buildShadowReport(db as never, { from: o.from, to: o.to, now });
    const weekOf = (day: string) => { const t = Date.parse(`${day}T00:00:00Z`); const dow = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - dow * DAY).toISOString().slice(0, 10); };
    const byFam: Record<string, Record<string, Record<string, number>>> = {};
    let total = 0;
    for (const r of rep!.rows) {
      if (r.kind !== "would_block") continue;
      const w = weekOf(r.day);
      const f = ((byFam[r.family] ??= {})[r.code] ??= {});
      f[w] = (f[w] ?? 0) + r.count;
      total += r.count;
    }
    add({ id: "G6", name: "would_block counts (shadow)", li: true, li_families: [...GATE_INTEGRITY_FAMILIES], value: { by_family_code_week: byFam, explained: null, unexplained: total }, numerator: total, denominator: null, rate: null, breach: buildBreach(total > 0 ? [["would_block_unexplained", { count: total }, `${total} would-block event(s); all count as unexplained until a reviewer ties them to a fixture, legacy record or fixed defect`] as const] : []), note: "the explained/unexplained flag is a reviewer act and is not stored; every event is reported as unexplained" });
  });
  section("G7", "Countersign latency and pending count", false, ["maker_checker"], [NEED.chainDecision, NEED.cutoff, NEED.grants], () => {
    const rows = db
      .query(
        `SELECT g.decided_at AS made, a.decided_at AS signed FROM approval_chain a JOIN gate_decision g ON g.id = a.gate_decision_id
         WHERE a.status IN ('approved','conditional') AND a.decided_at >= ? AND a.decided_at < ? AND (? IS NULL OR g.gate = ?)`,
      )
      .all(o.from, o.to, gate, gate) as Array<{ made: string; signed: string }>;
    const bd = rows.map((r) => businessDays(r.made, r.signed));
    const hours = rows.map((r) => (Date.parse(r.signed) - Date.parse(r.made)) / 3_600_000);
    const pending = db
      .query(
        `SELECT g.decided_at AS made FROM gate_decision g
         WHERE g.entity_type = 'project' AND g.gate IN ('entity_ic','group_ic') AND g.decision = 'go' AND (? IS NULL OR g.gate = ?)
           AND g.rowid > COALESCE((SELECT max_decision_rowid FROM gate_integrity_cutoff WHERE name = 'maker_checker'), 0)
           AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
           AND NOT EXISTS (SELECT 1 FROM gate_decision h WHERE h.entity_type = 'project' AND h.entity_id = g.entity_id AND h.gate = g.gate AND (h.decided_at > g.decided_at OR (h.decided_at = g.decided_at AND h.id > g.id)))
           AND NOT EXISTS (SELECT 1 FROM approval_chain a WHERE a.gate_decision_id = g.id AND a.status IN ('approved','conditional','rejected','withdrawn_pending_resubmission'))`,
      )
      .all(gate, gate) as Array<{ made: string }>;
    const pendingOld = pending.filter((p) => businessDays(p.made, now) > 5).length;
    const p90 = pct(bd, 0.9);
    const found: Found = [];
    if (pendingOld > 0) found.push(["countersign_pending_old", { count: pendingOld }, `${pendingOld} decision(s) pending a countersign for more than 5 business days`]);
    if (p90 !== null && p90 > 10) found.push(["countersign_slow", { days: p90 }, `p90 countersign latency ${p90} business days exceeds 10`]);
    const holders = db.query("SELECT role_key, COUNT(DISTINCT user_id) c FROM app_user_human_role h WHERE revoked_at IS NULL GROUP BY role_key").all() as Array<{ role_key: string; c: number }>;
    for (const r of ["entity-ic-reviewer", "group-ic-reviewer"]) if ((holders.find((h) => h.role_key === r)?.c ?? 0) < 2) found.push(["reviewer_holders_low", { role: r }, `${r} has fewer than 2 active holders (O-1 not met)`]);
    add({ id: "G7", name: "Countersign latency and pending count", li: false, li_families: ["maker_checker"], value: { median_hours: median(hours), p90_hours: pct(hours, 0.9), median_business_days: median(bd), p90_business_days: p90, countersigned: rows.length, pending: pending.length, pending_over_5_business_days: pendingOld, holders: Object.fromEntries(holders.map((h) => [h.role_key, h.c])) }, numerator: pending.length, denominator: pending.length + rows.length, rate: rate(pending.length, pending.length + rows.length), breach: buildBreach(found), note: "numerator = pending now (not period-bound), denominator = pending + countersigned in the period" });
  });
  section("G8", "Open condition precedents and age", false, [], [NEED.conditions], () => {
    const open = db.query("SELECT id, project_id, gate, clear_by, created_at FROM condition_precedent WHERE status = 'open'").all() as Array<{ id: string; project_id: string; gate: string; clear_by: string; created_at: string }>;
    const older = open.filter((c) => Date.parse(now) - Date.parse(c.created_at) > 30 * DAY).length;
    const reached = open.filter((c) => c.clear_by === "group_ic" && db.query("SELECT 1 FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = 'group_ic' LIMIT 1").get(c.project_id)).length;
    const found: Found = [];
    if (older > 0) found.push(["conditions_old", { count: older }, `${older} open condition(s) older than 30 days`]);
    if (reached > 0) found.push(["group_ic_conditions_open", { count: reached }, `${reached} open group_ic condition(s) at a reached group_ic gate`]);
    const ages = open.map((c) => (Date.parse(now) - Date.parse(c.created_at)) / DAY);
    add({ id: "G8", name: "Open condition precedents and age", li: false, li_families: [], value: { open: open.length, older_than_30_days: older, past_clear_by_gate: reached, oldest_age_days: ages.length ? Math.round(Math.max(...ages)) : null }, numerator: older, denominator: open.length, rate: rate(older, open.length), breach: buildBreach(found), note: "open conditions are a current snapshot; past-clear-by is evaluated for group_ic (the gate whose reach is recorded)" });
  });
  section("G9", "Waiver count and age", false, ["waiver"], [], () => {
    const ws = db.query("SELECT clause_ref, status, approved_at, expires_at FROM waiver").all() as Array<{ clause_ref: string; status: string; approved_at: string | null; expires_at: string }>;
    const active = ws.filter((w) => w.status === "active" && w.approved_at && w.expires_at > now);
    const expired = ws.filter((w) => (w.status === "active" || w.status === "expired") && w.expires_at <= now);
    const horizon = new Date(Date.parse(now) + 14 * DAY).toISOString();
    const expiring = active.filter((w) => w.expires_at <= horizon).length;
    const ages = active.map((w) => (Date.parse(now) - Date.parse(w.approved_at!)) / DAY);
    const over90 = ages.filter((a) => a > 90).length;
    const conc: Record<string, number> = {};
    for (const w of ws) conc[w.clause_ref] = (conc[w.clause_ref] ?? 0) + 1;
    add({ id: "G9", name: "Waiver count and age", li: false, li_families: ["waiver"], value: { active: active.length, expired: expired.length, expiring_14d: expiring, mean_active_age_days: ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null, active_over_90_days: over90, concentration_by_clause: conc }, numerator: over90, denominator: active.length, rate: rate(over90, active.length), breach: buildBreach(over90 > 0 ? [["waivers_old", { count: over90 }, `${over90} active waiver(s) older than 90 days`] as const] : []), note: "'expired but relied on' is not derivable from stored data; expired waivers are counted" });
  });
  section("G10", "na confirmation latency and backlog", true, ["waiver"], [NEED.naConfirm], () => {
    const rows = db
      .query(`SELECT s.checklist_id, s.item_id, s.assessed_at, s.na_confirmed_by, s.na_confirmed_at FROM project_checklist_item_state s JOIN md_project p ON p.id = s.project_id WHERE s.status = 'na' AND p.deleted_at IS NULL`)
      .all() as Array<{ checklist_id: string; item_id: string; assessed_at: string; na_confirmed_by: string | null; na_confirmed_at: string | null }>;
    const mand = rows.filter((r) => isMandatoryChecklistItem(r.checklist_id, r.item_id));
    const unconf = mand.filter((r) => !r.na_confirmed_by);
    const mig = (db.query("SELECT applied_at FROM schema_migrations WHERE filename LIKE '0177_%'").get() as { applied_at: string } | null)?.applied_at ?? now;
    const legacy = unconf.filter((r) => r.assessed_at < mig).length;
    const over14 = unconf.filter((r) => Date.parse(now) - Date.parse(r.assessed_at) > 14 * DAY).length;
    const lat = mand.filter((r) => r.na_confirmed_at).map((r) => (Date.parse(r.na_confirmed_at!) - Date.parse(r.assessed_at)) / DAY);
    add({ id: "G10", name: "na confirmation latency and backlog", li: true, li_families: ["waiver"], value: { unconfirmed: unconf.length, unconfirmed_over_14_days: over14, legacy_unconfirmed: legacy, median_days_to_confirmation: median(lat) }, numerator: unconf.length, denominator: mand.length, rate: rate(unconf.length, mand.length), breach: buildBreach(over14 > 0 ? [["na_unconfirmed_old", { count: over14, legacy }, `${over14} unconfirmed mandatory na row(s) older than 14 days (legacy backlog ${legacy} must be reviewed before the waiver flip)`] as const] : []) });
  });
  section("G11", "WACC provisional share at S8+", true, ["wacc"], [], () => {
    const ps = db.query("SELECT p.id FROM md_project p WHERE p.status = 'open' AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM business_case_model m WHERE m.project_id = p.id)").all() as Array<{ id: string }>;
    const prov = ps.filter((p) => !resolveWaccConfirmation(db, p.id).confirmed).length;
    add({ id: "G11", name: "WACC provisional share at S8+", li: true, li_families: ["wacc"], value: { provisional: prov, projects_at_s8_or_later: ps.length }, numerator: prov, denominator: ps.length, rate: rate(prov, ps.length), breach: buildBreach(prov > 0 ? [["wacc_provisional", { count: prov }, `${prov} project(s) at S8 or later with a provisional discount rate`] as const] : []), note: "S8 or later = an S8 business-case model exists" });
  });
  section("G12", "Would-block-free days", true, [...GATE_INTEGRITY_FAMILIES], [], () => {
    const minWrites = o.minWrites ?? 10;
    const toDay = o.to.slice(0, 10);
    const horizonFrom = new Date(Date.parse(o.to) - 90 * DAY).toISOString();
    const wbRows = db.query("SELECT action, substr(created_at,1,10) AS day FROM audit_log WHERE action LIKE 'gate_integrity.would_block:%' AND created_at >= ? AND created_at < ?").all(horizonFrom, o.to) as Array<{ action: string; day: string }>;
    const writeRows = db.query("SELECT substr(decided_at,1,10) AS day, COUNT(*) c FROM gate_decision WHERE decided_at >= ? AND decided_at < ? GROUP BY 1").all(horizonFrom, o.to) as Array<{ day: string; c: number }>;
    const out: Record<string, { streak_days: number; writes_in_streak: number; qualifies_14_days: boolean; would_blocks_14d: number }> = {};
    const from14 = new Date(Date.parse(`${toDay}T00:00:00Z`) - 14 * DAY).toISOString().slice(0, 10);
    for (const f of GATE_INTEGRITY_FAMILIES) {
      const days = new Set(wbRows.filter((w) => CODE_FAMILY[w.action.slice(w.action.indexOf(":") + 1)] === f).map((w) => w.day));
      let streak = 0, writes = 0;
      for (let d = 0; d < 90; d += 1) {
        const day = new Date(Date.parse(`${toDay}T00:00:00Z`) - (d + 1) * DAY).toISOString().slice(0, 10);
        if (days.has(day)) break;
        streak += 1;
        writes += writeRows.find((w) => w.day === day)?.c ?? 0;
      }
      const wb14 = wbRows.filter((w) => w.day >= from14 && CODE_FAMILY[w.action.slice(w.action.indexOf(":") + 1)] === f).length;
      out[f] = { streak_days: streak, writes_in_streak: writes, qualifies_14_days: streak >= 14 && writes >= minWrites, would_blocks_14d: wb14 };
      g12ByFamily[f] = { cleanDays: streak, decisions: writes, wouldBlocks14d: wb14 };
    }
    add({ id: "G12", name: "Would-block-free days", li: true, li_families: [...GATE_INTEGRITY_FAMILIES], value: { min_writes: minWrites, by_family: out }, numerator: Object.values(out).filter((v) => v.qualifies_14_days).length, denominator: GATE_INTEGRITY_FAMILIES.length, rate: null, breach: ok(), note: "no breach trigger: the counter resets on any would_block event; writes are all gate decisions in the streak (N = min_writes, default 10 per the runbook)" });
  });
  const families = GATE_INTEGRITY_FAMILIES.map((f) => familyStatus(f, gateIntegrityMode(f, o.env ?? process.env), g12ByFamily[f] ?? { cleanDays: 0, decisions: 0, wouldBlocks14d: 0 }, o.minWrites));
  return { generated_at: now, families, unapplied_migrations: unappliedGateIntegrityMigrations(db), period: { from: o.from, to: o.to, prior_from: priorFrom, prior_to: priorTo }, gate, kpis };
}
