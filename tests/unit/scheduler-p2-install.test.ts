// @version 1.0.0
/**
 * Scheduler P2 installer tests (ADR-0189, scheduled-jobs design section 7 and the section 9 "Installer" test plan):
 * rendered launchd plist snapshots for both envs, plutil -lint validation (skipped gracefully when plutil is
 * unavailable), template existence and well-formedness (xmllint for the schtasks XML, skipped when unavailable),
 * and the uninstall path removing only its own LaunchAgent plist. Nothing is installed and launchctl is never
 * called - the real bootout is always injected.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "scheduler-p2-"));
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "co-newbiz", "scheduler-install.ts");
const OPS = join(REPO_ROOT, "ops", "scheduler");

const inst = await import("../../scripts/co-newbiz/scheduler-install.ts");

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const runCli = (args: string[]) => Bun.spawnSync([process.execPath, SCRIPT, ...args]);
// Bun 1.4 spawnSync cannot feed a string to stdin: lint through a temp file.
const xmlLintOk = (xml: string) => {
  if (!Bun.which("xmllint")) return true;
  const file = join(TMP, "lint.xml");
  writeFileSync(file, xml);
  return Bun.spawnSync(["xmllint", "--noout", file]).exitCode === 0;
};

describe("launchd rendering (both envs)", () => {
  const plistDev = inst.renderLaunchdPlist("dev");
  const plistProd = inst.renderLaunchdPlist("prod");

  test.each([
    ["dev", plistDev],
    ["prod", plistProd],
  ] as const)("%s: mandatory keys per design section 7 (snapshot)", (_, plist) => {
    expect(plist).toMatchSnapshot();
    expect(plist).toContain(`<key>Label</key>\n\t<string>org.bizknights.co-newbiz.`);
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>60</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n\t<false/>");
    expect(plist).toContain("<key>ProcessType</key>\n\t<string>Background</string>");
    // mandatory: the tick spawns detached run-job children that must outlive it
    expect(plist).toContain("<key>AbandonProcessGroup</key>\n\t<true/>");
    expect(plist).toContain("<key>CO_NEWBIZ_SCHEDULER_ENV</key>");
    expect(plist).toContain("<key>StandardOutPath</key>\n\t<string>/Users/");
    expect(plist).toContain("Library/Logs/co-newbiz/");
    expect(plist).toContain("scripts/co-newbiz/schedule-tick.ts");
  });

  test("dev: host bun with WorkingDirectory = repo root; prod: docker exec with the env injected into the container", () => {
    expect(plistDev).toContain(`<string>${process.execPath}</string>`);
    expect(plistDev).toContain("<key>WorkingDirectory</key>");
    expect(plistDev).not.toContain("docker");
    expect(plistProd).toContain("<string>docker</string>");
    expect(plistProd).toContain("<string>exec</string>");
    expect(plistProd).toContain("<string>co-newbiz-web</string>");
    expect(plistProd).not.toContain("WorkingDirectory");
    expect(inst.launchdLabel("dev")).toBe("org.bizknights.co-newbiz.dev.tick");
    expect(inst.launchdLabel("prod")).toBe("org.bizknights.co-newbiz.prod.tick");
  });

  test("release-engineer drift fix: docker exec does not forward client env, so CO_NEWBIZ_SCHEDULER_ENV is injected with -e", () => {
    // The client-side env var alone would leave the container-side tick exiting 2 every minute.
    expect(inst.tickArguments("prod")).toEqual([
      "docker",
      "exec",
      "-e",
      "CO_NEWBIZ_SCHEDULER_ENV=prod",
      "co-newbiz-web",
      "bun",
      "scripts/co-newbiz/schedule-tick.ts",
    ]);
    expect(plistProd).toContain("<string>-e</string>\n\t\t<string>CO_NEWBIZ_SCHEDULER_ENV=prod</string>");
    expect(plistDev).not.toContain("<string>-e</string>");
    // client-side env var is still declared in EnvironmentVariables (kept deliberately)
    expect(plistProd).toContain("<key>CO_NEWBIZ_SCHEDULER_ENV</key>\n\t\t<string>prod</string>");
  });

  test("explicit PATH includes the bun directory and standard dirs", () => {
    const m = plistDev.match(/<key>PATH<\/key>\n\t\t<string>([^<]+)<\/string>/)!;
    const parts = m[1].split(":");
    expect(parts).toContain(require("node:path").dirname(process.execPath));
    for (const d of ["/usr/bin", "/bin"]) expect(parts).toContain(d);
  });

  test("no secrets in the rendered plist (design section 5)", () => {
    for (const plist of [plistDev, plistProd]) expect(plist).not.toMatch(/API_KEY|PASSWORD|SECRET|TOKEN/);
  });

  test("launchd log paths follow ~/Library/Logs/co-newbiz/<env>-tick.{out,err}.log", () => {
    const home = join(TMP, "logpaths");
    const paths = inst.launchdLogPaths("dev", home);
    expect(paths.out).toBe(join(home, "Library", "Logs", "co-newbiz", "dev-tick.out.log"));
    expect(paths.err).toBe(join(home, "Library", "Logs", "co-newbiz", "dev-tick.err.log"));
    expect(inst.launchdPlistPath("prod", home)).toBe(
      join(home, "Library", "LaunchAgents", "org.bizknights.co-newbiz.prod.tick.plist"),
    );
  });
});

describe("plutil -lint (skipped when plutil is unavailable)", () => {
  test.skipIf(!inst.plutilAvailable())("rendered plists for both envs lint clean", () => {
    for (const env of ["dev", "prod"] as const) {
      const file = join(TMP, `${env}-tick.plist`);
      writeFileSync(file, inst.renderLaunchdPlist(env));
      const p = Bun.spawnSync(["plutil", "-lint", file]);
      expect(p.exitCode).toBe(0);
      expect(p.stdout.toString()).toContain("OK");
      expect(inst.lintPlist(inst.renderLaunchdPlist(env)).ok).toBe(true);
    }
  });

  test.skipIf(!inst.plutilAvailable())("lintPlist rejects a malformed plist", () => {
    const r = inst.lintPlist("this is not a plist");
    expect(r.ok).toBe(false);
  });
});

describe("templates", () => {
  test("launchd template exists and carries every placeholder plus the mandatory keys", () => {
    const tmpl = readFileSync(join(OPS, "launchd", "co-newbiz-tick.plist.tmpl"), "utf-8");
    for (const p of ["{{LABEL}}", "{{PROGRAM_ARGUMENTS}}", "{{WORKING_DIRECTORY}}", "{{PATH}}", "{{ENV}}", "{{STDOUT_LOG}}", "{{STDERR_LOG}}"]) {
      expect(tmpl).toContain(p);
    }
    expect(tmpl).toContain("<key>AbandonProcessGroup</key>");
    expect(tmpl).toContain("<key>StartInterval</key>");
  });

  test("systemd timer template: OnCalendar every minute, Persistent=false", () => {
    const tmpl = readFileSync(join(OPS, "systemd", "co-newbiz-tick@.timer"), "utf-8");
    expect(tmpl).toContain("OnCalendar=*-*-* *:*:00");
    expect(tmpl).toContain("Persistent=false");
    expect(tmpl).toContain("Unit=co-newbiz-tick@%i.service");
  });

  test("systemd service template: instance env, no secrets, renderable for both envs", () => {
    const tmpl = readFileSync(join(OPS, "systemd", "co-newbiz-tick@.service"), "utf-8");
    expect(tmpl).toContain("CO_NEWBIZ_SCHEDULER_ENV=%i");
    expect(tmpl).toContain("{{EXEC_START}}");
    const dev = inst.renderSystemdService("dev");
    expect(dev).toContain(`ExecStart=${process.execPath} scripts/co-newbiz/schedule-tick.ts`);
    expect(dev).toContain(`WorkingDirectory=${REPO_ROOT}`);
    const prod = inst.renderSystemdService("prod");
    expect(prod).toContain("ExecStart=docker exec -e CO_NEWBIZ_SCHEDULER_ENV=prod co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts");
    expect(prod).not.toContain("WorkingDirectory=");
    expect(dev).not.toMatch(/API_KEY|PASSWORD|SECRET|TOKEN/);
  });

  test("schtasks XML: template and rendered output are well-formed with a 1-minute repetition", () => {
    const tmplPath = join(OPS, "schtasks", "co-newbiz-tick.xml");
    expect(existsSync(tmplPath)).toBe(true);
    const tmpl = readFileSync(tmplPath, "utf-8");
    expect(xmlLintOk(tmpl)).toBe(true);
    expect(tmpl).toContain("<Interval>PT1M</Interval>");
    for (const env of ["dev", "prod"] as const) {
      const xml = inst.renderSchtasksXml(env);
      expect(xmlLintOk(xml)).toBe(true);
      expect(xml).toContain("<Interval>PT1M</Interval>");
      expect(xml).not.toContain("{{");
      expect(xml).not.toMatch(/API_KEY|PASSWORD|SECRET|TOKEN/);
    }
    expect(inst.renderSchtasksXml("dev")).toContain(`<WorkingDirectory>${REPO_ROOT}</WorkingDirectory>`);
    expect(inst.renderSchtasksXml("prod")).toContain("<Command>docker</Command>");
    expect(inst.renderSchtasksXml("prod")).toContain(
      "<Arguments>exec -e CO_NEWBIZ_SCHEDULER_ENV=prod co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts</Arguments>",
    );
  });
});

describe("CLI behaviour (no side effects in print/dry-run mode)", () => {
  test("--env dev --print emits the rendered plist only", () => {
    const p = runCli(["--env", "dev", "--print"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain("org.bizknights.co-newbiz.dev.tick");
    expect(out).toContain("AbandonProcessGroup");
    expect(out).toContain("scripts/co-newbiz/schedule-tick.ts");
  });

  test("--env prod --print renders the docker-exec variant", () => {
    const p = runCli(["--env", "prod", "--print"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out).toContain("org.bizknights.co-newbiz.prod.tick");
    expect(out).toContain("<string>docker</string>");
    expect(out).toContain("<string>co-newbiz-web</string>");
    expect(out).not.toContain("WorkingDirectory");
  });

  test("--env dev --dry-run prints the plan and validates without side effects", () => {
    const p = runCli(["--env", "dev", "--dry-run"]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("[dry-run] would run: launchctl bootstrap");
    expect(p.stdout.toString()).toContain("[dry-run] would write plist:");
  });

  test("--env dev --uninstall --dry-run prints bootout + removal only", () => {
    const p = runCli(["--env", "dev", "--uninstall", "--dry-run"]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("launchctl bootout");
  });

  test("--platform systemd --print emits units and the enable commands", () => {
    const p = runCli(["--env", "prod", "--platform", "systemd", "--print"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out).toContain("OnCalendar=*-*-* *:*:00");
    expect(out).toContain("systemctl --user enable --now co-newbiz-tick@prod.timer");
  });

  test("--platform schtasks prints the /Create command and never executes it", () => {
    const p = runCli(["--env", "dev", "--platform", "schtasks"]);
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out).toContain('schtasks /Create /TN "co-newbiz-dev-tick"');
    expect(out).toContain("never executes schtasks");
    expect(out).toContain("PT1M");
  });

  test("usage errors exit 2: missing --env, bad env, bad platform", () => {
    expect(runCli([]).exitCode).toBe(2);
    expect(runCli(["--env", "staging"]).exitCode).toBe(2);
    expect(runCli(["--env", "dev", "--platform", "cron"]).exitCode).toBe(2);
  });
});

describe("uninstall removes only its own plist", () => {
  test("bootout is called for our plist, the file is removed, other LaunchAgents are untouched", () => {
    const home = join(TMP, "uninstall");
    const laDir = join(home, "Library", "LaunchAgents");
    mkdirSync(laDir, { recursive: true });
    const ours = inst.launchdPlistPath("dev", home);
    const decoy = join(laDir, "org.someone-else.app.plist");
    writeFileSync(ours, "<plist version=\"1.0\"/>");
    writeFileSync(decoy, "<plist version=\"1.0\"/>");
    const booted: string[] = [];
    const r = inst.removeLaunchdPlist("dev", {
      home,
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

  test("a failed bootout still removes the file (best-effort bootout)", () => {
    const home = join(TMP, "uninstall-fail");
    const laDir = join(home, "Library", "LaunchAgents");
    mkdirSync(laDir, { recursive: true });
    const ours = inst.launchdPlistPath("dev", home);
    writeFileSync(ours, "<plist version=\"1.0\"/>");
    const r = inst.removeLaunchdPlist("dev", { home, bootout: () => ({ code: 3, stderr: "not loaded" }) });
    expect(r.bootedOut).toBe(false);
    expect(r.removed).toBe(true);
  });

  test("a missing plist means nothing to do: no bootout call, removed=false", () => {
    const home = join(TMP, "uninstall-missing");
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    let calls = 0;
    const r = inst.removeLaunchdPlist("dev", {
      home,
      bootout: () => {
        calls++;
        return { code: 0, stderr: "" };
      },
    });
    expect(r.removed).toBe(false);
    expect(calls).toBe(0);
  });
});
