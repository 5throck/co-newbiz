---
lang: ko
lang_reason: source-material
---

# Company Competitor Registry — AI proposes, a person confirms

- Spec ID: `2026-09-18-company-competitor-registry`
- Date: 2026-09-18
- Status: implemented
- Companion ADR: `docs/adr/0143-company-competitor-human-confirmation.md`

## Problem

Competitors exist only inside the company-profile analysis payload
(`company_profile_version.payload` → `profile.competitive.competitors`), written
straight from the LLM step of `lib/company-profile-pipeline.ts` with no human
decision in between (ADR-0089 kept the surface a non-stage activity with no
approval semantics). The `/our-company` 경쟁 tab renders the list read-only;
the only way to change it is a re-analysis. The user direction: AI **proposes**
competitors, a person **selects/confirms** them, and manual registration must
also be possible — direct machine acceptance of AI-proposed competitors is the
defect.

## Requirements (ASD-STE100)

- R1: The profile payload stays an append-only analysis record; the pipeline
  does not change. Payload competitors are PROPOSALS.
- R2: A confirmed competitor row is created only by a person's accept (AI
  proposal) or register (manual form) action. Both record
  `discovery_source` (`ai_proposal` | `manual`) and `proposal_accepted_at`.
- R3: Accepting a proposal snapshots the cross-check verdict and evidence URLs
  onto the row, so later payload regeneration or renaming cannot detach them.
- R4: The registry supports note/DART-code edit, soft exclusion with a reason,
  and restore; every mutation is audited (`appendAudit`).
- R5: Duplicate names for the same subject are rejected (excluding excluded
  rows, mirroring the brownfield proposal contract).
- R6: The proposal list is stateless — assembled from the latest completed
  profile payload at read time, with already-confirmed names marked.
- R7: Consumers (brownfield technical-draft evidence, brownfield target detail
  profile section) read the confirmed registry first and fall back to the
  payload with an explicit "unconfirmed" marker.
- R8: No backfill migration — existing payload competitors surface as
  proposals for a person to accept.

## Design

### Storage (migration `0112_company_competitor.sql`)

`company_competitor` table — dual subject per the `company_profile_version`
0105/0106 pattern:

| column | type / constraint |
|---|---|
| id | TEXT PK |
| member_id | TEXT NULL REFERENCES company_group_member(id) |
| company_id | TEXT NULL REFERENCES md_company(id) |
| name | TEXT NOT NULL |
| dart_corp_code | TEXT NULL |
| note | TEXT NULL (경쟁 관계 한 줄) |
| status | CHECK IN ('confirmed','excluded') DEFAULT 'confirmed' |
| exclusion_reason | TEXT NULL |
| discovery_source | CHECK IN ('manual','ai_proposal') NOT NULL |
| proposal_accepted_at | TEXT NOT NULL |
| crosscheck_verdict | TEXT NULL |
| evidence_json | TEXT NULL (array of {title,url}) |
| created_by / created_at / updated_at | TEXT |

CHECK `(member_id IS NOT NULL OR company_id IS NOT NULL)`; partial unique
`UNIQUE(name, member_id) WHERE member_id IS NOT NULL AND status='confirmed'`
and the company_id twin.

### API (all analyst+, all mutations `appendAudit`)

Shared helpers in `lib/company-competitors.ts` (subject resolution, proposal
assembly, dup checks) so the member and company routes stay thin:

- `GET .../competitor-proposals` — latest completed profile payload
  `competitive.competitors` joined with the cross-check verdict
  (claim-prefix `"경쟁사 {name}:"` mapping) and `accepted` marks from the
  registry; response `{ proposals: [{name, note, verdict, evidence, accepted}] }`.
- `POST .../competitors` — body `{name, dart_corp_code?, note?,
  discovery_source, crosscheck_verdict?, evidence?}`; enum validation, dup
  check (excludes excluded rows), `proposal_accepted_at = now`, audit
  `competitor.accept` / `competitor.register` (brownfield
  `target-proposals` route contract, `route.ts:58-86`).
- `PATCH .../competitors/[competitorId]` — note / dart_corp_code edit;
  audit `competitor.update`.
- `POST .../competitors/[competitorId]/exclude` — body `{reason}` required;
  `POST .../restore` — back to confirmed; audits `competitor.exclude` /
  `competitor.restore`.

Deferred (tracked, not in this PR): on-demand web-search re-proposal endpoint
(the brownfield `target-proposals/web-search` ladder) — until then, proposals
refresh via profile re-analysis.

### UI (`/our-company` 경쟁 tab)

Three stacked sections, replacing the read-only table:

1. **확정 경쟁사** — registry table (경쟁사 / DART / 경쟁 관계 / 출처 칩
   `AI 제안 수용`|`수작업` / 수용일 / 대조 판정 칩 / 관리 액션 수정·제외·복원).
   Empty state instructs to accept a proposal or register manually.
2. **AI 제안** — cards from the proposal API: note, cross-check verdict chip,
   evidence links, `[수용]` `[무시]` per card (무시 is client-side dismiss).
   Sourced from the latest analysis; a re-analysis refreshes proposals.
3. **수작업 등록** — always-visible form: name + [DART 검색] (reuse
   `GET /api/synergy/dart-search`, same fill pattern as the brownfield form) +
   note + [등록].

The payload positioning paragraph stays below as "AI 분석 참고 — 확정 목록과
별개" context. Design-checklist: P2 report patterns, existing components only
(SectionToolbar, status-chip, btn-primary/btn-ghost, ConfirmDialog not needed —
exclusion uses a required-reason inline form), no new icons/tokens.

### Consumers

- `lib/brownfield-technical-draft.ts` `profileEvidenceBlock`: prepend registry
  rows when the subject has any confirmed competitors; annotate payload-only
  fallback lines with `(미확정 — AI 제안)`.
- Brownfield target detail profile section: same registry-first order.

## Test plan

- `tests/unit/company-competitor.test.ts` — scratch SQLite + route dispatch:
  accept creates a row with provenance + audit; manual register; duplicate
  rejection; exclude requires a reason; restore; PATCH edits; proposals mark
  accepted names and map cross-check verdicts; viewer role → 403.
- Consumer fallback test: with an empty registry the technical-draft evidence
  block falls back to payload lines with the 미확정 marker; with registry rows
  the payload lines are replaced.
- Gates: `bun run test:unit`, design-lint, `db:migrate` + `db:integrity`.

## Out of scope

- Web-search re-proposal endpoint (deferred above).
- Backfill of historical payload competitors (they surface as proposals).
- Feeding the registry into S1 competitive-structure analysis (future link).
