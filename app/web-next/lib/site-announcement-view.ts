// ADR-0194 item B (PR-2): view logic of the S5 "site announcement + infrastructure plan" panel
// (design 2026-11-07-kill-data-sources §4.6). Pure data mapping, no React: the panel renders these results, tests pin them.
// Both inputs of kill criterion #5 are human-recorded facts. Nothing here derives, suggests, defaults or pre-fills a date
// or an answer; the status line is a client-side reading aid, the gate snapshot (server filler) stays authoritative.

export interface SiteAnnouncementRow {
  id: string;
  project_id: string;
  site_id: string | null;
  announced_on: string;
  announcement_kind: string;
  evidence_ref: string;
  recorded_by: string;
  recorded_at: string;
  superseded_by: string | null;
}

export interface SiteAnnouncementData {
  project_id: string;
  /** One row per kind. */
  live: SiteAnnouncementRow[];
  history: SiteAnnouncementRow[];
  /** MIN(announced_on) over the live rows; null = nothing recorded, kill criterion #5 stays unassessed. */
  earliest_announced_on: string | null;
  unrecorded_kinds: string[];
  vocabulary: { announcement_kinds: string[] };
}

export interface DimensionInputRow {
  id: string;
  run_id: string;
  project_id: string;
  var_key: string;
  value_kind: "num" | "text" | "bool";
  value_text: string | null;
  value_num: number | null;
  unit: string | null;
  evidence_ref: string;
  asserted_by: string;
  reviewed_by: string | null;
  rationale: string;
  observed_at: string;
  effective_on: string | null;
  superseded_by: string | null;
}

export interface AssertableVar {
  var_key: string;
  label_ko: string;
  value_type: "number" | "string" | "boolean";
  unit: string | null;
  requires_evidence_ref: number;
}

export interface DimensionInputData {
  project_id: string;
  inputs: DimensionInputRow[];
  live: DimensionInputRow[];
  vocabulary: { assertable_vars: AssertableVar[] };
}

export const EVIDENCE_MAX = 2000;
export const RATIONALE_MAX = 2000;

/** The kill criterion this panel feeds, as the snapshot's acknowledgement key (`<procedure>:<criterion_id>`). */
export const SITE_ANNOUNCEMENT_KILL_KEY = "greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement";

/** Anchor of the panel on the S5 screen (review tab). */
export const SITE_ANNOUNCEMENT_PANEL_ID = "site-announcement-panel";

/** The asserted variable whose live, reviewed row is the plan side of kill criterion #5. */
export const PLAN_VAR_KEY = "infra.plan_finalized";

/** Deep link from the gate snapshot row: the review tab of the S5 screen, scrolled to the panel. */
export function siteAnnouncementHref(dealId: string): string {
  return `/deals/${encodeURIComponent(dealId)}/s5?tab=review#${SITE_ANNOUNCEMENT_PANEL_ID}`;
}

// ── dates ──────────────────────────────────────────────────────────────

/** True for a real calendar date in YYYY-MM-DD form (2026-02-30 and 2026-13-01 are not). */
export function isIsoCalendarDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The Asia/Seoul calendar date (UTC+9, no DST) of an instant: the server's definition of "today" for these dates. */
export function seoulToday(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Citation vocabulary of evidence_ref: doc:<id> | src:<code> | https://<url>, no whitespace. */
export function isValidEvidenceRef(ref: string): boolean {
  const t = ref.trim();
  if (t.length === 0 || /\s/.test(t)) return false;
  if (t.startsWith("doc:")) return t.length > "doc:".length;
  if (t.startsWith("src:")) return t.length > "src:".length;
  if (t.startsWith("https://")) return t.length > "https://".length;
  return false;
}

/** Only an https citation becomes a link (never javascript: or other schemes); everything else renders as text. */
export function evidenceHref(ref: string): string | null {
  const t = ref.trim();
  return t.startsWith("https://") && t.length > "https://".length && !/\s/.test(t) ? t : null;
}

// ── announcement rows ──────────────────────────────────────────────────

export type AnnouncementKindRow =
  | { kind: string; state: "unrecorded" }
  | { kind: string; state: "recorded"; row: SiteAnnouncementRow; earliest: boolean };

/** One row per vocabulary kind, in vocabulary order: the live row (flagged when it carries the earliest date) or "unrecorded". */
export function announcementKindRows(
  data: Pick<SiteAnnouncementData, "live" | "vocabulary" | "earliest_announced_on">,
): AnnouncementKindRow[] {
  const liveByKind = new Map(data.live.map((r) => [r.announcement_kind, r]));
  const kinds = [...data.vocabulary.announcement_kinds];
  for (const r of data.live) if (!kinds.includes(r.announcement_kind)) kinds.push(r.announcement_kind);
  return kinds.map((kind): AnnouncementKindRow => {
    const row = liveByKind.get(kind);
    return row
      ? {
          kind,
          state: "recorded",
          row,
          earliest: data.earliest_announced_on !== null && row.announced_on === data.earliest_announced_on,
        }
      : { kind, state: "unrecorded" };
  });
}

export interface AnnouncementForm {
  announcedOn: string;
  kind: string;
  evidenceRef: string;
}

/** Empty by design: no default date (never "today"), no default kind. */
export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementForm = { announcedOn: "", kind: "", evidenceRef: "" };

/** Loads a previously RECORDED row (the person's own earlier entry) into the form for correction of that kind. */
export function announcementFormFromRow(row: SiteAnnouncementRow): AnnouncementForm {
  return { announcedOn: row.announced_on, kind: row.announcement_kind, evidenceRef: row.evidence_ref };
}

export type AnnouncementProblem =
  | "kind"
  | "announcedOn"
  | "announcedOnFuture"
  | "evidence"
  | "evidenceFormat"
  | "evidenceTooLong";

/** Early client check; the server stays authoritative. Order = field order on screen. */
export function validateAnnouncementForm(f: AnnouncementForm, today: string): AnnouncementProblem | null {
  if (!f.kind) return "kind";
  if (!isIsoCalendarDate(f.announcedOn)) return "announcedOn";
  if (f.announcedOn > today) return "announcedOnFuture";
  const ref = f.evidenceRef.trim();
  if (!ref) return "evidence";
  if (ref.length > EVIDENCE_MAX) return "evidenceTooLong";
  if (!isValidEvidenceRef(ref)) return "evidenceFormat";
  return null;
}

/** Request body: no recorder field (the server takes the session user). */
export function buildAnnouncementBody(f: AnnouncementForm): {
  announced_on: string;
  announcement_kind: string;
  evidence_ref: string;
} {
  return { announced_on: f.announcedOn, announcement_kind: f.kind, evidence_ref: f.evidenceRef.trim() };
}

// ── infrastructure plan assertion ──────────────────────────────────────

export type PlanAnswer = "yes" | "no";

/** The live assertion of infra.plan_finalized, if any. */
export function livePlanRow(data: Pick<DimensionInputData, "live"> | null): DimensionInputRow | null {
  if (!data) return null;
  return data.live.find((r) => r.var_key === PLAN_VAR_KEY && r.superseded_by === null) ?? null;
}

/** Superseded earlier assertions of infra.plan_finalized, newest first as the API returns them. */
export function planHistoryRows(data: Pick<DimensionInputData, "inputs"> | null): DimensionInputRow[] {
  if (!data) return [];
  return data.inputs.filter((r) => r.var_key === PLAN_VAR_KEY && r.superseded_by !== null);
}

export function planAnswerOf(row: DimensionInputRow): PlanAnswer | null {
  const v = (row.value_text ?? "").trim();
  return v === "yes" || v === "no" ? v : null;
}

export type PlanReviewState = "pending" | "reviewed";

/** A row counts for the criterion only when it is reviewed; until then it is "pending" and fills nothing. */
export function planReviewState(row: DimensionInputRow): PlanReviewState {
  return row.reviewed_by ? "reviewed" : "pending";
}

export type ReviewAvailability = "available" | "own_assertion" | "not_pending" | "no_access";

/**
 * Whether this viewer can review the live assertion. The reviewer must differ from the asserter (server: 409
 * second_person_required); the button is offered only to a different, signed-in analyst. Server stays authoritative.
 */
export function reviewAvailability(row: DimensionInputRow, meId: string | null, canAct: boolean): ReviewAvailability {
  if (planReviewState(row) !== "pending") return "not_pending";
  if (!canAct || !meId) return "no_access";
  if (row.asserted_by === meId) return "own_assertion";
  return "available";
}

export interface PlanForm {
  /** "" until a person picks: there is no default answer. */
  value: "" | PlanAnswer;
  effectiveOn: string;
  evidenceRef: string;
  rationale: string;
}

export const EMPTY_PLAN_FORM: PlanForm = { value: "", effectiveOn: "", evidenceRef: "", rationale: "" };

/** The effective-date field exists only for 'yes' (a plan that is not finalized has no finalization date). */
export function showsEffectiveOn(f: Pick<PlanForm, "value">): boolean {
  return f.value === "yes";
}

export type PlanProblem =
  | "value"
  | "effectiveOn"
  | "effectiveOnFuture"
  | "evidence"
  | "evidenceFormat"
  | "evidenceTooLong"
  | "rationale"
  | "rationaleTooLong";

/** Early client check; the server stays authoritative. 'yes' needs the document date and a resolvable citation. */
export function validatePlanForm(f: PlanForm, today: string, evidenceRequired: boolean): PlanProblem | null {
  if (f.value !== "yes" && f.value !== "no") return "value";
  if (f.value === "yes") {
    if (!isIsoCalendarDate(f.effectiveOn)) return "effectiveOn";
    if (f.effectiveOn > today) return "effectiveOnFuture";
  }
  const ref = f.evidenceRef.trim();
  const mustCite = f.value === "yes" || evidenceRequired;
  if (mustCite && !ref) return "evidence";
  if (ref.length > EVIDENCE_MAX) return "evidenceTooLong";
  if (mustCite && !isValidEvidenceRef(ref)) return "evidenceFormat";
  const rationale = f.rationale.trim();
  if (!rationale) return "rationale";
  if (rationale.length > RATIONALE_MAX) return "rationaleTooLong";
  return null;
}

/** Request body: effective_on only for 'yes' (the server refuses it on 'no'); no asserter field. */
export function buildPlanBody(f: PlanForm): {
  var_key: string;
  value: string;
  evidence_ref: string;
  rationale: string;
  effective_on?: string;
} {
  return {
    var_key: PLAN_VAR_KEY,
    value: f.value,
    evidence_ref: f.evidenceRef.trim(),
    rationale: f.rationale.trim(),
    ...(showsEffectiveOn(f) ? { effective_on: f.effectiveOn } : {}),
  };
}

/** Whether the registry vocabulary demands a citation for infra.plan_finalized regardless of the answer. */
export function planEvidenceRequired(data: Pick<DimensionInputData, "vocabulary"> | null): boolean {
  return data?.vocabulary.assertable_vars.find((v) => v.var_key === PLAN_VAR_KEY)?.requires_evidence_ref === 1;
}

// ── kill criterion #5 status line ──────────────────────────────────────

export type MissingPart = "announcement" | "plan" | "review" | "effectiveOn";

export type KillFiveStatus =
  | { kind: "unassessed"; missing: MissingPart[] }
  | { kind: "clean"; announcedOn: string; planOn: string }
  | { kind: "triggered"; reason: "plan_after_announcement"; announcedOn: string; planOn: string }
  | { kind: "triggered"; reason: "plan_not_finalized"; announcedOn: string };

/**
 * Reading aid for #5 (the gate snapshot filler is authoritative; this mirrors design §4.5):
 *  - no announcement, no live plan assertion, an unreviewed one, or a reviewed 'yes' without effective_on: unassessed,
 *    listing what is missing (never read as clean or triggered);
 *  - plan date on or before the earliest announcement: clean;
 *  - a reviewed 'no', or a plan dated after the announcement: triggered.
 */
export function killFiveStatus(earliest: string | null, plan: DimensionInputRow | null): KillFiveStatus {
  const missing: MissingPart[] = [];
  if (earliest === null) missing.push("announcement");
  if (!plan) missing.push("plan");
  else if (planReviewState(plan) === "pending") missing.push("review");
  else if (planAnswerOf(plan) === "yes" && !plan.effective_on) missing.push("effectiveOn");
  if (missing.length > 0 || earliest === null || !plan) return { kind: "unassessed", missing };
  if (planAnswerOf(plan) === "no") return { kind: "triggered", reason: "plan_not_finalized", announcedOn: earliest };
  if (planAnswerOf(plan) !== "yes" || !plan.effective_on) return { kind: "unassessed", missing: ["plan"] };
  return plan.effective_on <= earliest
    ? { kind: "clean", announcedOn: earliest, planOn: plan.effective_on }
    : { kind: "triggered", reason: "plan_after_announcement", announcedOn: earliest, planOn: plan.effective_on };
}

// ── errors ─────────────────────────────────────────────────────────────

export type KillDataErrorKind =
  | "viewer"
  | "admin"
  | "notFound"
  | "invalid"
  | "humanOnly"
  | "secondPerson"
  | "reviewRejected"
  | "noRun"
  | "other";

/** Maps the routes' error envelopes (400 invalid_request, 403 role_required / role_forbidden / human_only, 404, 409 ...) to a message kind. */
export function killDataErrorKind(status: number, code: string): KillDataErrorKind {
  if (status === 403 && code === "role_required") return "viewer";
  if (status === 403 && code === "role_forbidden") return "admin";
  if (status === 403 && code === "human_only") return "humanOnly";
  if (status === 404) return "notFound";
  if (status === 400 && code === "invalid_request") return "invalid";
  if (status === 409 && code === "second_person_required") return "secondPerson";
  if (status === 409 && code === "review_rejected") return "reviewRejected";
  if (status === 409 && code === "no_run") return "noRun";
  return "other";
}
