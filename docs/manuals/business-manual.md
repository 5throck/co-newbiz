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
| Pre-FS | Confirm WACC/hurdle IRR inputs with the deal sponsor; then record the human `pre_fs` GO decision at opportunity scope (ADR-0205) — a person with gate rights records GO/HOLD, agents only propose. No GO → S6 cannot complete and S7 stays locked; a HOLD recorded after a GO relocks S7 (recorded S7 work is kept); unreviewed `ai_draft` verdicts block the GO (ADR-0202) | Not yet involved |
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

- IC memos: `templates/deliverables/ic-memo-template.md`.
- DD findings: recorded against the applicable `dd_finding` schema, linked to `assumption_key`.
- Meeting outcomes: `memory/meeting-*.md`, with action items routed per the design's explicit rule — no action item without an owner and a landing location.

## 6. Brown Field Special Topics — Evaluation Order

Per meeting M5, the six mandatory validators resolve in this order when you're assembling the valuation: (1) antitrust + HR integration cash-flow-schedule effects, (2) customer retention + incentive revenue/cost build, (3) certification transferability **last**, since a non-transferable certification can strip the entire acquisition premium and must not be computed against a valuation that already assumed it.

## 7. Committee Meetings (Dialogue Form)

Committee deliberation runs as a **turn-based dialogue meeting** between AI seats (ADR-0204). It is not a meeting of people, and its output (a `proposal`) is not a decision. Gate approval and the investment decision stay with humans.

- **Default engine**: the dialogue engine is the default for new meetings (owner decision, 2026-11-21). With `CO_NEWBIZ_COMMITTEE_ENGINE` unset it resolves to `turns`. An operator who sets `CO_NEWBIZ_COMMITTEE_ENGINE=rounds` opts back into the earlier round engine (one position paper per seat per round); see the operations manual §3.1. Meetings already convened keep the engine they started with. A history row shows a "대화형" (dialogue) badge for dialogue meetings.
- **Attendance and voting**: for each agenda issue the chair picks 3-5 seats and records a reason for each. Seats with veto or mandatory-review authority (the risk seat) are always included. Seats address each other by display name and ask, answer, and rebut. Only that issue's participants vote on the consensus proposal; a seat that did not take part is shown as "불참" (absent) and is never counted as agreement.
- **Following progress**: after you convene, the page shows a one-line status (issue i/n, the current speaker, turn count, elapsed time). The meeting window opens only when you click "회의 보기" (view meeting). It follows the newest turn; when you scroll up it pauses and offers "최신 발언으로 (새 발언 N건)" (jump to latest, N new turns). Closing the window does not stop the meeting.
- **Human seats**: in a hybrid meeting ("라운드별 인간 입장 포함"), a human turn shows "내 차례" (your turn) with a countdown: 3 minutes per turn and 20 minutes per meeting. A turn that times out is recorded as no response. Submitting a turn needs analyst permission or above.
- **Interrupted meetings**: if a meeting stops (for example a server restart) the page shows "회의 진행이 도중에 끊겼습니다" with "멈춘 안건부터 다시 시작" (restart from the stopped issue). The minutes of a resumed meeting note "N번에 나눠 진행" (held in N sittings).
- **Minutes**: a finished meeting opens through a single "회의록 보기" (view minutes) button, with "회의록" (minutes) and "전체 발언" (full transcript) tabs. The minutes list each issue's attendees and selection reasons, key exchanges quoted verbatim, the consensus proposal, the vote tally including absent seats, seat recommendations, dissent verbatim, open items, and appendices (full transcript, interrupted attempts); a `.md` download is available. A person with analyst permission or above confirms the minutes. Meetings held before the dialogue engine keep the earlier minutes format.
- For screen-level reading steps see the in-app guide page "S4 진출방식 결정", sections "위원회 회의 진행 보기" and "위원회 회의록 읽기".

## 8. Related Screens

- `/flows` — stage-flow visualization with a dry-run lane (ADR-0183).
- UI language switch — ko/en message catalogs behind cookie-based locale negotiation (ADR-0184).
- `/wiki` — in-app viewer for the user-manual wiki.
- [`mcp-user-guide.md`](mcp-user-guide.md) — connecting an AI client (Connected Apps screen, personal API token).
