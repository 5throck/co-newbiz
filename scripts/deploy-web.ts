// @version 1.1.0
/**
 * deploy-web.ts — deploy (or roll forward) the co-newbiz web production
 * container on this host. Implements the ADR-0014 deployment order end to
 * end: the container entrypoint backs up the database before migrations,
 * boot applies pending migrations, and this script gates completion on the
 * /api/health check (design: docs/designs/2026-09-21-docker-prod-cicd-design.md,
 * procedure: docs/runbooks/deployment.md §8).
 *
 * Usage: bun scripts/deploy-web.ts [--build]
 *   --build   build the image locally instead of pulling from ghcr.io
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { die } from "./lib/error-handling.ts";

const IMAGE = "ghcr.io/5throck/co-newbiz-web:latest";
const SERVICE = "web";
const CONTAINER = "co-newbiz-web";
const REPO_ROOT = join(import.meta.dir, "..");
const HEALTH_URL = process.env.CO_NEWBIZ_HEALTH_URL ?? "http://127.0.0.1:7748/api/health";
const TIMEOUT_SECONDS = Number(process.env.CO_NEWBIZ_HEALTH_TIMEOUT ?? "120");

interface RunResult {
  status: number;
  stdout: string;
}

/**
 * Remove superseded local generations of the app image after a successful
 * deploy. Keeps the newest two generations — the running image and the one
 * before it (rollback) — and untags/removes everything older: each generation
 * is ~3.4 GB in the Docker VM, macOS never returns that space to the host
 * automatically, and per-deploy accumulation was shrinking the host disk
 * (2026-09-22 host disk review; retention design:
 * docs/designs/2026-09-23-docker-image-retention-deploy-restore-design.md).
 */
function pruneSupersededGenerations(): void {
  const inspect = run(["docker", "inspect", "--format", "{{.Image}}", CONTAINER], true);
  const runningId = inspect.status === 0 ? inspect.stdout.trim() : "";
  const list = run(
    ["docker", "images", "--format", "{{.CreatedAt}}|{{.ID}}|{{.Repository}}:{{.Tag}}", CONTAINER],
    true,
  );
  if (list.status !== 0) return;

  // One entry per image ID (a generation may carry several tags).
  const gens = new Map<string, { id: string; createdAt: string; refs: string[] }>();
  for (const line of list.stdout.trim().split("\n")) {
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const [createdAt, id, ref] = parts as [string, string, string];
    if (ref === "<none>:<none>") continue;
    const g = gens.get(id) ?? { id, createdAt, refs: [] };
    if (createdAt > g.createdAt) g.createdAt = createdAt;
    g.refs.push(ref);
    gens.set(id, g);
  }

  const sorted = [...gens.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  sorted.forEach((g, i) => {
    if (g.id === runningId || i < 2) return; // keep running + rollback generation
    for (const ref of g.refs) {
      console.log(`[deploy] pruning superseded image ${ref} (${g.createdAt.slice(0, 10)})`);
      if (run(["docker", "rmi", ref], true).status !== 0) {
        console.error(`[deploy] image prune skipped ${ref} (in use — non-fatal)`);
      }
    }
  });
}

function run(cmd: string[], capture = false): RunResult {
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: REPO_ROOT,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf-8",
  });
  if (res.error) die(`failed to execute ${cmd[0]}: ${res.error.message}`);
  return { status: res.status ?? 1, stdout: res.stdout ?? "" };
}

// Remember the running image so a failed deploy can print a concrete
// rollback command (code rollback; DB rollback is a separate, sequenced
// action — see docs/runbooks/backup-restore.md §3).
const prev = run(["docker", "inspect", "--format", "{{.Image}}", CONTAINER], true);
const prevImage = prev.status === 0 ? prev.stdout.trim() : "";

if (process.argv.includes("--build")) {
  console.log("[deploy] building image locally (--build)");
  if (run(["docker", "compose", "build", SERVICE]).status !== 0) die("docker compose build failed");
} else {
  console.log(`[deploy] pulling ${IMAGE}`);
  if (run(["docker", "compose", "pull", SERVICE]).status !== 0) die("docker compose pull failed");
}

console.log(`[deploy] starting ${SERVICE}`);
if (run(["docker", "compose", "up", "-d", SERVICE]).status !== 0) die("docker compose up failed");

console.log(`[deploy] waiting for ${HEALTH_URL} (up to ${TIMEOUT_SECONDS}s)`);
const deadline = Date.now() + TIMEOUT_SECONDS * 1000;
while (Date.now() < deadline) {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      console.log("[deploy] healthy — deploy complete.");
      pruneSupersededGenerations();
      process.exit(0);
    }
  } catch {
    // not up yet — keep polling until the deadline
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error(`[deploy] FAILED: health check did not pass within ${TIMEOUT_SECONDS}s.`);
if (prevImage) {
  console.error(`[deploy] code rollback:  docker tag ${prevImage} ${IMAGE} && docker compose up -d ${SERVICE}`);
}
console.error("[deploy] db rollback:    restore the newest backups/pre-deploy-*.db per docs/runbooks/backup-restore.md §3, then redeploy.");
process.exit(1);
