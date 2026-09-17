// company-competitors.ts — 인간 확정 경쟁사 레지스트리 (ADR-0142, design
// 2026-09-18-company-competitor-registry-design). 프로필 payload의
// competitive.competitors는 "제안"일 뿐이고, 확정 행은 사람의 수용(register/
// accept)으로만 생긴다(경계 #2). 수용 시점에 대조 판정·근거를 행에 스냅샷해
// 이후 payload 재생성·이름 변경과 무관하게 보존한다. 브라운필드 후보발굴
// 제안-수용 계약(target-proposals)을 준용: 중복 검사는 제외 행을 제외하고,
// 제안 목록은 stateless(최신 payload에서 조립).
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { loadLatestProfile, type ProfileSubject } from "./company-profile-pipeline.ts";
import type { ClaimVerdict } from "./company-profile-crosscheck.ts";

type Db = ReturnType<typeof getDb>;

export interface CompetitorRow {
  id: string;
  member_id: string | null;
  company_id: string | null;
  name: string;
  dart_corp_code: string | null;
  note: string | null;
  status: "confirmed" | "excluded";
  exclusion_reason: string | null;
  discovery_source: "manual" | "ai_proposal";
  proposal_accepted_at: string;
  crosscheck_verdict: ClaimVerdict | null;
  evidence_json: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface CompetitorProposal {
  name: string;
  note: string;
  verdict: ClaimVerdict | null;
  evidence: Array<{ title: string | null; url: string }>;
  /** 레지스트리에 이미 같은 이름의 행(확정·제외 모두)이 있으면 true */
  accepted: boolean;
}

function subjectColumn(subject: Pick<ProfileSubject, "kind">): "member_id" | "company_id" {
  return subject.kind === "member" ? "member_id" : "company_id";
}

function subjectEq(subject: Pick<ProfileSubject, "kind" | "id">): { column: string; id: string } {
  return { column: subjectColumn(subject), id: subject.id };
}

export function listConfirmedCompetitors(db: Db, subject: Pick<ProfileSubject, "kind" | "id">): CompetitorRow[] {
  const { column, id } = subjectEq(subject);
  return db
    .query(
      `SELECT * FROM company_competitor WHERE ${column} = ? AND status = 'confirmed' ORDER BY proposal_accepted_at ASC, name ASC`,
    )
    .all(id) as CompetitorRow[];
}

export function findCompetitor(db: Db, subject: Pick<ProfileSubject, "kind" | "id">, competitorId: string): CompetitorRow | null {
  const { column, id } = subjectEq(subject);
  return (
    (db
      .query(`SELECT * FROM company_competitor WHERE id = ? AND ${column} = ?`)
      .get(competitorId, id) as CompetitorRow | undefined) ?? null
  );
}

/** 최신 완료 프로필 payload의 competitors를 제안으로 조립한다 — 저장 없음.
 *  대조 판정·근거는 crossCheck claim의 "경쟁사 {name}:" 접두어로 매핑한다. */
export function listCompetitorProposals(db: Db, subject: Pick<ProfileSubject, "kind" | "id">): CompetitorProposal[] {
  const payload = loadLatestProfile(db, subject);
  const competitive = payload?.competitive;
  if (!competitive?.competitors?.length) return [];
  const claims = competitive.crossCheck?.claims ?? [];
  const claimFor = (name: string) => claims.find((c) => c.claim.startsWith(`경쟁사 ${name}:`));
  const { column, id } = subjectEq(subject);
  const known = new Set(
    (db
      .query(`SELECT name FROM company_competitor WHERE ${column} = ?`)
      .all(id) as Array<{ name: string }>).map((r) => r.name),
  );
  const seen = new Set<string>();
  const proposals: CompetitorProposal[] = [];
  for (const c of competitive.competitors) {
    const name = c.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const claim = claimFor(name);
    const evidence: Array<{ title: string | null; url: string }> = [];
    if (claim?.url) evidence.push({ title: null, url: claim.url });
    for (const s of payload?.researchSources ?? []) {
      if (evidence.length >= 3) break;
      if (s.url && !evidence.some((e) => e.url === s.url)) evidence.push({ title: s.title ?? null, url: s.url });
    }
    proposals.push({
      name,
      note: c.note ?? "",
      verdict: claim?.verdict ?? null,
      evidence,
      accepted: known.has(name),
    });
  }
  return proposals;
}

export interface RegisterCompetitorInput {
  name: string;
  dart_corp_code?: string | null;
  note?: string | null;
  discovery_source: "manual" | "ai_proposal";
  crosscheck_verdict?: ClaimVerdict | null;
  evidence?: Array<{ title: string | null; url: string }> | null;
}

/** 수용(ai_proposal)·수작업(manual) 등록 — 확정 행을 만드는 유일한 경로.
 *  중복(제외 행 제외)은 브라운필드 제안 계약과 동일하게 거절한다.
 *  ai_proposal 수용 시 최신 payload에서 대조 판정·근거를 스냅샷한다(R3). */
export function registerCompetitor(
  db: Db,
  subject: ProfileSubject,
  input: RegisterCompetitorInput,
  actorUserId: string,
): { id: string } {
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("경쟁사명은 필수입니다."), { code: "name_required" });
  const { column, id } = subjectEq(subject);
  const dup = db
    .query(`SELECT id FROM company_competitor WHERE ${column} = ? AND name = ? AND status != 'excluded'`)
    .get(id, name) as { id: string } | undefined;
  if (dup) throw Object.assign(new Error(`'${name}'은(는) 이미 확정 경쟁사로 등록되어 있습니다.`), { code: "duplicate_competitor" });

  let verdict = input.crosscheck_verdict ?? null;
  let evidence = input.evidence ?? null;
  if (input.discovery_source === "ai_proposal" && verdict === null) {
    // 서버 측 스냅샷 — 클라이언트가 보낸 값보다 최신 payload의 대조 결과를 우선한다.
    const proposal = listCompetitorProposals(db, subject).find((p) => p.name === name);
    if (proposal) {
      verdict = proposal.verdict;
      evidence = proposal.evidence.length ? proposal.evidence : null;
    }
  }

  const rowId = `cc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO company_competitor (id, ${column}, name, dart_corp_code, note, status, discovery_source, proposal_accepted_at, crosscheck_verdict, evidence_json, created_by, created_at)
     VALUES (?,?,?,?,?,'confirmed',?,?,?,?,?,?)`,
    [
      rowId,
      id,
      name,
      input.dart_corp_code?.trim() || null,
      input.note?.trim() || null,
      input.discovery_source,
      now,
      verdict,
      evidence ? JSON.stringify(evidence) : null,
      actorUserId,
      now,
    ],
  );
  appendAudit(db, {
    actor: actorUserId,
    action: input.discovery_source === "ai_proposal" ? "competitor.accept" : "competitor.register",
    target: `${subject.kind}:${subject.id}:${rowId}`,
    now,
  });
  return { id: rowId };
}

/** 비고·DART 코드 수정 — 상태·출처는 이 경로로 바꾸지 않는다. */
export function updateCompetitor(
  db: Db,
  subject: Pick<ProfileSubject, "kind" | "id">,
  competitorId: string,
  patch: { note?: string | null; dart_corp_code?: string | null },
  actorUserId: string,
): CompetitorRow | null {
  const row = findCompetitor(db, subject, competitorId);
  if (!row) return null;
  const now = new Date().toISOString();
  db.run(
    "UPDATE company_competitor SET note = ?, dart_corp_code = ?, updated_at = ? WHERE id = ?",
    [patch.note !== undefined ? patch.note?.trim() || null : row.note, patch.dart_corp_code !== undefined ? patch.dart_corp_code?.trim() || null : row.dart_corp_code, now, competitorId],
  );
  appendAudit(db, { actor: actorUserId, action: "competitor.update", target: `${subject.kind}:${subject.id}:${competitorId}`, now });
  return findCompetitor(db, subject, competitorId);
}

/** 소프트 제외 — 사유 필수(브라운필드 제외 패턴). UNIQUE 인덱스는 confirmed에만
 *  걸려 있으므로 제외 행은 같은 이름의 재등록을 막지 않는다. */
export function excludeCompetitor(
  db: Db,
  subject: Pick<ProfileSubject, "kind" | "id">,
  competitorId: string,
  reason: string,
  actorUserId: string,
): CompetitorRow | null {
  const row = findCompetitor(db, subject, competitorId);
  if (!row) return null;
  if (!reason.trim()) throw Object.assign(new Error("제외 사유는 필수입니다."), { code: "reason_required" });
  const now = new Date().toISOString();
  db.run("UPDATE company_competitor SET status = 'excluded', exclusion_reason = ?, updated_at = ? WHERE id = ?", [reason.trim(), now, competitorId]);
  appendAudit(db, { actor: actorUserId, action: "competitor.exclude", target: `${subject.kind}:${subject.id}:${competitorId}`, now });
  return findCompetitor(db, subject, competitorId);
}

export function restoreCompetitor(
  db: Db,
  subject: Pick<ProfileSubject, "kind" | "id">,
  competitorId: string,
  actorUserId: string,
): { row: CompetitorRow | null; duplicate: boolean } {
  const row = findCompetitor(db, subject, competitorId);
  if (!row) return { row: null, duplicate: false };
  const dup = db
    .query(
      `SELECT id FROM company_competitor WHERE ${subjectColumn(subject)} = ? AND name = ? AND status = 'confirmed' AND id != ?`,
    )
    .get(subject.id, row.name, competitorId) as { id: string } | undefined;
  if (dup) return { row, duplicate: true };
  const now = new Date().toISOString();
  db.run("UPDATE company_competitor SET status = 'confirmed', exclusion_reason = NULL, updated_at = ? WHERE id = ?", [now, competitorId]);
  appendAudit(db, { actor: actorUserId, action: "competitor.restore", target: `${subject.kind}:${subject.id}:${competitorId}`, now });
  return { row: findCompetitor(db, subject, competitorId), duplicate: false };
}
