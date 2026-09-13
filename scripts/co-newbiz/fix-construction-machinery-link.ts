#!/usr/bin/env bun
// @version 1.0.0
/**
 * fix-construction-machinery-link.ts — one-time data correction (design
 * 2026-09-13, meeting panel-reviewed; user-reported on 2026-09-13).
 *
 * The live proxy_link row 유압식 브레이커 → 건설기계(굴삭기·스키드로더) 장비 운용
 * was tagged relation='전방' (downstream demand). From the equipment-operator
 * perspective the hydraulic breaker is a PROCURED attachment (부착 작업기) —
 * i.e. 후방 (supply side). The row also carried a placeholder evidence_ref('.')
 *
 * Per the ADR-0129 contract (relation overwrite is forbidden — retire then
 * re-register), the script:
 *   1. sweeps every active proxy_link row with a placeholder evidence_ref,
 *   2. retires the wrong row (soft-delete + rationale, audit 'proxy_link_retire'),
 *   3. inserts the corrected 후방 row with a real evidence_ref
 *      (audit 'proxy_link_create', same topology breaker→operator).
 *
 * Idempotent — safe to re-run: skips if no qualifying row exists.
 *
 * Usage: bun scripts/co-newbiz/fix-construction-machinery-link.ts [--db-path <path>]
 */
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { appendAudit } from "../../db/lib/access-control.ts";

const argv = process.argv.slice(2);
const dbPathIdx = argv.indexOf("--db-path");
const db = getDb(dbPathIdx >= 0 ? argv[dbPathIdx + 1] : undefined);

const now = new Date().toISOString();
const rationale =
  "relation 오기 교정(2026-09-13 재점검) — 장비 운용 사업자 관점에서 유압식 브레이커는 조달하는 부착 작업기이므로 전방이 아니라 후방이다. 기존 행은 근거 없이 승인된 행(evidence_ref='.')이기도 하다.";

// 1) sweep — report placeholder-evidence rows (the panel's P2 audit)
const placeholder = db
  .query(
    "SELECT id, relation, status, evidence_ref FROM proxy_link WHERE status = 'active' AND (evidence_ref = '.' OR evidence_ref = '')",
  )
  .all() as Array<{ id: string; relation: string | null; status: string; evidence_ref: string }>;
console.log(`placeholder-evidence active rows: ${placeholder.length}`);
for (const r of placeholder) console.log(`  - ${r.id} relation=${r.relation} evidence=${JSON.stringify(r.evidence_ref)}`);

// 2) find the wrong row: breaker -> machinery-operator, relation='전방'
const wrong = db
  .query(
    `SELECT pl.id, pl.from_industry_id, pl.to_industry_id, f.name_ko AS from_name, t.name_ko AS to_name
     FROM proxy_link pl
     JOIN md_industry f ON f.id = pl.from_industry_id
     JOIN md_industry t ON t.id = pl.to_industry_id
     WHERE pl.status = 'active' AND pl.relation = '전방'
       AND f.name_ko = '유압식 브레이커'
       AND t.name_ko LIKE '건설기계%'`,
  )
  .get() as { id: string; from_industry_id: string; to_industry_id: string; from_name: string; to_name: string } | null;

if (!wrong) {
  console.log("교정 대상 행이 없습니다 — 이미 교정되었거나 존재하지 않습니다. 종료.");
  process.exit(0);
}

// 3) retire (soft-delete + audit — ADR-0129 contract)
db.run("UPDATE proxy_link SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?", [now, "fix-construction-machinery-link", wrong.id]);
appendAudit(db, {
  actor: "fix-construction-machinery-link",
  action: "proxy_link_retire",
  target: `${wrong.from_industry_id}->${wrong.to_industry_id}: ${rationale}`,
  now,
});
console.log(`retired: ${wrong.id} (${wrong.from_name} → ${wrong.to_name}, was relation='전방')`);

// 4) re-register corrected 후방 row (same supply-flow topology breaker→operator)
const newId = ulid();
db.run(
  `INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, relation, hop_distance, source, status, evidence_ref, calibrated_at)
   VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
  [
    newId,
    wrong.from_industry_id,
    wrong.to_industry_id,
    "structural",
    "후방",
    1,
    "user_added",
    "active",
    "장비 운용사가 굴삭기·스키드로더에 부착하는 파쇄 작업기(부착 작업기)를 유압식 브레이커 제조·공급 산업에서 조달한다 — 2026-09-13 사용자 지적 + 가치사슬 방향 재점검(운용 사업자 관점)",
  ],
);
appendAudit(db, {
  actor: "fix-construction-machinery-link",
  action: "proxy_link_create",
  target: `${wrong.from_industry_id}->${wrong.to_industry_id}: relation=후방 (재등록 — ${rationale})`,
  now,
});
console.log(`inserted corrected row: ${newId} relation='후방' hop_distance=1`);

// 5) verify
const after = db
  .query(
    `SELECT pl.id, pl.relation, pl.hop_distance, pl.status, pl.evidence_ref FROM proxy_link pl
     WHERE pl.from_industry_id = ? AND pl.to_industry_id = ? ORDER BY pl.status`,
  )
  .all(wrong.from_industry_id, wrong.to_industry_id);
console.log("post-state:", JSON.stringify(after, null, 1));
