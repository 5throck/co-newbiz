# ADR-0050: Errata to ADR-0045 — dangling reference to a nonexistent ADR

**Status**: Proposed
**Date**: 2026-08-22
**Deciders**: process-governance-manager, compliance-officer, brownfield-agent, legal-counsel

> **Proposed, not Accepted.** This is an errata record. It does **not** modify ADR-0045's Decision text, and it does not supersede ADR-0045 — that ADR's decision stands exactly as written.

## Context

[ADR-0045](0045-investment-vehicle-structuring-as-a-deal-structure-axis.md) added four mandatory review axes (tax structure, liability isolation, financing leverage, exit structure) to the Pre-FS deal-structure-hypothesis deliverable. That decision is sound and is not in question here.

Its Decision section closes with a supporting argument that contains a dangling reference:

> "…the same way the R&BD case-subtype extension (ADR referenced in design §18.2) extended `brownfield-pre-fs` rather than adding a parallel procedure."

**No such ADR exists.** ADR numbering in this repository runs 0001–0045 with no gaps, and no ADR in that range records the R&BD case-subtype decision. The reference points at design §18.2, which describes the decision but is not itself an ADR and carries no ADR number.

The decision being referred to is real; only its status as an ADR is not. It was taken on 2026-08-20 by user decision, and its actual record is:

- `CHANGELOG.md:83` — "R&BD (Research & Business Development) scope addition, per user decision — treated as a **Brown Field sub-type** (`case_subtype: rbd`), not a new top-level review type alongside GF/BF, since its deal mechanics (equity stake, license-in, spin-off carve-out) are BF-shaped rather than GF site-selection-shaped."
- `docs/srs.md:94` — the same decision restated as a requirement.

This was found during the classification-model work, where the R&BD decision needed to be cited precisely. It is recorded here rather than silently repaired because the ADR README states that amending a decision requires a new ADR referencing the one it supersedes, not an edit to the existing record — and that discipline applies to a citation defect as much as to a substantive one. Editing ADR-0045 in place would erase the evidence that its argument once rested on a reference that did not resolve.

## Decision

### 1. ADR-0045's Decision text is not rewritten

The four mandatory axes stand. The ownership assignment stands. The consequences stand. No content of ADR-0045 is modified by this errata, and readers should continue to treat ADR-0045 as the authority for investment-vehicle structuring.

### 2. The 2026-08-20 R&BD decision is prior art, not an ADR

It is recorded as a **non-ADR precedent** — a user decision with a real, citable record at `CHANGELOG.md:83` and `docs/srs.md:94`. Any document needing to cite it must cite those two locations. No ADR number may be assigned to it retroactively: back-filling a number into the sequence to satisfy a dangling reference would misrepresent when the decision entered the ADR record.

### 3. Nothing here claims to supersede a nonexistent ADR

This ADR supersedes nothing. Neither does [ADR-0047](0047-three-axis-case-classification-model-retiring-case-subtype.md), which retires `case_subtype` and carries the substance of the 2026-08-20 decision forward as `technology_track = 'rbd'`. ADR-0047 cites the 2026-08-20 decision as prior art in its Context and explicitly declines to name an ADR number for it, for the same reason.

A "supersedes ADR-NNNN" line pointing at a number that was never issued would create a second dangling reference while purporting to fix the first.

### 4. Going forward, ADR-0045's supporting argument reads against ADR-0047

ADR-0045's argument — that a case-classification extension belongs inside an existing procedure rather than in a parallel one — is correct, but its precedent is now ADR-0047, which makes the same architectural choice explicitly: three orthogonal classification axes extend the existing procedure set rather than forking parallel procedures per case type. Once ADR-0047 is Accepted, a reader encountering the "ADR referenced in design §18.2" phrase should read it as pointing at ADR-0047 (with `CHANGELOG.md:83` and `docs/srs.md:94` as the original 2026-08-20 record), not at a missing document.

## Consequences

- ADR-0045 keeps a citation that does not resolve on its own. That is deliberate: this errata is the resolution, and the ADR index links the two.
- The ADR README's closing paragraph — that ADRs 0001–0045 are Accepted and that amendments require a new ADR rather than an edit — is unchanged and is in fact the rule this errata follows.
- Practice going forward: an ADR may cite a design section, a changelog entry, or a requirements line as prior art, and should do so **by file and line** rather than by an implied ADR number. The failure mode here was not the citation of a non-ADR decision, which is legitimate, but the phrasing that made a non-ADR decision look like an ADR.
- One cheap check would have caught this: every `ADR-NNNN` reference, and every phrase of the form "the ADR referenced in …", should resolve to a file in `docs/adr/`. Adding that to `scripts/audit.ts` alongside the existing documentation-link validation is recommended but is not a blocking requirement of this ADR.
