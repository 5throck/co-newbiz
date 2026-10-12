// greenfield-structure — S10 server validation per track (ADR-0160 §5.2,
// deal-structuring v1.1.0). Greenfield establishment structures accept the
// vehicle (same enum), the four-axis notes, the rationale and — for a JV
// vehicle only — the stake ("our share in JV"); funding sources go to the
// financing plan and phased capex tranches to capex_tranche (migration 0136).
// The M&A-only inputs (asset_or_stock, instrument_mix; stake_type except
// vehicle = jv) are refused rather than silently stored. Brownfield and
// unrouted projects return null: their validation path is untouched.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { currentRoute } from "./greenfield-subtrack.ts";

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

export function greenfieldHypothesisIssue(projectId: string, body: Record<string, unknown>, db: Database = getDb()): string | null {
  if (currentRoute(projectId, db)?.track !== "greenfield") return null;
  if (present(body.asset_or_stock)) return "greenfield 설립 구조에는 asset_or_stock(자산/주식 인수 형태)을 쓰지 않습니다 — 비워 두세요.";
  if (present(body.instrument_mix)) return "greenfield 설립 구조에는 instrument_mix를 쓰지 않습니다 — 자금 조달 구성은 재원 계획(sources) 행으로 기록하세요.";
  if (present(body.stake_type) && body.vehicle !== "jv") return "greenfield에서 stake_type은 vehicle = jv(합작 지분)일 때만 기록합니다.";
  if (present(body.stake_type) && body.stake_type === "full") return "JV 합작 지분은 majority | minority | joint_control 중 하나입니다.";
  return null;
}
