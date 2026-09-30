// UI mirror of the project-write authorization (server stays authoritative).
// Deal routes hide the project from `admin` (role separation, project-visibility.ts)
// and reject `viewer` on writes, so only analysts may write project data.
export function canWriteProject(role: string | null | undefined): boolean {
  return role === "analyst";
}

export function isReadOnlyAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}
