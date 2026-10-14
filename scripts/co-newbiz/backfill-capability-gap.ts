// @version 1.1.0
// ADR-0136 1회성 백필 — greenfield_assessment.capability_gaps_json에 있던 필요
// 역량 행을 opportunity.capability_gap_json(S3 레지스터)으로 병합한다. S3에
// capability 텍스트(대소문자 무시, trim)로 이미 있는 행이면 requiredLevel/
// currentLevel/resolution/note만 채우고(이미 값이 있으면 덮어쓰지 않음), 없는
// 행은 source: "manual"로 새로 추가한다 — 데이터 유실 방지가 최우선이다.
//
// 사용법: bun run scripts/co-newbiz/backfill-capability-gap.ts [--dry-run]
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { persistGapRegister } from "../../app/web-next/lib/capability-register-write.ts";
import { normalizeGapRows, parseGapRegister, type CapabilityGapRow } from "../../app/web-next/lib/capability-gap.ts";

interface LegacyGapRow {
  capability?: string;
  required_level?: string;
  current_level?: string;
  gap?: string;
  resolution?: string;
  note?: string;
}

function parseLegacy(json: string | null): LegacyGapRow[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as LegacyGapRow[]) : [];
  } catch {
    return [];
  }
}

const dryRun = process.argv.includes("--dry-run");
const db = getDb();

const rows = db
  .query("SELECT opportunity_id, capability_gaps_json FROM greenfield_assessment WHERE capability_gaps_json IS NOT NULL")
  .all() as Array<{ opportunity_id: string; capability_gaps_json: string }>;

let oppsTouched = 0;
let rowsMerged = 0;
let rowsAdded = 0;

for (const row of rows) {
  const legacyRows = parseLegacy(row.capability_gaps_json).filter((r) => r.capability?.trim());
  if (legacyRows.length === 0) continue;

  const opp = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(row.opportunity_id) as
    | { capability_gap_json: string | null }
    | undefined;
  if (!opp) continue; // opportunity가 삭제된 경우 — 스킵

  const register = parseGapRegister(opp.capability_gap_json);
  const byKey = new Map(register.rows.map((r) => [r.capability.trim().toLowerCase(), r]));
  let changed = false;

  for (const legacy of legacyRows) {
    const key = legacy.capability!.trim().toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      const patch: Partial<CapabilityGapRow> = {};
      if (!existing.requiredLevel && legacy.required_level) patch.requiredLevel = legacy.required_level;
      if (!existing.currentLevel && legacy.current_level) patch.currentLevel = legacy.current_level;
      if (!existing.resolution && legacy.resolution) patch.resolution = legacy.resolution as CapabilityGapRow["resolution"];
      if (!existing.note && legacy.note) patch.note = legacy.note;
      if (Object.keys(patch).length > 0) {
        Object.assign(existing, patch);
        changed = true;
        rowsMerged++;
      }
    } else {
      const added: CapabilityGapRow = {
        id: ulid(),
        capability: legacy.capability!.trim(),
        source: "manual",
        requiredNote: legacy.gap ? `S5 격차 메모(백필): ${legacy.gap}` : "",
        held: { status: "unevaluated", holders: [], evidence: "" },
        resolution: (legacy.resolution as CapabilityGapRow["resolution"]) ?? null,
        note: legacy.note ?? "",
        requiredLevel: legacy.required_level ?? "",
        currentLevel: legacy.current_level ?? "",
      };
      register.rows.push(added);
      byKey.set(key, added);
      changed = true;
      rowsAdded++;
    }
  }

  if (changed) {
    oppsTouched++;
    const normalized = normalizeGapRows(register.rows);
    if (!dryRun) {
      const at = new Date().toISOString();
      persistGapRegister(db, row.opportunity_id, normalized, at, "backfill-capability-gap");
    }
  }
}

console.log(
  `${dryRun ? "[dry-run] " : ""}오퍼튜니티 ${oppsTouched}건 영향 — 기존 행 병합 ${rowsMerged}건, 신규 행 추가 ${rowsAdded}건.`,
);
if (dryRun) console.log("실제 반영하려면 --dry-run 없이 다시 실행하세요.");
