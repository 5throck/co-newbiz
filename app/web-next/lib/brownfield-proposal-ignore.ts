// Brownfield 제안 무시(ignore) 이벤트 저장소 — design
// 2026-11-13-proposal-ignore-suppression §3.1, DEC-20261113-04.
// 무시는 UI 제스처가 아니라 이벤트다: 한 번의 클릭이 한 행. 같은 회사 키가
// 임계값(2) 이상 쌓이면 두 제안 표면(웹검색 POST·마스터 제안 GET) 어디에서도
// 그 후보는 더 이상 제안되지 않는다. 감사 계열 선례(ADR-0012)에 따라 앱 코드에는
// UPDATE·DELETE 경로가 없다 — 무시 취소는 수동 DB 작업뿐이다.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { companyKey } from "./name-similarity.ts";

/** 억제 임계값 — 같은 (opportunity_id, company_key)에 대한 무시 이벤트가 이 횟수
 *  이상이면 그 후보는 더 이상 제안되지 않는다(사용자 결정, 2026-11-13: "2회 이상
 *  무시한 후보는 재제안 금지"). 1회 무시는 문을 닫지 않는다 — 카드에 칩 하나
 *  (무시 1회)만 붙여 두 번째 무시가 실수가 아님을 보게 한다. 임계값 판정은 이
 *  파일의 suppressedProposalKeys 한 곳에서만 한다. */
export const PROPOSAL_IGNORE_SUPPRESS_THRESHOLD = 2;

/** 프롬프트 힌트에 실어 보낼 무시된 원문 이름 상한 — 어드바이저리 힌트일 뿐이고
 *  규칙의 보증은 추출 후 하드 필터가 담당하므로, 프롬프트 길이는 상수로 제한한다. */
export const IGNORED_NAMES_PROMPT_CAP = 20;

/** 무시 이벤트 1건 기록 — INSERT 한 행 + 감사 1건(target_proposal.ignore,
 *  target `oppId:companyKey`) + 삽입 뒤의 누적 횟수 반환. 반복 클릭은 새 이벤트·
 *  새 행 — 누적이 계약이고 멱등성이 아니다(사용자 규칙이 횟수를 센다). */
export function recordProposalIgnore(
  db: Database,
  oppId: string,
  rawName: string,
  userId: string,
): { companyKey: string; ignoreCount: number } {
  const key = companyKey(rawName);
  const now = new Date().toISOString();
  db.run(
    "INSERT INTO brownfield_target_proposal_ignore (id, opportunity_id, company_name_raw, company_key, ignored_by, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), oppId, rawName, key, userId, now],
  );
  const count = (
    db
      .query("SELECT COUNT(*) AS n FROM brownfield_target_proposal_ignore WHERE opportunity_id = ? AND company_key = ?")
      .get(oppId, key) as { n: number }
  ).n;
  appendAudit(db, { actor: userId, action: "target_proposal.ignore", target: `${oppId}:${key}`, now });
  return { companyKey: key, ignoreCount: count };
}

/** 억제 대상 키 집합 — 임계값 이상 무시된 (opportunity_id, company_key)의 키만
 *  담는다. "무엇이 억제되는가"의 유일한 판정 장소(§3.4). 억제 매칭은 이 집합에
 *  대한 완전 일치(companyKey(candidate) ∈ 결과)뿐 — 퍼지 없음(§4.3). */
export function suppressedProposalKeys(db: Database, oppId: string): Set<string> {
  const rows = db
    .query(
      `SELECT company_key FROM brownfield_target_proposal_ignore
       WHERE opportunity_id = ?
       GROUP BY company_key
       HAVING COUNT(*) >= ${PROPOSAL_IGNORE_SUPPRESS_THRESHOLD}`,
    )
    .all(oppId) as Array<{ company_key: string }>;
  return new Set(rows.map((r) => r.company_key));
}

/** 키별 무시 이벤트 수 — 칩(ignore_count)과 프롬프트 힌트가 같은 스캔에서 쓰는
 *  로더. 임계값 이상 키는 suppressedProposalKeys가 이미 걸러 응답에 도달하지
 *  않으므로, 호출점은 count === 1인 키에만 칩을 붙인다(design §3.4). */
export function proposalIgnoreCounts(db: Database, oppId: string): Map<string, number> {
  const rows = db
    .query(
      "SELECT company_key, COUNT(*) AS n FROM brownfield_target_proposal_ignore WHERE opportunity_id = ? GROUP BY company_key",
    )
    .all(oppId) as Array<{ company_key: string; n: number }>;
  return new Map(rows.map((r) => [r.company_key, r.n]));
}

/** 프롬프트 힌트용 무시된 원문 이름 — DISTINCT company_name_raw, 최근 우선,
 *  IGNORED_NAMES_PROMPT_CAP 상한(§3.4 어드바이저리 블록). */
export function ignoredProposalRawNames(db: Database, oppId: string): string[] {
  const rows = db
    .query(
      `SELECT company_name_raw, MAX(created_at) AS latest
       FROM brownfield_target_proposal_ignore
       WHERE opportunity_id = ?
       GROUP BY company_name_raw
       ORDER BY latest DESC
       LIMIT ${IGNORED_NAMES_PROMPT_CAP}`,
    )
    .all(oppId) as Array<{ company_name_raw: string }>;
  return rows.map((r) => r.company_name_raw);
}
