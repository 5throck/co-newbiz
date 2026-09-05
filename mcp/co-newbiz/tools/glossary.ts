// @version 1.0.0
// lookup_term — the same endpoint that backs the web UI's tooltip
// (mcp-integration.md §3, docs/architecture/ui-spec.md §1's glossary tooltip integration).

import { rest } from "../shared/rest-client.ts";

export async function lookupTerm(term: string) {
  return rest.get(`/api/glossary/${encodeURIComponent(term)}`);
}
