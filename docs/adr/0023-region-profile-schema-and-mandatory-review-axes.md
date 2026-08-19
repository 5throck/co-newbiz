# ADR-0023: Region profile schema and mandatory review axes

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: region-lead, legal-counsel

## Context

Cross-border review (merger control, foreign investment screening, labor consultation, tax, sanctions, data transfer, environmental succession, incentives) is easy to under-specify per region and easy to silently omit an axis that turns out to be decisive (e.g. EU works-council consultation).

## Decision

Fix a required schema (`region-profiles/_schema.yaml`) with mandatory axes and mandatory `source`/`verified_on`/`maintainer` provenance on every section; `_validate.ts` rejects an unsourced or empty section rather than silently accepting a placeholder.

## Consequences

KR and EU profiles ship first (meeting M1, O-2 — shipbuilding-adjacent industry, Korea + EU target regions), with US/CN/SEA as an initial draft per design task 2.5.
