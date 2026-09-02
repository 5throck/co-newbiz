# ADR-0085: S10 entity establishment execution — spec alignment and execution record layer

**Status**: Accepted — implemented in the same change (flow.spec S10, migration 0059, establishment API)
**Date**: 2026-09-01
**Deciders**: user (standing directive), process-governance-manager (procedure owner), platform-lead (review)
**Design of record**: `process/flow.spec.yaml` (S10), `db/migrations/0059_entity_establishment.sql`, `app/web-next/app/api/opportunities/[id]/establishment/route.ts`
**Procedure of record**: `procedures/_shared/entity-establishment-execution/schema.yaml` v1.1.0 + `checklists/entity-formation-checklist.yaml` (chk-entity-formation)

## Context

The Entity Establishment Execution procedure (설립준비 → 법인등기·정관·사업자등록 →
인허가 이전/재발급 분류 → 인력이전(신 근로계약+PIIA) → 완료확인(IP양도체인·거버넌스
베이스라인; JV는 이사회·데드락 조항 추가검증)) and its checklist (ef-01..ef-12, JV addendum
ef-13..ef-18) were complete at the procedure layer, but nothing downstream knew they existed:
flow.spec S10 did not reference the procedure in any activity, its requiredArtifacts/completion
criteria covered only IC approvals (so S10 could close without formation), and no table or API
recorded execution state. Five skills already carried the procedure in `procedure_keys`, so the
gap was one-directional — spec → procedure, not procedure → skill.

## Decision

1. **flow.spec S10 alignment (Phase 1)** — a fifth activity `entity-establishment-execution`
   (agent: process-governance-manager) joins the four IC activities; requiredArtifacts gains
   the 설립 실행 기록 (chk-entity-formation evidence); completion criteria gains "origin∈
   {internal,joint}인 프로젝트는 entity-establishment-execution 5단계 완료 기록이 존재한다".
   The conditionality mirrors the procedure's `applies_when` (ADR-0047 origin axis) —
   acquisition-shaped brownfield routes are not formation projects and stay exempt. S11's
   entry criterion now reads "S10 완료 (IC 승인, internal/joint는 설립 실행 완료 포함)".
2. **Execution record layer (Phase 2)** — `entity_establishment_step` (migration 0059,
   additive): one row per step with status vocabulary `pending/in_progress/done/halted/
   escalated` mapping 1:1 to the procedure's kill-criteria actions (halt = incomplete IP
   assignment chain; escalate = employment transfer without consent determination), the
   origin axis, the checklist item id, and an evidence URL into the entity data room.
3. **API enforces sequence, not judgement** — PUT blocks 완료확인 (step 5) as `done` until
   steps 1–4 are all done; every mutation is analyst-gated and audit-logged. The API records
   execution facts; it never re-decides the Entity IC outcome (boundary #2 — human approval).
4. **Web surface deferred** — per the standing S8–S11 surface-removal decision (ADR-0078),
   no dedicated page is built; the record layer exists so the eventual progress surface
   (and any gate-progress consumer) can bind to real data. Dashboard integration ships with
   that rebuild.

## Consequences

- S10 can no longer silently close for internal/joint origins without formation evidence;
  the completion criterion is now machine-checkable against `entity_establishment_step`.
- The status vocabulary keeps the kill-criteria semantics observable at the data layer —
  a `halted` 완료확인 row IS the `ip_assignment_chain_incomplete_at_establishment` halt,
  not a new decision type.
- Checklist item granularity is optional per row (`checklist_item` nullable): a step can be
  recorded once at step level, with ef-level evidence added incrementally as the data room
  fills.
