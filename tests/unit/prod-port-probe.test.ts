// @version 1.0.0
/**
 * Host-side production port-publish invariant probe tests (design addendum 2026-11-28:
 * docs/designs/2026-09-21-docker-prod-cicd-design.md, REQ-P8..P11). Pure-logic coverage
 * following the scheduler-p2 pattern - no Docker daemon, no network: the full
 * classifyOutcome matrix (invariant first, precedence over HTTP), docker inspect output
 * parsing (empty/absent port mapping, malformed output never silently OK), the one-line
 * JSON report shape, the portprobe plist template/render, and the installer CLI contract
 * for --job port-probe (no side effects in print/dry-run mode).
 */
import { test, expect, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const OPS = join(REPO_ROOT, "ops", "scheduler");

const probe = await import("../../scripts/co-newbiz/prod-port-probe.ts");
const inst = await import("../../scripts/co-newbiz/scheduler-install.ts");

const TMP = mkdtempSync(join(tmpdir(), "port-probe-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const runCli = (args: string[]) =>
  Bun.spawnSync([process.execPath, join(REPO_ROOT, "scripts", "co-newbiz", "scheduler-install.ts"), ...args]);

// Inspect payloads shaped like the real `docker inspect co-newbiz-web` output
// (only the fields parseInspect reads are populated).
const inspectJson = (opts: {
  running?: boolean;
  active?: unknown[]; // NetworkSettings.Ports["7749/tcp"]
  desired?: unknown[]; // HostConfig.PortBindings["7749/tcp"]
}) =>
  JSON.stringify([
    {
      State: { Running: opts.running ?? true },
      NetworkSettings: { Ports: { "7749/tcp": opts.active ?? [] } },
      HostConfig: { PortBindings: { "7749/tcp": opts.desired ?? [] } },
    },
  ]);

const DESIRED = [{ HostIp: "127.0.0.1", HostPort: "7749" }];
const runningPublished = { running: true, portPublished: true, desiredBinding: true };
const runningUnpublished = { running: true, portPublished: false, desiredBinding: true };

describe("classifyOutcome matrix (invariant first, then HTTP)", () => {
  test("OK: running, published, HTTP ok", () => {
    expect(probe.classifyOutcome(runningPublished, true)).toEqual({ outcome: "OK", sub_reason: null });
  });

  test("app_down: running, published, HTTP fail -> DEGRADED", () => {
    expect(probe.classifyOutcome(runningPublished, false)).toEqual({
      outcome: "DEGRADED",
      sub_reason: "app_down",
    });
  });

  test("PUBLISH_DEAD takes precedence over a failed HTTP check (the 2026-11-28 incident shape)", () => {
    const c = probe.classifyOutcome(runningUnpublished, false);
    expect(c.outcome).toBe("PUBLISH_DEAD");
    expect(c.sub_reason).toBe(null);
  });

  test("PUBLISH_DEAD even when HTTP happens to succeed (invariant keys on the active mapping alone)", () => {
    expect(probe.classifyOutcome(runningUnpublished, true).outcome).toBe("PUBLISH_DEAD");
  });

  test("inspect failed/malformed (null facts) -> DEGRADED docker_down, never PUBLISH_DEAD", () => {
    for (const httpOk of [true, false]) {
      const c = probe.classifyOutcome(null, httpOk);
      expect(c.outcome).toBe("DEGRADED");
      expect(c.sub_reason).toBe("docker_down");
      expect(c.outcome).not.toBe("PUBLISH_DEAD");
    }
  });

  test("container present but not running -> DEGRADED docker_down, explicitly NOT PUBLISH_DEAD", () => {
    const notRunning = { running: false, portPublished: false, desiredBinding: false };
    const c = probe.classifyOutcome(notRunning, false);
    expect(c.outcome).toBe("DEGRADED");
    expect(c.sub_reason).toBe("docker_down");
    expect(c.outcome).not.toBe("PUBLISH_DEAD");
  });
});

describe("parseInspect", () => {
  test("healthy mapping: active + desired bindings both non-empty", () => {
    expect(probe.parseInspect(inspectJson({ active: DESIRED, desired: DESIRED }))).toEqual({
      running: true,
      portPublished: true,
      desiredBinding: true,
    });
  });

  test("the incident signature: desired binding present, active mapping empty -> unpublished", () => {
    expect(probe.parseInspect(inspectJson({ active: [], desired: DESIRED }))).toEqual({
      running: true,
      portPublished: false,
      desiredBinding: true,
    });
  });

  test("absent 7749/tcp keys count as unpublished and unbound", () => {
    const raw = JSON.stringify([
      { State: { Running: true }, NetworkSettings: { Ports: {} }, HostConfig: { PortBindings: {} } },
    ]);
    expect(probe.parseInspect(raw)).toEqual({
      running: true,
      portPublished: false,
      desiredBinding: false,
    });
  });

  test("State.Running false is parsed as not-running", () => {
    const facts = probe.parseInspect(inspectJson({ running: false, active: DESIRED, desired: DESIRED }));
    expect(facts?.running).toBe(false);
  });

  test("malformed output returns null (classifies DEGRADED docker_down, never silently OK)", () => {
    for (const bad of ["", "not json at all", "[]", JSON.stringify({ State: { Running: true } }), "null"]) {
      expect(probe.parseInspect(bad)).toBeNull();
    }
  });
});

describe("report line (one JSON line per run)", () => {
  test("OK line carries ts/outcome/sub_reason/publish_binding/http/detail", () => {
    const line = probe.buildReportLine(
      { outcome: "OK", sub_reason: null },
      runningPublished,
      "ok",
      new Date("2026-11-28T09:00:00+09:00"),
    );
    expect(Object.keys(line)).toEqual(
      expect.arrayContaining(["ts", "outcome", "sub_reason", "publish_binding", "http", "detail"]),
    );
    expect(line.ts).toBe(new Date("2026-11-28T09:00:00+09:00").toISOString());
    expect(line.outcome).toBe("OK");
    expect(line.sub_reason).toBeNull();
    expect(line.publish_binding).toBe("present");
    expect(line.http).toBe("ok");
    expect(typeof line.detail).toBe("string");
    expect(line.detail.length).toBeGreaterThan(0);
  });

  test("PUBLISH_DEAD detail names the desync fix when the desired binding is present", () => {
    const line = probe.buildReportLine({ outcome: "PUBLISH_DEAD", sub_reason: null }, runningUnpublished, "fail");
    expect(line.publish_binding).toBe("present");
    expect(line.detail).toContain("--force-recreate");
  });

  test("PUBLISH_DEAD with no desired binding flags config drift", () => {
    const facts = { running: true, portPublished: false, desiredBinding: false };
    const line = probe.buildReportLine({ outcome: "PUBLISH_DEAD", sub_reason: null }, facts, "fail");
    expect(line.publish_binding).toBe("absent");
    expect(line.detail).toContain("drift");
  });

  test("docker_down detail distinguishes failed inspect from a not-running container", () => {
    const failed = probe.buildReportLine({ outcome: "DEGRADED", sub_reason: "docker_down" }, null, "fail");
    expect(failed.publish_binding).toBe("unknown");
    expect(failed.detail).toContain("malformed");
    const stopped = probe.buildReportLine(
      { outcome: "DEGRADED", sub_reason: "docker_down" },
      { running: false, portPublished: false, desiredBinding: false },
      "fail",
    );
    expect(stopped.publish_binding).toBe("absent");
    expect(stopped.detail).toContain("not running");
  });

  test("the line serializes to exactly one line of JSON", () => {
    const line = probe.buildReportLine({ outcome: "DEGRADED", sub_reason: "app_down" }, runningPublished, "fail");
    const s = JSON.stringify(line);
    expect(s).not.toContain("\n");
    expect(JSON.parse(s)).toEqual(line);
  });

  test("exit code mapping: OK 0, DEGRADED 1, PUBLISH_DEAD 2", () => {
    expect(probe.exitCodeFor("OK")).toBe(0);
    expect(probe.exitCodeFor("DEGRADED")).toBe(1);
    expect(probe.exitCodeFor("PUBLISH_DEAD")).toBe(2);
  });
});

// LaunchAgents are a macOS-only mechanism; the renderer bakes machine-local absolute paths
// into the output. Same guard/normalization approach as scheduler-p2-install.test.ts.
const DOCKER_BIN = Bun.which("docker") ?? "docker";
const normalizePaths = (s: string) => {
  const tokens: Array<[string, string]> = [
    [DOCKER_BIN && DOCKER_BIN !== "docker" ? DOCKER_BIN : "", "<DOCKER_BIN>"],
    [dirname(process.execPath), "<BUN_BIN>"],
    [process.execPath, "<BUN>"],
    [REPO_ROOT, "<REPO_ROOT>"],
    [homedir(), "<HOME>"],
  ];
  return tokens.reduce((acc, [token, replacement]) => (token ? acc.replaceAll(token, replacement) : acc), s);
};
const MAC_LAUNCHD = process.platform === "darwin";
const skipUnlessMac = MAC_LAUNCHD ? test : test.skip;

describe("portprobe plist template and rendering", () => {
  skipUnlessMac("template exists with the required placeholders and probe-specific keys", () => {
    const tmpl = readFileSync(join(OPS, "launchd", "co-newbiz-portprobe.plist.tmpl"), "utf-8");
    for (const p of [
      "{{LABEL}}",
      "{{PROGRAM_ARGUMENTS}}",
      "{{WORKING_DIRECTORY}}",
      "{{PATH}}",
      "{{STDOUT_LOG}}",
      "{{STDERR_LOG}}",
    ]) {
      expect(tmpl).toContain(p);
    }
    expect(tmpl).toContain("<key>StartInterval</key>\n\t<integer>300</integer>");
    expect(tmpl).toContain("<key>RunAtLoad</key>\n\t<true/>");
    expect(tmpl).toContain("<key>ProcessType</key>\n\t<string>Background</string>");
  });

  skipUnlessMac("rendered plist: label, host-process arguments, PATH pinning, log paths (snapshot)", () => {
    const plist = inst.renderPortProbePlist();
    expect(normalizePaths(plist)).toMatchSnapshot();
    expect(plist).toContain("<key>Label</key>\n\t<string>org.bizknights.co-newbiz.prod.portprobe</string>");
    expect(plist).toContain(`<string>${process.execPath}</string>`);
    expect(plist).toContain("<string>scripts/co-newbiz/prod-port-probe.ts</string>");
    // host process, not docker exec: the HTTP check must originate on the host (REQ-P8)
    expect(plist).not.toContain("docker");
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>300</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
    // explicit PATH (launchd's inherited PATH is minimal), same pinning as the tick
    const m = plist.match(/<key>PATH<\/key>\n\t\t<string>([^<]+)<\/string>/);
    expect(m).not.toBeNull();
    expect(m?.[1].split(":")).toContain(dirname(process.execPath));
    expect(plist).toContain("Library/Logs/co-newbiz/");
    // no secrets in the plist
    expect(plist).not.toMatch(/API_KEY|PASSWORD|SECRET|TOKEN/);
  });

  skipUnlessMac("rendered plist lints clean (plutil, skipped when unavailable)", () => {
    if (!inst.plutilAvailable()) return;
    const r = inst.lintPlist(inst.renderPortProbePlist());
    expect(r.ok).toBe(true);
  });

  test("label, plist path, and the three log files (incl. the probe's own alert log)", () => {
    expect(inst.portProbeLabel()).toBe("org.bizknights.co-newbiz.prod.portprobe");
    const home = join(TMP, "paths");
    expect(inst.portProbePlistPath(home)).toBe(
      join(home, "Library", "LaunchAgents", "org.bizknights.co-newbiz.prod.portprobe.plist"),
    );
    const logs = inst.portProbeLogPaths(home);
    expect(logs.out).toBe(join(home, "Library", "Logs", "co-newbiz", "prod-portprobe.out.log"));
    expect(logs.err).toBe(join(home, "Library", "Logs", "co-newbiz", "prod-portprobe.err.log"));
    expect(logs.alert).toBe(join(home, "Library", "Logs", "co-newbiz", "prod-port-probe.log"));
    expect(probe.alertLogPath(home)).toBe(logs.alert);
  });
});

describe("CLI --job port-probe (no side effects in print/dry-run mode)", () => {
  test("--job port-probe --print emits the rendered plist only", () => {
    const p = runCli(["--job", "port-probe", "--print"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain("org.bizknights.co-newbiz.prod.portprobe");
    expect(out).toContain("prod-port-probe.ts");
    expect(out).toContain("<integer>300</integer>");
  });

  test("--job port-probe --dry-run prints the plan and exits 0", () => {
    const p = runCli(["--job", "port-probe", "--dry-run"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out).toContain("[dry-run] would write plist:");
    expect(out).toContain("[dry-run] would run: launchctl bootstrap");
    expect(out).toContain("prod-port-probe.log");
  });

  skipUnlessMac("--job port-probe --uninstall --dry-run prints bootout + removal only", () => {
    // the CLI exits 1 on non-macOS by its own platform guard (launchd uninstall needs process.getuid)
    const p = runCli(["--job", "port-probe", "--uninstall", "--dry-run"]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("launchctl bootout");
    expect(p.stdout.toString()).toContain("prod.portprobe");
  });

  test("usage errors exit 2: unknown job, --env combined with the probe job, non-launchd platform", () => {
    expect(runCli(["--job", "tick"]).exitCode).toBe(2);
    expect(runCli(["--job", "port-probe", "--env", "prod"]).exitCode).toBe(2);
    expect(runCli(["--job", "port-probe", "--platform", "systemd"]).exitCode).toBe(2);
    expect(runCli(["--job", "port-probe", "--platform", "schtasks"]).exitCode).toBe(2);
  });

  test("the tick contract is unchanged: no --job still requires --env", () => {
    expect(runCli([]).exitCode).toBe(2);
    expect(runCli(["--env", "dev", "--print"]).exitCode).toBe(0);
  });
});

describe("uninstall removes only its own plist (removePlistFile)", () => {
  test("bootout is called for our plist, the file is removed, other LaunchAgents are untouched", () => {
    const home = join(TMP, "uninstall");
    const laDir = join(home, "Library", "LaunchAgents");
    mkdirSync(laDir, { recursive: true });
    const ours = inst.portProbePlistPath(home);
    const decoy = join(laDir, "org.someone-else.app.plist");
    writeFileSync(ours, '<plist version="1.0"/>');
    writeFileSync(decoy, '<plist version="1.0"/>');
    const booted: string[] = [];
    const r = inst.removePlistFile(ours, {
      bootout: (p) => {
        booted.push(p);
        return { code: 0, stderr: "" };
      },
    });
    expect(r.removed).toBe(true);
    expect(r.bootedOut).toBe(true);
    expect(booted).toEqual([ours]);
    expect(existsSync(ours)).toBe(false);
    expect(existsSync(decoy)).toBe(true);
  });

  test("a missing plist means nothing to do: no bootout call, removed=false", () => {
    const home = join(TMP, "uninstall-missing");
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    let calls = 0;
    const r = inst.removePlistFile(inst.portProbePlistPath(home), {
      bootout: () => {
        calls++;
        return { code: 0, stderr: "" };
      },
    });
    expect(r.removed).toBe(false);
    expect(calls).toBe(0);
  });
});
