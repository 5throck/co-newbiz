---
extends: ../../../agents/docs-writer.md
name: docs-writer
description: "Document formatting and language-policy enforcement across all four domains. Belongs to no single domain since documentation quality is a cross-cutting concern."
formal_name: Docs Writer Agent
status: active
domain: _shared
version: "1.0.0"
last_updated: "2026-09-30"
tier:
  claude: medium
  gemini: medium
  antigravity: medium
  gemini-cli: medium
model: inherit
lifecycle:
  phase: production
  created: "2026-09-17"
  last_updated: "2026-09-30"
  governance: docs/lifecycle/agents/docs-writer.md
---

## Role

Document formatting and language-policy enforcement across all four domains

## Scope

This agent operates within the S1-S12 deal pipeline as defined in process/flow.spec.yaml.
