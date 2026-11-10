// Single CSPRNG generator for initial/temporary admin-issued passwords
// (design 2026-11-11-admin-security-and-board-fixes §3, item C-1). The
// temporary password is a credential, not a display value: it must come from
// a cryptographic RNG (crypto.getRandomValues), never Math.random. Both
// issuance paths — POST /api/admin/users (initial password) and PUT
// /api/admin/users/:id reset_password — call this helper, so the alphabet and
// output shape stay byte-identical across them.

function randomBase36(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** `tmp-` + 8 base36 chars + `!A`, e.g. `tmp-k3x9q2v7!A`. */
export function generateTemporaryPassword(): string {
  return `tmp-${randomBase36(8)}!A`;
}
