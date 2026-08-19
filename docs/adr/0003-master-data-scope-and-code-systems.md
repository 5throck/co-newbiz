# ADR-0003: Master data scope and code systems

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: data-architect, quant-methodologist

## Context

Proxy chains, peer benchmarking, and regulatory mapping all require a small set of canonical master-data tables with real code systems, not free-text.

## Decision

Fix master tables to industry (KSIC + NAICS/ISIC mapping), company (DART corp_code + business registration + LEI), unit (code + dimension + SI coefficient), currency/country (ISO 4217 / ISO 3166-1), period (date/year/quarter/month + fiscal_year), source, statute (법제처 ID + foreign framework key), account (IFRS canonical), entity (group company code), and project.

## Consequences

Unmapped values are quarantined in `staging_unmapped` rather than silently auto-created — a deliberate friction point that keeps master data trustworthy.
