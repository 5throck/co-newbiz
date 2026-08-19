# ADR-0022: Glossary tooling integration across four surfaces

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: glossary-curator, docs-writer

## Context

A glossary that isn't consumed by any tooling has no enforcement pressure keeping it current, and empirically gets abandoned within months.

## Decision

Wire the glossary into four consuming surfaces from the start: UI tooltip (`/api/glossary/:term`), automatic report appendix generation, `glossary:lint` (detects undefined jargon in skills/docs/UI strings), and the MCP `lookup_term` tool.

## Consequences

Every term addition has at least one consumer by construction, rather than being added speculatively with no forcing function to keep it accurate.
