---
lang: ko
lang_reason: source-material
---

# ADR-0196: Committee deliberation as a meeting: responsive rounds, chair agenda, structured minutes

**Status**: Accepted (owner decisions in chat, 2026-11-08)
**Date**: 2026-11-08
**Deciders**: Owner (decision); drafted by process-governance-manager
**Related**: ADR-0053, ADR-0074, ADR-0096 (amended §4), ADR-0097 (amended), ADR-0104 (amended), ADR-0186 (amended for M7), design `2026-11-08-committee-minutes-as-meeting-design`

Owner decisions, verbatim (chat, 2026-11-08):

- Decisions 1–6: "결정힐 6가지 사안에 대해 권장안에 동의해."
- Decisions 7–8: owner selected "confirm all as recommended".
- Decision 9: "9번도 변경해주는 것으로 확정할께".
- Scope: "다른 회의방식도 같은 형태로 바꿀 필요가 있어."

## Context

Committee minutes today are a seat scorecard plus raw positions. Seats write independent positions each round, so the record reads as parallel monologues, not a meeting: no agenda, no exchange between seats, no grouping by issue. The owner asked that every meeting format adopt the same form.

## Decision

1. **Responsive rounds (ADR-0096 §4).** Round 2+ prompts include the member's own prior position, every peer's latest position verbatim, the agenda, and a response contract (respond to named seats; mark stance changes in the `position-meta` tail: `responds_to`, `stance_changed`, `issues`). Peer text is capped at about 6k tokens; the latest round is always pasted verbatim.
2. **Chair agenda (A1).** After round 1 the chair runs one agenda pass (LLM with a deterministic fallback). In hybrid mode humans may edit the agenda before round 2.
3. **Structured minutes.** A chair minutes pass produces JSON (agenda, discussion by issue with position refs, agreements, verbatim dissent, open questions and actions, the recommendation labelled "proposal, not a decision", appendix of all positions). A zod schema drops fabricated refs and non-session seats.
4. **Storage (S2).** `process_run.meta_json` holds `agenda` and `minutes_draft{json, model, prompt_version, input_hash, created_at}`. No migration. Markdown is rendered on read. A move to a `committee_minutes` table (S3) requires a new ADR and data-architect review; triggers: minutes become a queried IC-package input or need cross-session search.
5. **Regeneration.** The minutes pass runs once (synthesis or last round). A GET never calls the LLM. Explicit regeneration (analyst+, audited) is allowed only while unconfirmed and when `input_hash` changed or the draft is a fallback. Once `minutes_confirmed_by` is set (ADR-0104) regeneration is refused (409). Budget or rate-limit errors fall back to deterministic minutes marked `fallback: true`; a run never fails because of the minutes.
6. **Language.** AI-drafted minutes follow the topic language, as `committee.position` does.
7. **Surfaces in scope (M1–M8).** M1 S4 route steering committee; M2 S6/S7 long list → short list committee; M3 pipeline auto-convene; M4 the CLI `committee-deliberation.ts` (persists the same meta keys, renders the same layout); M5 MCP read-only passthrough; M6 IC package links to minutes (no content copied); M7 Entity-IC and Group-IC reviews become committee sessions (decision 9, design §7.2): each procedure gains a deliberation step before the human verdict step, two committees are registered in `procedures/_committees.yaml`, flow.spec gate exit criteria reference the minutes; M8 `skills/meeting-facilitation` adopts the same section order as a markdown template.
8. **Phasing.** A engine → B agenda/minutes/storage → C UI, MCP, IC package → D meeting-facilitation → E M7 (last).

## Boundaries (binding)

- Agents propose; humans decide (boundary #2, ADR-0053). The minutes and the recommendation are proposals; no AI section uses "approved" or "decision" wording.
- Dissent is reproduced verbatim from `dissent_json`; the minutes pass has no write path to dissent or to the recommendation (ADR-0096 §6).
- The chair facilitates (agenda and minutes passes, recorder pattern) and votes nothing (ADR-0097).
- For M7 the committee session is neither maker nor checker under ADR-0186; its outputs are DISPLAY items in the gate snapshot, and unconfirmed minutes at GO are an ACK item.

## Consequences

- No schema change for M1–M6, M8. M7 may need project-scoped sessions; if that needs a schema change, a separate ADR is drafted at Phase E start.
- M7 changes `procedures/**` (entity-ic-review v1.5.0, group-investment-review v1.4.0): policy impact analysis and a `project_policy_pin` check are required before merge; pinned in-flight projects keep their pinned versions unless a human re-pins.
- `skills/meeting-facilitation` is `scope: common`: the template change goes upstream via `upstream_request_create` (filed by PM), with a project-local override marked `LOCAL-PATCH(upstream-request: <id>)` until it lands.
- Cost: one agenda call (~600 tokens) and one minutes call (~2500 tokens) per session.
