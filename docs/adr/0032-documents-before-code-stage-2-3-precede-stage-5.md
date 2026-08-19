# ADR-0032: Documents before code — Stage 2/3 precede Stage 5

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: pm, process-governance-manager

## Context

Writing the system before the governance content it implements is finalized reproduces the exact failure mode (problem #9 in the design) this project exists to fix — regulation and system diverging.

## Decision

Enforce the Stage 0-5 execution order strictly: Stage 2 (regulation book, procedures, manuals) and Stage 3 (detailed process + manual pilot) complete and are user-approved before Stage 4 (system requirements) begins.

## Consequences

This ADR is the project's own governing constraint on itself — a Stage 4/5 PR that lacks a corresponding, already-approved Stage 2/3 artifact is out of order regardless of urgency.
