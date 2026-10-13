# ADR-0166 — Green Field projects default to origin `internal` at promotion (amends ADR-0047 section A.5)

- Status: Proposed — decided in chat 2026-10-14 by the human decider (corrected the same day); formal acceptance pending
- Date: 2026-10-14
- Decider: Human decider (account techcross), chat 2026-10-14. Drafted by backend-engineer.
- Amends: ADR-0047 section A.5 (origin derivation mapping table, Wave F-8 audit B4)
- Related: ADR-0013 (origin enum), ADR-0047 (origin applies_when), ADR-0100 (establishment project key), ADR-0165 (establishment steps), DEC-20261014-01

## Context

`deriveOriginFromSubTrack` (db/lib/origin-derivation.ts) maps only Brown Field sub-tracks (jv -> joint, corporate_venture / intra_venture -> internal, m_and_a / strategic_investment -> external, minority_investment -> hybrid). Green Field returned null, so a promoted Green Field project had `md_project.origin = NULL` unless the promoter supplied one. With origin NULL the S11 establishment steps (applies_when origin in internal or joint) did not apply.

An earlier same-day chat answer ("joint") concerned Brown Field and was misapplied to Green Field; the decider corrected it: the Green Field default is `internal`.

## Decision

1. For `track = 'greenfield'`, `deriveOriginFromSubTrack` returns `internal` for every sub-track (including none). The Brown Field mapping is unchanged.
2. The optional `origin` in the `POST /api/opportunities/:id/promote` body still wins, so `joint` (a genuine joint venture) or any enum value remains selectable. The promotion form's empty choice means "server default" (internal for Green Field).
3. No backfill: existing rows with `origin IS NULL` stay NULL. Reclassification of an existing project remains a separate, explicit act.
4. Consequence per ADR-0047: a freshly promoted Green Field project takes the origin internal-or-joint paths, so S11 requires the five establishment steps.

Amended mapping table (A.5):

| track | sub_track | default origin |
|---|---|---|
| greenfield | any or none | internal |
| brownfield | jv | joint |
| brownfield | corporate_venture, intra_venture | internal |
| brownfield | m_and_a, strategic_investment | external |
| brownfield | minority_investment | hybrid |
| brownfield | other or none | null |

## Open consideration: new business unit without a new legal entity

The decider clarified (chat 2026-10-14) that creating a new legal entity is not mandatory for a new (Green Field) business: it can be pursued as a new business unit without forming a company. Under this ADR a Green Field project defaulting to `internal` takes the S11 establishment steps, which presume entity formation. How S10/S11 should treat a business-unit-only path is NOT decided here; a separate design will decide it. Nothing is implemented for this point.

## Consequences

- Existing NULL-origin Green Field projects are unaffected and will not gain the S11 establishment requirement until an origin is set deliberately.
- The isolated demo seed Green Field project carries `internal` (restored).
- Open point for the human: whether to backfill or reclassify existing NULL-origin Green Field projects.
