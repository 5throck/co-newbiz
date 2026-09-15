---
lang: ko
lang_reason: source-material
---

# ADR-0099: S9 due diligence — external-search tailored checklist proposals on top of the standard checklists

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 4)
- Design of record: `process/flow.spec.yaml` (S9, spec v2.0.0), `db/migrations/0069_project_checklist_item_custom.sql` (new), `checklists/commercial-dd-checklist.yaml`, `checklists/technical-dd-checklist.yaml`, `checklists/legal-dd-checklist.yaml`, `db/migrations/0011_dd_finding_and_remaining_tables.sql` (`dd_finding`), `db/migrations/0039_project_checklist_state.sql` (`project_checklist_item_state`), `app/web-next/lib/process-flow.ts` (project-branch S9 check), `app/web-next/lib/agent-orchestrator.ts` (`runActivityChain`), `app/web-next/lib/business-case-generator.ts` (Phase 3 executor-seam pattern)
- Related: ADR-0096 (orchestration engine generalization; `runActivityChain` is the generation engine), ADR-0098 (S8 multi-business-case generation; the pluggable-executor pattern and the `/api/projects/[id]/**` route pattern this phase extends), ADR-0097 (steering-committee deliberation; sourced-proposal-vs-binding-confirmation principle), ADR-0095 (project promotion foundation, S8–S11 skeleton), ADR-0094 (gate_decision as the sole human-confirmation ledger; MCP access is REST-only, no dead endpoints), ADR-0014 (migration rules)
- Related non-ADR artifacts: project CLAUDE.md boundary #2 (gate approval and the investment decision belong to humans), boundary #4 (data confidence caps the overall RAG grade — the reason source reliability travels with every item), `md_source.reliability_grade` A/B/C vocabulary (0001)

## Context

S9 (실사·검증, "사실인가? 위험은 무엇인가?") carries the completion criterion, verbatim from
`flow.spec.yaml` v2.0.0:

> 적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다

— every item of the *applied* checklist is judged and zero mandatory items are
unmet — gated at `dd`, with outputs "DD 체크리스트 판정" and "조사내역
(`dd_finding`)".

The standard gate checklists — `checklists/commercial-dd-checklist.yaml`,
`checklists/technical-dd-checklist.yaml`, `checklists/legal-dd-checklist.yaml`
(items like `cdd-01` "Customer concentration analyzed", each with
`mandatory` / `waiver_eligible` flags, `gate: DD`) — are deliberately generic
must-haves. They are authoritative and stay that way. But a semiconductor
foundry acquisition and a food-delivery startup acquisition should not be due-
diligenced with the same ten questions; industry- and company-specific DD
concerns (process-chemistry liability, platform worker reclassification,
regulatory license portability, and so on) are exactly where a generic
checklist silently under-covers. The user directive for this phase: agents
generate industry/company-specific **additional** checklist items using
external search benchmarking — **augmenting, never replacing, the standard
items**.

The project-keyed infrastructure already exists:

- `dd_finding` (0011) — per-project DD findings keyed to `md_project`, with
  `value_impact`, `assumption_key`, `evidence_ref`;
- `project_checklist_item_state` (0039) — per-project judgment state per
  `(checklist_id, item_id)` with `status IN ('pending','pass','fail','na',
  'waived')` and `waiver_id` — the existing waiver/status tracking this phase
  deliberately rides rather than reinvents;
- **S8 (ADR-0098)** established the project-keyed surface pattern this phase
  follows: `/api/projects/[id]/**` routes behind `getProjectIfVisible`
  deny-by-default visibility, async generation returning a `process_run` id,
  and `GateDecisionPanel` as the human confirmation surface.

What is missing is exactly two things:

1. **Tailored item generation with provenance** — nothing turns an industry
   profile plus external benchmarking into persisted, source-attributed,
   additional checklist items per project.
2. **Approval plumbing that lands tailored items in the existing judgment
   tracking** — an approved custom item must be judged like any other item,
   through `project_checklist_item_state`, not through a parallel ledger.

## Decision

### 1. Migration `0069_project_checklist_item_custom.sql` (additive, ADR-0014)

New table persisting agent-proposed, human-approved tailored checklist items:

```sql
CREATE TABLE project_checklist_item_custom (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  domain TEXT NOT NULL CHECK (domain IN ('commercial','technical','legal')),
  item_label TEXT NOT NULL,
  rationale TEXT,
  source_url TEXT,
  source_reliability TEXT CHECK (source_reliability IS NULL OR source_reliability IN ('A','B','C')),
  proposed_by_agent TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pcic_project ON project_checklist_item_custom(project_id, domain, status);
```

`source_reliability` reuses the `md_source.reliability_grade` A/B/C vocabulary
(0001) — the same confidence scale the rest of the data pipeline speaks, so
boundary #4 (data confidence caps conclusions) applies to checklist coverage
the same way it applies to market data.

**On approval** (`status = 'approved'`), the review path additionally inserts a
`project_checklist_item_state` row with `checklist_id = 'custom:<domain>'`,
`item_id = <the custom item's id>`. From that moment the tailored item is an
ordinary checklist item: it is judged through the existing status tracking, it
participates in the existing waiver flow via `waiver_id`, and the S9 completion
check (§5) counts it with **no special treatment**. Proposed-but-unapproved and
rejected items never get a state row and never count.

**Numbering note**: the phase plan tentatively numbered this migration 0070;
0069 is in fact the next free number (0068 is the highest existing migration),
so this ADR takes `0069`.

### 2. Automatic benchmarking via `runActivityChain()`

Per domain, the S9 activity owner from `flow.spec.yaml` investigates
industry-specific DD concerns through the session's external search tools:

| Domain | Agent | Search posture |
|---|---|---|
| commercial | `commercial-dd-agent` | "`[industry]` M&A commercial due diligence checklist", customer/channel-concentration precedents |
| technical | `technical-dd-agent` | "`[industry]` technical due diligence checklist", process/facility-specific failure modes |
| legal | `legal-counsel` | "`[industry]` M&A legal due diligence checklist", license/certification transfer precedents |

Each agent proposes **5–10 tailored items** per domain, each with a `rationale`
(a source URL and a reliability grade where the source is real). Items are
recorded **ONLY in `proposed` status**. The chain runs through the ADR-0096
`runActivityChain` engine — one `process_run`, one `activity_run`/`agent_run`
per domain activity, `entity = { type: "project", id }` — so the generation is
auditable end to end exactly like S8 case generation.

**Sourced proposal ≠ binding confirmation** (boundary #2, the same principle as
ADR-0097 committee proposals). Whether a proposed item becomes a gate-relevant
requirement is a human approval recorded in the table's `approved_by` /
`approved_at`. An agent cannot promote its own proposal, and an unapproved
proposal cannot block a gate.

### 3. API

- `POST /api/projects/[id]/dd-checklist/tailor` — analyst+; triggers the
  benchmarking chain for one `domain` or all three, returning the `runId` of
  the `process_run`.
- `GET .../dd-checklist/tailor/[runId]` — progress and proposed items assembled
  from `activity_run`/`agent_run` plus the `project_checklist_item_custom` rows
  (the ADR-0098 generate/[runId] pattern).
- `PUT .../dd-checklist/tailor/[itemId]/review` — approve/reject; analyst+.
  **This is the human decision**: approval flips `status` to `approved`,
  stamps `approved_by`/`approved_at`, and inserts the
  `project_checklist_item_state` row (§1). Rejection records the reject with no
  state row.
- The rest of the S9 page surface follows ADR-0098's project-route pattern:
  `dd_finding` CRUD and `project_checklist_item_state` judgment routes as
  needed, all behind `getProjectIfVisible` deny-by-default visibility.

### 4. Web page

`app/web-next/app/projects/[id]/dd/page.tsx`:

- the standard checklists in three tabs — Commercial / Technical / Legal —
  each rendered from its `checklists/*.yaml` item list with live
  `project_checklist_item_state` judgments;
- a **"산업 맞춤 제안" (industry-tailored proposals) panel**: proposed items
  with their source links and reliability grades, and approve/reject buttons —
  an unsourced proposal is visibly unsourced, so a reviewer can weigh it as
  such;
- approved custom items appear in their domain tab as ordinary items (they are
  ordinary items, once a state row exists);
- the `dd_finding` list;
- `GateDecisionPanel` with `gates=["dd"]` — the human confirmation surface per
  the ADR-0094/0095 gate-decision ledger.

### 5. Completion criterion — mechanically checkable

`flow.spec.yaml` S9, verbatim and unchanged; the project-branch S9 check in
`process-flow.ts` is rewired, replacing the placeholder explicitly marked
`REFINEMENT (Phase 4)`. The current placeholder already checks "no pending
items and at least one"; Phase 4 strengthens it to the full spec predicate:

- **every applied checklist item judged**: zero `pending` rows across the
  standard checklists *and* all `custom:<domain>` state rows;
- **zero unmet mandatory items**: no `fail` row without a corresponding
  `waived`-via-waiver resolution on a mandatory item (`mandatory: true` in the
  checklist yaml, or an approved custom item's equivalent flag carried in its
  state/rationale);
- **approved custom items count through `project_checklist_item_state`, NOT
  directly**: the check queries the state table only — it never reads
  `project_checklist_item_custom`. A `proposed` (unapproved) item does not
  count toward coverage, cannot block, and cannot satisfy anything.

Gate `dd` evaluation continues to read `latestGateDecisions("project", …)` —
the completion check produces the missing-artifact list; the human gate
decision remains the record.

### 6. External search seam — pluggable, and honest by default

The benchmarking executor is pluggable exactly like Phases 2–3: the seam of
`runActivityChain` is the insertion point, the ADR-0098
`business-case-generator.ts` pattern (`setExecutorFactory` / env-gated mode)
is the shape. The **default executor is deterministic and does NOT fake
external sources**: it proposes items derived from the project's industry
profile, with `source_url = NULL` and `source_reliability = 'C'` — visibly
unsourced, visibly lowest-confidence. A WebSearch-backed implementation is the
documented seam for Phase 7 / live use.

**Honesty constraint (binding):** the deterministic default must not fabricate
plausible-looking URLs or grades. A fabricated A-grade source behind a
checklist item would launder an invented concern into a gate input — the
precise failure boundary #4 exists to prevent. An unsourced proposal is shown
as such in the 산업 맞춤 제안 panel and can still be approved by a human who
judges it worthwhile on its own terms; what it can never do is *appear*
sourced.

### 7. MCP thin wrapper

`dd_checklist_tailor` and `dd_checklist_review` thin wrappers over the REST
routes above, per the no-dead-endpoint principle (ADR-0094 §6 / ADR-0011) —
MCP access is REST-only, and every exposed tool backs an existing route.

## Consequences

- **S9 completion becomes mechanically checkable including custom items.**
  "적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다" has a
  table-level predicate over `project_checklist_item_state` alone;
  `REFINEMENT (Phase 4)` is paid off and removed.
- **Provenance travels with every tailored item.** `source_url` +
  `source_reliability` are columns on the item, not prose in an
  `activity_run` — a reviewer can see at a glance which tailored coverage rests
  on an A-grade source and which on an unsourced agent proposal.
- **The standard checklists remain the authoritative floor.** Tailoring is
  strictly additive; nothing in this ADR lets an agent remove, weaken, or
  downgrade a `checklists/*.yaml` item, and the completion predicate runs over
  standard and custom items identically.
- **Boundary #2 preserved by construction.** Agents propose with sources;
  only a human approves an item into the gate-relevant set, and only a human
  records the `dd` gate decision.
- **One judgment ledger, no parallel tracking.** Approved custom items ride
  `project_checklist_item_state` (and its waiver flow) from day one; a
  consumer reading that table cannot tell standard from custom items apart and
  does not need to.
- **The deterministic default is honest by being visibly weak.** Unsourced,
  C-grade proposals make the seam's limits legible to the reviewer instead of
  hiding behind fabricated authority; the WebSearch-backed executor upgrades
  provenance without changing any table, route, or predicate.
