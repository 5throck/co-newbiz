# ADR-0154 — MCP remote transport, user-delegated OAuth 2.1, and proposal-only decision tools

- Status: Accepted (2026-10-08, pre-approved by the user in chat)
- Date: 2026-10-08
- Deciders: Human reviewer (user, pre-approved in chat 2026-10-08). Drafted by platform-lead (Wave M Row 0). AI review alone cannot accept this ADR (auth model, MCP tool scope, DB schema, boundary #2).
- Design of record: `docs/designs/2026-10-08-wave-m-mcp-parity-design.md`
- Related: ADR-0152 (typed closure), ADR-0153 (3-stage review runtime)

## Context

The MCP server is stdio only, with a single personal API token and 19 tools, 3 of which write. Hosted chat clients (ChatGPT, Claude.ai, and the Gemini app) need Streamable HTTP with OAuth. Agents cannot cover S1–S12. The existing `record_gate_decision` lets an agent write a gate decision directly, which conflicts with boundary #2.

## Decision

1. **Transport.** The web app exposes MCP over Streamable HTTP at `/api/mcp`. Stdio is kept. Both transports use one tool registry that calls the existing route handlers through a `RestPort`, with no duplicated business logic.
2. **Auth.** The web app hosts an OAuth 2.1 authorization server: S256 PKCE, RFC 7591 dynamic client registration, RFC 8414/9728 metadata, RFC 8707 audience binding, and RFC 7009 revocation. Access tokens last 15 minutes; refresh tokens last 7 days and rotate with reuse detection. Scopes are `read`, `write`, and `propose`. Tokens are issued only to a logged-in human and are evaluated against that user's live permissions. There is no `client_credentials` grant and no agent account (boundary #1). All issuance and tool calls are audited.
3. **Schema (additive).** `api_tokens` gains `kind`, `client_id`, `scopes`, `family_id`, `audience`, `expires_at`, and `revoked_at`. New tables are `oauth_client`, `oauth_code`, and `decision_proposal`.
4. **Tool scope.** Write, generate, review, and propose tools cover every flow.spec S1–S12 activity and required artifact. The `mcp-coverage.ts` audit check enforces this coverage, with an explicit exclusion list.
5. **Proposal-only decisions (boundary #2).** Gate, route, case adoption, target selection, transition, and approval tools only create a `decision_proposal`. A human confirms it on a web page in their own session, and that session executes the existing decision route. MCP elicitation may point to the page but never executes the decision. Closure and PMI kickoff are not exposed as tools.
6. **Breaking change.** `record_gate_decision` and `create_route_decision` are replaced by `propose_gate_decision` and `propose_route_decision`. For one release the old names remain as deprecated aliases that create proposals, and they are then removed.

## Consequences

- Hosted connectors can work a deal end to end, and every decision still has a human decider of record.
- Agents that call `record_gate_decision` stop writing decisions immediately and must follow the confirm URL.
- There are new attack surfaces: DCR, consent, and the remote endpoint. The design's threat model (§10) applies, and security-engineer reviews it before M-1 merges.
- The parity test (REST vs MCP reaching the same `evaluateProcess` result) becomes a standing regression gate.

## Alternatives rejected

- **A separate MCP service with its own credentials.** It would need an elevated server credential, which creates a confused deputy and violates boundary #1.
- **Long-lived personal tokens pasted into connectors.** Hosted clients do not support this, and the theft risk is high.
- **Letting elicitation responses execute decisions.** The response travels through the agent's client and does not prove a human web session.
