---
lang: en
date: 2026-11-22
status: implemented
owner: automation-engineer-agent (upstream request U-20261121-002)
related: scripts/co-newbiz/audit-variant.ts (Generated projection drift gate, v1.10.0), scripts/co-newbiz/sync-library-projection.ts, app/web-next/lib/library.generated.ts
spec: library-projection-eol-normalization
---

# Design — Library projection embeds LF-normalized source content

## Problem

The Generated projection drift gate (`scripts/co-newbiz/audit-variant.ts`
v1.10.0) runs `sync-library-projection.ts --check`. On a Windows working copy
whose tracked sources carry CRLF bytes on disk (git-clean under
`core.autocrlf`), the gate reported `app/web-next/lib/library.generated.ts` as
stale and blocked dev-sync. Observed 2026-11-21: 283 tracked files carried CRLF;
re-writing them from the index (LF) made the gate pass without any content
change.

Root cause (verified by repro): `sync-library-projection.ts` assigned
`entry.content = readFileSync(path, "utf-8")` and then emitted the whole map
through `JSON.stringify`. JSON serializes a real CRLF as the two-character
escape sequence `\r\n` *inside the string literal*. The script's existing
`normalize()` hashes entire file text and only rewrites actual CR bytes, so it
can never see those escape sequences. A CRLF checkout therefore produced a
different projection than an LF checkout for byte-identical content.

## Decision

Normalize EOL at read time, at the single point where source bytes enter the
projection:

- `entry.content = normalize(readFileSync(path, "utf-8"))` — `normalize` is the
  existing `s.replace(/\r\n/g, "\n")` helper already used for the final
  comparison.
- The final whole-file `normalize(next) === normalize(src)` comparison stays
  (it guards the generated file's own endings).
- Overlay inputs are unaffected: they are `yaml.load`-parsed before emission,
  so their EOL never reaches the output text.

YAML checklist parsing also consumes the now-normalized `entry.content`, so the
parsed `version` / `item_count` / items are unchanged for LF sources and become
stable for CRLF sources.

## Consequences

- The projection is identical for LF and CRLF working copies; the drift gate no
  longer depends on checkout EOL. A real content edit still fails `--check`.
- Delivered `.gitattributes` (`templates/common`) does not yet declare
  `*.yaml` / `*.ts` as `eol=lf`, which is why Windows checkouts smudge those
  files at all; the upstream request routes that L1 fix to the workspace.
- Scope is this one projection. `sync-wiki-projection.ts` already normalizes
  frontmatter before embedding, and `generate-glossary-data.ts` parses YAML and
  re-emits structured data, so neither shares the defect.
