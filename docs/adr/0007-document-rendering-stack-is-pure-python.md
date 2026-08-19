# ADR-0007: Document rendering stack is pure Python

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: backend-engineer, docs-writer

## Context

Deliverables must render to Word, PDF, and HWPX with no layout drift between formats and no external binary dependency that would complicate deployment.

## Decision

Route all formats through a common Markdown-derived AST (`python/report/ast.py`), rendered by format-specific pure-Python renderers (`python-docx`, `reportlab`, `python-hwpx`). Korean fonts (Pretendard/Nanum, OFL-licensed) are registered explicitly in the PDF renderer.

## Consequences

No external binary dependency simplifies deployment. Font registration for reportlab is the primary implementation risk flagged at design time.
