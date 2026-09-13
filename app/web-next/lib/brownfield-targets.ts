// S6~S7 브라운필드 대상 경로 공용 로직 — 기회 목록, Long List 후보 CRUD,
// chk-target-screening 체크리스트 판정, Short List 승격/제외.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { getChecklistItems } from "./library.ts";

// Library registry id for the S7 screening checklist (checklists/target-screening-checklist.yaml).
// NOTE: the registry id is "chk-target-screening-checklist" — a previous
// "chk-target-screening" lookup here silently returned no checklist items.
export const SCREENING_CHECKLIST_ID = "chk-target-screening-checklist";

export interface TargetRow {
  id: string;
  opportunity_id: string;
  company_name: string;
  dart_corp_code: string | null;
  universe_note: string | null;
  status: "pending" | "shortlisted" | "excluded";
  rank: number | null;
  exclusion_reason: string | null;
  screening_json: string | null;
  created_at: string;
  updated_at: string;
}

export function screeningItems() {
  return getChecklistItems(SCREENING_CHECKLIST_ID) ?? [];
}

export function listTargets(opportunityId: string): TargetRow[] {
  return getDb()
    .query(
      `SELECT * FROM brownfield_target WHERE opportunity_id = ? ORDER BY
         CASE status WHEN 'shortlisted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
         rank IS NULL, rank, created_at`,
    )
    .all(opportunityId) as unknown as TargetRow[];
}

/** 체크리스트 판정 집계 — Long List 커버리지·knock-out 통과 여부 (S7 진행 입력). */
export function screeningSummary(target: TargetRow): {
  assessed: number;
  total: number;
  knockOutsPassed: boolean;
  anyKnockOutFail: boolean;
  mandatoryOpen: string[];
} {
  const items = screeningItems();
  const states = target.screening_json ? (JSON.parse(target.screening_json) as Record<string, string>) : {};
  const mandatoryOpen: string[] = [];
  let assessed = 0;
  let anyKnockOutFail = false;
  for (const item of items) {
    const st = states[item.id];
    if (st && st !== "pending") assessed++;
    if (item.mandatory && st === "fail") anyKnockOutFail = true;
    if (item.mandatory && (!st || st === "pending")) mandatoryOpen.push(item.id);
  }
  return { assessed, total: items.length, knockOutsPassed: !anyKnockOutFail && mandatoryOpen.length === 0, anyKnockOutFail, mandatoryOpen };
}

export function createTarget(opportunityId: string, companyName: string, dartCorpCode: string | null, universeNote: string | null): TargetRow {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, universe_note, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, opportunityId, companyName, dartCorpCode, universeNote, "pending", now, now],
  );
  return getDb().query("SELECT * FROM brownfield_target WHERE id = ?").get(id) as unknown as TargetRow;
}
