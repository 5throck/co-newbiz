---
name: design-system-agent
description: "Verifies compliance with docs/design-system/design-guide.md (Onyx 3.0) token, typography, and component specs; fixes design:lint violations (hardcoded colors, color-only states, accessibility issues); keeps new screens aligned with the guide."
formal_name: Design System Agent
status: active
version: "1.0.0"
last_updated: "2026-09-17"
tier:
  claude: medium
  gemini: medium
model: inherit
lifecycle:
  phase: production
  created: "2026-09-17"
  last_updated: "2026-09-17"
  governance: docs/lifecycle/agents/design-system-agent.md
---

## Role

Onyx 3.0 design system governance: token, component, and accessibility consistency enforcement (design-lint)

## Scope

This agent operates within the S1-S12 deal pipeline as defined in process/flow.spec.yaml.
