// S11 PMI kickoff record (Wave F-6). flow.spec S11 activity `pmi-kickoff`
// (pmi-agent / pmi-planning / pmi-integration-execution): for brownfield
// M&A / JV / strategic-investment routes the integration-plan baseline is
// established after Entity/Group IC approval. The record is a HUMAN-recorded
// process_run (stage 's11_pmi_kickoff'), same ledger pattern as s8_case_adopt /
// s8_target_select — agents may draft the plan, but only a person records
// the kickoff (boundary #1/#2: recorded_by is the session user, never an
// agent persona id).
import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";

export const PMI_KICKOFF_STAGE = "s11_pmi_kickoff";

/** Brownfield sub-tracks that do NOT enter PMI (spec: PMI is for M&A/JV/strategic investment). */
export const NON_PMI_SUB_TRACKS: ReadonlySet<string> = new Set([
  "minority_investment", "partnership", "rbd", "corporate_venture", "existing_business_rbd", "intra_venture",
]);

export interface PmiKickoffRecord {
  id: string;
  recordedBy: string;
  recordedAt: string;
  owner: string;
  planNote: string;
}

export class PmiKickoffError extends Error {
  constructor(public readonly code: "invalid_input" | "agent_forbidden", message: string) {
    super(message);
  }
}

export function pmiKickoffApplies(track: string | null, subTrack: string | null): boolean {
  if (track !== "brownfield") return false;
  return !(subTrack && NON_PMI_SUB_TRACKS.has(subTrack));
}

export function latestPmiKickoff(db: Database, projectId: string): PmiKickoffRecord | null {
  const row = db
    .query(
      `SELECT id, started_by, finished_at, meta_json FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId, PMI_KICKOFF_STAGE) as { id: string; started_by: string; finished_at: string | null; meta_json: string | null } | undefined;
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { owner?: string; plan_note?: string };
    if (!meta.owner?.trim() || !meta.plan_note?.trim()) return null;
    return { id: row.id, recordedBy: row.started_by, recordedAt: row.finished_at ?? "", owner: meta.owner.trim(), planNote: meta.plan_note.trim() };
  } catch {
    return null;
  }
}

export function recordPmiKickoff(
  db: Database,
  input: { projectId: string; owner: string; planNote: string; recordedBy: string; now?: string },
): PmiKickoffRecord {
  const owner = input.owner.trim();
  const planNote = input.planNote.trim();
  if (!owner) throw new PmiKickoffError("invalid_input", "owner(통합 책임자)는 필수입니다.");
  if (planNote.length < 20) throw new PmiKickoffError("invalid_input", "plan_note(통합 계획 기준선)는 20자 이상이어야 합니다.");
  if (AGENT_KEYS.has(input.recordedBy)) {
    throw new PmiKickoffError("agent_forbidden", "PMI 킥오프 기록은 사람(세션 사용자)만 남길 수 있습니다.");
  }
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "project", input.projectId, input.projectId, SPEC_VERSION, PMI_KICKOFF_STAGE, "done", "web", input.recordedBy, now, now, JSON.stringify({ owner, plan_note: planNote })],
  );
  return { id, recordedBy: input.recordedBy, recordedAt: now, owner, planNote };
}
