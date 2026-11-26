// @version 1.0.0
/**
 * Unit tests for scripts/co-newbiz/setup-python-env.ts (accelerator detection,
 * selection, install plan, stamp, --check / --dry-run output) and the web
 * app's GPU-misconfiguration warning (app/web-next/lib/sim-engine.ts).
 * Hermetic: host facts and every subprocess are injected — nothing is installed.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  acceleratorUsable,
  buildPlan,
  computeStampHash,
  decideStamp,
  detectAccelerator,
  parseArgs,
  parseEngineProbe,
  parseGpuMode,
  parseIndexUrls,
  resolveSelection,
  runSetup,
  SOFT_RETRY_COOLDOWN_MS,
  torchBuildMismatch,
  type ExecResult,
  type HostProbe,
  type SetupIO,
  type SetupOptions,
} from "../../scripts/co-newbiz/setup-python-env.ts";
import { gpuMisconfigWarning, requestedGpu } from "../../app/web-next/lib/sim-engine.ts";

function host(over: Partial<HostProbe> & { tools?: string[] } = {}): HostProbe {
  const tools = new Set(over.tools ?? []);
  return {
    platform: over.platform ?? "linux",
    arch: over.arch ?? "x64",
    env: over.env ?? {},
    which: (cmd) => (tools.has(cmd) ? `/usr/bin/${cmd}` : null),
    exists: over.exists ?? (() => false),
  };
}

const OPTS: SetupOptions = { mode: "auto", check: false, dryRun: false, force: false, soft: false, quiet: false };
const CUDA_FILE = "--extra-index-url https://download.pytorch.org/whl/cu126\ntorch>=2.4,<3.0\n";

const PROBE_NO_TORCH = JSON.stringify({
  engine: "python-sim-engine",
  version: "1.0.1",
  torch: { installed: false },
  device: { device: "cpu", reason: "auto: no torch runtime", warnings: [] },
});
const PROBE_MPS = JSON.stringify({
  engine: "python-sim-engine",
  version: "1.0.1",
  torch: { installed: true, version: "2.15.0", available: { cuda: false, mps: true, xpu: false, rocm: false } },
  device: { device: "mps", reason: "auto: mps available" },
});

interface FakeState {
  files: Map<string, string>;
  calls: string[];
  logs: string[];
  warns: string[];
  probe: string;
  torchVersion: string | null;
  failMatch?: string;
  now: number;
}

function fakeIO(h: HostProbe, state: FakeState, venvExists: boolean): SetupIO {
  const root = "/repo";
  const venvPy = h.platform === "win32" ? "/repo/.venv/Scripts/python.exe" : "/repo/.venv/bin/python";
  return {
    host: { ...h, exists: (p) => (p === venvPy ? venvExists : h.exists(p)) },
    repoRoot: root,
    readText: (p) => state.files.get(p) ?? null,
    writeText: (p, t) => void state.files.set(p, t),
    exec: (cmd, args): ExecResult => {
      const line = [cmd, ...args].join(" ");
      state.calls.push(line);
      if (state.failMatch && line.includes(state.failMatch)) return { status: 1, stdout: "", stderr: "boom" };
      if (args.includes("--device-info")) return { status: 0, stdout: state.probe, stderr: "" };
      if (line.includes("sys.version")) return { status: 0, stdout: "3.12.1 (main)\n", stderr: "" };
      if (line.includes("m.version('torch')")) {
        return state.torchVersion
          ? { status: 0, stdout: `${state.torchVersion}\n`, stderr: "" }
          : { status: 1, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    now: () => state.now,
    log: (l) => void state.logs.push(l),
    warn: (l) => void state.warns.push(l),
  };
}

function freshState(over: Partial<FakeState> = {}): FakeState {
  return {
    files: new Map([
      ["/repo/python/requirements.txt", "numpy\n"],
      ["/repo/python/requirements-gpu-cuda.txt", CUDA_FILE],
      ["/repo/python/requirements-gpu-mps.txt", "torch>=2.4,<3.0\n"],
      ["/repo/python/requirements-gpu-rocm.txt", "--extra-index-url https://download.pytorch.org/whl/rocm6.2\ntorch\n"],
    ]),
    calls: [],
    logs: [],
    warns: [],
    probe: PROBE_NO_TORCH,
    torchVersion: null,
    now: 1_000_000,
    ...over,
  };
}

describe("accelerator detection", () => {
  test("Apple Silicon selects mps; Intel Mac does not", () => {
    expect(detectAccelerator(host({ platform: "darwin", arch: "arm64" })).accelerator).toBe("mps");
    expect(detectAccelerator(host({ platform: "darwin", arch: "x64" })).accelerator).toBe("none");
  });

  test("nvidia-smi selects cuda; precedence follows the engine order cuda > xpu > rocm", () => {
    expect(detectAccelerator(host({ tools: ["nvidia-smi"] })).accelerator).toBe("cuda");
    expect(detectAccelerator(host({ tools: ["nvidia-smi", "rocminfo", "xpu-smi"] })).accelerator).toBe("cuda");
    expect(detectAccelerator(host({ tools: ["xpu-smi", "rocm-smi"] })).accelerator).toBe("xpu");
    expect(detectAccelerator(host({ tools: ["rocminfo"] })).accelerator).toBe("rocm");
    expect(detectAccelerator(host({ tools: ["rocm-smi"] })).accelerator).toBe("rocm");
  });

  test("oneAPI is detected via sycl-ls or ONEAPI_ROOT", () => {
    expect(detectAccelerator(host({ tools: ["sycl-ls"] })).accelerator).toBe("xpu");
    expect(detectAccelerator(host({ env: { ONEAPI_ROOT: "/opt/intel/oneapi" } })).accelerator).toBe("xpu");
  });

  test("nothing found falls back to none; rocm tools on Windows/macOS are ignored", () => {
    expect(detectAccelerator(host()).accelerator).toBe("none");
    expect(detectAccelerator(host({ platform: "win32", tools: ["rocminfo"] })).accelerator).toBe("none");
    expect(detectAccelerator(host({ platform: "darwin", arch: "arm64", tools: ["nvidia-smi"] })).accelerator).toBe(
      "mps",
    );
  });
});

describe("selection and option parsing", () => {
  test("parseGpuMode accepts the documented values, empty means auto, junk is null", () => {
    for (const mode of ["auto", "none", "cuda", "mps", "rocm", "xpu"]) expect(parseGpuMode(mode)).toBe(mode as never);
    expect(parseGpuMode(" CUDA ")).toBe("cuda");
    expect(parseGpuMode("")).toBe("auto");
    expect(parseGpuMode(undefined)).toBe("auto");
    expect(parseGpuMode("metal")).toBeNull();
  });

  test("flag beats env; env beats default; invalid values and conflicting modes are errors", () => {
    expect(parseArgs([], {})).toMatchObject({ mode: "auto" });
    expect(parseArgs([], { CO_NEWBIZ_SIM_GPU: "none" })).toMatchObject({ mode: "none" });
    expect(parseArgs(["--gpu=cuda"], { CO_NEWBIZ_SIM_GPU: "none" })).toMatchObject({ mode: "cuda" });
    expect(parseArgs(["--gpu", "xpu"], {})).toMatchObject({ mode: "xpu" });
    expect(parseArgs(["--gpu=metal"], {})).toHaveProperty("error");
    expect(parseArgs([], { CO_NEWBIZ_SIM_GPU: "bogus" })).toHaveProperty("error");
    expect(parseArgs(["--bogus"], {})).toHaveProperty("error");
    expect(parseArgs(["--check", "--dry-run"], {})).toHaveProperty("error");
  });

  test("forced accelerators the OS cannot run are refused; forcing without a tool still proceeds", () => {
    expect(resolveSelection("cuda", host({ platform: "darwin", arch: "arm64" }))).toHaveProperty("error");
    expect(resolveSelection("mps", host({ platform: "linux" }))).toHaveProperty("error");
    expect(resolveSelection("rocm", host({ platform: "win32" }))).toHaveProperty("error");
    expect(resolveSelection("cuda", host())).toMatchObject({ accelerator: "cuda", hostRuntimeFound: false });
    expect(resolveSelection("cuda", host({ tools: ["nvidia-smi"] }))).toMatchObject({
      accelerator: "cuda",
      hostRuntimeFound: true,
    });
    expect(resolveSelection("none", host({ tools: ["nvidia-smi"] }))).toMatchObject({ accelerator: "none" });
  });
});

describe("plan, stamp and torch flavor", () => {
  test("parseIndexUrls reads both index flags", () => {
    expect(parseIndexUrls(CUDA_FILE)).toEqual(["https://download.pytorch.org/whl/cu126"]);
    expect(parseIndexUrls("--index-url=https://x/y\n# --extra-index-url https://no\n")).toEqual(["https://x/y"]);
  });

  test("buildPlan: venv step only when missing, gpu step only for an accelerator, reinstall flag on mismatch", () => {
    const base = {
      venvExists: true,
      basePython: "python3",
      venvPython: "/v/bin/python",
      venvDir: "/v",
      baseRequirementsPath: "/p/requirements.txt",
      gpuRequirementsPath: "/p/requirements-gpu-cuda.txt",
      indexUrls: ["https://download.pytorch.org/whl/cu126"],
      accelerator: "cuda" as const,
      forceTorchReinstall: false,
      quiet: false,
    };
    expect(buildPlan(base).map((s) => s.id)).toEqual(["base", "gpu"]);
    expect(buildPlan({ ...base, venvExists: false }).map((s) => s.id)).toEqual(["venv", "base", "gpu"]);
    expect(buildPlan({ ...base, accelerator: "none", gpuRequirementsPath: null }).map((s) => s.id)).toEqual(["base"]);
    const forced = buildPlan({ ...base, forceTorchReinstall: true }).at(-1);
    expect(forced?.command).toContain("--force-reinstall");
    expect(forced?.description).toContain("whl/cu126");
    expect(buildPlan({ ...base, quiet: true })[0].command).toContain("-q");
  });

  test("torchBuildMismatch detects the wrong flavor, ignores absent torch and CPU-only mode", () => {
    expect(torchBuildMismatch("none", "2.4.0+cpu", "linux")).toBe(false);
    expect(torchBuildMismatch("rocm", null, "linux")).toBe(false);
    expect(torchBuildMismatch("rocm", "2.4.0+cu126", "linux")).toBe(true);
    expect(torchBuildMismatch("rocm", "2.4.0+rocm6.2", "linux")).toBe(false);
    expect(torchBuildMismatch("cuda", "2.4.0+cu126", "linux")).toBe(false);
    expect(torchBuildMismatch("cuda", "2.4.0", "linux")).toBe(false);
    expect(torchBuildMismatch("cuda", "2.4.0", "win32")).toBe(true); // PyPI win32 wheel is CPU-only
    expect(torchBuildMismatch("xpu", "2.4.0+cpu", "linux")).toBe(true);
    expect(torchBuildMismatch("mps", "2.15.0", "darwin")).toBe(false);
  });

  test("stamp hash changes with requirements, accelerator and interpreter; decideStamp gates re-runs", () => {
    const input = {
      baseRequirements: "numpy",
      gpuRequirements: "",
      accelerator: "none" as const,
      platform: "linux",
      arch: "x64",
      pythonVersion: "3.12",
    };
    const hash = computeStampHash(input);
    expect(computeStampHash({ ...input })).toBe(hash);
    for (const change of [
      { baseRequirements: "numpy\npandas" },
      { accelerator: "cuda" as const },
      { pythonVersion: "3.13" },
    ]) {
      expect(computeStampHash({ ...input, ...change })).not.toBe(hash);
    }
    const ok = { hash, ok: true, accelerator: "none" as const, at: 0 };
    expect(decideStamp(ok, hash, false, false, 10)).toBe("up-to-date");
    expect(decideStamp(ok, hash, false, true, 10)).toBe("run");
    expect(decideStamp(ok, "other", false, false, 10)).toBe("run");
    expect(decideStamp(null, hash, false, false, 10)).toBe("run");
    const failed = { ...ok, ok: false };
    expect(decideStamp(failed, hash, true, false, SOFT_RETRY_COOLDOWN_MS - 1)).toBe("recent-failure");
    expect(decideStamp(failed, hash, true, false, SOFT_RETRY_COOLDOWN_MS + 1)).toBe("run");
    expect(decideStamp(failed, hash, false, false, 10)).toBe("run");
  });

  test("engine probe parsing and usability", () => {
    const mps = parseEngineProbe(PROBE_MPS);
    expect(mps?.torch.installed).toBe(true);
    expect(acceleratorUsable("mps", mps)).toBe(true);
    expect(acceleratorUsable("cuda", mps)).toBe(false);
    expect(acceleratorUsable("mps", parseEngineProbe(PROBE_NO_TORCH))).toBe(false);
    expect(acceleratorUsable("none", null)).toBe(true);
    expect(acceleratorUsable("mps", null)).toBe(false);
    expect(parseEngineProbe("not json")).toBeNull();
    expect(parseEngineProbe(JSON.stringify({ engine: "other" }))).toBeNull();
  });
});

describe("runSetup --dry-run", () => {
  test("prints the plan, creates nothing, executes no installer", () => {
    const state = freshState();
    const h = host({ platform: "linux", tools: ["nvidia-smi"] });
    const code = runSetup({ ...OPTS, dryRun: true }, fakeIO(h, state, false));
    const out = state.logs.join("\n");
    expect(code).toBe(0);
    expect(out).toContain("--gpu=auto -> cuda (nvidia-smi found)");
    expect(out).toContain("create the virtual environment");
    expect(out).toContain("requirements-gpu-cuda.txt");
    expect(out).toContain("whl/cu126");
    expect(out).toContain("dry-run: no changes made");
    expect(state.calls).toEqual([]);
    expect([...state.files.keys()].some((k) => k.includes(".co-newbiz-setup"))).toBe(false);
  });

  test("with an existing CPU-only venv and no GPU the plan is just the base install", () => {
    const state = freshState();
    const code = runSetup({ ...OPTS, dryRun: true }, fakeIO(host(), state, true));
    expect(code).toBe(0);
    expect(state.logs.join("\n")).toContain("(1 step)");
    expect(state.calls.some((c) => c.includes("pip install"))).toBe(false);
  });

  test("an unsupported forced accelerator exits 2", () => {
    const state = freshState();
    expect(runSetup({ ...OPTS, mode: "mps", dryRun: true }, fakeIO(host({ platform: "linux" }), state, true))).toBe(2);
    expect(state.warns.join("\n")).toContain("not supported on linux/x64");
  });
});

describe("runSetup --check", () => {
  test("exits 1 when the selected accelerator is selected but torch is missing", () => {
    const state = freshState({ probe: PROBE_NO_TORCH });
    const code = runSetup({ ...OPTS, check: true }, fakeIO(host({ platform: "darwin", arch: "arm64" }), state, true));
    expect(code).toBe(1);
    expect(state.warns.join("\n")).toContain("mps runtime is missing");
    expect(state.warns.join("\n")).toContain("bun run setup:python");
  });

  test("exits 0 when torch sees the selected accelerator", () => {
    const state = freshState({ probe: PROBE_MPS });
    const code = runSetup({ ...OPTS, check: true }, fakeIO(host({ platform: "darwin", arch: "arm64" }), state, true));
    expect(code).toBe(0);
    expect(state.logs.join("\n")).toContain("check: OK (mps runtime usable by torch)");
    expect(state.calls.some((c) => c.includes("pip install"))).toBe(false);
  });

  test("with no accelerator selected the check passes even without torch or a venv", () => {
    const state = freshState();
    expect(runSetup({ ...OPTS, check: true }, fakeIO(host(), state, false))).toBe(0);
    expect(state.logs.join("\n")).toContain("CPU path");
  });

  test("a forced accelerator with no usable runtime fails", () => {
    const state = freshState({ probe: PROBE_MPS });
    expect(runSetup({ ...OPTS, mode: "cuda", check: true }, fakeIO(host(), state, true))).toBe(1);
  });
});

describe("runSetup install path", () => {
  test("installs base then the accelerator extra, writes an ok stamp, prints the probe", () => {
    const state = freshState({ probe: PROBE_MPS });
    const code = runSetup({ ...OPTS, quiet: true }, fakeIO(host({ platform: "darwin", arch: "arm64" }), state, true));
    expect(code).toBe(0);
    const pip = state.calls.filter((c) => c.includes("pip install"));
    expect(pip).toHaveLength(2);
    expect(pip[0]).toContain("requirements.txt");
    expect(pip[1]).toContain("requirements-gpu-mps.txt");
    expect(JSON.parse(state.files.get("/repo/.venv/.co-newbiz-setup.json") ?? "")).toMatchObject({
      ok: true,
      accelerator: "mps",
    });
    expect(state.logs.join("\n")).toContain("auto device for large jobs: mps");
  });

  test("a second run with an unchanged stamp is a no-op (no pip)", () => {
    const state = freshState({ probe: PROBE_MPS });
    const h = host({ platform: "darwin", arch: "arm64" });
    runSetup(OPTS, fakeIO(h, state, true));
    state.calls.length = 0;
    expect(runSetup(OPTS, fakeIO(h, state, true))).toBe(0);
    expect(state.calls.some((c) => c.includes("pip install"))).toBe(false);
    expect(state.logs.join("\n")).toContain("up to date");
    // --force re-runs the installers
    runSetup({ ...OPTS, force: true }, fakeIO(h, state, true));
    expect(state.calls.filter((c) => c.includes("pip install"))).toHaveLength(2);
  });

  test("a wrong-flavor torch is replaced with --force-reinstall", () => {
    const state = freshState({ torchVersion: "2.4.0+cu126", probe: PROBE_NO_TORCH });
    runSetup({ ...OPTS, mode: "rocm" }, fakeIO(host({ platform: "linux" }), state, true));
    const gpuInstall = state.calls.find((c) => c.includes("requirements-gpu-rocm.txt")) ?? "";
    expect(gpuInstall).toContain("--force-reinstall");
    // installed but invisible device: warning, not failure
    expect(state.warns.join("\n")).toContain("cannot use the rocm device");
  });

  test("pip failure: exit 1 normally; --soft exits 0 and is not retried within the cool-down", () => {
    const h = host({ platform: "darwin", arch: "arm64" });
    const hard = freshState({ failMatch: "pip install" });
    expect(runSetup(OPTS, fakeIO(h, hard, true))).toBe(1);

    const soft = freshState({ failMatch: "pip install" });
    expect(runSetup({ ...OPTS, soft: true }, fakeIO(h, soft, true))).toBe(0);
    expect(JSON.parse(soft.files.get("/repo/.venv/.co-newbiz-setup.json") ?? "").ok).toBe(false);
    soft.calls.length = 0;
    soft.now += 60_000;
    expect(runSetup({ ...OPTS, soft: true }, fakeIO(h, soft, true))).toBe(0);
    expect(soft.calls.some((c) => c.includes("pip install"))).toBe(false);
    expect(soft.warns.join("\n")).toContain("previous install attempt failed");
  });

  test("missing venv is created from python3 before pip runs", () => {
    const state = freshState();
    const h = { ...host({ tools: ["python3"] }) };
    runSetup(OPTS, fakeIO(h, state, false));
    expect(state.calls[0]).toBe("/usr/bin/python3 -m venv /repo/.venv");
  });
});

describe("web app GPU misconfiguration warning", () => {
  const noTorch = { torch: { installed: false }, device: { device: "cpu", reason: "auto: no torch runtime" } };

  test("requestedGpu is silent for unset / none / invalid and active for names and explicit auto", () => {
    expect(requestedGpu({})).toBeNull();
    expect(requestedGpu({ CO_NEWBIZ_SIM_GPU: "none" })).toBeNull();
    expect(requestedGpu({ CO_NEWBIZ_SIM_GPU: "bogus" })).toBeNull();
    expect(requestedGpu({ CO_NEWBIZ_SIM_GPU: "MPS" })).toBe("mps");
    expect(requestedGpu({ CO_NEWBIZ_SIM_GPU: "auto" })).toBe("auto");
  });

  test("warns and points at setup:python only when a GPU is requested and torch is absent", () => {
    const warning = gpuMisconfigWarning({ CO_NEWBIZ_SIM_GPU: "mps" }, noTorch);
    expect(warning).toContain("no torch runtime");
    expect(warning).toContain("bun run setup:python");
    expect(gpuMisconfigWarning({}, noTorch)).toBeNull();
    expect(gpuMisconfigWarning({ CO_NEWBIZ_SIM_GPU: "none" }, noTorch)).toBeNull();
    expect(gpuMisconfigWarning({ CO_NEWBIZ_SIM_GPU: "mps" }, null)).toBeNull();
    // below-threshold CPU is expected behavior, not a misconfiguration
    expect(
      gpuMisconfigWarning(
        { CO_NEWBIZ_SIM_GPU: "mps" },
        { torch: { installed: true }, device: { device: "cpu", reason: "work=10 below GPU payoff threshold" } },
      ),
    ).toBeNull();
  });

  test("warns when torch is installed but cannot see the explicitly requested device", () => {
    const probe = {
      torch: { installed: true, available: { cuda: false, mps: true } },
      device: { device: "mps", reason: "auto" },
    };
    expect(gpuMisconfigWarning({ CO_NEWBIZ_SIM_GPU: "cuda" }, probe)).toContain("cannot use cuda");
    expect(gpuMisconfigWarning({ CO_NEWBIZ_SIM_GPU: "mps" }, probe)).toBeNull();
  });
});

describe("engine --device-info contract (additive probe)", () => {
  const root = resolve(import.meta.dirname, "..", "..");
  const venvPython = resolve(root, ".venv", "bin", "python3");
  const python = existsSync(venvPython) ? venvPython : "python3";
  const run = spawnSync(python, ["-m", "sim_engine", "--device-info"], {
    cwd: resolve(root, "python"),
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, PYTHONPATH: resolve(root, "python") },
  });
  const available = (run.status ?? (run as { exitCode?: number }).exitCode) === 0;

  test.skipIf(!available)("reports engine identity, torch state and the auto device without running a job", () => {
    const probe = parseEngineProbe(run.stdout);
    expect(probe).not.toBeNull();
    expect(typeof probe?.torch.installed).toBe("boolean");
    expect(probe?.device.device).toMatch(/^(cpu|cuda|mps|xpu|rocm)$/);
    expect(JSON.parse(run.stdout).gpu_work_threshold).toBe(200_000);
  });
});
