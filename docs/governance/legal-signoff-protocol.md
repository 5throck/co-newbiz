---
lang: en
lang_reason: source-material
governance_doc_id: gov-legal-signoff-protocol
layer: guideline
title: "Legal Counsel Sign-off Protocol"
owner_agent: process-governance-manager
version: "1.0.0"
status: approved
approved_by: "human decider, chat 2026-10-13"
---

# Legal Counsel Sign-off Protocol

## Purpose

Checklist items that cite law start as AI drafts (`draft-AI`). This protocol defines how a named lawyer's review is recorded
so an item can move to `counsel-reviewed` or `confirmed` with evidence. It is informational: it never blocks a gate or any work.
Proposed in the legal-counsel round 2 of `memory/meeting-2026-10-13-residual-items.md`; approved by the human decider in chat on 2026-10-13.

## Artifact

`legal-signoff/<checklist>@<version>.yaml` (checklist = the `checklists/<stem>.yaml` stem; version = the checklist version reviewed).
Template: `legal-signoff/_template.yaml`.

Per item: `item_id`, `authority` (law name, MST, article), `verdict` (`confirm` | `revise` | `hold`), signer name and qualification
(file level), `signed_on` date, optional note.

## Roles

- One named lawyer signs (the signer). **Signer: to be designated by the human decider** - not yet named, so no item may be marked counsel-reviewed today.
- One human approver (not the signer) accepts the record. The approver is a person, never an agent.
- Agents may prepare the file as drafts but cannot sign or approve (agents hold no accounts of their own).

## Granularity

Per item. Checklist-level signing is allowed only for pure citation corrections (article numbers, notation, verification dates; same obligation, same person).

## Mapping to the checklist YAML

| Sign-off verdict | Checklist item |
|---|---|
| `confirm` | `review_status: counsel-reviewed` (or `confirmed` once the human approver also accepts), `reviewer` = signer name, `verified_on` = `signed_on` |
| `revise` | text is revised by the owner, then re-submitted as a new version; status stays `draft-AI` |
| `hold` | status stays `draft-AI`; the item is listed as "needs judgement" |

`checklists/_validate.ts` (v1.5.0) enforces: item ids exist, verdict enum, signer, qualification, approver and date present,
and every item with `counsel-reviewed` or `confirmed` has a matching `confirm` entry with equal reviewer and date.

## 30-day rule

An item whose sign-off request is unsigned 30 days after the request leaves gate evidence and moves to "needs judgement" on the review surface.
This is informational only and never blocks work or a gate.

## Interim marker

Until signed, items show: `"AI 작성 · 법령 원문 일부 확인 · 변호사 검토 전 — 확정 아님"` (quoted Korean marker).

## Limits

Decision support, not legal opinion. Certification-transferability and similar conclusions still need the certifying body or counsel as the design requires.
