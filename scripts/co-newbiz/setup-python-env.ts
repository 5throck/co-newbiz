#!/usr/bin/env bun
// @version 1.0.0
/**
 * setup-python-env.ts — preliminary step that prepares the repo-root `.venv`
 * for the Monte Carlo engine (python/sim_engine) and, when a GPU is present or
 * requested, installs the matching accelerator wheels so no manual pip work is
 * needed (design 2026-09-18-s8-business-case-evaluation REQ-W7-2/REQ-W7-3).
 *
 *   bun scripts/co-newbiz/setup-python-env.ts                # auto-detect (default)
 *   bun scripts/co-newbiz/setup-python-env.ts --gpu=none     # CPU deps only
 *   bun scripts/co-newbiz/setup-python-env.ts --gpu=cuda     # force an accelerator
 *   bun scripts/co-newbiz/setup-python-env.ts --check        # report only; exit 1 if the
 *                                                            # selected accelerator is unusable
 *   bun scripts/co-newbiz/setup-python-env.ts --dry-run      # print the plan, change nothing
 *   bun run setup:python                                     # same as the first line
 *
 * Flags:
 *   --gpu=auto|none|cuda|mps|rocm|xpu   accelerator selection (env CO_NEWBIZ_SIM_GPU, default auto)
 *   --check      report-only: venv state, detected/selected accelerator, the engine's own device
 *                probe. Exit 1 only when an accelerator is selected and torch cannot use it.
 *   --dry-run    resolve everything and print the install plan; creates/changes nothing
 *   --force      ignore the up-to-date stamp and re-run the installs
 *   --soft       never fail the caller: an install failure is a warning (exit 0) and is not
 *                retried for 6 hours (used by the app's `predev` hook)
 *   --quiet      one-line output when already up to date; pip -q
 *
 * Idempotent: a stamp (.venv/.co-newbiz-setup.json) holds a hash of the requirement files, the
 * accelerator, the platform and the venv interpreter; a matching stamp makes the call a no-op
 * costing one python spawn. Everything stays inside `.venv`; sudo is never used. Accelerator
 * wheels come from the `--extra-index-url` lines inside python/requirements-gpu-<acc>.txt.
 *
 * Exit codes: 0 ok, 1 failure / accelerator unusable (--check), 2 usage or unsupported selection.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Pure model — accelerator selection and detection
// ---------------------------------------------------------------------------

export const ACCELERATORS = ["cuda", "mps", "xpu", "rocm"] as const; // engine AUTO_ORDER (device.py)
export type Accelerator = (typeof ACCELERATORS)[number] | "none";
export type GpuMode = "auto" | Accelerator;
export const GPU_MODES: readonly GpuMode[] = ["auto", "none", ...ACCELERATORS];

/** Which accelerator wheels exist on which OS (torch publishes no other combos). */
const SUPPORTED_PLATFORMS: Record<Exclude<Accelerator, "none">, readonly string[]> = {
  cuda: ["linux", "win32"],
  mps: ["darwin"],
  rocm: ["linux"],
  xpu: ["linux", "win32"],
};

export interface HostProbe {
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  /** Resolves a command on PATH (null when absent). */
  which(cmd: string): string | null;
  exists(path: string): boolean;
}

export interface Detection {
  accelerator: Accelerator;
  evidence: string;
}

export function parseGpuMode(raw: string | undefined | null): GpuMode | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "auto";
  return (GPU_MODES as readonly string[]).includes(value) ? (value as GpuMode) : null;
}

export function platformSupports(acc: Accelerator, platform: string, arch: string): boolean {
  if (acc === "none") return true;
  if (!SUPPORTED_PLATFORMS[acc].includes(platform)) return false;
  return acc === "mps" ? arch === "arm64" : true;
}

/** Host-runtime evidence for ONE accelerator (null = no sign of it on this host). */
export function hostRuntimeEvidence(acc: Accelerator, host: HostProbe): string | null {
  if (acc === "none" || !platformSupports(acc, host.platform, host.arch)) return null;
  switch (acc) {
    case "cuda":
      return host.which("nvidia-smi") ? "nvidia-smi found" : null;
    case "mps":
      return "Apple Silicon (darwin/arm64)";
    case "xpu": {
      const tool = ["xpu-smi", "sycl-ls"].find((cmd) => host.which(cmd));
      if (tool) return `${tool} found`;
      return host.env.ONEAPI_ROOT ? "ONEAPI_ROOT set" : null;
    }
    case "rocm": {
      const tool = ["rocminfo", "rocm-smi"].find((cmd) => host.which(cmd));
      return tool ? `${tool} found` : null;
    }
  }
}

/** First accelerator with host evidence, in the engine's AUTO_ORDER (cuda > mps > xpu > rocm). */
export function detectAccelerator(host: HostProbe): Detection {
  for (const acc of ACCELERATORS) {
    const evidence = hostRuntimeEvidence(acc, host);
    if (evidence) return { accelerator: acc, evidence };
  }
  return { accelerator: "none", evidence: "no GPU runtime detected" };
}

export interface Selection extends Detection {
  mode: GpuMode;
  /** False when the user forced an accelerator the host has no sign of. */
  hostRuntimeFound: boolean;
}

/** Resolve the requested mode into a concrete accelerator; null = forced accelerator unsupported on this OS. */
export function resolveSelection(mode: GpuMode, host: HostProbe): Selection | { error: string } {
  if (mode === "auto") {
    const detected = detectAccelerator(host);
    return { ...detected, mode, hostRuntimeFound: true };
  }
  if (mode === "none") return { accelerator: "none", evidence: "disabled (--gpu=none)", mode, hostRuntimeFound: true };
  if (!platformSupports(mode, host.platform, host.arch)) {
    return {
      error: `--gpu=${mode} is not supported on ${host.platform}/${host.arch} (torch ships ${mode} wheels for: ${SUPPORTED_PLATFORMS[mode].join(", ")}${mode === "mps" ? ", arm64 only" : ""})`,
    };
  }
  const evidence = hostRuntimeEvidence(mode, host);
  return {
    accelerator: mode,
    evidence: evidence ?? `forced; no ${mode} runtime tool found on this host`,
    mode,
    hostRuntimeFound: evidence !== null,
  };
}

export function requirementsFileFor(acc: Accelerator): string | null {
  return acc === "none" ? null : `requirements-gpu-${acc}.txt`;
}

/** `--index-url` / `--extra-index-url` values declared inside a requirements file. */
export function parseIndexUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^\s*--(?:extra-)?index-url[\s=]+(\S+)/.exec(line)?.[1])
    .filter((url): url is string => Boolean(url));
}

/**
 * Whether an already-installed torch build is the wrong flavor for the target accelerator
 * (e.g. CPU/cuda wheel present but rocm wanted). A plain `pip install -r` would see the
 * version constraint satisfied and leave the wrong build in place, so a mismatch forces a reinstall.
 */
export function torchBuildMismatch(acc: Accelerator, installedVersion: string | null, platform: string): boolean {
  if (acc === "none" || !installedVersion) return false;
  const local = installedVersion.includes("+") ? installedVersion.split("+")[1] : "";
  switch (acc) {
    case "cuda":
      return !(local.startsWith("cu") || (local === "" && platform === "linux"));
    case "rocm":
      return !local.startsWith("rocm");
    case "xpu":
      return !local.startsWith("xpu");
    case "mps":
      return platform !== "darwin" || local !== "";
  }
}

export interface StampInput {
  baseRequirements: string;
  gpuRequirements: string;
  accelerator: Accelerator;
  platform: string;
  arch: string;
  pythonVersion: string;
}

export function computeStampHash(input: StampInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.baseRequirements,
        input.gpuRequirements,
        input.accelerator,
        input.platform,
        input.arch,
        input.pythonVersion,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

export interface Stamp {
  hash: string;
  ok: boolean;
  accelerator: Accelerator;
  at: number; // epoch ms
}

/** Soft-mode retry cool-down after a failed install (offline dev machines must not pay a pip timeout on every dev start). */
export const SOFT_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type StampDecision = "up-to-date" | "recent-failure" | "run";

export function decideStamp(
  stamp: Stamp | null,
  hash: string,
  soft: boolean,
  force: boolean,
  now: number,
): StampDecision {
  if (force || !stamp || stamp.hash !== hash) return "run";
  if (stamp.ok) return "up-to-date";
  return soft && now - stamp.at < SOFT_RETRY_COOLDOWN_MS ? "recent-failure" : "run";
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: "venv" | "base" | "gpu";
  description: string;
  command: string[];
}

export interface PlanInput {
  venvExists: boolean;
  basePython: string;
  venvPython: string;
  venvDir: string;
  baseRequirementsPath: string;
  gpuRequirementsPath: string | null;
  indexUrls: string[];
  accelerator: Accelerator;
  forceTorchReinstall: boolean;
  quiet: boolean;
}

export function buildPlan(input: PlanInput): PlanStep[] {
  const steps: PlanStep[] = [];
  const pipArgs = ["-m", "pip", "install", "--disable-pip-version-check", ...(input.quiet ? ["-q"] : [])];
  if (!input.venvExists) {
    steps.push({
      id: "venv",
      description: `create the virtual environment ${input.venvDir}`,
      command: [input.basePython, "-m", "venv", input.venvDir],
    });
  }
  steps.push({
    id: "base",
    description: "install the engine's CPU dependencies (numpy et al.)",
    command: [input.venvPython, ...pipArgs, "-r", input.baseRequirementsPath],
  });
  if (input.accelerator !== "none" && input.gpuRequirementsPath) {
    const via = input.indexUrls.length ? ` via ${input.indexUrls.join(", ")}` : "";
    steps.push({
      id: "gpu",
      description: `install the ${input.accelerator} accelerator extra${via}${input.forceTorchReinstall ? " (replacing the installed torch build)" : ""}`,
      command: [
        input.venvPython,
        ...pipArgs,
        ...(input.forceTorchReinstall ? ["--force-reinstall"] : []),
        "-r",
        input.gpuRequirementsPath,
      ],
    });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Engine probe (`python -m sim_engine --device-info`)
// ---------------------------------------------------------------------------

export interface EngineProbe {
  torch: { installed: boolean; version?: string; available?: Partial<Record<(typeof ACCELERATORS)[number], boolean>> };
  device: { device: string; reason?: string; warnings?: string[] };
}

export function parseEngineProbe(stdout: string): EngineProbe | null {
  try {
    const parsed = JSON.parse(stdout) as Partial<EngineProbe> & { engine?: string };
    if (parsed.engine !== "python-sim-engine" || !parsed.torch || !parsed.device) return null;
    return parsed as EngineProbe;
  } catch {
    return null;
  }
}

/** True when torch inside the venv can actually drive the selected accelerator. */
export function acceleratorUsable(acc: Accelerator, probe: EngineProbe | null): boolean {
  if (acc === "none") return true;
  return Boolean(probe?.torch.installed && probe.torch.available?.[acc]);
}

// ---------------------------------------------------------------------------
// I/O seam + orchestration
// ---------------------------------------------------------------------------

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface SetupIO {
  host: HostProbe;
  repoRoot: string;
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  /** `inherit` streams the child's output (pip progress) instead of capturing it. */
  exec(
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean },
  ): ExecResult;
  now(): number;
  log(line: string): void;
  warn(line: string): void;
}

export interface SetupOptions {
  mode: GpuMode;
  check: boolean;
  dryRun: boolean;
  force: boolean;
  soft: boolean;
  quiet: boolean;
}

const TAG = "[setup-python]";

export function venvPythonPath(repoRoot: string, platform: string): string {
  return platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
}

function readStamp(io: SetupIO, path: string): Stamp | null {
  const text = io.readText(path);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Stamp;
    return typeof parsed.hash === "string" && typeof parsed.ok === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function runEngineProbe(io: SetupIO, venvPython: string, pythonDir: string): EngineProbe | null {
  const result = io.exec(venvPython, ["-m", "sim_engine", "--device-info"], {
    cwd: pythonDir,
    env: { ...io.host.env, PYTHONPATH: pythonDir },
  });
  return result.status === 0 ? parseEngineProbe(result.stdout) : null;
}

function printProbe(io: SetupIO, probe: EngineProbe | null): void {
  if (!probe) {
    io.log(`${TAG} engine device probe: unavailable (python -m sim_engine --device-info failed)`);
    return;
  }
  const t = probe.torch;
  io.log(`${TAG} engine device probe: torch ${t.installed ? (t.version ?? "installed") : "not installed"}`);
  if (t.available) {
    io.log(`${TAG}   torch sees: ${ACCELERATORS.map((a) => `${a}=${t.available?.[a] ? "yes" : "no"}`).join(" ")}`);
  }
  io.log(
    `${TAG}   auto device for large jobs: ${probe.device.device}${probe.device.reason ? ` (${probe.device.reason})` : ""}`,
  );
  for (const warning of probe.device.warnings ?? []) io.log(`${TAG}   warning: ${warning}`);
}

export function runSetup(opts: SetupOptions, io: SetupIO): number {
  const { host, repoRoot } = io;
  const pythonDir = join(repoRoot, "python");
  const venvDir = join(repoRoot, ".venv");
  const venvPython = venvPythonPath(repoRoot, host.platform);
  const stampPath = join(venvDir, ".co-newbiz-setup.json");

  const selection = resolveSelection(opts.mode, host);
  if ("error" in selection) {
    io.warn(`${TAG} ${selection.error}`);
    return 2;
  }
  const acc = selection.accelerator;
  const gpuFile = requirementsFileFor(acc);
  const baseRequirementsPath = join(pythonDir, "requirements.txt");
  const gpuRequirementsPath = gpuFile ? join(pythonDir, gpuFile) : null;
  const baseText = io.readText(baseRequirementsPath);
  const gpuText = gpuRequirementsPath ? io.readText(gpuRequirementsPath) : "";
  if (baseText === null || (gpuRequirementsPath && gpuText === null)) {
    io.warn(`${TAG} requirements file missing under ${pythonDir}`);
    return 1;
  }

  const venvExists = host.exists(venvPython);
  if (!opts.quiet || opts.check || opts.dryRun) {
    io.log(
      `${TAG} host: ${host.platform}/${host.arch}; selection: --gpu=${opts.mode} -> ${acc} (${selection.evidence})`,
    );
    if (!selection.hostRuntimeFound) {
      io.log(
        `${TAG} note: no ${acc} runtime tool found on this host; installing anyway (forced) — the engine falls back to CPU until a device is visible`,
      );
    }
  }

  // --- check (report only) -------------------------------------------------
  if (opts.check) {
    io.log(`${TAG} venv: ${venvExists ? venvDir : `missing (${venvDir}) — run \`bun run setup:python\``}`);
    const probe = venvExists ? runEngineProbe(io, venvPython, pythonDir) : null;
    if (venvExists) printProbe(io, probe);
    const stamp = readStamp(io, stampPath);
    io.log(`${TAG} install stamp: ${stamp ? `${stamp.ok ? "ok" : "failed"} (${stamp.accelerator})` : "none"}`);
    if (acceleratorUsable(acc, probe)) {
      io.log(
        `${TAG} check: OK (${acc === "none" ? "CPU path; no accelerator selected" : `${acc} runtime usable by torch`})`,
      );
      return 0;
    }
    io.warn(
      `${TAG} check: FAILED — ${acc} runtime is missing (${probe?.torch.installed ? "torch is installed but does not see the device" : "torch is not installed in .venv"}). Run \`bun run setup:python${opts.mode === "auto" ? "" : ` --gpu=${opts.mode}`}\`.`,
    );
    return 1;
  }

  // --- resolve the interpreter + stamp (needs a venv python) ---------------
  const findBasePython = (): string | null =>
    [host.env.CO_NEWBIZ_PYTHON, "python3", "python"]
      .map((c) => (c ? host.which(c) : null))
      .find((p): p is string => Boolean(p)) ?? null;

  let pythonVersion = "";
  if (venvExists) {
    const version = io.exec(venvPython, ["-c", "import sys; print(sys.version)"], {});
    pythonVersion = version.status === 0 ? version.stdout.trim() : "";
  }
  const hash = computeStampHash({
    baseRequirements: baseText,
    gpuRequirements: gpuText ?? "",
    accelerator: acc,
    platform: host.platform,
    arch: host.arch,
    pythonVersion,
  });

  if (!opts.dryRun && venvExists && pythonVersion) {
    const decision = decideStamp(readStamp(io, stampPath), hash, opts.soft, opts.force, io.now());
    if (decision === "up-to-date") {
      io.log(
        `${TAG} .venv up to date (${acc === "none" ? "CPU" : acc}); nothing to do${opts.force ? "" : " (use --force to reinstall)"}`,
      );
      return 0;
    }
    if (decision === "recent-failure") {
      io.warn(
        `${TAG} the previous install attempt failed less than 6h ago; skipping (run \`bun run setup:python\` to retry)`,
      );
      return 0;
    }
  }

  const basePython = findBasePython();
  if (!venvExists && !basePython && !opts.dryRun) {
    io.warn(`${TAG} no python3/python found on PATH (set CO_NEWBIZ_PYTHON to an interpreter); cannot create .venv`);
    return opts.soft ? 0 : 1;
  }

  const installedTorch =
    venvExists && pythonVersion
      ? (() => {
          const res = io.exec(venvPython, ["-c", "import importlib.metadata as m; print(m.version('torch'))"], {});
          return res.status === 0 ? res.stdout.trim() || null : null;
        })()
      : null;
  const plan = buildPlan({
    venvExists,
    basePython: basePython ?? "python3",
    venvPython,
    venvDir,
    baseRequirementsPath,
    gpuRequirementsPath,
    indexUrls: gpuText ? parseIndexUrls(gpuText) : [],
    accelerator: acc,
    forceTorchReinstall: torchBuildMismatch(acc, installedTorch, host.platform),
    quiet: opts.quiet,
  });

  // --- dry-run -------------------------------------------------------------
  if (opts.dryRun) {
    io.log(
      `${TAG} plan (${plan.length} step${plan.length === 1 ? "" : "s"}); torch in .venv: ${installedTorch ?? (venvExists ? "not installed" : "n/a")}`,
    );
    plan.forEach((step, i) => {
      io.log(`${TAG}   ${i + 1}. ${step.description}`);
      io.log(`${TAG}      $ ${step.command.join(" ")}`);
    });
    io.log(`${TAG}   ${plan.length + 1}. print the engine's device probe (python -m sim_engine --device-info)`);
    io.log(`${TAG} dry-run: no changes made`);
    return 0;
  }

  // --- execute -------------------------------------------------------------
  const fail = (message: string): number => {
    io.warn(`${TAG} ${message}`);
    if (opts.soft && venvExists) {
      // Remember the failure so the next dev start does not pay for another attempt right away.
      io.writeText(stampPath, JSON.stringify({ hash, ok: false, accelerator: acc, at: io.now() } satisfies Stamp));
    }
    return opts.soft ? 0 : 1;
  };

  for (const step of plan) {
    io.log(`${TAG} ${step.description}`);
    const [cmd, ...args] = step.command;
    const result = io.exec(cmd, args, { cwd: repoRoot, inherit: true });
    if (result.status !== 0) return fail(`step "${step.id}" failed (exit ${result.status}): ${step.command.join(" ")}`);
  }

  // The venv may have just been created — recompute the interpreter fingerprint for the stamp.
  const finalVersion = io.exec(venvPython, ["-c", "import sys; print(sys.version)"], {});
  const finalHash = computeStampHash({
    baseRequirements: baseText,
    gpuRequirements: gpuText ?? "",
    accelerator: acc,
    platform: host.platform,
    arch: host.arch,
    pythonVersion: finalVersion.status === 0 ? finalVersion.stdout.trim() : pythonVersion,
  });
  io.writeText(
    stampPath,
    JSON.stringify({ hash: finalHash, ok: true, accelerator: acc, at: io.now() } satisfies Stamp),
  );

  const probe = runEngineProbe(io, venvPython, pythonDir);
  printProbe(io, probe);
  if (!acceleratorUsable(acc, probe)) {
    // Not an install failure: Docker builds and GPU-less CI legitimately cannot see the device.
    io.warn(
      `${TAG} warning: ${acc} packages installed but torch cannot use the ${acc} device on this host right now (driver/runtime not visible?) — the engine will fall back to CPU. Verify with \`bun run setup:python --check\`.`,
    );
  }
  io.log(`${TAG} done`);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[], env: Record<string, string | undefined>): SetupOptions | { error: string } {
  let rawMode: string | undefined = env.CO_NEWBIZ_SIM_GPU;
  const opts: SetupOptions = { mode: "auto", check: false, dryRun: false, force: false, soft: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") opts.check = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--soft") opts.soft = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg.startsWith("--gpu=")) rawMode = arg.slice("--gpu=".length);
    else if (arg === "--gpu") rawMode = argv[++i];
    else return { error: `unknown argument: ${arg}` };
  }
  const mode = parseGpuMode(rawMode);
  if (!mode)
    return { error: `invalid --gpu / CO_NEWBIZ_SIM_GPU value "${rawMode}" (expected one of: ${GPU_MODES.join(", ")})` };
  opts.mode = mode;
  if (opts.check && opts.dryRun) return { error: "--check and --dry-run are mutually exclusive" };
  return opts;
}

export function realIO(repoRoot: string): SetupIO {
  const env = process.env as Record<string, string | undefined>;
  return {
    repoRoot,
    host: {
      platform: process.platform,
      arch: process.arch,
      env,
      which: (cmd) => Bun.which(cmd),
      exists: (path) => existsSync(path),
    },
    readText: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    writeText: (path, text) => writeFileSync(path, text, "utf8"),
    exec: (cmd, args, opts) => {
      const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        env: opts.env as NodeJS.ProcessEnv | undefined,
        encoding: "utf8",
        stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
        shell: false,
      });
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    now: () => Date.now(),
    log: (line) => console.log(line),
    warn: (line) => console.error(line),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: bun scripts/co-newbiz/setup-python-env.ts [--gpu=auto|none|cuda|mps|rocm|xpu] [--check|--dry-run] [--force] [--soft] [--quiet]",
    );
    process.exit(0);
  }
  const parsed = parseArgs(argv, process.env as Record<string, string | undefined>);
  if ("error" in parsed) {
    console.error(`${TAG} ${parsed.error}`);
    process.exit(2);
  }
  const repoRoot = resolve(import.meta.dir, "..", "..");
  process.exit(runSetup(parsed, realIO(repoRoot)));
}
