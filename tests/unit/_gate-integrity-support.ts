// @version 1.0.0
/**
 * Shared fixtures for the ADR-0186 P1 unit tests (gate integrity hygiene
 * primitives). Every function takes the scratch db so the caller controls
 * CO_NEWBIZ_DB_PATH before any db import. ASCII-only identifiers; Korean
 * strings only where a real scenario string is the point.
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../../db/lib/ulid.ts";
import { promoteOpportunity } from "../../db/repositories/project.repository.ts";
import { judgeAllStandardDdItems } from "./_dd-standard.ts";

export const NOW = "2026-10-27T09:00:00Z";

export const GENUINE = "대상 회사의 영업이익률과 인증 승계 가능성을 확인했으므로 다음 단계로 진행함";
export const GENUINE_2 = "투자 구조와 DD 결과를 검토했고 위험 요인이 허용 범위 안에 있음";

export function seedS10Complete(db: Database, pid: string, by: string): void {
  db.run(
    `INSERT INTO deal_structure_hypothesis
       (id, project_id, asset_or_stock, stake_type, instrument_mix, vehicle,
        tax_structure_note, liability_isolation_note, financing_leverage_note,
        exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [ulid(), pid, "stock", "majority", "mixed", "spc", "tax", "isolation", "leverage", "exit", by, NOW, "four-axis"],
  );
  for (const [kind, name] of [
    ["source", "equity"],
    ["use", "purchase"],
  ] as const) {
    db.run(
      "INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at, evidence_kind, evidence_ref) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        ulid(),
        pid,
        kind,
        name,
        1000,
        by,
        NOW,
        kind === "source" ? "internal_approval" : null,
        kind === "source" ? "fixture-evidence" : null,
      ],
    ); // ADR-0187 P3 (M1): sources carry funding evidence
  }
}

/** A promoted greenfield project whose S8-S10 are complete, so GO is limited only by the integrity families. */
export function seedReadyProject(db: Database, analyst: string): { projectId: string; oppId: string } {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    opp,
    `ladder opp ${opp.slice(-6)}`,
    "industry",
    "selected",
    analyst,
    NOW,
  ]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), opp, "greenfield", "test", "alt", analyst, NOW],
  );
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), opp, "direct", "alt", "test", analyst, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
    JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }),
    opp,
  ]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", opp, gate, "go", "seed", analyst, NOW],
    );
  }
  const pid = promoteOpportunity(opp, { promotedBy: analyst, needToKnowBasis: "gate integrity test" }).project.id;
  seedS10Complete(db, pid, analyst);
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), pid, "greenfield_cost", "case", 5, analyst, NOW, "{}"],
  );
  const modelId = (db.query("SELECT id FROM business_case_model WHERE project_id = ?").get(pid) as { id: string }).id;
  db.run(
    "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), pid, modelId, "base", "p50", 12000, 0.14, "seed", NOW, 2.5, 2.5],
  );
  judgeAllStandardDdItems(db, pid, analyst, NOW);
  return { projectId: pid, oppId: opp };
}

export function insertGate(
  db: Database,
  entityType: "opportunity" | "project",
  entityId: string,
  gate: string,
  decision: "go" | "hold" | "kill",
  at = NOW,
): string {
  const id = ulid();
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, entityType, entityId, gate, decision, "seed", "seed-user", at],
  );
  return id;
}

/** A bare opportunity with a current route decision of the given track. */
export function insertOpportunity(
  db: Database,
  track: "greenfield" | "brownfield" | null,
  creator = "seed-user",
): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    `opp ${id.slice(-6)}`,
    "industry",
    "selected",
    creator,
    NOW,
  ]);
  if (track) {
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
      [ulid(), id, track, "seed", creator, NOW],
    );
  }
  return id;
}

/** A bare project row linked to a source opportunity (enough for the ladder and checklist tables). */
export function insertProject(
  db: Database,
  sourceOpportunityId: string | null,
  track: "greenfield" | "brownfield" = "greenfield",
): string {
  const id = `PRJ-${ulid().slice(-8)}`;
  db.run(
    `INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, source_opportunity_id, track, status)
     VALUES (?, ?, ?, 'fs', 'internal', ?, ?, 'open')`,
    [id, id, NOW, sourceOpportunityId, track],
  );
  return id;
}

export function insertGovernanceDoc(db: Database, id = "govdoc-gi-test"): string {
  db.run(
    `INSERT OR IGNORE INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      "policy",
      "neb-policy",
      "Group New Business Review Policy",
      "shared",
      "1.0.0",
      "mandatory",
      "process-governance-manager",
      "policies/group/neb-policy.md",
      NOW,
    ],
  );
  return id;
}

// ── ADR-0186 P3 fixtures: maker / checker, conditions, overrides ─────────────────────────────────

/** Issue an active human-role grant through the repository the admin route uses. */
export async function grantRole(
  db: Database,
  userId: string,
  roleKey: "entity-ic-reviewer" | "group-ic-reviewer",
  grantedBy: string,
): Promise<string> {
  const { issueHumanRoleGrant } = await import("../../db/lib/human-roles.ts");
  return issueHumanRoleGrant(db, { userId, roleKey, grantedBy, now: NOW });
}

/** Add a project member (deny-by-default visibility: an IC reviewer must be on the deal to see it). */
export function addMember(db: Database, projectId: string, userId: string, role: "lead" | "member" = "member"): void {
  db.run(
    "INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, userId, role, "test", NOW, "gate integrity P3 test"],
  );
}

/** A project that can record an entity_ic GO: the ready project plus recorded fs and dd GOs (legacy rows, effective). */
export function seedIcReadyProject(db: Database, maker: string): { projectId: string; oppId: string } {
  const r = seedReadyProject(db, maker);
  insertGate(db, "project", r.projectId, "fs", "go");
  insertGate(db, "project", r.projectId, "dd", "go");
  seedCommitteeSession(db, r.projectId, maker);
  return r;
}

/**
 * A convened, confirmed-minutes project committee session (ADR-0196). One session satisfies
 * both IC gates: `committee_session_missing` only requires a session to exist at
 * entity_ic / group_ic; the session list is not gate-filtered.
 */
export function seedCommitteeSession(db: Database, projectId: string, convenedBy: string): string {
  const id = `SES-${ulid().slice(-12)}`;
  db.run(
    "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      "project",
      projectId,
      projectId,
      "test",
      "entity_ic",
      "done",
      "system",
      convenedBy,
      NOW,
      JSON.stringify({ minutes_confirmed_by: convenedBy, minutes_confirmed_at: NOW }),
    ],
  );
  return id;
}

export const IC_RATIONALE = "투자심의위원회가 사업계획과 위험 요인을 검토했고 조건부로 진행하는 데 동의함";
export const IC_GAP = "알려진 미비 사항은 후속 조치 일정과 함께 감수하기로 함";
