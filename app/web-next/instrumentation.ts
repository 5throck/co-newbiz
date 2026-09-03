// Next.js instrumentation — runs once on server start (Bun runtime).
// A fresh clone ships no SQLite file (gitignored), so the first boot must
// (1) apply migrations and (2) bootstrap a first admin account — otherwise
// the server comes up with zero tables and no way to log in.

function randomPassword(bytes = 16): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => alphabet[b % alphabet.length]).join("");
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { runMigrations } = await import("../../db/migrate.ts");
    const { getDb } = await import("../../db/client.ts");
    const { createUser, approveUser, listUsers } = await import("../../db/lib/accounts.ts");

    const { applied } = runMigrations();
    const db = getDb();

    if (listUsers(db).length > 0) {
      if (applied.length > 0) console.log(`[bootstrap] applied ${applied.length} pending migration(s).`);
      return;
    }

    // First boot (or a wiped DB): create the initial admin. The password is
    // random and printed exactly once — it is never stored in plaintext, and
    // the account is flagged must_change_password so the first login forces a
    // real password. Bootstrap self-approves: no other admin exists yet.
    // createUser is async (PBKDF2) — it MUST be awaited before approveUser.
    const password = randomPassword();
    await createUser(db, {
      userId: "admin",
      role: "admin",
      password,
      displayName: "Initial Admin",
      createdBy: "bootstrap",
      now: new Date().toISOString(),
    });
    approveUser(db, { userId: "admin", approvedBy: "bootstrap", now: new Date().toISOString() });

    console.log(
      "\n" +
        "============================================================\n" +
        "  FIRST-BOOT BOOTSTRAP — initial admin account created\n" +
        "  user id:  admin\n" +
        `  password: ${password}\n` +
        "  (printed once; change it at first login)\n" +
        "============================================================\n",
    );
  } catch (err) {
    console.error("[bootstrap] database bootstrap failed:", err instanceof Error ? err.message : err);
  }
}
