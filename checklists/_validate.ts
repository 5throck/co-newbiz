#!/usr/bin/env bun
// @version 1.5.0
/**
 * Checklist Validator — co-newbiz
 *
 * Validates all checklists/*.yaml structure at authoring time. procedures/ has
 * _validate.ts and glossary/ has _validate.ts; until now the checklist layer
 * — the layer that carries the no-waiver Brown Field core — had no authoring
 * gate at all, relying only on runtime flags in db/lib/compliance.ts.
 *
 * What is an ERROR:
 *   - missing/empty id, text, or mandatory on any item
 *   - non-boolean mandatory / waiver_eligible
 *   - MISSING waiver_eligible on any item — every item must declare it
 *     explicitly; the engine's undeclared-default (`?? true`) is no longer
 *     allowed to act as invisible policy (all items declared as of
 *     2026-08-24; `true` values codify the then-current engine default,
 *     amendable per item through normal governance)
 *   - duplicate item ids within one file
 *   - item ids not matching the <prefix>-<number> convention
 *   - waiver_eligible: false on a RECOMMENDED item (a recommended item never
 *     blocks, so a no-waiver flag on it is a contradiction)
 *
 * Overlays (checklists/_overlays/*.yaml, ADR-0160 addendum b) — ERROR when:
 *   - meta missing, unknown checklist id, overlay row for a non-existent
 *     item, or a checklist item missing from the overlay
 *   - invalid code (A/R/X/N/C), R without reading, N/C without na_reason,
 *     X without existing replacement targets
 *   - a binding item (mandatory, waiver_eligible: false) classified anything but A (R/X/N/C)
 *     (always an error; no exemption)
 *   - a row without an approved human approval record
 *   - declared expected_counts differ from the recomputed counts
 *   - a `steps` entry naming an unknown procedure step, tab, or item, or a
 *     procedure step left unmapped
 *   - one of the seven ADR-0148 workspace checklists missing from the overlay
 *   - brownfield overlays (ADR-0162): code C used; a baseline_sub_track
 *     (m_and_a) cell that is not A, or a baseline exclusion in
 *     extra_checklists; an X target not in an extra checklist attached to that
 *     sub-track (or excluded there); an extra_checklists exclusion of an
 *     unknown or binding item (bf-01..03 etc.), or without na_reason; an extra
 *     `readings` entry (R) on an unknown, excluded or binding item, or without
 *     a reading; declared
 *     extras_judgeable / total_judgeable differing from the recomputed values
 *
 * Review status (optional per item, informational — never gate-blocking):
 *   - review_status must be draft-AI | counsel-reviewed | confirmed (missing = draft-AI)
 *   - reviewer (named person) and verified_on (YYYY-MM-DD) are REQUIRED when the
 *     status is counsel-reviewed or confirmed (confirmed without both is rejected)
 *   - reviewer / verified_on on a draft-AI item are rejected (a review claim needs a status)
 *
 * Legal sign-off (optional, informational — docs/governance/legal-signoff-protocol.md):
 *   - when legal-signoff/<checklist>@<version>.yaml files exist: item_id must exist in the
 *     named checklist, verdict must be confirm | revise | hold, signer name and qualification,
 *     approver and a YYYY-MM-DD date must be present
 *   - a checklist item with review_status counsel-reviewed | confirmed needs a matching signed
 *     entry with verdict confirm whose signer equals 'reviewer' and date equals 'verified_on'
 *
 * What is a WARN:
 *   - legal_basis entries pointing at repo paths that do not exist
 *
 * Usage:
 *   bun checklists/_validate.ts
 *   bun checklists/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const CHECKLIST_DIR = resolve(import.meta.dirname);
const REPO_ROOT = resolve(CHECKLIST_DIR, "..");
const VERBOSE = process.argv.includes("--verbose");

const REQUIRED_META = ["governance_doc_id", "layer", "title", "owner_agent", "version"] as const;

interface Issue {
  file: string;
  item: string;
  message: string;
  severity: "error" | "warn";
}

interface ItemShape {
  id?: unknown;
  text?: unknown;
  mandatory?: unknown;
  waiver_eligible?: unknown;
  review_status?: unknown;
  reviewer?: unknown;
  verified_on?: unknown;
}

export const REVIEW_STATUSES = ["draft-AI", "counsel-reviewed", "confirmed"] as const;

/** Validates the optional review-status fields of one checklist item. */
export function validateReviewFields(file: string, item: ItemShape, label: string): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ file, item: label, message, severity: "error" });
  const has = (v: unknown) => v !== undefined && v !== null;
  if (!has(item.review_status) && !has(item.reviewer) && !has(item.verified_on)) return issues;
  const status = has(item.review_status) ? item.review_status : "draft-AI";
  if (!(REVIEW_STATUSES as readonly unknown[]).includes(status)) {
    err(`'review_status' must be one of ${REVIEW_STATUSES.join(" | ")}`);
    return issues;
  }
  if (status === "draft-AI") {
    if (has(item.reviewer) || has(item.verified_on)) err("'reviewer' / 'verified_on' given on a draft-AI item — set review_status to counsel-reviewed or confirmed");
    return issues;
  }
  if (typeof item.reviewer !== "string" || item.reviewer.trim().length === 0) err(`'reviewer' (named person) is required when review_status is ${String(status)}`);
  if (typeof item.verified_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.verified_on)) err(`'verified_on' (YYYY-MM-DD) is required when review_status is ${String(status)}`);
  return issues;
}

export const SIGNOFF_VERDICTS = ["confirm", "revise", "hold"] as const;
export const SIGNER_PLACEHOLDER = "to be designated by the human decider";

export interface SignoffInput { file: string; doc: unknown }
export interface ChecklistSummary { items: Map<string, { review_status?: unknown; reviewer?: unknown; verified_on?: unknown }> }

/** Validates legal-signoff files against the checklists they name and the review-status claims in those checklists. */
export function validateSignoffs(signoffs: SignoffInput[], checklists: Map<string, ChecklistSummary>): Issue[] {
  const issues: Issue[] = [];
  const signed = new Map<string, { signer: string; date: string }>();
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  for (const { file, doc } of signoffs) {
    const err = (item: string, message: string) => issues.push({ file, item, message, severity: "error" });
    if (typeof doc !== "object" || doc === null) { err("(root)", "Sign-off root is not a mapping"); continue; }
    const d = doc as Record<string, unknown>;
    const stem = isStr(d.checklist) ? d.checklist : "";
    const cl = checklists.get(stem);
    if (!cl) { err("(checklist)", `'checklist' must name an existing checklists/*.yaml stem (got '${stem}')`); continue; }
    if (!isStr(d.checklist_version)) err("(meta)", "'checklist_version' is required");
    const signer = (d.signer ?? {}) as Record<string, unknown>;
    const approver = (d.approver ?? {}) as Record<string, unknown>;
    if (!isStr(signer.name) || signer.name === SIGNER_PLACEHOLDER) err("(signer)", "'signer.name' must be a named lawyer");
    if (!isStr(signer.qualification)) err("(signer)", "'signer.qualification' is required");
    if (!isStr(approver.name)) err("(approver)", "'approver.name' (human approver) is required");
    if (!Array.isArray(d.items) || d.items.length === 0) { err("(items)", "'items' must be a non-empty array"); continue; }
    for (const raw of d.items as unknown[]) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const id = isStr(e.item_id) ? e.item_id : "(no item_id)";
      if (!isStr(e.item_id) || !cl.items.has(e.item_id)) err(id, `item_id does not exist in checklist '${stem}'`);
      if (!(SIGNOFF_VERDICTS as readonly unknown[]).includes(e.verdict)) err(id, `'verdict' must be one of ${SIGNOFF_VERDICTS.join(" | ")}`);
      const auth = (e.authority ?? {}) as Record<string, unknown>;
      if (!isStr(auth.law) || !isStr(auth.article)) err(id, "'authority' needs law and article (and MST where a statute)");
      if (typeof e.signed_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.signed_on)) err(id, "'signed_on' (YYYY-MM-DD) is required");
      else if (e.verdict === "confirm" && isStr(signer.name)) signed.set(`${stem}:${id}`, { signer: signer.name, date: e.signed_on });
    }
  }
  for (const [stem, cl] of checklists) {
    for (const [id, item] of cl.items) {
      if (item.review_status !== "counsel-reviewed" && item.review_status !== "confirmed") continue;
      const hit = signed.get(`${stem}:${id}`);
      const file = `${stem}.yaml`;
      if (!hit) issues.push({ file, item: id, message: `review_status ${String(item.review_status)} needs a matching confirm entry in legal-signoff/`, severity: "error" });
      else if (item.reviewer !== hit.signer || item.verified_on !== hit.date) issues.push({ file, item: id, message: "reviewer / verified_on must equal the sign-off signer name / signed_on date", severity: "error" });
    }
  }
  return issues;
}

/** Repo-relative doc references in legal_basis are checked for existence; free-text citations ("Meeting M5") are not. */
function looksLikeRepoPath(entry: string): boolean {
  return /[\\/]/.test(entry) && /\.(md|yaml|yml)$/i.test(entry.trim());
}

function validateItem(file: string, item: ItemShape, seenIds: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const label = typeof item.id === "string" ? item.id : "(missing id)";

  if (typeof item.id !== "string" || item.id.trim().length === 0) {
    issues.push({ file, item: label, message: "Missing or empty required field 'id'", severity: "error" });
  } else {
    if (!/^[a-z][a-z0-9_]*-\d+$/.test(item.id)) {
      issues.push({ file, item: label, message: `Id '${item.id}' does not match the <prefix>-<number> convention`, severity: "error" });
    }
    if (seenIds.has(item.id)) {
      issues.push({ file, item: label, message: "Duplicate item id within this checklist", severity: "error" });
    }
    seenIds.add(item.id);
  }

  if (typeof item.text !== "string" || item.text.trim().length === 0) {
    issues.push({ file, item: label, message: "Missing or empty required field 'text'", severity: "error" });
  }

  if (typeof item.mandatory !== "boolean") {
    issues.push({ file, item: label, message: "'mandatory' must be a boolean — the enforceability layer depends on it", severity: "error" });
  }

  if (item.waiver_eligible === undefined) {
    issues.push({
      file,
      item: label,
      message: "Missing 'waiver_eligible' — every item must declare it explicitly (undeclared items default to WAIVABLE at runtime)",
      severity: "error",
    });
  } else if (typeof item.waiver_eligible !== "boolean") {
    issues.push({ file, item: label, message: "'waiver_eligible' must be a boolean when present", severity: "error" });
  } else if (item.waiver_eligible === false && item.mandatory === false) {
    issues.push({
      file,
      item: label,
      message: "waiver_eligible=false on a recommended item is a contradiction — recommended items never block, so there is nothing to waive",
      severity: "error",
    });
  }

  issues.push(...validateReviewFields(file, item, label));

  return issues;
}

// ---------------------------------------------------------------------------
// Overlay validation (checklists/_overlays/*.yaml) — ADR-0160 addendum (b).
// An overlay scopes existing checklist items per track/sub-track without
// editing checklist text. It is governance: every row needs a human approval
// record, and the declared counts are recomputed here (fail on mismatch).
// ---------------------------------------------------------------------------

export const OVERLAY_CODES = ["A", "R", "X", "N", "C"] as const;
export type OverlayCode = (typeof OVERLAY_CODES)[number];

export interface ChecklistItemFacts {
  mandatory: boolean;
  waiver_eligible: boolean;
}

export interface OverlayContext {
  /** checklist id (chk-<file stem>) -> item id -> facts */
  checklists: Map<string, Map<string, ChecklistItemFacts>>;
  /** procedure id -> step ids */
  procedureSteps: Map<string, Set<string>>;
}

/** The seven ADR-0148 S9 workspace checklists every overlay must cover. */
export const WORKSPACE_CHECKLIST_IDS = [
  "chk-commercial-dd-checklist",
  "chk-technical-dd-checklist",
  "chk-legal-dd-checklist",
  "chk-market-dd-checklist",
  "chk-financial-dd-checklist",
  "chk-hr-dd-checklist",
  "chk-financing-plan-checklist",
] as const;

/** Codes allowed per track. C (site_required) exists only on greenfield. */
const TRACK_CODES: Record<string, readonly OverlayCode[]> = {
  greenfield: OVERLAY_CODES,
  brownfield: ["A", "R", "X", "N"],
};

const OVERLAY_META = ["governance_doc_id", "layer", "title", "owner_agent", "maintainer", "version", "track", "procedure_id"] as const;

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function checklistIdForFile(file: string): string {
  return `chk-${file.replace(/\.ya?ml$/i, "")}`;
}

export function validateOverlay(file: string, doc: unknown, ctx: OverlayContext): Issue[] {
  const issues: Issue[] = [];
  const err = (item: string, message: string) => issues.push({ file, item, message, severity: "error" });

  if (typeof doc !== "object" || doc === null) {
    err("(root)", "Overlay root is not a mapping");
    return issues;
  }
  const root = doc as Record<string, unknown>;
  for (const f of OVERLAY_META) if (!nonEmpty(root[f])) err("(meta)", `Missing or empty required field '${f}'`);
  if (root.layer !== undefined && root.layer !== "checklist-overlay") err("(meta)", "'layer' must be 'checklist-overlay'");
  // Approval provenance: every overlay names the decision record (docs/decisions/DEC-YYYYMMDD-NN.md)
  // that records who approved its classifications and what changed after review.
  if (!nonEmpty(root.decision_record) || !/^DEC-\d{8}-\d{2}$/.test(String(root.decision_record))) {
    err("(meta)", "Missing or malformed 'decision_record' (expected DEC-YYYYMMDD-NN)");
  }

  const subTrackKeys = root.sub_track_keys;
  if (typeof subTrackKeys !== "object" || subTrackKeys === null || Object.keys(subTrackKeys).length === 0) {
    err("(meta)", "Missing or empty 'sub_track_keys' mapping");
    return issues;
  }
  const subTracks = Object.keys(subTrackKeys);
  const track = String(root.track ?? "");
  const brownfield = track === "brownfield";
  if (root.track !== undefined && !(track in TRACK_CODES)) err("(meta)", `Unknown track '${track}' (expected ${Object.keys(TRACK_CODES).join("/")})`);
  const codes = TRACK_CODES[track] ?? OVERLAY_CODES;
  const baseline = brownfield ? String(root.baseline_sub_track ?? "") : "";
  if (brownfield && !subTracks.includes(baseline)) err("(meta)", `'baseline_sub_track' must name a declared sub-track (got '${baseline}')`);

  // Brownfield extra checklists: which sub-tracks they attach to and which items are excluded per sub-track.
  const extraBlocks = (brownfield ? root.extra_checklists ?? {} : {}) as Record<string, Record<string, unknown> | null>;
  const attachedTo = (checklistId: string): string[] => {
    const a = extraBlocks[checklistId]?.attached_to;
    return Array.isArray(a) ? a.map(String) : [];
  };
  const excludedIds = (checklistId: string, st: string): Set<string> => {
    const cell = (extraBlocks[checklistId]?.sub_tracks as Record<string, Record<string, unknown>> | undefined)?.[st];
    const out = new Set<string>();
    for (const e of (Array.isArray(cell?.excluded) ? cell.excluded : []) as Record<string, unknown>[])
      for (const id of (Array.isArray(e?.ids) ? e.ids : []) as unknown[]) out.add(String(id));
    return out;
  };

  const checklists = root.checklists;
  if (typeof checklists !== "object" || checklists === null) {
    err("(checklists)", "Missing 'checklists' mapping");
    return issues;
  }

  for (const id of WORKSPACE_CHECKLIST_IDS)
    if (!(id in (checklists as Record<string, unknown>))) err(id, "Workspace checklist missing from overlay (ADR-0148 seven domains)");

  const counts: Record<string, Record<OverlayCode, number>> = {};
  for (const st of subTracks) counts[st] = { A: 0, R: 0, X: 0, N: 0, C: 0 };

  const refExists = (checklist: unknown, item: unknown) =>
    nonEmpty(checklist) && nonEmpty(item) && (ctx.checklists.get(checklist)?.has(item) ?? false);

  for (const [checklistId, block] of Object.entries(checklists as Record<string, unknown>)) {
    const facts = ctx.checklists.get(checklistId);
    if (!facts) {
      err(checklistId, `Unknown checklist id '${checklistId}' (expected chk-<file stem> of a checklists/*.yaml file)`);
      continue;
    }
    const items = (block as Record<string, unknown> | null)?.items;
    if (!Array.isArray(items)) {
      err(checklistId, "Missing or non-array 'items'");
      continue;
    }
    const seen = new Set<string>();
    for (const raw of items) {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = nonEmpty(row.id) ? row.id : "(missing id)";
      const label = `${checklistId}/${id}`;
      if (!nonEmpty(row.id)) {
        err(label, "Overlay row without 'id'");
        continue;
      }
      if (seen.has(id)) err(label, "Duplicate overlay row");
      seen.add(id);
      const itemFacts = facts.get(id);
      if (!itemFacts) err(label, `Item '${id}' does not exist in checklist '${checklistId}'`);

      const approval = row.approval as Record<string, unknown> | undefined;
      if (!approval || approval.status !== "approved" || !nonEmpty(approval.approved_by) || !nonEmpty(approval.approved_at)) {
        err(label, "Missing approval record (status: approved, approved_by, approved_at) — checklist applicability cannot pass on AI review alone");
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(approval.approved_at))) {
        err(label, "approval.approved_at must be an ISO date (YYYY-MM-DD)");
      }

      const cells = row.sub_tracks as Record<string, unknown> | undefined;
      if (!cells || typeof cells !== "object") {
        err(label, "Missing 'sub_tracks' mapping");
        continue;
      }
      for (const key of Object.keys(cells)) if (!subTracks.includes(key)) err(label, `Unknown sub-track key '${key}'`);
      for (const st of subTracks) {
        const cell = cells[st] as Record<string, unknown> | undefined;
        const where = `${label}[${st}]`;
        if (brownfield && cell?.code === "C") {
          err(where, "C (conditional on site_required) is not used on brownfield — no site rule exists on the brownfield route");
          continue;
        }
        if (!cell || !codes.includes(cell.code as OverlayCode)) {
          err(where, `Missing or invalid code (expected one of ${codes.join("/")})`);
          continue;
        }
        const code = cell.code as OverlayCode;
        counts[st][code]++;
        if (brownfield && st === baseline && code !== "A") err(where, `Baseline sub-track '${baseline}' must be A on every row (byte-identical baseline)`);
        if (code === "R" && !nonEmpty(cell.reading)) err(where, `R (reinterpreted) requires a ${brownfield ? "brownfield" : "greenfield"} 'reading'`);
        if ((code === "N" || code === "C") && !nonEmpty(cell.na_reason)) err(where, `${code} requires a user-facing 'na_reason'`);
        if (code === "C" && !nonEmpty(cell.site_rule)) err(where, "C (conditional) requires 'site_rule'");
        if (code === "X") {
          const reps = cell.replaced_by;
          if (!Array.isArray(reps) || reps.length === 0) err(where, "X (replace) requires a non-empty 'replaced_by' list");
          else
            for (const r of reps as Record<string, unknown>[]) {
              if (!refExists(r?.checklist, r?.item)) err(where, `Replacement target '${r?.checklist}/${r?.item}' does not exist`);
              if (!nonEmpty(r?.stage)) err(where, "Replacement target needs 'stage' (where it is judged)");
              if (brownfield && refExists(r?.checklist, r?.item)) {
                const cid = String(r.checklist);
                if (!attachedTo(cid).includes(st)) err(where, `Replacement target '${cid}/${String(r.item)}' is not in a checklist attached to sub-track '${st}'`);
                else if (excludedIds(cid, st).has(String(r.item))) err(where, `Replacement target '${cid}/${String(r.item)}' is itself excluded for sub-track '${st}'`);
              }
            }
        }
        if (code !== "A" && itemFacts && itemFacts.mandatory && !itemFacts.waiver_eligible) {
          err(where, `Binding item (mandatory, waiver_eligible: false) classified ${code} — binding items must be A in every column (never reinterpreted, replaced, or scoped out)`);
        }
      }
    }
    for (const id of facts.keys()) if (!seen.has(id)) err(`${checklistId}/${id}`, "Checklist item missing from overlay (would fail closed to A)");
  }

  // Declared counts must equal the recomputed counts.
  const expected = root.expected_counts as Record<string, Record<string, unknown>> | undefined;
  if (!expected || typeof expected !== "object") {
    err("(expected_counts)", "Missing 'expected_counts'");
  } else {
    for (const st of subTracks) {
      const exp = expected[st];
      if (!exp) {
        err("(expected_counts)", `No expected counts for sub-track '${st}'`);
        continue;
      }
      const got = counts[st];
      for (const c of codes) {
        if (exp[c] !== got[c]) err("(expected_counts)", `${st}.${c}: declared ${String(exp[c])}, recomputed ${got[c]}`);
      }
      const judgeable = got.A + got.R;
      if (exp.judgeable !== judgeable) err("(expected_counts)", `${st}.judgeable (A+R): declared ${String(exp.judgeable)}, recomputed ${judgeable}`);
    }
  }

  if (brownfield) issues.push(...validateExtraChecklists(file, root, subTracks, baseline, ctx));

  // steps: procedure step -> tabs / items.
  const tabLabels = (root.tab_labels ?? {}) as Record<string, unknown>;
  const steps = root.steps;
  if (steps !== undefined) {
    const procId = String(root.procedure_id ?? "");
    const stepIds = ctx.procedureSteps.get(procId);
    if (!stepIds) err("(steps)", `Unknown procedure_id '${procId}'`);
    if (!Array.isArray(steps)) err("(steps)", "'steps' must be an array");
    else {
      const mapped = new Set<string>();
      for (const s of steps as Record<string, unknown>[]) {
        const sid = String(s?.step ?? "");
        const where = `(steps)/${sid}`;
        if (stepIds && !stepIds.has(sid)) err(where, `Step '${sid}' does not exist in procedure '${procId}'`);
        mapped.add(sid);
        const tabs = s?.tabs;
        if (!Array.isArray(tabs) || tabs.length === 0) err(where, "Step needs at least one tab");
        else for (const t of tabs) if (!(String(t) in tabLabels)) err(where, `Tab '${String(t)}' has no entry in 'tab_labels'`);
        for (const key of ["items", "pointers"] as const) {
          const refs = s?.[key];
          if (refs === undefined) continue;
          if (!Array.isArray(refs)) {
            err(where, `'${key}' must be an array`);
            continue;
          }
          for (const ref of refs as Record<string, unknown>[]) {
            for (const item of (Array.isArray(ref?.ids) ? ref.ids : []) as unknown[]) {
              if (!refExists(ref?.checklist, item)) err(where, `${key} reference '${ref?.checklist}/${String(item)}' does not exist`);
            }
          }
        }
      }
      if (stepIds) for (const sid of stepIds) if (!mapped.has(sid)) err("(steps)", `Procedure step '${sid}' is not mapped to any tab`);
    }
  }
  for (const [tab, label] of Object.entries(tabLabels)) {
    const l = label as Record<string, unknown> | null;
    if (!nonEmpty(l?.en) || !nonEmpty(l?.ko)) err("(tab_labels)", `Tab '${tab}' needs non-empty 'en' and 'ko' labels`);
  }

  return issues;
}

/**
 * Brownfield `extra_checklists` (ADR-0162 design section 6): section/item
 * scoping of the sub-track extra checklists. Items not excluded count as
 * judgeable; binding items can never be excluded; the baseline sub-track
 * excludes nothing. Recomputes extras_judgeable and total_judgeable.
 */
function validateExtraChecklists(file: string, root: Record<string, unknown>, subTracks: string[], baseline: string, ctx: OverlayContext): Issue[] {
  const issues: Issue[] = [];
  const err = (item: string, message: string) => issues.push({ file, item, message, severity: "error" });
  const blocks = root.extra_checklists;
  if (typeof blocks !== "object" || blocks === null) {
    err("(extra_checklists)", "Missing 'extra_checklists' mapping (brownfield overlays declare the attached extras, even when unscoped)");
    return issues;
  }
  const extras: Record<string, number> = Object.fromEntries(subTracks.map((s) => [s, 0]));
  for (const [cid, raw] of Object.entries(blocks as Record<string, unknown>)) {
    const label = `(extra_checklists)/${cid}`;
    const block = (raw ?? {}) as Record<string, unknown>;
    const facts = ctx.checklists.get(cid);
    if (!facts) {
      err(label, `Unknown checklist id '${cid}'`);
      continue;
    }
    if ((WORKSPACE_CHECKLIST_IDS as readonly string[]).includes(cid)) err(label, "A workspace checklist cannot also be an extra checklist");
    const approval = block.approval as Record<string, unknown> | undefined;
    if (!approval || approval.status !== "approved" || !nonEmpty(approval.approved_by) || !/^\d{4}-\d{2}-\d{2}$/.test(String(approval.approved_at ?? ""))) {
      err(label, "Missing approval record (status: approved, approved_by, approved_at YYYY-MM-DD) — checklist applicability cannot pass on AI review alone");
    }
    const attached = Array.isArray(block.attached_to) ? block.attached_to.map(String) : [];
    if (attached.length === 0) err(label, "Missing or empty 'attached_to'");
    for (const st of attached) if (!subTracks.includes(st)) err(label, `Unknown sub-track '${st}' in attached_to`);
    const cells = (block.sub_tracks ?? {}) as Record<string, Record<string, unknown> | null>;
    for (const st of Object.keys(cells)) if (!attached.includes(st)) err(`${label}[${st}]`, "Sub-track scoped but not listed in attached_to");
    for (const st of attached) {
      if (!subTracks.includes(st)) continue;
      const where = `${label}[${st}]`;
      const cell = cells[st];
      if (!cell) {
        err(where, "Attached sub-track has no scoping entry (use 'excluded: []' for unscoped)");
        continue;
      }
      if (!Array.isArray(cell.excluded)) {
        err(where, "'excluded' must be an array");
        continue;
      }
      const excluded = new Set<string>();
      for (const e of cell.excluded as Record<string, unknown>[]) {
        if (!nonEmpty(e?.na_reason)) err(where, "Exclusion requires a user-facing 'na_reason'");
        const ids = Array.isArray(e?.ids) ? (e.ids as unknown[]).map(String) : [];
        if (ids.length === 0) err(where, "Exclusion requires a non-empty 'ids' list");
        for (const id of ids) {
          const f = facts.get(id);
          if (!f) err(where, `Excluded item '${id}' does not exist in checklist '${cid}'`);
          else if (f.mandatory && !f.waiver_eligible) err(where, `Binding item '${id}' (mandatory, waiver_eligible: false) excluded — binding items can never be scoped out (no exemption)`);
          if (excluded.has(id)) err(where, `Item '${id}' excluded twice`);
          excluded.add(id);
        }
      }
      // Optional R readings on attached, not-excluded extra items (ADR-0162 addendum 2026-10-13).
      if (cell.readings !== undefined && !Array.isArray(cell.readings)) err(where, "'readings' must be an array");
      const read = new Set<string>();
      for (const r of (Array.isArray(cell.readings) ? cell.readings : []) as Record<string, unknown>[]) {
        if (!nonEmpty(r?.reading)) err(where, "Extra-item R reading requires a non-empty 'reading'");
        const ids = Array.isArray(r?.ids) ? (r.ids as unknown[]).map(String) : [];
        if (ids.length === 0) err(where, "Extra-item reading requires a non-empty 'ids' list");
        for (const id of ids) {
          const f = facts.get(id);
          if (!f) err(where, `Read item '${id}' does not exist in checklist '${cid}'`);
          else if (f.mandatory && !f.waiver_eligible) err(where, `Binding item '${id}' (mandatory, waiver_eligible: false) given an R reading — binding items must be A`);
          if (excluded.has(id)) err(where, `Item '${id}' is both excluded and given a reading`);
          if (read.has(id)) err(where, `Item '${id}' given a reading twice`);
          read.add(id);
        }
      }
      if (st === baseline && (excluded.size > 0 || read.size > 0)) err(where, `Baseline sub-track '${baseline}' extras must stay unscoped (byte-identical baseline)`);
      extras[st] += [...facts.keys()].filter((id) => !excluded.has(id)).length;
    }
  }
  // Baseline extras must keep their attached checklists; a baseline column must exist.
  if (subTracks.includes(baseline) && !Object.values(blocks as Record<string, Record<string, unknown> | null>).some((b) => Array.isArray(b?.attached_to) && b.attached_to.includes(baseline))) {
    err("(extra_checklists)", `No extra checklist attached to baseline sub-track '${baseline}'`);
  }
  const expected = (root.expected_counts ?? {}) as Record<string, Record<string, unknown>>;
  for (const st of subTracks) {
    const exp = expected[st];
    if (!exp) continue; // reported by the main pass
    if (exp.extras_judgeable !== extras[st]) err("(expected_counts)", `${st}.extras_judgeable: declared ${String(exp.extras_judgeable)}, recomputed ${extras[st]}`);
    const total = (typeof exp.judgeable === "number" ? exp.judgeable : NaN) + extras[st];
    if (exp.total_judgeable !== total) err("(expected_counts)", `${st}.total_judgeable: declared ${String(exp.total_judgeable)}, recomputed ${total}`);
  }
  return issues;
}

async function loadOverlayContext(checklistFiles: string[]): Promise<OverlayContext> {
  const checklists = new Map<string, Map<string, ChecklistItemFacts>>();
  for (const file of checklistFiles) {
    try {
      const doc = yaml.load(await readFile(join(CHECKLIST_DIR, file), "utf-8"), { schema: yaml.JSON_SCHEMA }) as { items?: ItemShape[] };
      const items = new Map<string, ChecklistItemFacts>();
      for (const it of doc?.items ?? []) {
        if (typeof it?.id === "string") items.set(it.id, { mandatory: it.mandatory === true, waiver_eligible: it.waiver_eligible !== false });
      }
      checklists.set(checklistIdForFile(file), items);
    } catch {
      // parse errors are reported by the checklist pass
    }
  }
  const procedureSteps = new Map<string, Set<string>>();
  const sharedDir = join(REPO_ROOT, "procedures", "_shared");
  if (existsSync(sharedDir)) {
    for (const dir of await readdir(sharedDir)) {
      const schema = join(sharedDir, dir, "schema.yaml");
      if (!existsSync(schema)) continue;
      try {
        const doc = yaml.load(await readFile(schema, "utf-8"), { schema: yaml.JSON_SCHEMA }) as { procedure_id?: string; steps?: { id?: unknown }[] };
        if (typeof doc?.procedure_id === "string") {
          procedureSteps.set(doc.procedure_id, new Set((doc.steps ?? []).map((s) => String(s?.id))));
        }
      } catch {
        // procedure parse errors are reported by procedures/_validate.ts
      }
    }
  }
  return { checklists, procedureSteps };
}

async function main() {
  const files = (await readdir(CHECKLIST_DIR)).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));

  if (files.length === 0) {
    console.error("No checklists/*.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
  let totalItems = 0;
  const summaries = new Map<string, ChecklistSummary>();

  for (const file of files) {
    const raw = await readFile(join(CHECKLIST_DIR, file), "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, item: "(parse)", message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }

    if (typeof doc !== "object" || doc === null) {
      allIssues.push({ file, item: "(root)", message: "Checklist root is not a mapping", severity: "error" });
      continue;
    }
    const root = doc as Record<string, unknown>;

    for (const field of REQUIRED_META) {
      const value = root[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        allIssues.push({ file, item: "(meta)", message: `Missing or empty required field '${field}'`, severity: "error" });
      }
    }

    if (!Array.isArray(root.items)) {
      allIssues.push({ file, item: "(items)", message: "Missing or non-array top-level 'items'", severity: "error" });
      continue;
    }

    const seenIds = new Set<string>();
    const summary: ChecklistSummary = { items: new Map() };
    summaries.set(file.replace(/\.yaml$/, ""), summary);
    for (const entry of root.items) {
      totalItems++;
      if (typeof entry !== "object" || entry === null) {
        allIssues.push({ file, item: `(item #${totalItems})`, message: "Item is not a mapping", severity: "error" });
        continue;
      }
      allIssues.push(...validateItem(file, entry as ItemShape, seenIds));
      const it = entry as ItemShape & { id?: unknown };
      if (typeof it.id === "string") summary.items.set(it.id, it);
    }

    const basis = root.legal_basis;
    if (basis !== undefined && !Array.isArray(basis)) {
      allIssues.push({ file, item: "(legal_basis)", message: "'legal_basis' must be an array when present", severity: "error" });
    } else if (Array.isArray(basis)) {
      for (const entry of basis) {
        if (typeof entry === "string" && looksLikeRepoPath(entry)) {
          const target = resolve(REPO_ROOT, entry.trim());
          if (!existsSync(target)) {
            allIssues.push({
              file,
              item: "(legal_basis)",
              message: `Referenced path '${entry.trim()}' does not exist in the repo (forward reference? keep, but track it)`,
              severity: "warn",
            });
          }
        }
      }
    }
  }

  // Overlays.
  const overlayDir = join(CHECKLIST_DIR, "_overlays");
  let overlayCount = 0;
  if (existsSync(overlayDir)) {
    const overlayFiles = (await readdir(overlayDir)).filter((f) => f.endsWith(".yaml"));
    const ctx = await loadOverlayContext(files);
    for (const f of overlayFiles) {
      overlayCount++;
      const rel = `_overlays/${f}`;
      try {
        const doc = yaml.load(await readFile(join(overlayDir, f), "utf-8"), { schema: yaml.JSON_SCHEMA });
        allIssues.push(...validateOverlay(rel, doc, ctx));
      } catch (e) {
        allIssues.push({ file: rel, item: "(parse)", message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      }
    }
  }

  // Legal sign-offs (optional directory).
  const signoffDir = join(REPO_ROOT, "legal-signoff");
  const signoffs: SignoffInput[] = [];
  if (existsSync(signoffDir)) {
    for (const f of (await readdir(signoffDir)).filter((x) => x.endsWith(".yaml") && !x.startsWith("_"))) {
      try {
        signoffs.push({ file: `legal-signoff/${f}`, doc: yaml.load(await readFile(join(signoffDir, f), "utf-8"), { schema: yaml.JSON_SCHEMA }) });
      } catch (e) {
        allIssues.push({ file: `legal-signoff/${f}`, item: "(parse)", message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      }
    }
  }
  allIssues.push(...validateSignoffs(signoffs, summaries));

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      const tag = i.severity === "error" ? "ERROR" : "WARN";
      console.log(`[${tag}] ${i.file} :: ${i.item} — ${i.message}`);
    }
  }

  console.log(`\nChecklist validation: ${files.length} file(s), ${totalItems} item(s), ${overlayCount} overlay(s), ${errors.length} error(s), ${warnings.length} warning(s).`);

  if (errors.length > 0) {
    console.error("❌ Checklist validation failed.");
    process.exit(1);
  }
  console.log("✅ Checklist validation passed.");
}

if (import.meta.main) main();
