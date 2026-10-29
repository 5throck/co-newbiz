// Renders app/web-next/lib/glossary-data.generated.ts from the glossary/*.yaml
// term list. Shared by scripts/co-newbiz/generate-glossary-data.ts (CLI, --check)
// and the POST /api/glossary registration path, so a registered term lands in the
// static projection that the UI tooltip, /api/glossary and MCP lookup_term read.
export function renderGlossaryDataModule(terms: ReadonlyArray<Record<string, unknown>>): string {
  return `// Generated from glossary/*.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update glossary YAML and regenerate this projection.
import type { GlossaryTerm } from "./glossary.ts";

export const GLOSSARY_TERMS: GlossaryTerm[] = ${JSON.stringify(terms, null, 2)};
`;
}
