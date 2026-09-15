// S6~S7 브라운필드 대상 경로 공용 로직 — 기회 목록, Long List 후보 CRUD,
// chk-target-screening 체크리스트 판정, Short List 승격/제외.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { getChecklistItems } from "./library.ts";
import { listOrSeedCriteria } from "./brownfield-eval-criteria.ts";

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
  discovery_source: "manual" | "master_proposal" | "web_proposal";
  proposal_accepted_at: string | null;
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

/** company_id는 저장된 컬럼이 아니라 조회 시점에 md_company를 찾아 붙인다
 * (dart_corp_code 일치 우선, 없으면 name_ko 폴백 — resolveOrCreateCompany와
 * 동일한 해석 순서). name_ko에는 유니크 제약이 없어 완전한 정합은 아니지만
 * dart_corp_code가 있는 대상은 정확히 매칭된다. */
export function listTargets(opportunityId: string): Array<TargetRow & { company_id: string | null }> {
  return getDb()
    .query(
      `SELECT bt.*,
         COALESCE(
           (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code),
           (SELECT mc.id FROM md_company mc WHERE mc.name_ko = bt.company_name)
         ) AS company_id
       FROM brownfield_target bt
       WHERE bt.opportunity_id = ? ORDER BY
         CASE bt.status WHEN 'shortlisted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
         bt.rank IS NULL, bt.rank, bt.created_at`,
    )
    .all(opportunityId) as unknown as Array<TargetRow & { company_id: string | null }>;
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

/** 회사명(우선 dart_corp_code, 없으면 name_ko)으로 md_company를 찾거나
 * 만든다 — Long List 등록·Short List 승격 양쪽에서 재사용하는 멱등 함수. */
export function resolveOrCreateCompany(db: Database, companyName: string, dartCorpCode: string | null): string {
  const byCode = dartCorpCode
    ? (db.query("SELECT id FROM md_company WHERE dart_corp_code = ?").get(dartCorpCode) as { id: string } | undefined)
    : undefined;
  const mc = byCode ?? (db.query("SELECT id FROM md_company WHERE name_ko = ?").get(companyName) as { id: string } | undefined);
  if (mc) {
    if (dartCorpCode) db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ? AND dart_corp_code IS NULL", [dartCorpCode, mc.id]);
    return mc.id;
  }
  const id = ulid();
  db.run("INSERT INTO md_company (id, dart_corp_code, name_ko, created_at) VALUES (?,?,?,?)", [id, dartCorpCode, companyName, new Date().toISOString()]);
  return id;
}

export interface CreateTargetOptions {
  discoverySource?: "manual" | "master_proposal" | "web_proposal";
  proposalAcceptedAt?: string;
  actorUserId: string;
}

/** Long List 후보 등록 — 등록 즉시 회사 마스터(md_company)를 확보하고 이
 * 오퍼튜니티의 평가 기준 카탈로그(재무 빌트인 + S3 기술)를 시딩해, 등록
 * 직후부터 재무·기술 평가가 가능한 상태로 만든다(경계 #2: 시딩만 하고
 * 판정은 항상 사람이 함). 세 단계는 하나의 트랜잭션으로 묶어 도중 실패
 * 시 등록되다 만 타겟이 남지 않게 한다. */
export function createTarget(opportunityId: string, companyName: string, dartCorpCode: string | null, universeNote: string | null, opts: CreateTargetOptions): TargetRow {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, universe_note, discovery_source, proposal_accepted_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, opportunityId, companyName, dartCorpCode, universeNote, opts.discoverySource ?? "manual", opts.proposalAcceptedAt ?? null, "pending", now, now],
    );
    resolveOrCreateCompany(db, companyName, dartCorpCode);
    listOrSeedCriteria(opportunityId, opts.actorUserId, db);
  })();
  return getDb().query("SELECT * FROM brownfield_target WHERE id = ?").get(id) as unknown as TargetRow;
}
