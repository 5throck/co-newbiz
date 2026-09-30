// UI mirror of the project-write authorization (server stays authoritative).
// Deal routes hide the project from `admin` (role separation, project-visibility.ts)
// and reject `viewer` on writes, so only analysts may write project data.
export function canWriteProject(role: string | null | undefined): boolean {
  return role === "analyst";
}

export function isReadOnlyAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

// Opportunity-carrier (business content) write access. UI mirror of
// requireBusinessActor write mode (app/web-next/lib/auth.ts), which stays
// authoritative (ADR-0146): viewer and admin are rejected, only analyst writes.
export function canWriteBusiness(role: string | null | undefined): boolean {
  return role === "analyst";
}

// Business content read access. UI mirror of requireBusinessActor read mode
// (app/web-next/lib/auth.ts, ADR-0146): viewer and analyst may read, admin may not.
export function canReadBusiness(role: string | null | undefined): boolean {
  return role != null && role !== "admin";
}
