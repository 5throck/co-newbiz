# Procedure: Brown Field Screening (Shared)

**Layer**: Procedure (mandatory — gate-blocking)
**Consumed by**: `ent-a` (with overrides), `ent-b` (as-is), any future entity via `references:`

## Purpose

Defines the Screening-gate steps for Brown Field (M&A) review. This is the group-common baseline; entities and regions consume it via `references:` and declare only their deviations (design §6.3) — they never duplicate these steps.

## What This Procedure Owns

**What and when** — which agent runs at which step, in what order, producing what output type. It does **not** describe *how* an agent does its work; that lives in the referenced skill (`brownfield-feasibility`, `antitrust-screening`). See design §6.8 for why this split exists and what breaks if a skill restates these steps.

## Steps Summary

1. `brownfield-agent` builds the target longlist.
2. `antitrust-agent` runs a preliminary HHI screen (not the full six-way cross-check — that's a DD-gate requirement).
3. `process-governance-manager` confirms Screening deliverables and opens Pre-FS.

## Kill Criteria

See `schema.yaml`'s `kill_criteria` block — this is machine-readable and authoritative; do not restate the conditions here in a way that could drift from it.

## Who References This

- `procedures/entities/ent-a/brownfield-screening/schema.yaml` — adds an internal strategy-office pre-screen step (per `policies/entities/ent-a/addendum.md`)
- `procedures/entities/ent-b/` — not yet created; ent-b consumes this procedure directly with no override (design's "minimal form" reference case)
- `procedures/regions/EU/brownfield-screening/schema.yaml` — adds an EU works-council consultation step
