# Skills Directory

Reusable workflow knowledge is defined as **skills**.

## What are Skills?

- **Agents** are for **roles** (what someone is)
- **Skills** are for **capabilities** (how to do something)

## Structure

Each skill is a directory with a `SKILL.md` file:

```
skills/
├── <skill-name>/
│   └── SKILL.md
└── example-skill/
    └── SKILL.md
```

## Skill File Format

Every `SKILL.md` must have frontmatter:

```yaml
---
name: skill-name
description: Brief description of what this skill does
metadata:
  type: process | implementation | domain
  triggers:
    - keyword1
    - keyword2
  procedure_keys:        # optional (PR-8) — shared procedures whose steps reference this skill
    - brownfield-dd
  requires_skills:       # optional (PR-8) — skills this one cannot run without
    - quality-of-earnings
  related_skills:        # optional (PR-8) — same-workflow neighbors, for discovery
    - technical-due-diligence
  requires_tools:        # optional (PR-8) — external tools/CLIs the skill needs
    - DART OpenAPI
---
```

### Skill-Graph Metadata Fields (PR-8, ADR-0053)

All four fields are optional lists of non-empty strings, validated by `scripts/co-newbiz/graph-map.ts --check`:

| Field | Meaning | Enforcement |
|-------|---------|-------------|
| `procedure_keys` | Shared procedures whose steps reference this skill (the inverse graph edge) | **Bidirectional contract**: every procedure→skill edge must appear here; unknown keys error |
| `requires_skills` | Skills this one depends on to run | Every entry must have a `skills/<key>/SKILL.md` |
| `related_skills` | Same-workflow neighbors (discovery aid) | Every entry must have a `skills/<key>/SKILL.md` |
| `requires_tools` | External tools the skill needs (no closed registry — shape check only) | Must be non-empty strings |

YAML note: list items are plain or quoted scalars — a bare item starting with a backtick is invalid YAML (`` ` `` is a reserved indicator); quote such items. Korean or other non-English trigger keywords do not belong in `SKILL.md` at all (language validation fails them) — keep them in `skills/<name>/references/` as non-Markdown assets and link from the skill body.

### Metadata Types

| Type | Purpose | Examples |
|------|---------|----------|
| `process` | Workflow and methodology | debugging, brainstorming, testing |
| `implementation` | Technical implementation | frontend-design, api-integration |
| `domain` | Domain-specific knowledge | abap-dev, sap-fi, i18n |

## Creating a New Skill

1. Copy the example from `_examples/skills/example-skill/`
2. Create `skills/<skill-name>/SKILL.md`
3. Add frontmatter with name, description, and type
4. Update `AGENTS.md § Skills` and `docs/context.md § Skills`
5. Run `bun run verify-skills` to validate

## Skill Activation

Skills are activated in two ways:

### Claude Code
- **Slash Commands**: `.claude/commands/<name>.md` auto-registers as a skill
- **Manual**: Invoke via `Skill` tool with skill name

### Gemini CLI
- **Manual**: Read and follow the skill content directly
- **Subagent**: Pass skill content in subagent prompt

## Available Skills

See `AGENTS.md § Skills` for the complete list of skills in this project.

## Tips

- Keep skills focused on a single capability
- Use clear trigger keywords in metadata
- Document expected inputs and outputs
- Include examples when helpful

---

*Skills template - customize as needed*
