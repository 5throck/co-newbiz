---
lang: en
counterpart: business-manual_ko.md
---

# Business Manual — Analysts & Committee Reviewers

> **Language**: **English** · [한국어](business-manual_ko.md)

**Audience**: Analysts, Entity IC / Group IC reviewers
**Not for**: system operators (see `operations-manual.md`) or administrators (see `admin-manual.md`) — this separation is deliberate; merging the three means nobody reads any of them (design section 10.5).

## What This Manual Covers

What to do at each gate, how to read a checklist, where deliverables go, and how to interpret RAG grades and Kill Criteria findings.

## 1. Your Role at Each Gate

See `docs/governance/process-map.md` for the authoritative deliverable/approver/RACI table. In summary:

| Gate | If you are an analyst | If you are an IC reviewer |
|---|---|---|
| Screening | Build the initial deliverable (site shortlist or target longlist) | Not yet involved |
| Pre-FS | Confirm WACC/hurdle IRR inputs with the deal sponsor | Not yet involved |
| FS | Complete the valuation, growth projection, and (BF) start the six-validator cross-check | Not yet involved |
| DD | Land every DD finding as a `dd_finding` with `value_impact` (INTEGER, unit = KRW millions — ADR-0061) — never leave a finding as prose only | Not yet involved |
| (S10 deal structuring — between DD and Entity IC) | Record the deal-structure hypothesis (vehicle incl. SPC), complete the four-axis review (tax / liability isolation / financing leverage / exit), and balance the financing plan (sources & uses) — ADR-0106. S11 cannot open without it | Not yet involved — the structure the IC reviews is this stage's output |
| Entity IC | Prepare the IC memo (see template) | Review, confirm or correct the AI-proposed RAG grade **with a reason if you correct it**, approve/reject/request more work |
| Group IC | Support the ranking discussion if asked | Rank this proposal against concurrent `group_agenda` entries; decide approved/rejected/**conditional** |

## 2. Reading a Checklist

Checklists mix mandatory and recommended items (`mandatory: true/false` per item — see `checklists/*.yaml`). A mandatory item blocks the gate without an active waiver. A recommended item's absence just needs a stated reason, not a waiver.

## 3. Reading a RAG Grade

- **Never take a single overall color at face value** — read the six-dimension breakdown. A Green overall requires *all six* dimensions Green, including data confidence.
- **Data confidence caps everything.** If you see Amber overall with a strong financial dimension, check data confidence first — a B-grade proxy chain caps the whole assessment at Amber regardless of how good the numbers look.
- **The rationale line tells you which rule fired**, not just the color. If it doesn't, that's a defect — flag it.
- **An Amber grade should tell you what would raise it.** "Data confidence B" is not actionable; "confirm direct shipment data to reach A" is.

## 4. Kill Criteria

A Kill Criteria hit halts the project. It is not advisory. See `policies/group/neb-policy.md` §4 for the binding list. Overriding one requires an explicit Group IC decision — no analyst or single reviewer can waive a Kill Criteria unilaterally.

## 5. Where Deliverables Go

- IC memos: `templates/deliverables/ic-memo-template.md` — see the deliverables output folder structure once Stage 4/5 lands the system.
- DD findings: recorded against the applicable `dd_finding` schema, linked to `assumption_key`.
- Meeting outcomes: `memory/meeting-*.md`, with action items routed per the design's explicit rule — no action item without an owner and a landing location.

## 6. Brown Field Special Topics — Evaluation Order

Per meeting M5, the six mandatory validators resolve in this order when you're assembling the valuation: (1) antitrust + HR integration cash-flow-schedule effects, (2) customer retention + incentive revenue/cost build, (3) certification transferability **last**, since a non-transferable certification can strip the entire acquisition premium and must not be computed against a valuation that already assumed it.
