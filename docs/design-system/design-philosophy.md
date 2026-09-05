---
governance_doc_id: gov-des-01
layer: docs-content
title: "Design Philosophy and Principles"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: design-philosophy_ko.md
---
# What standards govern the design of this site's screens

The co-newbiz website is a single system covering all 12 stages (S1–S12) of new business review. With dozens of screens, if each person built them their own way, users would have to relearn how to use every screen. To prevent that, five design principles that every screen follows in common have been defined. (Basis documents: `docs/designs/2026-09-01-standard-screen-patterns-design_ko.md`, `docs/design-system/design-guide.md`)

1. **Never confuse "in progress" with "decided"** — screens mix two kinds of indicators. One is **status**, showing "where things stand right now" (e.g., In Progress, Pending); the other is **decision**, showing "who decided what" (e.g., Approve, Reject, Required). Without a clear visual distinction between the two, users can look at a color and mistakenly think something "has already been approved."
2. **Never mix what the AI proposed with what a human decided** — values recommended by the system (AI) are always shown with a "proposal" marker, kept visually and clearly separate from the screen elements where a human actually approves or rejects (the gate decision cards). In other words, an AI recommendation must never be made to look like a decision a human already made.
3. **One screen, one purpose** — list screens are for "picking", detail screens are for "reading", and decision screens are for "deciding." Mixing several purposes on one screen confuses users about what they are supposed to do there. (For the detailed screen-type classification, see [Standard Screen Patterns P0–P5].)
4. **Colors, spacing, and typography use only pre-defined tokens** — no raw color values are written directly into screen code; only pre-defined tokens are used (see [Design Tokens] for details). This is what makes it possible later to change the color or style of the entire product in one move.
5. **Accessibility is not optional — it is the default** — keyboard operability, standard tags for screen readers, and respect for motion-sensitivity settings are conditions every screen must satisfy before it can ship (see [Accessibility · Universal Design] for details).

## 🌐 External Reference — Is "separating AI proposals from human decisions" also an industry standard?

Yes — this principle matches exactly the widely used industry concept of **Human-in-the-Loop** (the human holds final decision authority): the AI supplies material for judgment, the actual decision is always made by a human, and nothing executes automatically before human approval. That said, related research shows that simply having this structure in place does not automatically produce good outcomes — people sometimes actually review less carefully precisely when the AI's accuracy is low (automation complacency / over-reliance). So in addition to separating AI proposals and human decisions visually, it is also important not to fatigue reviewers by demanding human approval for every trivial, low-risk item — when there is too much to review, people eventually stop looking properly and just click Approve. For sources and details, see [docs/research/human-in-the-loop-ui.md] (surveyed 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Visual separation of boundary #2 | docs/adr/0106, flow.spec boundary invariants |
| Token-first | docs/design-system/design-guide.md, standard screen patterns design doc §2 |
| Accessibility shipping condition | ui-spec as-built (UD audit), manual-authoring skill |
| HITL design practice | docs/research/human-in-the-loop-ui.md |
