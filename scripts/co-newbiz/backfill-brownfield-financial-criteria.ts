// @version 1.0.0
// 1회성 백필 — S7 재무 평가 빌트인 기준을 5항목("매출 성장률/영업이익률/
// 순이익률/부채비율/영업 부문")에서 3항목("매출액/영업이익/부채 규모·5개년
// 추이")으로 정리한다. 이미 시딩된 오퍼튜니티에는 라벨이 자동 반영되지
// 않으므로(listOrSeedCriteria는 1회성 lazy 시딩) 이 스크립트로 맞춘다.
//
// - 유지 항목(구 data_ref → 신 data_ref): revenue_growth→revenue_5y,
//   operating_margin→operating_profit_5y, debt_ratio→debt_5y — 라벨/설명만
//   갱신(id·판정 이력 유지).
// - 제외 항목(net_margin, segment_manual): is_deletable을 무시하고
//   deleted_at을 직접 세팅해 화면에서 숨기되, brownfield_target_eval_state에
//   남은 판정 이력은 감사 추적을 위해 그대로 둔다.
//
// 사용법: bun run scripts/co-newbiz/backfill-brownfield-financial-criteria.ts [--dry-run]
import { getDb } from "../../db/client.ts";

const dryRun = process.argv.includes("--dry-run");
const db = getDb();

const RELABEL: Record<string, { label: string; description: string; data_ref: string }> = {
  revenue_growth: {
    label: "매출액 규모·5개년 추이",
    description: "5개년 매출액과 전년대비 증감율(참고) — DART 동기화 값이 있으면 표시, 판정은 사람이 내린다.",
    data_ref: "revenue_5y",
  },
  operating_margin: {
    label: "영업이익 규모·5개년 추이(흑자 지속 여부 포함)",
    description: "5개년 영업이익 절대액과 영업이익률·순이익률(참고) — 매출 성장과 마진 추세를 함께 확인한다.",
    data_ref: "operating_profit_5y",
  },
  debt_ratio: {
    label: "부채 규모·5개년 추이(부채비율 포함)",
    description: "5개년 부채총계와 부채비율(참고). 영업부문(사업부문별 실적)은 DART 세그먼트 데이터 미지원으로 v1 범위 밖 — 필요 시 커스텀 항목으로 수기 기록.",
    data_ref: "debt_5y",
  },
};
const RETIRE_DATA_REFS = new Set(["net_margin", "segment_manual"]);

const rows = db
  .query("SELECT id, data_ref FROM brownfield_eval_criterion WHERE category = 'financial' AND source = 'builtin' AND deleted_at IS NULL")
  .all() as Array<{ id: string; data_ref: string | null }>;

let relabeled = 0;
let retired = 0;

for (const row of rows) {
  if (!row.data_ref) continue;
  const patch = RELABEL[row.data_ref];
  if (patch) {
    if (!dryRun) {
      db.run("UPDATE brownfield_eval_criterion SET label = ?, description = ?, data_ref = ? WHERE id = ?", [patch.label, patch.description, patch.data_ref, row.id]);
    }
    relabeled++;
  } else if (RETIRE_DATA_REFS.has(row.data_ref)) {
    if (!dryRun) {
      db.run("UPDATE brownfield_eval_criterion SET deleted_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
    }
    retired++;
  }
}

console.log(`${dryRun ? "[dry-run] " : ""}재무 빌트인 기준 라벨 갱신 ${relabeled}건, 제외(숨김) ${retired}건.`);
if (dryRun) console.log("실제 반영하려면 --dry-run 없이 다시 실행하세요.");
