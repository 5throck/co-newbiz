// establishment — shared read/write model for the S11 설립 실행 5단계 record
// (entity-establishment-execution, ADR-0085; project key ADR-0100 §1/§2).
//
// One ledger, two projections. entity_establishment_step rows carry BOTH
// opportunity_id (origin of record, NOT NULL since 0059) and project_id
// (backfilled in 0070). Reads resolve through project_id first and fall back
// to the source_opportunity_id backlink ONLY for legacy rows that predate the
// backfill (project_id IS NULL); writes always land on project_id-keyed rows.
// The project route is therefore a projection of the same rows the
// opportunity route serves — never a second ledger.
//
// Sequence enforcement (ADR-0085/0059): 완료확인 (step 5) may only be marked
// done after steps 1–4 are all done. Status vocabulary matches the procedure
// kill-criteria actions 1:1: pending | in_progress | done | halted | escalated.
// origin∈{internal, joint} only (ADR-0047, the procedure's applies_when).
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export const ESTABLISHMENT_STATUSES = ["pending", "in_progress", "done", "halted", "escalated"] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

export const ESTABLISHMENT_ORIGINS = ["internal", "joint"] as const;
export type EstablishmentOrigin = (typeof ESTABLISHMENT_ORIGINS)[number];

export const ESTABLISHMENT_STEP_TITLES: Record<number, string> = {
  1: "설립준비(관할·주식구조·이사회 결의)",
  2: "법인등기·정관·사업자등록",
  3: "인허가 이전/재발급 분류",
  4: "인력이전(신 근로계약+PIIA)",
  5: "완료확인(IP양도체인·거버넌스 베이스라인)",
};

export interface EstablishmentStepRow {
  id: string;
  step_no: number;
  status: EstablishmentStatus;
  origin: EstablishmentOrigin;
  checklist_item: string | null;
  evidence_url: string | null;
  note: string | null;
  owner: string;
  updated_at: string;
  /** How this row was reached — project_id key, or the legacy opportunity backlink. */
  keyed_by: "project" | "backlink";
}

interface ProjectKeyRow {
  id: string;
  source_opportunity_id: string | null;
}

function projectKeyRow(projectId: string): ProjectKeyRow | undefined {
  return getDb()
    .query("SELECT id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as ProjectKeyRow | undefined;
}

/** All establishment steps visible for a project — project_id-keyed rows
 * plus, as fallback, un-backfilled rows reached through the opportunity
 * backlink (ADR-0100 §1). Sorted by step_no. */
export function listEstablishmentSteps(projectId: string): EstablishmentStepRow[] {
  const project = projectKeyRow(projectId);
  if (!project) return [];
  const db = getDb();
  const direct = db
    .query(
      `SELECT id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at
       FROM entity_establishment_step WHERE project_id = ? ORDER BY step_no, id`,
    )
    .all(projectId) as Array<Omit<EstablishmentStepRow, "keyed_by">>;
  const seen = new Set(direct.map((r) => r.id));
  let fallback: Array<Omit<EstablishmentStepRow, "keyed_by">> = [];
  if (project.source_opportunity_id) {
    fallback = db
      .query(
        `SELECT id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at
         FROM entity_establishment_step
         WHERE project_id IS NULL AND opportunity_id = ?
         ORDER BY step_no, id`,
      )
      .all(project.source_opportunity_id) as Array<Omit<EstablishmentStepRow, "keyed_by">>;
  }
  return [
    ...direct.map((r) => ({ ...r, keyed_by: "project" as const })),
    ...fallback.filter((r) => !seen.has(r.id)).map((r) => ({ ...r, keyed_by: "backlink" as const })),
  ].sort((a, b) => a.step_no - b.step_no || a.id.localeCompare(b.id));
}

export interface EstablishmentProgress {
  done: number;
  total: 5;
  complete: boolean;
}

/** Distinct completed step numbers for the project — the S11 predicate input
 * (process-flow) and the IC-package progress (n/5) both read this, so the
 * count cannot drift between surfaces. */
export function establishmentProgress(projectId: string): EstablishmentProgress {
  const project = projectKeyRow(projectId);
  if (!project) return { done: 0, total: 5, complete: false };
  const db = getDb();
  const rows = db
    .query(
      `SELECT DISTINCT step_no FROM entity_establishment_step
       WHERE status = 'done' AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .all(projectId, project.source_opportunity_id ?? "") as Array<{ step_no: number }>;
  return { done: rows.length, total: 5, complete: rows.length >= 5 };
}

export type UpsertResult =
  | { ok: true; id: string; step_no: number; status: EstablishmentStatus; title: string; step_done: boolean; updated_at: string }
  | { ok: false; error: "sequence_violation" | "no_origin_opportunity" };

export interface UpsertInput {
  step_no: number;
  status: EstablishmentStatus;
  origin: EstablishmentOrigin;
  checklist_item?: string | null;
  evidence_url?: string | null;
  note?: string | null;
}

/**
 * Write one establishment step for the project. Writes are ALWAYS
 * project_id-keyed (ADR-0100 §2); opportunity_id keeps the origin-of-record
 * backlink where the project has one. A new row requires either a source
 * opportunity (0059 keeps opportunity_id NOT NULL) or an existing
 * project-keyed row to update. Step 5 'done' is gated on steps 1–4 all done
 * across the project's full visible step set.
 */
export function upsertEstablishmentStep(projectId: string, input: UpsertInput, owner: string): UpsertResult {
  const db = getDb();
  const now = new Date().toISOString();
  const itemKey = input.checklist_item?.trim() || null;

  // 순서 강제 — 완료확인(5)은 선행 4단계가 모두 done일 때만 완료할 수 있다.
  if (input.step_no === 5 && input.status === "done") {
    const prior = establishmentPriorDone(projectId);
    if (prior < 4) return { ok: false, error: "sequence_violation" };
  }

  const existing = db
    .query(
      `SELECT id FROM entity_establishment_step
       WHERE project_id = ? AND step_no = ? AND checklist_item IS ?`,
    )
    .get(projectId, input.step_no, itemKey) as { id: string } | undefined;

  if (existing) {
    db.run(
      `UPDATE entity_establishment_step
       SET status = ?, evidence_url = ?, note = ?, owner = ?, updated_at = ?
       WHERE id = ?`,
      [input.status, input.evidence_url?.trim() || null, input.note?.trim() || null, owner, now, existing.id],
    );
    return { ok: true, id: existing.id, step_no: input.step_no, ...resultFields(projectId, input, now) };
  }

  const project = projectKeyRow(projectId);
  if (!project?.source_opportunity_id) return { ok: false, error: "no_origin_opportunity" };

  // ADOPT, never duplicate: a matching legacy row that still lives only under
  // the opportunity backlink (project_id NULL, pre-backfill) is promoted in
  // place to the project key. Inserting a second row for the same
  // (opportunity, step) would double-count the opportunity establishment
  // view — the two routes share one ledger.
  const legacy = db
    .query(
      `SELECT id FROM entity_establishment_step
       WHERE project_id IS NULL AND opportunity_id = ? AND step_no = ? AND checklist_item IS ?`,
    )
    .get(project.source_opportunity_id, input.step_no, itemKey) as { id: string } | undefined;

  if (legacy) {
    db.run(
      `UPDATE entity_establishment_step
       SET project_id = ?, status = ?, evidence_url = ?, note = ?, owner = ?, updated_at = ?
       WHERE id = ?`,
      [projectId, input.status, input.evidence_url?.trim() || null, input.note?.trim() || null, owner, now, legacy.id],
    );
    return { ok: true, id: legacy.id, step_no: input.step_no, ...resultFields(projectId, input, now) };
  }

  const rowId = ulid();
  db.run(
    `INSERT INTO entity_establishment_step
       (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, project.source_opportunity_id, projectId, input.step_no, input.status, input.origin,
      itemKey, input.evidence_url?.trim() || null, input.note?.trim() || null, owner, now],
  );
  return { ok: true, id: rowId, step_no: input.step_no, ...resultFields(projectId, input, now) };
}

function resultFields(projectId: string, input: UpsertInput, now: string) {
  const doneCount = (getDb()
    .query(
      `SELECT COUNT(*) AS c FROM entity_establishment_step
       WHERE project_id = ? AND step_no = ? AND status = 'done'`,
    )
    .get(projectId, input.step_no) as { c: number }).c;
  return { status: input.status, title: ESTABLISHMENT_STEP_TITLES[input.step_no], step_done: doneCount > 0, updated_at: now };
}

/** Done count across steps 1–4, project-keyed rows plus the backlink fallback. */
function establishmentPriorDone(projectId: string): number {
  const project = projectKeyRow(projectId);
  if (!project) return 0;
  const row = getDb()
    .query(
      `SELECT COUNT(DISTINCT step_no) AS c FROM entity_establishment_step
       WHERE status = 'done' AND step_no < 5 AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .get(projectId, project.source_opportunity_id ?? "") as { c: number };
  return row.c;
}
