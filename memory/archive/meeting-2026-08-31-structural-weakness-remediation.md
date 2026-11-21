# Meeting — Structural Weakness Remediation (2026-08-31)

## Agenda and Purpose

A remediation-planning meeting on the four structural weaknesses identified in the
stage-coverage audit of flow.spec v2.0.0 (S1–S11 track separation, ADR-0076/0078/0079/0080):

1. **W1 — "Phase" terminology collision**: `docs/phase-definitions.md` Phase 0–6 (workspace PM
   lifecycle) vs deal process stages S1–S11; skill metadata `phases` tags follow the workspace
   axis, not the deal stages.
2. **W2 — No dedicated S7 target-screening checklist**: `brownfield-target-screening` reuses the
   strategic-fit checklist; the spec's ownership/availability, geographic, regulatory knock-out
   axes have no checklist home.
3. **W3 — S5 has no dedicated procedure**: 역량 평가·진출전략 (capability gap →
   Build/Partner/Hire/Invest) rides on greenfield-pre-fs/greenfield-fs.
4. **W4 — Web implementation skew**: only S1–S3 + supporting tools (우리 회사 분석, 시너지 정합성)
   are built; S4–S11 surfaces were removed (ADR-0078) pending the rebuild.

Session composition: PM (chair) + process-governance-manager (functional) + brownfield-agent +
greenfield-agent (track owners) + frontend-engineer (web) + docs-writer (terminology). Decision
rights: gate approvals and checklist/policy amendments remain human (boundary #2) — this meeting
produces recommendations and an execution plan only.

---

## Perspective Statements (round 1)

### 1. docs-writer (terminology / documentation)

- **W1 is a documentation defect, not a process defect.** The two axes never conflict in
  behavior — phase-definitions 0–6 governs how agents work on tasks; S1–S11 is the deal review
  pipeline. Skill metadata `phases` tags (phase1–4) follow the workspace axis by design.
- Cheapest sound fix: add a "Deal Process Stages (S1–S11) — a separate axis" section to
  phase-definitions.md, plus a naming discipline — deal stages are always written "S-스테이지
  (S1–S11)", workspace phases as "워크스페이스 페이즈(Phase 0–6)". No rename of the skill
  `phases` metadata: renaming touches 51 manifest entries and both platform mirrors for zero
  behavioral gain.
- Guardrail: the audit already flags non-standard .md placement; the new section must live in
  phase-definitions.md, not a new file.

### 2. brownfield-agent (S6/S7 target identification & screening)

- **W2 is the highest-value item**: S7 is where capital gets pointed at a specific counterparty;
  without a checklist the screen rests on an LLM narrative. Proposal —
  `checklists/target-screening-checklist.yaml` with knock-out items: (t1) ownership/availability
  (is the stake actually for sale / partnerable), (t2) regulatory (foreign-investment limits,
  licensing transferability, concentration pre-screen), (t3) geographic fit, (t4) market
  contraction+commoditization (the standing kill axis), (t5) capability divergence vs the
  required-capability list from S1/S3 — plus a rated section (strategic value, capability
  complementarity, financial attractiveness, integration/partnership complexity).
- Wiring: `brownfield-target-screening` step 1 references the checklist (legal_basis + description
  update); the spec S7 itself needs no change — procedures are gate-keyed, and the procedure
  already exists. **Procedure amendment trigger applies** → recommend a lightweight ADR (or this
  meeting record + process-governance-manager gate) documenting the checklist addition.
- Note: mandatory/pass and waiver_eligible flags must follow the existing chk-* conventions so
  the DART-era checklist engine stays reusable.

### 3. greenfield-agent (S5 capability assessment & entry strategy)

- **W3 — split, but conditionally.** S5's outputs (capability gap, Build/Partner/Hire/Invest
  decision) genuinely have no 1:1 home in greenfield-pre-fs/fs; a dedicated
  `greenfield-capability-assessment` procedure would make the artifact chain auditable.
- **But not now**: creating a procedure costs schema + validation + graph mirror upkeep, and S5's
  web surface does not exist yet (W4). Interim measure: flow.spec S5 activity note already maps
  procedures; add one completion-criterion line so the interim reuse is explicit ("진출전략은
  greenfield-pre-fs/fs 재사용 — 전용 절차는 S4+ 재구축 시 분리"). Revisit when the S5 screen is
  built (ADR-0080 Phase 2 list already carries the related item).

### 4. frontend-engineer (web surfaces)

- **W4 sequencing** — rebuild order should follow dependency, not stage number:
  1. **S4 진출방식 결정** (the branch point; both tracks need it first; route_decision API/DB
     already exist),
  2. **S6–S7 Brownfield target path** (the target list/sketch tooling and `project_company`
     candidate/target model already survived ADR-0078; /synergy already serves as the
     company-verification tool),
  3. **S5 Greenfield path** (capability assessment UI — also the precondition for W3's procedure
     split),
  4. **S8–S11** (business case → DD → IC → post-management; largest surface, last).
- Constraint: every rebuilt screen renders from flow.spec v2.0.0 (no S-number hardcoding — the
  ADR-0074 acceptance test), and each delivered stage updates the stage-coverage matrix recorded
  in ADR-0078 so the web-skew is tracked, not forgotten.
- Practical note: the S1–S3 pattern to copy already exists three times (market list→report,
  opportunities funnel→detail, synergy companies→tabbed report); S4+ screens are composition
  work, not invention.

### 5. process-governance-manager (procedures / policy gate)

- Endorses brownfield-agent's W2 scope with two additions: every knock-out item needs
  **mandatory + waiver_eligible** flags decided at authoring time (retrofitting flags later is the
  error class the D-round killed), and the checklist id must register in the checklist registry
  (`checklists/_validate.ts` conventions) or the drift test will fail.
- On W3: agrees with the conditional split and adds the governance condition — the moment a
  dedicated S5 procedure exists, its steps must carry agent_key/skill_key/output_type that pass
  the PR-8 bidirectional graph contract (the same gate that caught the ADR-0077-era procedure
  keys).
- On W1: documentation-only fix is correct; no ADR needed. On W2: lightweight ADR recommended
  (procedure amendment is on the ADR trigger list) — can be a short record citing this meeting.

---

## Chair Synthesis (PM)

**Convergence**:
- W1 → documentation-only fix in phase-definitions.md + naming discipline (no skill-metadata
  rename). Owner: docs-writer.
- W2 → new `checklists/target-screening-checklist.yaml` (5 knock-out + 4 rated axes, mandatory/
  waiver flags at authoring, registry + `_validate.ts` compliant), wired into
  `brownfield-target-screening` step 1; documented via a lightweight ADR-0081 citing this meeting.
  Owner: brownfield-agent drafts, process-governance-manager gates.
- W3 → conditional split: greenfield-capability-assessment procedure is created when the S5 web
  surface starts (ADR-0080 Phase 2), not now; interim reuse is explicitly noted in the spec S5
  completion criteria wording. Owner: greenfield-agent (future), pm gates the trigger.
- W4 → rebuild order fixed as S4 → S6–S7 → S5 → S8–S11, each stage updating the ADR-0078
  coverage matrix; flow.spec-rendered screens only (ADR-0074 no-hardcoding acceptance test).
- No ADR for W1/W4 beyond this record; lightweight ADR-0081 for W2; W3's future split noted in
  ADR-0080 Phase 2 (already there in substance — cross-referenced).

**Boundary reaffirmation**: all four remediations are preparation work. Gate verdicts, checklist
mandatory/waiver policy sign-off, and any stage promotion remain human decisions (boundary #2).

---

## Decisions and Action Items

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | phase-definitions.md: add "Deal Process Stages (S1–S11) — separate axis" section + naming discipline (S-스테이지 vs 워크스페이스 페이즈) | docs-writer → PM gate | Next PR |
| 2 | Create `checklists/target-screening-checklist.yaml` (5 knock-out + 4 rated, mandatory/waiver flags) and wire into `brownfield-target-screening` step 1 | brownfield-agent drafts, process-governance-manager gates | Next PR |
| 3 | Lightweight ADR-0081 documenting the checklist addition (procedure-amendment trigger) | brownfield-agent → PM gate | With #2 |
| 4 | Spec S5 wording: note interim pre-fs/fs reuse + future split trigger (S4+ rebuild start) | greenfield-agent | Next PR |
| 5 | S4+ rebuild order recorded as S4 → S6–S7 → S5 → S8–S11; ADR-0078 coverage matrix updated per delivered stage | frontend-engineer + PM | S4+ rebuild kickoff |
| 6 | Checklist registry/`_validate.ts` compliance for #2 (chk id registration, drift test) | platform-lead review | With #2 |
