// S6~S7 브라운필드 대상 경로 공용 로직 — 기회 목록, Long List 후보 CRUD,
// chk-target-screening 체크리스트 판정, Short List 승격/제외.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { getChecklistItems } from "./library.ts";
import { canonicalCompanyName } from "./company-name.ts";
import { listOrSeedCriteria } from "./brownfield-eval-criteria.ts";
import { normalizeVerdict } from "./brownfield-precheck.ts";

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
  screening_evidence_json: string | null;
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

/** 체크리스트 판정 집계 — Long List 커버리지·knock-out 통과 여부 (S7 진행 입력).
 * 판정 척도는 2026-09-16 5단으로 세분화(confirmed/probable/partial/unfulfilled/
 * insufficient) — 구버전 값(pass/fail/na/waived)은 읽기 시점 정규화한다.
 * assessed는 insufficient도 "판정이 내려진 것"으로 센다(근거 부족도 결정이다). */
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
    const st = normalizeVerdict(states[item.id]);
    if (st !== "pending") assessed++;
    if (item.mandatory && st === "unfulfilled") anyKnockOutFail = true;
    if (item.mandatory && st === "pending") mandatoryOpen.push(item.id);
  }
  return {
    assessed,
    total: items.length,
    knockOutsPassed: !anyKnockOutFail && mandatoryOpen.length === 0,
    anyKnockOutFail,
    mandatoryOpen,
  };
}

/**
 * S6 (Wave F-6): a Long List candidate counts toward coverage only when it
 * carries the procedure's required attributes AND a source
 * (procedures/_shared/brownfield-target-identification: "candidates without
 * required attributes or sources do not count toward coverage").
 *  - attributes: an identity (DART corp code or a resolved md_company) and the
 *    universe-fit note (segment / why it is in the Universe).
 *  - source: an accepted master/web proposal, or ≥1 discovery evidence row
 *    that carries a source URL or a detail note (createTarget writes one on
 *    registration, so a candidate registered without any note is flagged).
 * Returns the missing parts ([] = qualified).
 */
export function longListCandidateGaps(
  t: TargetRow & { company_id: string | null },
  db: Database = getDb(),
): Array<"attributes" | "source"> {
  const gaps: Array<"attributes" | "source"> = [];
  const hasIdentity = Boolean((t.dart_corp_code ?? "").trim() || t.company_id);
  if (!t.company_name.trim() || !hasIdentity || !(t.universe_note ?? "").trim()) gaps.push("attributes");
  const acceptedProposal = t.discovery_source !== "manual" && Boolean(t.proposal_accepted_at);
  const discovery = db
    .query(
      `SELECT 1 FROM brownfield_target_evidence
       WHERE target_id = ? AND kind = 'discovery' AND (TRIM(COALESCE(source_url, '')) != '' OR TRIM(COALESCE(detail, '')) != '') LIMIT 1`,
    )
    .get(t.id);
  if (!acceptedProposal && !discovery) gaps.push("source");
  return gaps;
}

/**
 * S7 (Wave F-6, flow.spec "스크리닝 근거(evidence)가 후보별로 기록되었다"):
 * a SHORTLISTED candidate needs ≥1 evidence ref — a saved screening evidence
 * timeline row or the per-item screening_evidence_json. (An excluded candidate
 * is covered by its explicit exclusion_reason instead.)
 */
export function hasScreeningEvidence(t: TargetRow, db: Database = getDb()): boolean {
  const json = (t.screening_evidence_json ?? "").trim();
  if (json && json !== "{}" && json !== "[]" && json !== "null") return true;
  return Boolean(
    db.query("SELECT 1 FROM brownfield_target_evidence WHERE target_id = ? AND kind = 'screening' LIMIT 1").get(t.id),
  );
}

/** 회사명(우선 dart_corp_code, 없으면 name_ko)으로 md_company를 찾거나
 * 만든다 — Long List 등록·Short List 승격 양쪽에서 재사용하는 멱등 함수.
 *
 * design 2026-11-11-target-identity-resolution §3.3 — 이름 매칭은 3단:
 * ① 코드 일치(유니크 인덱스 존중, 변경 없음) → ② 정규화된 이름 일치 →
 * ③ 원문 이름 일치(레거시 비정규 행). ③이 적중하고 정규화 결과가 다르면
 * 그 행의 name_ko를 정규형으로 1회 갱신한다(멱등 — 쌍둥이 행 생성 대신
 * 제자리 정규화). 감사 커버리지는 호출부의 brownfield_target.update 행이
 * 담당한다(이 함수는 actor 파라미터를 갖지 않는다). INSERT는 항상 정규형. */
export function resolveOrCreateCompany(db: Database, companyName: string, dartCorpCode: string | null): string {
  const canonical = canonicalCompanyName(companyName);
  const byCode = dartCorpCode
    ? (db.query("SELECT id FROM md_company WHERE dart_corp_code = ?").get(dartCorpCode) as { id: string } | undefined)
    : undefined;
  let mc =
    byCode ?? (db.query("SELECT id FROM md_company WHERE name_ko = ?").get(canonical) as { id: string } | undefined);
  if (!mc) {
    // 원문(레거시 비정규) 이름 2차 패스 — 적중 시 제자리 정규화.
    const raw = db.query("SELECT id, name_ko FROM md_company WHERE name_ko = ?").get(companyName) as
      | { id: string; name_ko: string }
      | undefined;
    if (raw) {
      if (canonical !== raw.name_ko) db.run("UPDATE md_company SET name_ko = ? WHERE id = ?", [canonical, raw.id]);
      mc = { id: raw.id };
    }
  }
  if (mc) {
    if (dartCorpCode)
      db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ? AND dart_corp_code IS NULL", [dartCorpCode, mc.id]);
    return mc.id;
  }
  const id = ulid();
  db.run("INSERT INTO md_company (id, dart_corp_code, name_ko, created_at) VALUES (?,?,?,?)", [
    id,
    dartCorpCode,
    canonical,
    new Date().toISOString(),
  ]);
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
export function createTarget(
  opportunityId: string,
  companyName: string,
  dartCorpCode: string | null,
  universeNote: string | null,
  opts: CreateTargetOptions,
): TargetRow {
  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();
  // design 2026-11-11 §3.2 — both brownfield_target.company_name and
  // md_company.name_ko hold the canonical form; the raw glossed string stays
  // on the proposal card / evidence trail only.
  const canonical = canonicalCompanyName(companyName);
  db.transaction(() => {
    db.run(
      `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, universe_note, discovery_source, proposal_accepted_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        opportunityId,
        canonical,
        dartCorpCode,
        universeNote,
        opts.discoverySource ?? "manual",
        opts.proposalAcceptedAt ?? null,
        "pending",
        now,
        now,
      ],
    );
    resolveOrCreateCompany(db, canonical, dartCorpCode);
    listOrSeedCriteria(opportunityId, opts.actorUserId, db);
    // 등록 시점 근거 — 발굴 경로·제안 사유·출처를 타임라인에 적립한다
    // (사용자 결정, 2026-09-16: 수집 정보를 후보 상세에서 나중에 참고).
    insertTargetEvidence(db, {
      targetId: id,
      kind: "discovery",
      title: `후보 등록 — ${opts.discoverySource === "web_proposal" ? "웹검색 제안 수용" : opts.discoverySource === "master_proposal" ? "시장·기업 마스터 제안 수용" : "직접 등록"}`,
      detail: universeNote,
      sourceKind: opts.discoverySource ?? "manual",
      createdBy: opts.actorUserId,
    });
  })();
  return getDb().query("SELECT * FROM brownfield_target WHERE id = ?").get(id) as unknown as TargetRow;
}

/** 후보 근거 타임라인 1건 적립(brownfield_target_evidence, 0109). 등록·
 * 재분석·위원회 추천 검토 등 시점에서 수집된 "나중에 참고할 정보"를 기록한다.
 * 실패해도 본 작업을 막지 않는다 — 근거 적립은 부가 기록이다. */
export function insertTargetEvidence(
  db: Database,
  row: {
    targetId: string;
    kind: "discovery" | "analysis" | "screening";
    title: string;
    detail?: string | null;
    sourceUrl?: string | null;
    sourceKind?: string | null;
    createdBy?: string | null;
  },
): void {
  try {
    db.run(
      `INSERT INTO brownfield_target_evidence (id, target_id, kind, title, detail, source_url, source_kind, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        ulid(),
        row.targetId,
        row.kind,
        row.title,
        row.detail ?? null,
        row.sourceUrl ?? null,
        row.sourceKind ?? null,
        row.createdBy ?? null,
        new Date().toISOString(),
      ],
    );
  } catch {
    // 근거 적립 실패는 본 작업(등록·분석·판정 저장)을 막지 않는다.
  }
}

/** 회사 마스터에 연결된 후보 id 목록 — 해석 순서는 상세 화면과 동일
 * (dart_corp_code 일치 우선, 없으면 name_ko 일치). 재분석 완료 시 관련
 * 후보 전체에 근거를 적립할 때 쓴다. */
export function targetIdsForCompany(db: Database, companyId: string): string[] {
  const company = db.query("SELECT name_ko, dart_corp_code FROM md_company WHERE id = ?").get(companyId) as
    | { name_ko: string; dart_corp_code: string | null }
    | undefined;
  if (!company) return [];
  const rows = db
    .query(
      `SELECT id FROM brownfield_target
       WHERE (dart_corp_code IS NOT NULL AND dart_corp_code = ?)
          OR (dart_corp_code IS NULL AND company_name = ?)`,
    )
    .all(company.dart_corp_code ?? "\u0000", company.name_ko) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// 사전 검토(chk-target-screening) 추천안 도출 헬퍼(KNOCKOUT_IDS,
// precheckRecommendation)는 클라이언트에서도 쓰므로 lib/brownfield-precheck.ts
// (순수 함수, DB import 없음)에 둔다.

/**
 * Wave C-3 (pilot-009 D-5 / discrepancy 4.1): a deal can start from a named
 * ("known") target. The target is pre-filled into S6 (Long List) with this
 * marker in universe_note so screens can guide the user through S1–S4 with the
 * target as context. No predicate is skipped — S1–S4 must still be completed.
 */
export const KNOWN_TARGET_NOTE_PREFIX = "[알려진 대상]";

export function isKnownTargetNote(note: string | null | undefined): boolean {
  return (note ?? "").startsWith(KNOWN_TARGET_NOTE_PREFIX);
}

// ── design 2026-11-11-target-identity-resolution: D3 code-aware duplicates,
//    D4 one unified PATCH path ──

/** D3 (design §5.1) — code-or-canonical duplicate match over an opportunity's
 *  non-excluded targets. Rows are fetched and compared in JS (long lists are
 *  tens of rows, not thousands): a duplicate is an existing target with the
 *  same non-null dart_corp_code, or the same CANONICAL company name (a
 *  glossed re-proposal of a clean row dedupes; the bare-name equality this
 *  replaces could not see through the gloss). Registration is "ensure
 *  present" — callers turn a hit into 200 + meta deduped:true, not a 400. */
export function findDuplicateTarget(
  db: Database,
  opportunityId: string,
  companyName: string,
  dartCorpCode: string | null,
): TargetRow | null {
  const rows = db
    .query("SELECT * FROM brownfield_target WHERE opportunity_id = ? AND status != 'excluded'")
    .all(opportunityId) as unknown as TargetRow[];
  const canonical = canonicalCompanyName(companyName);
  const code = dartCorpCode?.trim() || null;
  for (const r of rows) {
    if (code && r.dart_corp_code === code) return r;
    if (canonicalCompanyName(r.company_name) === canonical) return r;
  }
  return null;
}

/** D3 PATCH collision (design §5.1) — would this PATCH move the target's
 *  canonical name or code onto a DIFFERENT non-excluded sibling in the same
 *  opportunity? Absent patch keys mean "unchanged" (the row's current values
 *  participate); explicit null clears a code. Returns the colliding sibling
 *  row (surfaces as 409 duplicate_target + existing_target_id; merging
 *  targets is destructive and stays a human action — no auto-merge). */
export function findPatchCollision(
  db: Database,
  targetId: string,
  patch: { company_name?: string; dart_corp_code?: string | null },
): TargetRow | null {
  const row = db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId) as TargetRow | undefined;
  if (!row) return null;
  const nextName =
    patch.company_name !== undefined ? canonicalCompanyName(patch.company_name) || row.company_name : row.company_name;
  const nextCode = patch.dart_corp_code !== undefined ? patch.dart_corp_code?.trim() || null : row.dart_corp_code;
  const siblings = db
    .query("SELECT * FROM brownfield_target WHERE opportunity_id = ? AND id != ? AND status != 'excluded'")
    .all(row.opportunity_id, targetId) as unknown as TargetRow[];
  for (const s of siblings) {
    if (nextCode && s.dart_corp_code === nextCode) return s;
    if (canonicalCompanyName(s.company_name) === canonicalCompanyName(nextName)) return s;
  }
  return null;
}

export interface UpdateTargetFieldsPatch {
  company_name?: string;
  /** Absent key = unchanged; explicit null = clear (fixes the opp-keyed
   *  PATCH route's COALESCE inability to clear a code). */
  dart_corp_code?: string | null;
  universe_note?: string | null;
}

/** D4 (design §5.2) — THE single target-update path. Canonicalizes the name,
 *  updates the row (absent key = unchanged, explicit null = clear), then
 *  ALWAYS re-links the company master via resolveOrCreateCompany — ending the
 *  split-brain where the opportunity-keyed PATCH route never touched
 *  md_company — and audits one brownfield_target.update shape (composite
 *  `${opportunity_id}:${targetId}`) for both PATCH routes. */
export function updateTargetFields(
  db: Database,
  targetId: string,
  patch: UpdateTargetFieldsPatch,
  opts: { actorUserId: string },
): TargetRow {
  const row = db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId) as TargetRow | undefined;
  if (!row) throw new Error(`brownfield_target ${targetId} not found`); // both routes pre-check existence
  // Blank company_name keeps the stored name (the detail route's blank-name
  // guard rejects it earlier; COALESCE parity for the opp-keyed route).
  const canonicalName =
    patch.company_name !== undefined ? canonicalCompanyName(patch.company_name) || row.company_name : row.company_name;
  const code = patch.dart_corp_code !== undefined ? patch.dart_corp_code?.trim() || null : row.dart_corp_code;
  const note = patch.universe_note !== undefined ? patch.universe_note?.trim() || null : row.universe_note;
  db.run(
    "UPDATE brownfield_target SET company_name = ?, dart_corp_code = ?, universe_note = ?, updated_at = ? WHERE id = ?",
    [canonicalName, code, note, new Date().toISOString(), targetId],
  );
  // Every write path re-links the company master (idempotent; by-code pass
  // first respects the unique md_company.dart_corp_code index).
  resolveOrCreateCompany(db, canonicalName, code);
  appendAudit(db, {
    actor: opts.actorUserId,
    action: "brownfield_target.update",
    target: `${row.opportunity_id}:${targetId}`,
    now: new Date().toISOString(),
  });
  return db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId) as unknown as TargetRow;
}
