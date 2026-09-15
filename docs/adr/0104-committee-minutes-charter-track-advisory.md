---
lang: ko
lang_reason: source-material
---

# ADR-0104: Committee minutes & scorecard, project charter, and track advisory

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0097 (committee deliberation), ADR-0095 (promotion), ADR-0101 (S11 scorecard), ADR-0103 (hybrid scoring)

## Context

The S8+ lifecycle moved to project-keyed execution, but three gaps remained:
committee deliberation left no durable minutes/scorecard (only an on-read
transcript), promoted projects carried no charter answering "어떤 프로젝트인지",
and the greenfield-vs-brownfield route decision had no structured logic for the
greenfield side.

## Decision

1. **Committee minutes & scorecard**: `lib/committee-scorecard.ts` builds, on
   read, a deterministic Markdown meeting record (seat scorecard with per-seat
   5-criteria scores parsed from position-meta markers, recommendations,
   confidence, veto/dissent, chair synthesis, gate link) and a committee
   aggregate (per-criterion median/spread). `GET …/minutes` serves it;
   `POST {confirm:true}` records the chair sign-off once in process_run meta
   (append-only) and audits it. The IC package lists committee session refs.
2. **Project charter**: promotion builds a structured charter
   (`lib/project-charter.ts`) from S1~S7 artifacts — purpose, track grounding
   (route decision score/rationale), track-specific entry scope (greenfield:
   entry strategy + capability gaps; brownfield: shortlist snapshot),
   and KPI pre-commits. Stored on md_project (0074: project_name,
   charter_json, charter_confirmed_at); amendments are append-only versions.
   C2: charter KPI keys become default S11 scorecard targets at record time.
3. **Track advisory**: `lib/track-advisory.ts` computes a deterministic
   greenfield/brownfield recommendation with per-signal rationale (S1 CAGR
   curve, shortlist existence, synergy score), base rates from past route
   decisions, and re-review triggers — exposed via
   `GET /api/opportunities/[id]/route-advisory`. Greenfield route decisions
   also record the 5-criteria scores (flow.spec S4 updated). Human authority
   unchanged: the advisory never records the decision.
4. **Portfolio pipeline**: `GET /api/portfolio/pipeline` exposes every
   project's S8~S11 stage/gate snapshot plus HOLD/kill gate aging (D1/D2);
   `/projects/[id]/pipeline` renders it.

## Consequences

- Boundary #2 is untouched: all new surfaces are read-only or human-confirmed.
- Charter KPI pre-commits give the S11 scorecard its yardstick from promotion
  day; insufficient_evidence/deviation statuses still mark early quarters.
