// @version 1.1.0
// lookup_term — the same endpoint that backs the web UI's tooltip
// (mcp-integration.md §3, docs/architecture/ui-spec.md §1's glossary tooltip integration).

import type { RestPort } from "../shared/rest-port.ts";

export async function lookupTerm(port: RestPort, term: string) {
  return port.get(`/api/glossary/${encodeURIComponent(term)}`);
}

/** The glossary index (key + names) — backs the glossary://index resource. */
export async function listGlossary(port: RestPort) {
  return port.get("/api/glossary");
}
