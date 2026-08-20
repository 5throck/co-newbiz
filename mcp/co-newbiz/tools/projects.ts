// @version 1.0.0
/**
 * list_projects / get_project_status — mcp-integration.md §3.
 *
 * Neither tool ever passes include_mnpi=1: mnpi_flag=true projects are
 * excluded from MCP responses by default (FR-SEC-06/FR-SYS-02) — the
 * REST layer's own excludeMnpi default already enforces this, the tool
 * just never opts out of it.
 */

import { rest } from "../shared/rest-client.ts";

export async function listProjects() {
  return rest.get("/api/projects");
}

export async function getProjectStatus(projectId: string) {
  const [project, rag] = await Promise.all([
    rest.get(`/api/projects/${encodeURIComponent(projectId)}`),
    rest.get(`/api/projects/${encodeURIComponent(projectId)}/rag`),
  ]);
  return { project, rag };
}
