// E2E harness (Wave C-1). Each scenario file gets its OWN production-mode Next
// server on a free port against a temp SQLite DB, and tears both down. It never
// binds or touches port 7749 (the operator's dev server).
//
// Boundary notes:
//  - The only direct DB writes happen BEFORE the server starts: migrations, the
//    admin account, and master data / evidence seeding (bootstrap).
//  - LLM / DART / web-research env vars are blanked so every executor uses its
//    offline / deterministic fallback.
//  - Credentials are generated at runtime and never logged.
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createUser, approveUser } from "../../../db/lib/accounts.ts";
import { getDb, resetDb } from "../../../db/client.ts";
import { runMigrations } from "../../../db/migrate.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "app", "web-next");
const DIST_DIR = ".next/e2e";
const BUILD_LOCK = join(tmpdir(), "co-newbiz-e2e-build.lock");

/** Never allowed: the operator's dev server port. */
const FORBIDDEN_PORT = 7749;

export interface TestApp {
  baseUrl: string;
  port: number;
  dbPath: string;
  adminId: string;
  /** Runtime-generated; first-login forces a change through the UI. */
  adminPassword: string;
  /** Deal content is walled off from admin (ADR-0091); deal work runs as the analyst. */
  analystId: string;
  analystPassword: string;
  readDb<T>(fn: (db: Database) => T): T;
  writeDb(fn: (db: Database) => void): void;
  stop(): Promise<void>;
  log(): string;
}

function runtimeSecret(prefix: string): string {
  // letters+digits+symbol, 20 chars — satisfies the password policy, never reused.
  return `${prefix}${randomBytes(9).toString("hex")}!`;
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolvePort, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => resolvePort(p));
      });
    });
    if (port !== FORBIDDEN_PORT && port > 1024) return port;
  }
  throw new Error("could not find a free port");
}

function newestSourceMtime(): number {
  let newest = 0;
  const skip = new Set(["node_modules", ".next", "render_out", "db", "public"]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css|json|mjs)$/.test(entry.name)) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(WEB_DIR);
  // Server code imports ../../db and scripts/ — include their mtimes too.
  for (const extra of ["db/client.ts", "db/lib", "db/repositories"]) {
    const p = join(REPO_ROOT, extra);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

function buildIsFresh(): boolean {
  const id = join(WEB_DIR, DIST_DIR, "BUILD_ID");
  return existsSync(id) && statSync(id).mtimeMs >= newestSourceMtime();
}

/** Build once per source state; a lock file serializes concurrent scenario processes. */
async function ensureBuild(): Promise<void> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (buildIsFresh()) return;
    try {
      writeFileSync(BUILD_LOCK, String(process.pid), { flag: "wx" });
    } catch {
      // another process is building — wait for it
      await Bun.sleep(1000);
      try {
        // stale lock (crashed builder) older than 6 minutes
        if (Date.now() - statSync(BUILD_LOCK).mtimeMs > 360_000) rmSync(BUILD_LOCK, { force: true });
      } catch {}
      continue;
    }
    try {
      if (buildIsFresh()) return;
      const proc = Bun.spawn([process.execPath, "--bun", "next", "build"], {
        cwd: WEB_DIR,
        env: { ...process.env, CO_NEWBIZ_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error(`next build failed (exit ${code}):\n${out.slice(-2000)}\n${err.slice(-2000)}`);
    } finally {
      rmSync(BUILD_LOCK, { force: true });
    }
    return;
  }
  throw new Error("timed out waiting for the e2e build");
}

export interface StartOptions {
  /** Seed master data / evidence BEFORE the server starts (bootstrap only). */
  seed?: (ctx: { dbPath: string; adminId: string; analystId: string }) => void | Promise<void>;
}

export async function startApp(name: string, opts: StartOptions = {}): Promise<TestApp> {
  await ensureBuild();
  // getDb() is a process-wide singleton; scenario files share one bun test process, so drop any previous file's connection.
  resetDb();

  const root = mkdtempSync(join(tmpdir(), `co-newbiz-e2e-${name}-`));
  mkdirSync(join(root, "data"), { recursive: true });
  // db/client.ts derives the migrations dir from the DB path's grandparent.
  symlinkSync(join(REPO_ROOT, "db", "migrations"), join(root, "migrations"));
  const dbPath = join(root, "data", "co-newbiz.sqlite");

  runMigrations(dbPath);
  const db = getDb(dbPath);
  const adminId = "admin";
  const adminPassword = runtimeSecret("Aa1-");
  const now = new Date().toISOString();
  await createUser(db, { userId: adminId, role: "admin", password: adminPassword, displayName: "E2E Admin", createdBy: "e2e-bootstrap", now });
  approveUser(db, { userId: adminId, approvedBy: "e2e-bootstrap", now });
  const analystId = "analyst";
  const analystPassword = runtimeSecret("Bb2-");
  await createUser(db, { userId: analystId, role: "analyst", password: analystPassword, displayName: "E2E Analyst", createdBy: "e2e-bootstrap", now });
  approveUser(db, { userId: analystId, approvedBy: "e2e-bootstrap", now });
  if (opts.seed) await opts.seed({ dbPath, adminId, analystId });
  // Flush WAL before the server opens the file.
  db.run("PRAGMA wal_checkpoint(TRUNCATE);");
  resetDb();

  const port = await freePort();
  const logChunks: string[] = [];
  const proc = Bun.spawn([process.execPath, "--bun", "next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      CO_NEWBIZ_DIST_DIR: DIST_DIR,
      CO_NEWBIZ_DB_PATH: dbPath,
      // Offline mode: every LLM / external-data executor uses its fallback.
      CO_NEWBIZ_LLM_PROVIDER: "",
      CO_NEWBIZ_LLM_API_KEY: "",
      CO_NEWBIZ_LLM_MODEL: "",
      CO_NEWBIZ_COMMITTEE_AGENTS: "",
      CO_NEWBIZ_BUSINESS_CASE_AGENTS: "",
      CO_NEWBIZ_DD_TAILOR_AGENTS: "",
      DART_API_KEY: "",
      CO_NEWBIZ_DART_API_KEY: "",
      // Web research: an empty key blocks the root .env fallback, and the
      // DuckDuckGo fallback is on by default, so switch it off explicitly
      // (pilot-009 re-run found S1 sizing calling out to the web).
      TAVILY_API_KEY: "",
      ECOS_API_KEY: "",
      KRX_API_KEY: "",
      WEB_SEARCH_DDG_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Never leave a server behind if the test process dies or is interrupted.
  const killServer = (): void => {
    try {
      proc.kill();
    } catch {}
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  };
  process.once("exit", killServer);
  process.once("SIGINT", () => {
    killServer();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    killServer();
    process.exit(143);
  });
  const drain = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      logChunks.push(dec.decode(value));
      if (logChunks.length > 400) logChunks.splice(0, 200);
    }
  };
  void drain(proc.stdout as ReadableStream<Uint8Array>);
  void drain(proc.stderr as ReadableStream<Uint8Array>);

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await Bun.sleep(300);
  }
  if (!healthy) {
    proc.kill();
    throw new Error(`server did not become healthy on ${baseUrl}:\n${logChunks.join("").slice(-3000)}`);
  }

  return {
    baseUrl,
    port,
    dbPath,
    adminId,
    adminPassword,
    analystId,
    analystPassword,
    readDb: <T>(fn: (d: Database) => T): T => {
      const ro = new Database(dbPath, { readonly: true });
      try {
        return fn(ro);
      } finally {
        ro.close();
      }
    },
    writeDb: (fn: (d: Database) => void): void => {
      const rw = new Database(dbPath);
      try {
        fn(rw);
      } finally {
        rw.close();
      }
    },
    log: () => logChunks.join(""),
    stop: async () => {
      proc.kill();
      await proc.exited.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
