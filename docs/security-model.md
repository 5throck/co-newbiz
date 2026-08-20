# Security Model — co-newbiz

**Owner**: security-engineer (with legal-counsel, compliance-officer)
**Design of record**: design v1.0 §4-9-1 (task 4.5), ADR-0038/0039/0040/0012
**Status**: Stage 4 draft — threat model and control mapping. Controls not yet implemented (Stage 5).

## 1. Trust Boundaries

```
[AI Client (Claude/Antigravity/Codex)] --stdio--> [MCP server] --REST--> [API layer] --repo layer--> [DB]
[Web Browser] --HTTPS--> [API layer] --repo layer--> [DB]
[CLI] --direct or REST--> [API layer / DB via repo layer]
```

**Single enforcement point**: every path above converges on the repository layer (`db/repositories/*.ts`) for project-membership filtering (FR-SEC-03). No trust boundary above that point is permitted to carry its own, separate authorization logic that could drift from the repository layer's.

## 2. STRIDE Threat Matrix

| Threat | Vector | Control |
|---|---|---|
| **Spoofing** | Stolen session cookie / API token | Hashed token storage, `httpOnly`+`secure`+`SameSite=Lax` cookies, session revocation on password reset (FR-SEC-09) |
| **Spoofing** | Agent service account impersonation | No agent service account exists at all — agents inherit the calling user's session (design non-negotiable boundary #1, FR-SEC-08) |
| **Tampering** | Direct DB write bypassing the repository layer | All access through `db/repositories/*.ts`; code review + static scan for a bypass query path (FR-SEC-03) |
| **Tampering** | Audit log deletion | Append-only `audit_log`, no DELETE grant at any DB role, including admin (FR-SEC-07, ADR-0012) |
| **Repudiation** | A user denies performing a sensitive action | `data_access_log` on read access to sensitive tables (not just writes); `audit_log` on every write |
| **Information Disclosure** | Non-member enumerates/discovers a project's existence | Deny-by-default membership; a non-member gets 404, not 403, so existence itself isn't leaked (FR-SEC-01) |
| **Information Disclosure** | `admin` role used to view deal data without membership | Two-axis model (role × membership) — admin grants system administration only (FR-SEC-02) |
| **Information Disclosure** | Individual compensation data exposure | No individual-level rows in `comp_benchmark`; `executive_ref` is a role-based key, never a real name (FR-SEC-05, FR-MA-06) |
| **Information Disclosure** | MNPI project data reaching an unauthorized AI client | `mnpi_flag` excludes the project from default MCP responses; explicit scoped-token override is itself audited (FR-SEC-06) |
| **Information Disclosure** | API key value exposed via the admin console | Console shows presence + last-success timestamp only — no field capable of rendering the key value exists in the UI (design §4-9) |
| **Information Disclosure** | Wall-group-excluded user accesses a project via an indirect path (e.g. a report link) | `wall_group` exclusion enforced at the same repository layer as membership, not just at the primary project endpoint (FR-SEC-04) |
| **Denial of Service** | Uncontrolled outbound fetch loop | `ensure_fresh()`'s cache-first design + `safeFetch()` SSRF guard on every outbound call (FR-DATA-05/06) |
| **Denial of Service** | Unbounded MCP write-tool calls | Per-token rate limiting on ✱-marked tools, tighter than read-tool limits (`docs/mcp-integration.md` §5) |
| **Elevation of Privilege** | Waiver approval role confusion | Approval-role table fixed per layer (regulation=Group IC, procedure=process-governance-manager, checklist item=domain lead) — not configurable by a lower-privileged actor (`docs/governance-operations.md` §2) |
| **Elevation of Privilege** | MCP tool scope creep | OpenAPI SSOT drift check (`docs/mcp-integration.md` §6) — a tool exposed without a matching REST endpoint is a CI failure |

## 3. Data Classification and Handling

| Sensitivity | Examples | Controls |
|---|---|---|
| Restricted (MNPI) | `mnpi_flag=true` project data | `insider_list`, full access logging, MCP default-exclusion, notification banner on access |
| Confidential | Executive compensation, individual employee pay | Aggregate-only storage where possible, role-based substitute keys, elevated-role API access requirement |
| Internal | Deal financials, DD findings, non-MNPI project data | Project-membership gating |
| Public (within workspace) | Glossary, interpretation registry | No project scoping needed |

## 4. Authentication and Session Security

- PBKDF2-HMAC-SHA256, 210,000 iterations, 16-byte salt, 32-byte key (OWASP 2023) — reused from `scripts/lib/auth.ts` (ADR-0009).
- Plaintext password never logged, including in error messages or audit-log payloads.
- Password reset: admin sets temporary password → `must_change_password=1` + revoke existing sessions → user forced through full-screen change flow before any other action → new password checked against `password_history`.
- Account lockout after N failed attempts; sessions stored server-side (DB), allowing forced termination.

## 5. Personal Data Minimization (ADR-0039)

- No individual identifiers collected where an aggregate suffices.
- Retention: deal termination/closure + N months → automated purge via `retention_policy`.
- Cross-border transfer: overseas M&A requires a documented transfer basis, recorded on the applicable `region-profiles/<ISO2>.yaml` entry.
- Pseudonymized views (`v_comp_anonymized`) for any analytics/statistical query touching compensation data — direct table access for that purpose is not permitted even for authorized roles.

## 6. MNPI Handling (ADR-0040)

- `mnpi_flag=true` set by `legal-counsel` at project classification time, not inferred.
- `insider_list` auto-generated and maintained; membership grant/revoke is itself audit-logged.
- Access banner displayed on every MNPI-flagged project screen/response.
- MCP default-exclusion with audited scoped-token override (§2 above).

## 7. Verification (Design §12 Forward Reference — "One Gap and It Fails")

1. Log in as a non-member; confirm the target project appears in **no** surface — list, search, direct API call, report, or MCP tool response.
2. Log in as `admin` without project membership; confirm deal data remains inaccessible.
3. Attempt a repository-layer bypass via a crafted query; confirm it is rejected or does not exist as a code path.
4. Set `mnpi_flag=true` on a test project; confirm `insider_list` auto-populates, every access logs, and the project is absent from an unscoped MCP token's responses.
5. Insert a row into `comp_benchmark` at individual granularity; confirm the schema/constraint rejects it (not just a lint warning).
6. Insert a real name into `management_package.executive_ref`; confirm rejection.
7. Attempt `audit_log` deletion as any role, including admin/DB-owner; confirm no path succeeds.
8. Recover a password from a direct DB dump; confirm it is not possible (hash-only storage, correct algorithm).

## 8. Related

- `docs/security-baseline.md` — the recurring operational security cadence (scans, patching, access review)
- `docs/api-spec.md` §1 — the access-control rules this model justifies
- `docs/db-schema.md` §9 — the information-protection tables this model governs
