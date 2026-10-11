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

  // Production hardening hint (never throws, never blocks boot): warn once per
  // process when the public origin is unset or malformed.
  try {
    const { checkPublicOrigin } = await import("./lib/public-origin-check.ts");
    for (const w of checkPublicOrigin()) console.warn(`[bootstrap] ${w}`);
  } catch {
    // diagnostics only
  }

  // Executor seams (ADR-0097 §5 / ADR-0098 / ADR-0099): committee deliberation
  // (above) plus the S8 business-case and S9 DD-tailor executors. Each is
  // activated by its own CO_NEWBIZ_*_AGENTS=llm env var AND a configured LLM
  // client; failures here never prevent boot — the deterministic executors
  // remain the fallback and the regression-test surface.
  try {
    if (process.env.CO_NEWBIZ_COMMITTEE_AGENTS === "llm") {
      const { isLlmConfigured } = await import("./lib/llm.ts");
      const { setCallAgentFactory } = await import("./lib/committee-agents.ts");
      const { makeLlmCommitteeAgent } = await import("./lib/committee-llm.ts");
      if (isLlmConfigured()) {
        setCallAgentFactory(() => makeLlmCommitteeAgent());
        console.log("[bootstrap] committee agents: LLM mode registered.");
      } else {
        console.warn("[bootstrap] CO_NEWBIZ_COMMITTEE_AGENTS=llm but no LLM configured (CO_NEWBIZ_LLM_PROVIDER/API_KEY/MODEL) — staying deterministic.");
      }
    }
    if (process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS === "llm") {
      const { isLlmConfigured } = await import("./lib/llm.ts");
      const { setBusinessCaseExecutorFactory } = await import("./lib/business-case-generator.ts");
      const { makeLlmBusinessCaseExecutor } = await import("./lib/llm-executors.ts");
      if (isLlmConfigured()) {
        setBusinessCaseExecutorFactory(() => makeLlmBusinessCaseExecutor());
        console.log("[bootstrap] business-case executor: LLM prose mode registered (persistence stays deterministic).");
      } else {
        console.warn("[bootstrap] CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm but no LLM configured — staying deterministic.");
      }
    }
    if (process.env.CO_NEWBIZ_DD_TAILOR_AGENTS === "llm") {
      const { isLlmConfigured } = await import("./lib/llm.ts");
      const { setDdTailorExecutorFactory } = await import("./lib/dd-checklist-tailor.ts");
      const { makeLlmDdTailorExecutor } = await import("./lib/llm-executors.ts");
      if (isLlmConfigured()) {
        setDdTailorExecutorFactory(() => makeLlmDdTailorExecutor());
        console.log("[bootstrap] DD-tailor executor: LLM mode registered (sources stay unsourced/C per ADR-0099 §6).");
      } else {
        console.warn("[bootstrap] CO_NEWBIZ_DD_TAILOR_AGENTS=llm but no LLM configured — staying deterministic.");
      }
    }
  } catch (err) {
    console.warn("[bootstrap] executor factory registration skipped:", err instanceof Error ? err.message : err);
  }

  try {
    const { getMigrationStatus, runMigrations } = await import("../../db/migrate.ts");
    const { getDb } = await import("../../db/client.ts");
    const { createUser, approveUser, listUsers } = await import("../../db/lib/accounts.ts");

    const migrationMode = process.env.CO_NEWBIZ_BOOTSTRAP_MIGRATIONS ?? "auto";
    if (!["auto", "require-current", "off"].includes(migrationMode)) {
      throw new Error("CO_NEWBIZ_BOOTSTRAP_MIGRATIONS must be one of: auto, require-current, off");
    }
    const before = getMigrationStatus();
    if (migrationMode === "require-current" && before.pending.length > 0) {
      throw new Error(
        `database has ${before.pending.length} pending migration(s); run "bun run db:migrate" before starting or set CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto`,
      );
    }
    const { applied } = migrationMode === "auto" ? runMigrations() : { applied: [] as string[] };
    if (migrationMode === "off" && before.pending.length > 0) {
      console.warn(`[bootstrap] migrations disabled; ${before.pending.length} pending migration(s) remain.`);
    }
    const db = getDb();

    // Boot transparency (사용자 요청 2026-10-10): WHICH database file this
    // server is bound to — printed once per boot. A wrong CO_NEWBIZ_DB_PATH
    // or a stale-launch divergence must be visible at a glance in the boot
    // log, not discovered through divergent data. PRAGMA failure never
    // blocks boot.
    try {
      const main = (db.query("PRAGMA database_list").all() as Array<{ name: string; file: string }>).find((r) => r.name === "main");
      console.log(`[bootstrap] database: ${main?.file || "(in-memory)"}`);
    } catch {
      console.warn("[bootstrap] database path could not be resolved (PRAGMA database_list failed).");
    }

    // S1 market-sizing queue recovery — recoverQueuePass is normally driven by
    // the OS-scheduled watch:run cycle (never an in-process timer), but local
    // dev has no such scheduler running. Every dev-server restart abandons any
    // in-process pipeline run mid-flight, leaving its row stuck at
    // status='in_progress' forever with nothing to ever mark it failed. Run
    // one pass on every boot so a restart-orphaned analysis surfaces as
    // "분석 실패" (with a retry path) instead of hanging at "분석 중" indefinitely.
    try {
      const { recoverQueuePass } = await import("./lib/market-sizing-pipeline.ts");
      const result = recoverQueuePass(db);
      if (result.healed.length > 0 || result.started.length > 0) {
        console.log(`[bootstrap] market-sizing queue recovery — healed ${result.healed.length}, started ${result.started.length}.`);
      }
    } catch (err) {
      console.warn("[bootstrap] market-sizing queue recovery skipped:", err instanceof Error ? err.message : err);
    }

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
