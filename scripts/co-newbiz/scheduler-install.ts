#!/usr/bin/env bun
// @version 1.0.0
//
// scheduler-install - OS registration installer for the co-newbiz minute-tick scheduler (ADR-0189, scheduled-jobs
// design section 7). Registers ONE OS entry per environment that fires `schedule-tick.ts` every 60 s: the OS is the
// clock (ADR-0019), the tick decides what is due. Nothing installed here carries a secret: the plist, the systemd
// units and the Task Scheduler XML hold only the label, program arguments, CO_NEWBIZ_SCHEDULER_ENV and log paths
// (design section 5) - secrets come from the container env (prod) or the host root-env (dev).
//
//   launchd (macOS, implemented)  renders ops/scheduler/launchd/co-newbiz-tick.plist.tmpl to
//                                 ~/Library/LaunchAgents/org.bizknights.co-newbiz.<env>.tick.plist, then
//                                 `launchctl bootstrap gui/$UID <plist>`; uninstall = `launchctl bootout`
//                                 then file removal. The plist sets AbandonProcessGroup = true because the
//                                 tick spawns DETACHED run-job children and exits: without it launchd kills
//                                 the tick's process group, children included (design section 7).
//   systemd (Linux, documented)   writes the rendered template units to ~/.config/systemd/user/ and prints the
//                                 `systemctl --user enable --now` commands; systemctl itself is NEVER executed.
//   Task Scheduler (Windows)      prints the rendered XML and the `schtasks /Create /XML` command; schtasks is
//                                 NEVER executed and nothing is written.
//
// Modes: default installs (launchd: write + bootstrap); --dry-run renders, validates and prints the plan without
// writing or calling launchctl; --print emits the rendered artifact only, no side effects at all. --uninstall
// reverses the registration for the given env only - other LaunchAgents are never touched. A LaunchAgent runs in
// the user session only (owner decision D5: Docker Desktop is user-session; nothing runs while logged out).
//
// Usage: bun scripts/co-newbiz/scheduler-install.ts --env prod|dev [--platform launchd|systemd|schtasks]
//                  [--uninstall] [--dry-run] [--print]
// Exit codes: 0 ok, 2 usage error, 1 failure.
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type SchedulerEnv = "prod" | "dev";
export type Platform = "launchd" | "systemd" | "schtasks";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const TICK_REL = "scripts/co-newbiz/schedule-tick.ts";
const DOCKER_CONTAINER = "co-newbiz-web";
const LABEL_BASE = "org.bizknights.co-newbiz";

const LAUNCHD_TMPL = join(REPO_ROOT, "ops", "scheduler", "launchd", "co-newbiz-tick.plist.tmpl");
const SYSTEMD_SERVICE_TMPL = join(REPO_ROOT, "ops", "scheduler", "systemd", "co-newbiz-tick@.service");
const SYSTEMD_TIMER_SRC = join(REPO_ROOT, "ops", "scheduler", "systemd", "co-newbiz-tick@.timer");
const SCHTASKS_TMPL = join(REPO_ROOT, "ops", "scheduler", "schtasks", "co-newbiz-tick.xml");

const LAUNCHCTL = "/bin/launchctl";
// The log files are mode 0600 (design section 5); the containing directory needs +x for launchd to write into it.
const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;

export interface RenderOptions {
  repoRoot?: string;
  bunPath?: string;
  home?: string;
}

export interface CommandResult {
  code: number;
  stderr: string;
}

// ── Paths and labels ───────────────────────────────────────────────────────

export function launchdLabel(env: SchedulerEnv): string {
  return `${LABEL_BASE}.${env}.tick`;
}

export function launchdPlistPath(env: SchedulerEnv, home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${launchdLabel(env)}.plist`);
}

export function launchdLogDir(home: string = homedir()): string {
  return join(home, "Library", "Logs", "co-newbiz");
}

export function launchdLogPaths(env: SchedulerEnv, home: string = homedir()): { out: string; err: string } {
  const dir = launchdLogDir(home);
  return { out: join(dir, `${env}-tick.out.log`), err: join(dir, `${env}-tick.err.log`) };
}

export function systemdUserDir(home: string = homedir()): string {
  return join(home, ".config", "systemd", "user");
}

export function schtasksTaskName(env: SchedulerEnv): string {
  return `co-newbiz-${env}-tick`;
}

/** Explicit host PATH for the LaunchAgent: launchd's inherited PATH is minimal and misses bun/docker. */
export function hostPath(bunPath: string = process.execPath): string {
  const parts = [dirname(bunPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(parts)].join(":");
}

/**
 * Design section 2.3: prod runs inside the container (one DB writer topology, container env carries the secrets).
 * `docker exec` does NOT forward client env vars into the container, so the tick's env guard
 * (CO_NEWBIZ_SCHEDULER_ENV, checked by scheduler-core.resolveSchedulerEnv) is injected explicitly with -e; the
 * client-side env var in the plist/unit is kept (harmless, and useful if the client ever needs it).
 */
export function tickArguments(env: SchedulerEnv, bunPath: string = process.execPath): string[] {
  return env === "prod"
    ? ["docker", "exec", "-e", `CO_NEWBIZ_SCHEDULER_ENV=${env}`, DOCKER_CONTAINER, "bun", TICK_REL]
    : [bunPath, TICK_REL];
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  const rest = out.match(/{{[A-Z_]+}}/g);
  if (rest) throw new Error(`template has unfilled placeholders: ${rest.join(", ")}`);
  return out;
}

// ── Renderers (pure: read templates, fill placeholders, return text) ───────

export function renderLaunchdPlist(env: SchedulerEnv, opts: RenderOptions = {}): string {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const bunPath = opts.bunPath ?? process.execPath;
  const home = opts.home ?? homedir();
  const args = tickArguments(env, bunPath)
    .map((a) => `\t\t<string>${xmlEscape(a)}</string>`)
    .join("\n");
  // dev runs from the repo (dev DB on 7748); a WorkingDirectory is meaningless for `docker exec` (prod).
  const workingDirectory =
    env === "dev" ? `\t<key>WorkingDirectory</key>\n\t<string>${xmlEscape(repoRoot)}</string>` : "";
  const logs = launchdLogPaths(env, home);
  return fill(readFileSync(LAUNCHD_TMPL, "utf-8"), {
    LABEL: launchdLabel(env),
    PROGRAM_ARGUMENTS: args,
    WORKING_DIRECTORY: workingDirectory,
    PATH: hostPath(bunPath),
    ENV: env,
    STDOUT_LOG: logs.out,
    STDERR_LOG: logs.err,
  });
}

/** The service is a template unit: the instance name (%i) carries the environment, so the placeholders are env-independent. */
export function renderSystemdService(env: SchedulerEnv, opts: RenderOptions = {}): string {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const bunPath = opts.bunPath ?? process.execPath;
  const execStart =
    env === "prod" ? `docker exec -e CO_NEWBIZ_SCHEDULER_ENV=${env} ${DOCKER_CONTAINER} bun ${TICK_REL}` : `${bunPath} ${TICK_REL}`;
  const workingDirectory = env === "dev" ? `WorkingDirectory=${repoRoot}` : "";
  return fill(readFileSync(SYSTEMD_SERVICE_TMPL, "utf-8"), {
    PATH: hostPath(bunPath),
    EXEC_START: execStart,
    WORKING_DIRECTORY: workingDirectory,
  });
}

export function renderSystemdTimer(): string {
  return readFileSync(SYSTEMD_TIMER_SRC, "utf-8");
}

export function renderSchtasksXml(env: SchedulerEnv, opts: RenderOptions = {}): string {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const bunPath = opts.bunPath ?? process.execPath;
  const [command, args] =
    env === "prod"
      ? ["docker", `exec -e CO_NEWBIZ_SCHEDULER_ENV=${env} ${DOCKER_CONTAINER} bun ${TICK_REL}`]
      : [bunPath, TICK_REL];
  const workingDirectory = env === "dev" ? `      <WorkingDirectory>${xmlEscape(repoRoot)}</WorkingDirectory>\n` : "";
  return fill(readFileSync(SCHTASKS_TMPL, "utf-8"), {
    ENV: env,
    COMMAND: xmlEscape(command),
    ARGUMENTS: xmlEscape(args),
    WORKING_DIRECTORY: workingDirectory,
  });
}

// ── Validation and uninstall primitive (injected command runner for tests) ─

export function plutilAvailable(): boolean {
  return process.platform === "darwin" && !!Bun.which("plutil");
}

export function lintPlist(plist: string): { ok: boolean; message: string } {
  // Bun 1.4 spawnSync cannot feed a string to stdin, so lint through a temp file.
  const dir = mkdtempSync(join(tmpdir(), "scheduler-install-lint-"));
  try {
    const file = join(dir, "tick.plist");
    writeFileSync(file, plist);
    const p = Bun.spawnSync(["plutil", "-lint", file]);
    return { ok: (p.exitCode ?? 1) === 0, message: (p.stdout.toString() + p.stderr.toString()).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Uninstall primitive: bootout the label (best-effort - a not-loaded label must not fail the uninstall) and remove
 * ONLY this env's plist. Other files in ~/Library/LaunchAgents are never touched. Tests inject `home` and `bootout`.
 */
export function removeLaunchdPlist(
  env: SchedulerEnv,
  opts: { home?: string; bootout?: (plistPath: string) => CommandResult } = {},
): { bootedOut: boolean; removed: boolean; plistPath: string } {
  const plistPath = launchdPlistPath(env, opts.home);
  const bootout = opts.bootout ?? defaultBootout;
  let bootedOut = false;
  const existed = existsSync(plistPath);
  if (existed) {
    const r = bootout(plistPath);
    if ((r.code ?? 1) !== 0) {
      console.error(`scheduler-install: launchctl bootout failed (continuing with file removal): ${r.stderr.trim()}`);
    } else {
      bootedOut = true;
    }
    rmSync(plistPath, { force: true });
  }
  return { bootedOut, removed: existed && !existsSync(plistPath), plistPath };
}

function defaultBootout(plistPath: string): CommandResult {
  const uid = process.getuid();
  const p = Bun.spawnSync([LAUNCHCTL, "bootout", `gui/${uid}`, plistPath]);
  return { code: p.exitCode ?? 1, stderr: p.stderr.toString() };
}

// ── Platform actions ───────────────────────────────────────────────────────

interface Mode {
  dryRun: boolean;
  print: boolean;
}

function validateRenderedPlist(plist: string): void {
  if (!plutilAvailable()) return;
  const lint = lintPlist(plist);
  if (!lint.ok) {
    console.error(`scheduler-install: rendered plist failed plutil -lint: ${lint.message}`);
    process.exit(1);
  }
}

function installLaunchd(env: SchedulerEnv, { dryRun, print }: Mode): void {
  const plist = renderLaunchdPlist(env);
  if (print) {
    console.log(plist);
    return;
  }
  const plistPath = launchdPlistPath(env);
  const logs = launchdLogPaths(env);
  validateRenderedPlist(plist);
  if (dryRun) {
    console.log(`[dry-run] would write plist: ${plistPath}`);
    console.log(`[dry-run] would create log dir ${launchdLogDir()} (mode 0700) with log files (mode 0600):`);
    console.log(`[dry-run]   ${logs.out}`);
    console.log(`[dry-run]   ${logs.err}`);
    console.log(`[dry-run] would run: launchctl bootstrap gui/\${UID} ${plistPath}`);
    return;
  }
  mkdirSync(launchdLogDir(), { recursive: true, mode: LOG_DIR_MODE });
  for (const f of [logs.out, logs.err]) {
    if (!existsSync(f)) closeSync(openSync(f, "a"));
    chmodSync(f, LOG_FILE_MODE);
  }
  writeFileSync(plistPath, plist, { mode: 0o644 });
  const uid = process.getuid();
  const r = Bun.spawnSync([LAUNCHCTL, "bootstrap", `gui/${uid}`, plistPath]);
  if ((r.exitCode ?? 1) !== 0) {
    console.error(`scheduler-install: launchctl bootstrap failed: ${(r.stderr.toString() || r.stdout.toString()).trim()}`);
    console.error("  (if the label is already loaded, run --uninstall first)");
    process.exit(1);
  }
  console.log(`installed: ${plistPath}`);
  console.log(`logs: ${logs.out} / ${logs.err}`);
  console.log(`verify: launchctl print gui/${uid}/${launchdLabel(env)}`);
}

function uninstallLaunchd(env: SchedulerEnv, { dryRun, print }: Mode): void {
  const plistPath = launchdPlistPath(env);
  const uid = process.getuid();
  if (print || dryRun) {
    console.log(`[dry-run] would run: launchctl bootout gui/${uid} ${plistPath}`);
    console.log(`[dry-run] would remove (this env's plist only): ${plistPath}`);
    return;
  }
  const r = removeLaunchdPlist(env);
  console.log(r.removed ? `uninstalled: ${r.plistPath}` : `not installed (nothing to remove): ${r.plistPath}`);
}

function installSystemd(env: SchedulerEnv, { dryRun, print }: Mode): void {
  const service = renderSystemdService(env);
  const timer = renderSystemdTimer();
  const dir = systemdUserDir();
  const servicePath = join(dir, "co-newbiz-tick@.service");
  const timerPath = join(dir, "co-newbiz-tick@.timer");
  const enableCmds = ["systemctl --user daemon-reload", `systemctl --user enable --now co-newbiz-tick@${env}.timer`];
  if (print) {
    console.log(`# ${servicePath}\n${service}`);
    console.log(`# ${timerPath}\n${timer}`);
    console.log(`# then run:\n${enableCmds.join("\n")}`);
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] would write: ${servicePath}`);
    console.log(`[dry-run] would write: ${timerPath}`);
    console.log(`[dry-run] then run (systemctl is never executed by this installer):\n${enableCmds.map((c) => `[dry-run]   ${c}`).join("\n")}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(servicePath, service, { mode: 0o644 });
  writeFileSync(timerPath, timer, { mode: 0o644 });
  console.log(`written: ${servicePath}`);
  console.log(`written: ${timerPath}`);
  console.log(`now run (systemctl is never executed by this installer):\n${enableCmds.join("\n")}`);
}

function uninstallSystemd(env: SchedulerEnv, { dryRun, print }: Mode): void {
  const dir = systemdUserDir();
  const disableCmd = `systemctl --user disable --now co-newbiz-tick@${env}.timer`;
  const files = [join(dir, "co-newbiz-tick@.service"), join(dir, "co-newbiz-tick@.timer")];
  if (print || dryRun) {
    console.log(`[dry-run] would suggest: ${disableCmd}`);
    console.log("[dry-run] would remove (shared template units - both env instances stop):");
    for (const f of files) console.log(`[dry-run]   ${f}`);
    return;
  }
  console.log(`now run: ${disableCmd}`);
  for (const f of files) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`removed: ${f}`);
    }
  }
}

function installSchtasks(env: SchedulerEnv, { print }: Mode): void {
  const xml = renderSchtasksXml(env);
  if (print) {
    console.log(xml);
    return;
  }
  // Documented-only platform: never writes, never executes. The user saves the XML and runs the command on Windows.
  console.log(`Task Scheduler is a documented template on this platform. Save the rendered XML below to a file, then run:`);
  console.log(`  schtasks /Create /TN "${schtasksTaskName(env)}" /XML "<path-to-saved-xml>" /F`);
  console.log(`(this installer never executes schtasks)`);
  console.log(`--- begin ${schtasksTaskName(env)}.xml ---`);
  console.log(xml);
  console.log(`--- end ${schtasksTaskName(env)}.xml ---`);
}

function uninstallSchtasks(env: SchedulerEnv): void {
  console.log(`run on the Windows host (this installer never executes schtasks):`);
  console.log(`  schtasks /Delete /TN "${schtasksTaskName(env)}" /F`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

const USAGE = `Usage: bun scripts/co-newbiz/scheduler-install.ts --env prod|dev [--platform launchd|systemd|schtasks] [--uninstall] [--dry-run] [--print]`;

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const print = argv.includes("--print");
  const dryRun = argv.includes("--dry-run");
  const uninstall = argv.includes("--uninstall");
  const envArg = argValue(argv, "--env");
  if (envArg !== "prod" && envArg !== "dev") {
    console.error(`scheduler-install: --env must be 'prod' or 'dev' (got ${envArg === undefined ? "nothing" : `'${envArg}'`})\n${USAGE}`);
    process.exit(2);
  }
  const env = envArg;
  const platformArg = argValue(argv, "--platform") ?? "launchd";
  if (platformArg !== "launchd" && platformArg !== "systemd" && platformArg !== "schtasks") {
    console.error(`scheduler-install: --platform must be launchd|systemd|schtasks (got '${platformArg}')\n${USAGE}`);
    process.exit(2);
  }
  const platform = platformArg as Platform;
  try {
    if (platform === "launchd") {
      uninstall ? uninstallLaunchd(env, { dryRun, print }) : installLaunchd(env, { dryRun, print });
    } else if (platform === "systemd") {
      uninstall ? uninstallSystemd(env, { dryRun, print }) : installSystemd(env, { dryRun, print });
    } else {
      uninstall ? uninstallSchtasks(env) : installSchtasks(env, { dryRun, print });
    }
  } catch (e) {
    console.error(`scheduler-install failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
