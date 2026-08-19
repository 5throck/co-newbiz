# ADR-0029: Group IC is a ranking decision, not a yes/no approval

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: group-review-agent, pm

## Context

Multiple entities can each present a project that is fully Green at the entity level, but the group has one capital budget — treating Group IC as an independent approve/reject per project loses the fact that they compete for the same resource.

## Decision

Group IC's primary output is a `group_agenda` ranking across concurrently submitted proposals, not an isolated approval per project. The system must present a comparison view across the current cycle's submissions, not project-by-project.

## Consequences

This reframes the least obvious but most operationally important insight from meeting M2/M8: group-level review answers 'which of these' more often than 'yes or no'.
